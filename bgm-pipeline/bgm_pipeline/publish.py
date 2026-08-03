"""End-to-end: generate a BGM track, render it, upload to YouTube, verify
it actually finished processing (i.e. is watchable, not just that the
bytes were accepted), then delete the local audio/video files. Local
files are only deleted once that verification passes — a video that's
merely "uploaded" is not the same as "published", and this project
learned that the hard way (see docs/ORG.md's グロース/運用部 section and
the 2026-08-03 dashboard entry) after declaring a video published
without ever checking whether it actually played.

Usage:
    python -m bgm_pipeline.publish --preset sleep_rain_focus --minutes 60 --privacy public
"""
from __future__ import annotations

import argparse
import os
import sys

from . import presets, video, youtube_upload

DEFAULT_TAGS = ["sleep music", "ambient", "relaxing music", "focus music", "study music"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate, render, upload, and clean up a BGM video.")
    parser.add_argument("--preset", required=True, choices=sorted(presets.PRESETS.keys()))
    parser.add_argument("--minutes", type=float, default=60.0)
    parser.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])
    parser.add_argument("--workdir", default="/tmp/bgm-publish")
    parser.add_argument("--keep-local", action="store_true", help="skip deleting local files after upload")
    args = parser.parse_args(argv)

    meta = presets.PRESET_METADATA[args.preset]
    os.makedirs(args.workdir, exist_ok=True)

    wav_path = os.path.join(args.workdir, f"{args.preset}.wav")
    mp4_path = os.path.join(args.workdir, f"{args.preset}.mp4")

    print(f"[1/4] generating {args.minutes} min of audio ({args.preset})...")
    track = presets.PRESETS[args.preset](minutes=args.minutes)
    track.to_wav(wav_path)

    print("[2/4] rendering video...")
    video.render(wav_path, mp4_path, meta["title"], args.preset, "landscape")

    hours = args.minutes / 60
    title = f"[{hours:g} Hour] {meta['title']} | AI Generated"
    tags = DEFAULT_TAGS + meta["tags"]

    print("[3/4] uploading to YouTube...")
    video_id = youtube_upload.upload_video(
        mp4_path, title, meta["description"], tags, privacy_status=args.privacy
    )
    watch_url = f"https://youtube.com/watch?v={video_id}"
    print(f"Uploaded: {watch_url}")

    print("[4/4] waiting for YouTube to finish processing (this can take a while for long videos)...")
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

    if not args.keep_local:
        os.remove(wav_path)
        os.remove(mp4_path)
        print("Local audio/video files deleted.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
