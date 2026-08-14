"""Generates the looping background video for モヤスカ shorts — a soft,
slow parallax scroll (several depth layers of blurred blobs, each moving
horizontally at its own speed), replacing the earlier "balls bouncing in
a ring" design.

Design history:
  v1: blurred lava-lamp blob blend — "特徴のある感じが欲しい" (too plain)
  v2: static chat-bubble shapes — "ゲーム性のある...そっちにも目が行って
      しまう感じ" (too static)
  v3: chat-bubble-shaped balls, elastic-collision physics in a ring
  v4: v3 + population drift (balls spawn/despawn over time)
  v5 (this version, 2026-08-14): after watching the actual published
      video against the reference channel, the owner's verdict was that
      the ball-arena motif reads as "busy" and competes with the LINE UI
      for attention rather than sitting quietly behind it. Explicit brief
      for the replacement: multiple depth layers, slow horizontal
      movement, low saturation, high brightness (never a dark
      background), low detail so the UI stays the visual lead. Real
      camera pans / a lighting change from day to dusk / wind-blown grass
      would need photoreal or 3D rendering this project's toolchain
      (PIL/numpy/ffmpeg only, no reachable video-generation AI) can't
      produce — a parallax scroll of soft flat shapes is the agreed
      realistic stand-in, not a compromise nobody signed off on.

No external assets or footage — pure PIL/numpy synthesis, same "nothing to
license" policy as every other visual in this repo.
"""
from __future__ import annotations

import argparse
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 720, 1280
FPS = 24
DT = 1.0 / FPS

# High brightness, low saturation — the UI (mostly opaque white/pale
# panel) stays the clear visual lead; this only needs to read as "always
# something gently moving" out of the corner of the eye.
BG = (247, 243, 236)  # warm off-white, never dark

# Each layer: how fast its blobs drift sideways (px/s), their radius
# range, a desaturated color, how heavily blurred (bigger = softer/more
# distant-reading), and how many blobs. Slower + more blurred + larger =
# reads as farther away (classic parallax depth cue), matching the
# reference video's calm background pacing rather than the old arena's
# constant elastic bouncing.
LAYERS = [
    {"speed": 5,  "radius": (150, 210), "color": (214, 205, 224), "blur": 70, "count": 3},  # far
    {"speed": 13, "radius": (95, 140),  "color": (232, 210, 200), "blur": 50, "count": 4},  # mid
    {"speed": 24, "radius": (55, 85),   "color": (204, 224, 214), "blur": 32, "count": 5},  # near
]

# Background occupies the same lower region the old ball arena used to
# (line_chat.py's chat panel covers the upper ~55% of the frame) — blobs
# are seeded across the full frame height but weighted toward this band so
# motion stays visible where the panel doesn't already cover it.
VISIBLE_Y0, VISIBLE_Y1 = H * 0.42, H * 0.98


class _Blob:
    def __init__(self, rng: np.random.Generator, layer: dict, phase_offset: float) -> None:
        self.radius = float(rng.uniform(*layer["radius"]))
        self.speed = layer["speed"]
        self.color = layer["color"]
        self.blur = layer["blur"]
        # spread starting x across a band wide enough that wrap-around
        # (x mod (W + 2*radius)) never looks like blobs popping in bunched
        # up — phase_offset staggers each blob's starting position
        self.x0 = phase_offset
        self.y = float(rng.uniform(VISIBLE_Y0, VISIBLE_Y1))

    def x_at(self, t: float) -> float:
        span = W + 2 * self.radius
        return ((self.x0 + self.speed * t) % span) - self.radius


def _build_layers(seed: int) -> list[list[_Blob]]:
    rng = np.random.default_rng(seed)
    layers: list[list[_Blob]] = []
    for layer in LAYERS:
        blobs = []
        span = W + 2 * max(layer["radius"])
        for i in range(layer["count"]):
            # evenly spread starting phase across the wrap span, plus a
            # little jitter so blobs in the same layer don't move in a
            # visibly uniform row
            phase = (span / layer["count"]) * i + rng.uniform(-40, 40)
            blobs.append(_Blob(rng, layer, phase))
        layers.append(blobs)
    return layers


def compose_frame(layers: list[list[_Blob]], t: float) -> Image.Image:
    """Renders one frame (background fill + all parallax layers, far to
    near) at time `t`. Pulled out of `render_frames`'s loop, same reason
    the old ball version did this — other pipelines (line_chat.py's
    overlay) composite the LINE UI on top of this directly."""
    img = Image.new("RGB", (W, H), BG)

    for layer_blobs, layer_spec in zip(layers, LAYERS):
        glow = Image.new("RGB", (W, H), BG)
        gd = ImageDraw.Draw(glow)
        for b in layer_blobs:
            x = b.x_at(t)
            gd.ellipse([x - b.radius, b.y - b.radius, x + b.radius, b.y + b.radius], fill=b.color)
        glow = glow.filter(ImageFilter.GaussianBlur(layer_spec["blur"]))
        # blend_alpha keeps each layer soft/translucent-reading rather than
        # a flat cutout — mirrors the old version's glow-blend technique
        img = Image.blend(img, glow, 0.55)

    return img


def iter_frames(seconds: float, seed: int):
    """Generator yielding (t, Image), same contract the ball version had
    so line_chat.py's caller doesn't need to change."""
    layers = _build_layers(seed)
    n_frames = int(FPS * seconds)
    for f in range(n_frames):
        t = f / FPS
        yield t, compose_frame(layers, t)


def render_frames(out_dir: str, seconds: float, seed: int) -> int:
    import os

    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for f, (_t, img) in enumerate(iter_frames(seconds, seed)):
        img.save(f"{out_dir}/f{f:05d}.png")
        n = f + 1
    return n


def render_video(out_path: str, seconds: float, seed: int = 0) -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        render_frames(tmp, seconds, seed)
        subprocess.run(
            ["ffmpeg", "-y", "-framerate", str(FPS), "-i", f"{tmp}/f%05d.png",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", out_path],
            check=True,
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render the moyasuka parallax background video.")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    render_video(args.out, args.seconds, args.seed)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
