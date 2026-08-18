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

Wired into line_chat.py's per-frame compositing via `iter_frames_from_clip`
below (2026-08-18, owner: "1で" — go with the blurry-but-usable footage
as-is, no masking treatment). line_chat.py picks a clip from the rotation
and loops it (via this generator) to fill however long the episode runs,
falling back to background_gen.iter_frames' self-generated Ken Burns pan
when no rotation pool exists yet (e.g. a fresh checkout with no source
video split).

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


def _split_one_source(source_path: str, clip_seconds: float, out_dir: Path, name_prefix: str) -> list[Path]:
    """Crops `source_path` to a centered 9:16 window, scales to TARGET_W x
    TARGET_H, and segments into `clip_seconds`-long .mp4 files named
    `{name_prefix}_00.mp4`, `{name_prefix}_01.mp4`, ... in `out_dir`.
    Returns the list of written clip paths, in order.

    2026-08-18 history: this was originally a plain crop+scale, but the
    first source (640x360, 16:9) needed a ~5.3x upscale after cropping to
    9:16, which was visibly blurry. A "sharp center + blurred fill"
    composite was tried as a fix, but the owner rejected the blur outright
    ("背景ぼかさなくていい...ズームとかしなくていいのに") and pointed out
    accurately that crop+scale-to-fill and zero-quality-loss are
    mathematically incompatible when the source is this narrow relative to
    9:16 — there's no filter trick around that, only a better source fixes
    it. The owner then supplied a new source already shot/exported close
    to 9:16 (576x1028), so a plain crop+scale is gentle again (~1.9x, not
    5.3x) and the blur compromise is no longer needed — back to this
    simpler filter.

    Uses ffmpeg's `-f segment` muxer for the split (a single decode pass,
    not N separate re-encodes) and a crop+scale filter matched to the
    source's actual aspect ratio so this works regardless of whether the
    source is itself already 9:16, 16:9, or something else.
    """
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
    vf = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={TARGET_W}:{TARGET_H}:flags=lanczos"

    pattern = str(out_dir / f"{name_prefix}_%02d.mp4")
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
    clips = sorted(out_dir.glob(f"{name_prefix}_*.mp4"))
    if not clips:
        raise RuntimeError(f"ffmpeg produced no clips from {source_path} — check the source file/filter")
    return clips


def split_video_to_clips(source_paths: str | list[str], clip_seconds: float = DEFAULT_CLIP_SECONDS, out_dir: Path = CLIPS_DIR) -> list[Path]:
    """Splits one or more source videos into the rotation pool (see
    `_split_one_source`). Multiple sources all feed the *same* pool —
    clips are named per-source (`bg{n}_00.mp4`, `bg{n}_01.mp4`, ...) so
    filenames from different sources never collide, and the combined,
    sorted list becomes the new rotation (replacing whatever was split
    before: this always starts a fresh pool, not an incremental append,
    since re-running with a different/updated set of sources is the
    common case, not adding one clip at a time)."""
    if isinstance(source_paths, str):
        source_paths = [source_paths]

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("bg*_*.mp4"):
        old.unlink()

    all_clips: list[Path] = []
    for i, source_path in enumerate(source_paths):
        all_clips += _split_one_source(source_path, clip_seconds, out_dir, name_prefix=f"bg{i}")

    _save_state({"clips": [c.name for c in all_clips], "last_used_index": -1})
    return all_clips


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


def has_rotation_pool() -> bool:
    """True once `split_video_to_clips()` has run at least once and the
    clips it wrote are still on disk — line_chat.py uses this to decide
    whether to pull a real background clip via `next_clip()`/
    `iter_frames_from_clip()` or fall back to background_gen's
    self-generated Ken Burns pan (e.g. a fresh checkout with no source
    video split yet)."""
    return bool(_load_state().get("clips"))


def iter_frames_from_clip(clip_path: Path, seconds: float, fps: int | None = None):
    """Generator yielding (t, Image) — same contract as background_gen.
    iter_frames, so line_chat.py's caller doesn't need to know which
    backend produced the frames. Extracts `clip_path`'s frames once (via
    ffmpeg, scaled straight to the render resolution so no separate PIL
    resize pass is needed) into a temp PNG sequence, then loops through
    them frame-by-frame to fill `seconds` — a rotation clip (~15s) is
    almost always shorter than a full episode (45-60s), so looping is the
    normal case, not an edge case. Frames are read from disk one at a time
    rather than held in memory all at once (a 15s clip at 720x1280 would
    be roughly 1GB of raw RGB if fully loaded up front)."""
    import tempfile

    from moyasuka.background_gen import FPS as BG_FPS
    from moyasuka.background_gen import H as BG_H
    from moyasuka.background_gen import W as BG_W
    from PIL import Image

    fps = fps or BG_FPS
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(clip_path), "-vf", f"scale={BG_W}:{BG_H},fps={fps}", f"{tmp}/f%05d.png"],
            check=True, capture_output=True,
        )
        frame_paths = sorted(Path(tmp).glob("f*.png"))
        if not frame_paths:
            raise RuntimeError(f"ffmpeg extracted no frames from {clip_path}")

        n_frames = int(fps * seconds)
        for f in range(n_frames):
            t = f / fps
            img = Image.open(frame_paths[f % len(frame_paths)]).convert("RGB")
            yield t, img


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_split = sub.add_parser("split", help="split one or more source videos into one rotation-ready 9:16 clip pool")
    p_split.add_argument("--source", required=True, action="append", help="repeat for multiple sources; all feed the same rotation pool")
    p_split.add_argument("--clip-seconds", type=float, default=DEFAULT_CLIP_SECONDS)

    sub.add_parser("next", help="print the next clip's path and advance the rotation")

    args = parser.parse_args(argv)
    if args.command == "split":
        clips = split_video_to_clips(args.source, args.clip_seconds)
        print(f"wrote {len(clips)} clips from {len(args.source)} source(s) to {CLIPS_DIR}")
    elif args.command == "next":
        print(next_clip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
