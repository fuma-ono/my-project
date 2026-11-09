"""End-to-end: generate a BGM track and render both YouTube (16:9) and
TikTok/Reels/Shorts (9:16) MP4s for it in one call. Also prints the
title/description/tags block ready to paste into the upload form.

Usage:
    python -m bgm_pipeline.produce --preset study_lofi_chill --minutes 60
"""
from __future__ import annotations

import argparse
import os
import sys

from . import presets, video


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate audio + both video orientations for a preset.")
    parser.add_argument("--preset", required=True, choices=sorted(presets.PRESETS.keys()))
    parser.add_argument("--minutes", type=float, default=3.0)
    parser.add_argument("--outdir", default="output")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args(argv)

    if args.seed is not None:
        import numpy as np

        np.random.seed(args.seed)

    os.makedirs(args.outdir, exist_ok=True)
    meta = presets.PRESET_METADATA[args.preset]

    wav_path = os.path.join(args.outdir, f"{args.preset}.wav")
    track = presets.PRESETS[args.preset](minutes=args.minutes)
    track.to_wav(wav_path)
    print(f"[audio] {wav_path} ({args.minutes} min)")

    landscape_path = os.path.join(args.outdir, f"{args.preset}_youtube.mp4")
    video.render(wav_path, landscape_path, meta["title"], args.preset, "landscape")
    print(f"[video] {landscape_path} (1920x1080, YouTube)")

    vertical_path = os.path.join(args.outdir, f"{args.preset}_shorts.mp4")
    video.render(wav_path, vertical_path, meta["title"], args.preset, "vertical")
    print(f"[video] {vertical_path} (1080x1920, TikTok/Reels/Shorts)")

    print("\n--- upload metadata ---")
    print(f"Title: {meta['title']}")
    print(f"Description: {meta['description']}")
    print(f"Tags: {', '.join(meta['tags'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
