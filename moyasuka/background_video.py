"""Splits a real-footage source video (e.g. a Minecraft parkour/obstacle-
course playthrough) into short 9:16 clips and manages round-robin rotation
across them, so each rendered モヤスカ episode gets a different background
segment instead of reusing the same footage every time.

Why this exists (owner instruction, 2026-08-18): "まずは背景動画から変え
ていこう" — moving away from background_gen.py's fully self-generated Ken
Burns photo pan toward real gameplay footage, the same "思わず見てしまう"
(可's own words) effect this genre's reference channels get from Minecraft
parkour backgrounds. This reverses a documented decision
(docs/projects/moyasuka/background.md) to avoid real gameplay footage —
see that file's reasoning (fetch/licensing concerns) for the tradeoff being
made here; a conscious reversal, not an oversight.

This module only handles the parts that don't need the actual source file
yet: splitting + rotation bookkeeping. It does NOT fetch anything — this
cloud sandbox cannot reach YouTube's video/CDN hosts at all (confirmed
repeatedly across this repo, e.g. moyasuka/note_publish's docstrings for
the same constraint against other sites). The owner supplies the source
video file directly (downloaded on their own machine, rights confirmed);
this module takes it from there.

Not yet wired into line_chat.py's per-frame compositing (background_gen.
iter_frames) — that's a real architecture question (decoding real video
frames in sync with the chat overlay loop, vs. compositing as a separate
ffmpeg pass) deliberately deferred until there's an actual source clip to
test against, rather than guessing at an integration no one can verify yet.

Usage (once a source file exists):
    python3 -m moyasuka.background_video split \\
        --source /path/to/parkour.mp4 --clip-seconds 15
    python3 -m moyasuka.background_video next   # prints the next clip's path, advances rotation
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

CLIPS_DIR = Path(__file__).resolve().parent / "assets" / "background_video_clips"
ROTATION_STATE_PATH = CLIPS_DIR / "rotation_state.json"

# 1080x1920: the resolution the owner's instruction specified. Deliberately
# higher than background_gen.py's own 720x1280 render resolution (see that
# module's W/H) — downscaling a higher-res source at composite time is
# lossless-enough and keeps this module decoupled from line_chat.py's
# current frame size, which may change independently.
TARGET_W, TARGET_H = 1080, 1920

DEFAULT_CLIP_SECONDS = 15.0


def split_video_to_clips(source_path: str, clip_seconds: float = DEFAULT_CLIP_SECONDS, out_dir: Path = CLIPS_DIR) -> list[Path]:
    """Crops `source_path` to a centered 9:16 window (owner instruction:
    "プレイヤー視点の中央を優先する" — parkour footage is usually already
    roughly centered on the player, so a plain center-crop is the
    reasonable default; revisit with real footage if that's not true),
    scales to TARGET_W x TARGET_H, and segments into `clip_seconds`-long
    .mp4 files named background_01.mp4, background_02.mp4, ... in
    `out_dir`. Returns the list of written clip paths, in order.

    Uses ffmpeg's `-f segment` muxer for the split (a single decode pass,
    not N separate re-encodes) and a crop+scale filter matched to the
    source's actual aspect ratio so this works regardless of whether the
    source is itself already 9:16, 16:9, or something else:
      - crop to the largest centered 9:16 (or already-9:16 source: no-op
        crop) window, then scale to TARGET_W x TARGET_H.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("background_*.mp4"):
        old.unlink()

    # Compute the centered 9:16 crop window in Python against the source's
    # *actual* pixel dimensions (via ffprobe), rather than an in-filter
    # if()/gt() expression — ffmpeg's filtergraph parser treats a bare `,`
    # inside -vf as a filter-chain separator, so an unescaped comma-bearing
    # expression like `if(gt(a,b),c,d)` silently breaks the graph ("No such
    # filter: '...'"). Plain integers sidestep that whole escaping problem.
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", source_path],
        check=True, capture_output=True, text=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    src_w, src_h = stream["width"], stream["height"]
    target_ar = TARGET_W / TARGET_H
    if src_w / src_h > target_ar:
        crop_h = src_h
        crop_w = round(src_h * target_ar)
    else:
        crop_w = src_w
        crop_h = round(src_w / target_ar)
    crop_x = (src_w - crop_w) // 2
    crop_y = (src_h - crop_h) // 2
    vf = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={TARGET_W}:{TARGET_H}"

    pattern = str(out_dir / "background_%02d.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", source_path,
            "-vf", vf,
            "-an",  # background footage is muted in the final composite (narration/BGM/sfx own the audio track)
            "-f", "segment", "-segment_time", str(clip_seconds),
            "-reset_timestamps", "1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            pattern,
        ],
        check=True, capture_output=True,
    )
    clips = sorted(out_dir.glob("background_*.mp4"))
    if not clips:
        raise RuntimeError(f"ffmpeg produced no clips from {source_path} — check the source file/filter")

    _save_state({"clips": [c.name for c in clips], "last_used_index": -1})
    return clips


def _load_state() -> dict:
    if not ROTATION_STATE_PATH.exists():
        return {"clips": [], "last_used_index": -1}
    return json.loads(ROTATION_STATE_PATH.read_text(encoding="utf-8"))


def _save_state(state: dict) -> None:
    ROTATION_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ROTATION_STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def next_clip(clips_dir: Path = CLIPS_DIR) -> Path:
    """Round-robin picker: returns the next clip in rotation and persists
    the advance, so the *next* call (from the *next* episode's render, a
    separate process) continues from where this one left off instead of
    always starting over at clip 1. Loops back to the start after the last
    clip (owner instruction: "全クリップを使い切ったら最初に戻る")."""
    state = _load_state()
    clips = state.get("clips", [])
    if not clips:
        raise RuntimeError(
            f"no clips found in {clips_dir} — run `split_video_to_clips()` "
            "(or `python3 -m moyasuka.background_video split --source ...`) first"
        )
    idx = (state.get("last_used_index", -1) + 1) % len(clips)
    state["last_used_index"] = idx
    _save_state(state)
    return clips_dir / clips[idx]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_split = sub.add_parser("split", help="split a source video into rotation-ready 9:16 clips")
    p_split.add_argument("--source", required=True)
    p_split.add_argument("--clip-seconds", type=float, default=DEFAULT_CLIP_SECONDS)

    sub.add_parser("next", help="print the next clip's path and advance the rotation")

    args = parser.parse_args(argv)
    if args.command == "split":
        clips = split_video_to_clips(args.source, args.clip_seconds)
        print(f"wrote {len(clips)} clips to {CLIPS_DIR}")
    elif args.command == "next":
        print(next_clip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
