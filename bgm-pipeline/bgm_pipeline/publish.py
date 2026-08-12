"""End-to-end: generate a BGM track, render it, upload to YouTube, verify
it actually finished processing (i.e. is watchable, not just that the
bytes were accepted), then delete the local audio/video files. Local
files are only deleted once that verification passes — a video that's
merely "uploaded" is not the same as "published", and this project
learned that the hard way (see docs/ORG.md's グロース/運用部 section and
the 2026-08-03 dashboard entry) after declaring a video published
without ever checking whether it actually played.

Usage:
    python -m bgm_pipeline.publish --minutes 60 --privacy public
    python -m bgm_pipeline.publish --preset sleep_rain_focus --minutes 60 --privacy public

If --preset is omitted, the next preset in the rotation is picked
automatically (see rotation.py) so the channel doesn't post the same
content repeatedly.
"""
from __future__ import annotations

import argparse
import os
import sys

from . import presets, rotation, thumbnail, video, youtube_upload

DEFAULT_TAGS = ["ambient music", "background music", "AI generated music", "royalty free music"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate, render, upload, and clean up a BGM video.")
    parser.add_argument("--preset", choices=sorted(presets.PRESETS.keys()), help="omit to auto-pick from the rotation")
    parser.add_argument("--minutes", type=float, default=60.0)
    parser.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])
    parser.add_argument("--workdir", default="/tmp/bgm-publish")
    parser.add_argument("--keep-local", action="store_true", help="skip deleting local files after upload")
    args = parser.parse_args(argv)

    if args.preset is None:
        args.preset = rotation.next_preset("long")
        print(f"No --preset given, picked from rotation: {args.preset}")

    meta = presets.PRESET_METADATA[args.preset]
    os.makedirs(args.workdir, exist_ok=True)

    wav_path = os.path.join(args.workdir, f"{args.preset}.wav")
    mp4_path = os.path.join(args.workdir, f"{args.preset}.mp4")
    thumb_path = os.path.join(args.workdir, f"{args.preset}_thumb.jpg")

    print(f"[1/5] generating {args.minutes} min of audio ({args.preset})...")
    track = presets.PRESETS[args.preset](minutes=args.minutes)
    track.to_wav(wav_path)

    print("[2/5] rendering video...")
    video.render(wav_path, mp4_path, meta["thumb_hook"], args.preset, "landscape")

    print("[3/5] generating custom thumbnail...")
    if meta.get("thumbnail_style") == "scene":
        thumbnail.make_breath_scene_thumbnail(thumb_path, meta["thumb_hook"], args.minutes)
    else:
        thumbnail.make_thumbnail(thumb_path, args.preset, meta["thumb_hook"], meta["icon_category"], args.minutes)

    title = meta["title"]
    description = presets.build_description(args.preset, args.minutes)
    tags = DEFAULT_TAGS + meta["tags"]

    print("[4/5] uploading to YouTube...")
    video_id = youtube_upload.upload_video(
        mp4_path, title, description, tags, privacy_status=args.privacy
    )
    watch_url = f"https://youtube.com/watch?v={video_id}"
    print(f"Uploaded: {watch_url}")

    print("[5/5] waiting for YouTube to finish processing (this can take a while for long videos)...")
    try:
        youtube_upload.wait_for_processing(video_id)
    except youtube_upload.VideoProcessingFailed as exc:
        print(f"UPLOAD FAILED PROCESSING: {exc}")
        print(f"Local files kept at {wav_path} / {mp4_path} for inspection — not deleting a failed upload.")
        return 1
    except TimeoutError as exc:
        print(f"STILL PROCESSING, not confirmed watchable yet: {exc}")
        print(f"Local files kept at {wav_path} / {mp4_path} — re-run with --keep-local check later, or verify manually and delete yourself.")
        return 1

    print(f"Confirmed watchable: {watch_url}")
    rotation.set_last_long_form(video_id)

    try:
        youtube_upload.set_thumbnail(video_id, thumb_path)
        print("Custom thumbnail set.")
    except Exception as exc:  # noqa: BLE001 — a bad thumbnail shouldn't undo a successful publish
        print(f"Thumbnail upload failed (video is still published fine): {exc}")

    if not args.keep_local:
        os.remove(wav_path)
        os.remove(mp4_path)
        os.remove(thumb_path)
        print("Local audio/video/thumbnail files deleted.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
