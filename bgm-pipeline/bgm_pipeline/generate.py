"""CLI: render a preset to a WAV file.

Usage:
    python -m bgm_pipeline.generate --preset sleep_deep_drone --minutes 3 --out output/sleep_deep_drone.wav
"""
from __future__ import annotations

import argparse
import sys
import time

from . import presets


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate an AI-composed BGM track.")
    parser.add_argument("--preset", required=True, choices=sorted(presets.PRESETS.keys()))
    parser.add_argument("--minutes", type=float, default=3.0)
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args(argv)

    if args.seed is not None:
        import numpy as np

        np.random.seed(args.seed)

    start = time.time()
    track_fn = presets.PRESETS[args.preset]
    track = track_fn(minutes=args.minutes)
    track.to_wav(args.out)
    elapsed = time.time() - start
    print(f"generated {args.out} ({args.minutes} min, preset={args.preset}) in {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
