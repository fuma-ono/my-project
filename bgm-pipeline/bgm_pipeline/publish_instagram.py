"""End-to-end: generate a short vertical clip, host it temporarily on GCS,
publish it to Instagram as a Reel, then clean up (GCS object + local
files). Nothing is kept on disk or in cloud storage after a successful
publish.

Usage:
    python -m bgm_pipeline.publish_instagram --preset sleep_rain_focus --seconds 45 --bucket my-bucket
"""
from __future__ import annotations

import argparse
import os
import sys

from . import gcs_temp_host, instagram_upload, presets, video

DEFAULT_HASHTAGS = "#sleepmusic #ambient #relaxingmusic #focusmusic #lofi"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate, host, and publish a Reel.")
    parser.add_argument("--preset", required=True, choices=sorted(presets.PRESETS.keys()))
    parser.add_argument("--seconds", type=float, default=45.0, help="Reels must be 5-90s to land in the Reels tab")
    parser.add_argument("--bucket", required=True, help="GCS bucket used for temporary public hosting")
    parser.add_argument("--workdir", default="/tmp/ig-publish")
    parser.add_argument("--keep-local", action="store_true")
    args = parser.parse_args(argv)

    if not (5 <= args.seconds <= 90):
        print("Warning: outside 5-90s, this will publish as a regular video post, not a Reel.")

    meta = presets.PRESET_METADATA[args.preset]
    minutes = args.seconds / 60
    os.makedirs(args.workdir, exist_ok=True)

    wav_path = os.path.join(args.workdir, f"{args.preset}.wav")
    mp4_path = os.path.join(args.workdir, f"{args.preset}_reel.mp4")

    print("[1/4] generating audio...")
    track = presets.PRESETS[args.preset](minutes=minutes)
    track.to_wav(wav_path)

    print("[2/4] rendering vertical video...")
    video.render(wav_path, mp4_path, meta["title"], args.preset, "vertical")

    print("[3/4] hosting temporarily and publishing to Instagram...")
    public_url, object_name = gcs_temp_host.upload_public(mp4_path, args.bucket)
    caption = f"{meta['description']}\n\n{DEFAULT_HASHTAGS}"
    try:
        media_id = instagram_upload.publish_reel(public_url, caption)
        print(f"Published: media id {media_id}")
    finally:
        gcs_temp_host.delete_object(args.bucket, object_name)

    print("[4/4] cleaning up local files...")
    if not args.keep_local:
        os.remove(wav_path)
        os.remove(mp4_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
