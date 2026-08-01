"""End-to-end: generate a BGM track, render it, upload to YouTube, then
delete the local audio/video files. This is the standard way to ship a
video going forward — nothing is kept on disk after a successful upload.

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

    print(f"[1/3] generating {args.minutes} min of audio ({args.preset})...")
    track = presets.PRESETS[args.preset](minutes=args.minutes)
    track.to_wav(wav_path)

    print("[2/3] rendering video...")
    video.render(wav_path, mp4_path, meta["title"], args.preset, "landscape")

    hours = args.minutes / 60
    title = f"[{hours:g} Hour] {meta['title']} | AI Generated"
    tags = DEFAULT_TAGS + meta["tags"]

    print("[3/3] uploading to YouTube...")
    video_id = youtube_upload.upload_video(
        mp4_path, title, meta["description"], tags, privacy_status=args.privacy
    )
    print(f"Published: https://youtube.com/watch?v={video_id}")

    if not args.keep_local:
        os.remove(wav_path)
        os.remove(mp4_path)
        print("Local audio/video files deleted.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
