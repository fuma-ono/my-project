"""End-to-end for a YouTube Short: generate a short vertical clip, render,
upload, verify processing, then clean up local files. Nothing here
uploaded Shorts before this — the vertical file produce.py made was
never actually pushed to YouTube.

Shorts get almost no benefit from a custom thumbnail (viewed full-screen
in a swipe feed, not a browse grid), so this skips thumbnail generation
to keep things simple — worth adding if that turns out to matter for
search/browse placement.

Usage:
    python -m bgm_pipeline.publish_shorts --seconds 45
    python -m bgm_pipeline.publish_shorts --preset sleep_rain_focus --seconds 45 --link-video-id cCFbFsWHX80

If --preset is omitted, the next preset in the Shorts rotation is picked
automatically (tracked separately from the long-form rotation, see
rotation.py). --link-video-id points the description at a matching
long-form upload, which is the whole point of Shorts for this channel:
pull viewers into the long-form video that actually earns watch time.
"""
from __future__ import annotations

import argparse
import os
import sys

from . import presets, rotation, video, youtube_upload

DEFAULT_TAGS = ["ambient music", "background music", "AI generated music", "shorts"]
PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _shorts_description(preset: str, link_video_id: str | None) -> str:
    """2026-08-25: rewrote in Japanese — previously the hook (Japanese)
    was followed by English boilerplate (link line, note.com line),
    inconsistent for a JP-first channel. Shorts get 15〜20x the views of
    long-form on this channel (docs/marketing/2026-08-17-bgm-engagement-
    analysis.md), so this description is the highest-traffic surface on
    the channel — worth getting right. Also adds the same engagement
    question used in the long-form description (build_description above)
    so Shorts, the actual discovery channel, carry the comment-bait too.
    """
    meta = presets.PRESET_METADATA[preset]
    hashtags = " ".join(f"#{h}" for h in meta["hashtags"][:3]) + " #Shorts"
    link_line = (
        f"\n\nフルバージョン(ノンストップ再生)はこちら: https://youtube.com/watch?v={link_video_id}"
        if link_video_id else ""
    )
    question = presets.ENGAGEMENT_QUESTION.get(meta["icon_category"], presets.ENGAGEMENT_QUESTION["sleep"])
    return f"{meta['hook']}{link_line}\n\n{question}\n\nもっと読む: {presets.NOTE_URL}\n\n{hashtags}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate, render, upload, and clean up a YouTube Short.")
    parser.add_argument("--preset", choices=sorted(presets.PRESETS.keys()), help="omit to auto-pick from the Shorts rotation")
    parser.add_argument("--seconds", type=float, default=45.0, help="must stay under YouTube's 3-minute Shorts limit")
    parser.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])
    parser.add_argument("--link-video-id", help="ID of a matching long-form video to promote in the description")
    parser.add_argument("--workdir", default="/tmp/bgm-publish")
    parser.add_argument("--keep-local", action="store_true", help="skip deleting local files after upload")
    args = parser.parse_args(argv)

    if args.seconds > 180:
        raise SystemExit("--seconds must be under 180 (3 minutes) to qualify as a YouTube Short.")

    if args.preset is None:
        args.preset = rotation.next_preset("shorts")
        print(f"No --preset given, picked from rotation: {args.preset}")

    if args.link_video_id is None:
        args.link_video_id = rotation.get_last_long_form()
        if args.link_video_id:
            print(f"No --link-video-id given, linking to last long-form upload: {args.link_video_id}")

    minutes = args.seconds / 60
    meta = presets.PRESET_METADATA[args.preset]
    os.makedirs(args.workdir, exist_ok=True)

    wav_path = os.path.join(args.workdir, f"{args.preset}_short.wav")
    mp4_path = os.path.join(args.workdir, f"{args.preset}_short.mp4")

    print(f"[1/3] generating {args.seconds:g}s of audio ({args.preset})...")
    track = presets.PRESETS[args.preset](minutes=minutes)
    track.to_wav(wav_path)

    print("[2/3] rendering vertical video...")
    if meta.get("thumbnail_style") == "photo":
        # 2026-08-25: Shorts previously always used the abstract
        # gradient renderer regardless of preset, even for presets that
        # had real photos in long-form — a leftover from before the
        # photo-background style existed, never revisited. Now matches
        # long-form's look and, per owner instruction ("これから全写真
        # 使って"), actually puts the photo pool to use — Shorts publish
        # daily now, so this is where most of the rotation happens.
        photo_source = os.path.join(PACKAGE_ROOT, rotation.next_thumbnail_source(args.preset))
        video.render_photo_background(wav_path, mp4_path, photo_source, "vertical")
    else:
        video.render(wav_path, mp4_path, meta["thumb_hook"], args.preset, "vertical")

    title = f"{meta['title']} #Shorts"
    description = _shorts_description(args.preset, args.link_video_id)
    tags = DEFAULT_TAGS + meta["tags"][:5]

    print("[3/3] uploading to YouTube...")
    video_id = youtube_upload.upload_video(mp4_path, title, description, tags, privacy_status=args.privacy)
    watch_url = f"https://youtube.com/watch?v={video_id}"
    print(f"Uploaded: {watch_url}")

    try:
        youtube_upload.wait_for_processing(video_id, timeout_seconds=600)
        print(f"Confirmed watchable: {watch_url}")
    except youtube_upload.VideoProcessingFailed as exc:
        print(f"UPLOAD FAILED PROCESSING: {exc}")
        print(f"Local files kept at {wav_path} / {mp4_path} for inspection — not deleting a failed upload.")
        return 1
    except TimeoutError as exc:
        print(f"STILL PROCESSING, not confirmed watchable yet: {exc}")
        print(f"Local files kept at {wav_path} / {mp4_path} — check manually and delete yourself.")
        return 1

    if not args.keep_local:
        os.remove(wav_path)
        os.remove(mp4_path)
        print("Local audio/video files deleted.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
