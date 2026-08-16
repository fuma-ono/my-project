"""Generates the looping background video for モヤスカ shorts — a slow
"Ken Burns" pan/zoom across a real photo, plus a light sparkle-flicker
layer seeded from that photo's own bright pixels.

Design history:
  v1: blurred lava-lamp blob blend — "特徴のある感じが欲しい" (too plain)
  v2: static chat-bubble shapes — "ゲーム性のある...そっちにも目が行って
      しまう感じ" (too static)
  v3: chat-bubble-shaped balls, elastic-collision physics in a ring
  v4: v3 + population drift (balls spawn/despawn over time)
  v5: soft blurred-blob parallax scroll (3 depth layers, no recognizable
      shapes) — the ball-arena motif read as "busy" against the reference
      channel. Real camera pans / lighting changes / wind-blown grass
      would need photoreal or 3D rendering this toolchain (PIL/numpy/
      ffmpeg only) can't produce.
  v6: "マイクラ風" blocky 3-layer parallax (mountains/forest/grass-blocks)
      per an explicit owner brief — genuinely within reach since Minecraft's
      own look is flat-shaded rectangles.
  v7 (this version, 2026-08-16): the owner wanted something closer to a
      real ocean photo than any procedural shader could produce (tried and
      rejected: a from-scratch numpy water shader, see git history) and
      asked to animate an actual reference photo directly. This is a
      deliberate, one-time exception to this repo's "everything self-
      generated, nothing to license" policy that every other visual here
      follows — the owner confirmed the source photo(s) are their own
      AI-generated images, not third-party stock, so there's no rights
      question, but this module now depends on real binary image assets
      (moyasuka/assets/backgrounds/*) instead of drawing everything from
      code. Drop additional photos into that directory to add rotation
      variety; nothing else needs to change.

No image-to-video model is reachable from this toolchain, so there is no
real water simulation here — what this actually does is a slow ping-pong
pan+zoom (a "Ken Burns" camera move) across the source photo, plus a
sparkle-flicker overlay seeded from the photo's own brightest pixels (its
real specular highlights), so the added twinkle sits on genuine bright
spots instead of hallucinating new ones. This is a moving photo, not a
simulated ocean, and is documented as such rather than oversold.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 720, 1280
FPS = 24
TARGET_AR = W / H

BACKGROUND_DIR = Path(__file__).parent / "assets" / "backgrounds"

PAN_PERIOD_S = 22.0          # full there-and-back cycle of the horizontal/vertical pan
ZOOM_MIN, ZOOM_MAX = 1.0, 1.10  # gentle zoom breathing on top of the pan
HORIZON_ANCHOR = 0.42        # keeps a landscape photo's horizon roughly this far down the frame instead of drifting vertically

SPARKLE_MIN_LUM = 215        # only the photo's own brightest pixels seed sparkle candidates
SPARKLE_Y_FRACTION = 0.46    # restrict candidates to below this fraction of the source height (keeps sparkle off sky/clouds)
SPARKLE_COUNT = 220
SPARKLE_FLICKER_THRESHOLD = 0.55  # fraction of frames a given seed stays dark — keeps flicker sparse, not a solid glitter sheet

BRIGHTEN_BAND_CENTER_Y = 375  # matches line_chat.py's PANEL_TOP..PANEL_BOTTOM midpoint (kept as a literal to avoid importing line_chat.py here)
BRIGHTEN_SIGMA = 260
BRIGHTEN_PEAK = 0.13


def _list_photos() -> list[Path]:
    exts = ("*.png", "*.jpg", "*.jpeg")
    paths: list[Path] = []
    for ext in exts:
        paths.extend(BACKGROUND_DIR.glob(ext))
    if not paths:
        raise FileNotFoundError(
            f"no background photos found in {BACKGROUND_DIR} — drop at least one .png/.jpg in there"
        )
    return sorted(paths)


class _PhotoLayers:
    """Everything derived once from a single source photo: the pixel data,
    its Ken-Burns crop geometry, and its sparkle seed points. Built once
    per render (see _build_layers) and reused across every frame, same
    reasoning every earlier version of this module had for not redoing
    per-frame work that doesn't change per-frame."""

    def __init__(self, path: Path, seed: int):
        self.img = Image.open(path).convert("RGB")
        self.src_w, self.src_h = self.img.size
        src_np = np.asarray(self.img).astype(np.float32)

        src_ar = self.src_w / self.src_h
        if src_ar >= TARGET_AR:
            # source is relatively wider than the target 9:16 — use the
            # full source height, crop a narrower width, pan horizontally
            self.base_h = float(self.src_h)
            self.base_w = self.base_h * TARGET_AR
            self.pan_axis = "x"
        else:
            # source is relatively taller — use the full width, crop a
            # shorter height, pan vertically instead
            self.base_w = float(self.src_w)
            self.base_h = self.base_w / TARGET_AR
            self.pan_axis = "y"

        # sparkle candidates: the photo's own brightest pixels, restricted
        # to the lower portion (water/ground, not sky) — see module docstring
        lum = src_np.mean(axis=2)
        y0 = int(self.src_h * SPARKLE_Y_FRACTION)
        mask = np.zeros_like(lum, dtype=bool)
        mask[y0:, :] = lum[y0:, :] > SPARKLE_MIN_LUM
        ys, xs = np.nonzero(mask)
        rng = np.random.default_rng(seed)
        if len(xs) > 0:
            idx = rng.choice(len(xs), size=min(SPARKLE_COUNT, len(xs)), replace=False)
            self.sparkle_seeds = np.stack([xs[idx], ys[idx]], axis=1).astype(np.float32)
        else:
            self.sparkle_seeds = np.empty((0, 2), dtype=np.float32)

        # stagger each render's pan so reusing the same photo across
        # multiple videos doesn't look identical every time
        self.phase_offset = rng.uniform(0, PAN_PERIOD_S)
        self.pan_direction = 1 if rng.random() < 0.5 else -1


def _build_layers(seed: int) -> _PhotoLayers:
    photos = _list_photos()
    photo_path = photos[seed % len(photos)]
    return _PhotoLayers(photo_path, seed)


def _pingpong(t: float, period: float) -> float:
    """0..1..0 triangle wave — avoids a hard jump-cut if playback loops."""
    phase = (t % period) / period
    return 1 - abs(2 * phase - 1)


_BRIGHTEN_WEIGHTS = np.exp(-0.5 * ((np.arange(H, dtype=np.float32) - BRIGHTEN_BAND_CENTER_Y) / BRIGHTEN_SIGMA) ** 2)


def compose_frame(layers: _PhotoLayers, t: float) -> Image.Image:
    """Renders one frame: crop+resize the Ken-Burns window at time `t`,
    layer the sparkle flicker on top (seeded from the photo's own
    highlights), then the same center-brighten band every earlier version
    of this module used to keep the chat UI legible."""
    p = _pingpong(layers.phase_offset + layers.pan_direction * t, PAN_PERIOD_S)
    zoom = ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * (0.5 - 0.5 * np.cos(2 * np.pi * t / (PAN_PERIOD_S * 2)))
    cw, ch = layers.base_w / zoom, layers.base_h / zoom

    if layers.pan_axis == "x":
        x0 = p * (layers.src_w - cw)
        y0 = (layers.src_h - ch) * HORIZON_ANCHOR
    else:
        x0 = (layers.src_w - cw) * 0.5
        y0 = p * (layers.src_h - ch)

    crop = layers.img.crop((x0, y0, x0 + cw, y0 + ch)).resize((W, H), Image.LANCZOS).convert("RGBA")

    if len(layers.sparkle_seeds):
        rng = np.random.default_rng(int(t * 1000) + 99991)
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        for sx, sy in layers.sparkle_seeds:
            if not (x0 <= sx < x0 + cw and y0 <= sy < y0 + ch):
                continue
            twinkle = rng.random()
            if twinkle < SPARKLE_FLICKER_THRESHOLD:
                continue
            fx = (sx - x0) / cw * W
            fy = (sy - y0) / ch * H
            r = 2.0 + 3.0 * rng.random()
            alpha = int(90 + 140 * (twinkle - SPARKLE_FLICKER_THRESHOLD) / (1 - SPARKLE_FLICKER_THRESHOLD))
            od.ellipse([fx - r, fy - r, fx + r, fy + r], fill=(255, 255, 255, alpha))
        overlay = overlay.filter(ImageFilter.GaussianBlur(0.6))
        crop.alpha_composite(overlay)

    frame = np.asarray(crop.convert("RGB")).astype(np.float32)
    brighten = (_BRIGHTEN_WEIGHTS * BRIGHTEN_PEAK)[:, None, None]
    frame = frame + brighten * (255 - frame)

    return Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8), mode="RGB")


def iter_frames(seconds: float, seed: int):
    """Generator yielding (t, Image), same contract every earlier version
    had so line_chat.py's caller doesn't need to change."""
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
    parser = argparse.ArgumentParser(description="Render the モヤスカ Ken-Burns photo background video.")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--seed", type=int, default=0, help="also selects which photo in assets/backgrounds/ to use (seed % photo count)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    render_video(args.out, args.seconds, args.seed)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
