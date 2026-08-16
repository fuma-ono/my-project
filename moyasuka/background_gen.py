"""Generates the looping background video for モヤスカ shorts — a low-
saturation, "マイクラ風" (Minecraft-style) blocky parallax scroll: a distant
mountains+sky layer, a mid-ground forest layer, and a fast-scrolling
foreground grass-block ground layer, each drifting sideways at its own
speed.

Design history:
  v1: blurred lava-lamp blob blend — "特徴のある感じが欲しい" (too plain)
  v2: static chat-bubble shapes — "ゲーム性のある...そっちにも目が行って
      しまう感じ" (too static)
  v3: chat-bubble-shaped balls, elastic-collision physics in a ring
  v4: v3 + population drift (balls spawn/despawn over time)
  v5: after watching the actual published video against the reference
      channel, the owner's verdict was that the ball-arena motif reads as
      "busy" and competes with the LINE UI for attention. Replaced with a
      soft blurred-blob parallax scroll (3 depth layers, no recognizable
      shapes) — real camera pans / a lighting change from day to dusk /
      wind-blown grass would need photoreal or 3D rendering this project's
      toolchain (PIL/numpy/ffmpeg only, no reachable video-generation AI)
      can't produce.
  v6 (this version, 2026-08-16): owner's follow-up brief specifically asked
      for "マイクラ風パララックス" — mountains/sky (far), forest (mid),
      grass blocks (near), each layer horizontally scrolling at a
      specified px/frame speed, low saturation, loopable, with the screen
      center brightened so the (now background-less, see line_chat.py's
      2026-08-16 revision) chat bubbles stay legible sitting directly on
      top of it. Unlike v5's brief, blocky/pixel-art scenery like this
      genuinely IS within this toolchain's reach — Minecraft's own look is
      flat-shaded rectangles, which is exactly what PIL primitives draw —
      so this is a real implementation of the request, not a compromise
      stand-in.

Each layer is authored once as a single seamless tile exactly TILE_W (=W)
pixels wide — sine-periodic mountains, evenly-spaced trees, and a block
grid whose block size evenly divides TILE_W — then scrolled per-frame by
pasting the same tile twice side by side at a shifting offset. Because the
tile's right edge is mathematically identical to its left edge, this loops
with no visible seam at any speed or duration.

No external assets or footage — pure PIL/numpy synthesis, same "nothing to
license" policy as every other visual in this repo.
"""
from __future__ import annotations

import argparse
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 720, 1280
FPS = 24
DT = 1.0 / FPS

TILE_W = W  # each layer's authored pattern repeats every TILE_W px — see
            # module docstring for why this makes scrolling seamless

# Owner spec (2026-08-16): px/frame speeds, slowest-to-fastest = farthest-
# to-nearest (classic parallax depth cue). Converted to px/s (this module's
# internal unit, from v5) by multiplying by FPS.
FAR_SPEED = 0.4 * FPS    # mountains + sky, ~9.6 px/s (spec: 0.3-0.5px/frame)
MID_SPEED = 1.3 * FPS    # forest, ~31.2 px/s (spec: 1-1.5px/frame)
NEAR_SPEED = 2.5 * FPS   # grass blocks, ~60 px/s (spec: 2-3px/frame)

# Vertical bands, top to bottom: sky -> mountain silhouette -> forest
# canopy -> grass-block ground. Chosen so mountain peaks stay clear of
# line_chat.py's chat panel (PANEL_TOP=50..PANEL_BOTTOM=700) most of the
# time — bubbles float over plain sky, the "ゲーム性" motion is concentrated
# lower on the screen where it doesn't fight the UI for attention.
HORIZON_Y = int(H * 0.62)    # mountain silhouette's base line
FOREST_BASE_Y = int(H * 0.66)  # tree trunks sit on this line
GRASS_TOP_Y = int(H * 0.68)   # grass-block ground starts here, runs to H

# Low saturation, high brightness — colors blended toward gray the same
# ~35% the evidence-chart bars use (owner precedent: quiet background,
# UI/chat stays the visual lead), never a dark palette.
SKY_TOP_COLOR = (211, 221, 224)
SKY_HORIZON_COLOR = (232, 227, 213)
MOUNTAIN_COLOR = (182, 178, 194)
FOREST_TRUNK_COLOR = (162, 142, 118)
FOREST_LEAF_COLOR = (156, 176, 148)
GRASS_TOP_COLOR = (152, 182, 138)
GRASS_DIRT_COLOR = (168, 143, 116)


def _darken(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, int(c * factor)) for c in color)


def _sky_gradient(w: int, h: int) -> Image.Image:
    top, bot = np.array(SKY_TOP_COLOR), np.array(SKY_HORIZON_COLOR)
    ys = np.linspace(0.0, 1.0, h)[:, None]
    row = (top[None, :] * (1 - ys) + bot[None, :] * ys).astype(np.uint8)  # (h, 3)
    arr = np.repeat(row[:, None, :], w, axis=1)  # (h, w, 3)
    return Image.fromarray(arr, mode="RGB")


def _build_far_tile(rng: np.random.Generator) -> Image.Image:
    """Sky + mountain silhouette, opaque, covers the full frame height —
    this is the base every frame starts from (nothing behind it needs to
    show through). Two sine harmonics give the ridge a jagged-but-gentle
    profile; both are exact periods of TILE_W so x=0 and x=TILE_W land on
    identical y, which is what makes the tile seamless when scrolled."""
    img = _sky_gradient(TILE_W, H)
    draw = ImageDraw.Draw(img)
    amp1 = rng.uniform(40, 60)
    amp2 = rng.uniform(15, 25)
    phase = rng.uniform(0, 2 * math.pi)
    pts = []
    for x in range(0, TILE_W + 1, 6):
        y = (
            HORIZON_Y
            - amp1 * math.sin(2 * math.pi * x / TILE_W)
            - amp2 * math.sin(4 * math.pi * x / TILE_W + phase)
        )
        pts.append((x, y))
    draw.polygon(pts + [(TILE_W, H), (0, H)], fill=MOUNTAIN_COLOR)
    return img.filter(ImageFilter.GaussianBlur(2))  # soft/distant read


def _build_mid_tile(rng: np.random.Generator) -> Image.Image:
    """Forest — simple blocky (Minecraft-style, flat rectangles rather than
    organic canopy shapes) trees, evenly spaced so the tile wraps cleanly.
    Transparent everywhere else so the far layer's sky shows through above
    the treeline."""
    img = Image.new("RGBA", (TILE_W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    n_trees = 4
    spacing = TILE_W / n_trees
    for i in range(n_trees):
        # jitter stays well inside each tree's spacing slot so no canopy
        # ever straddles the tile's x=0/x=TILE_W seam
        cx = spacing * i + spacing / 2 + rng.uniform(-20, 20)
        trunk_w, trunk_h = rng.uniform(10, 14), rng.uniform(26, 38)
        base_y = FOREST_BASE_Y + rng.uniform(-6, 10)
        draw.rectangle([cx - trunk_w / 2, base_y - trunk_h, cx + trunk_w / 2, base_y], fill=FOREST_TRUNK_COLOR)

        top_y = base_y - trunk_h
        canopy = rng.uniform(46, 64)
        draw.rectangle([cx - canopy / 2, top_y - canopy, cx + canopy / 2, top_y], fill=FOREST_LEAF_COLOR)
        small = canopy * 0.6
        draw.rectangle(
            [cx - small / 2, top_y - canopy - small * 0.5, cx + small / 2, top_y - canopy + small * 0.2],
            fill=FOREST_LEAF_COLOR,
        )
    return img.filter(ImageFilter.GaussianBlur(1))  # slight softness, stays blocky-readable


def _build_near_tile(rng: np.random.Generator) -> Image.Image:
    """Grass-block ground — the fastest, nearest layer and the most
    literally "マイクラ" element: a grid of blocks (green-topped grass on
    row 0, dirt below), each with a thin darker outline for definition and
    a little per-block color jitter so it doesn't read as a flat texture
    fill. block=60 divides TILE_W(720) evenly (12 columns), which is what
    keeps the grid seamless across the tile boundary."""
    img = Image.new("RGBA", (TILE_W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    block = 60
    cols = TILE_W // block
    rows = (H - GRASS_TOP_Y) // block + 1
    grid_line = _darken(GRASS_DIRT_COLOR, 0.85)
    for r in range(rows):
        for c in range(cols):
            bx0, by0 = c * block, GRASS_TOP_Y + r * block
            bx1, by1 = bx0 + block, min(by0 + block, H)
            tint = int(rng.integers(-8, 8))
            if r == 0:
                top_color = tuple(max(0, min(255, ch + tint)) for ch in GRASS_TOP_COLOR)
                draw.rectangle([bx0, by0, bx1, by0 + block * 0.35], fill=top_color)
                draw.rectangle([bx0, by0 + block * 0.35, bx1, by1], fill=GRASS_DIRT_COLOR)
            else:
                dirt_color = tuple(max(0, min(255, ch + tint)) for ch in GRASS_DIRT_COLOR)
                draw.rectangle([bx0, by0, bx1, by1], fill=dirt_color)
            draw.rectangle([bx0, by0, bx1, by1], outline=grid_line, width=1)
    return img


def _build_brighten_overlay() -> Image.Image:
    """Owner request (2026-08-16): "画面中央は少し明るめにしてチャットUIが
    見やすいように" — now that line_chat.py no longer draws an opaque panel
    behind the chat bubbles (see that module's 2026-08-16 revision), they
    sit directly on this background, so a soft brightening band keeps them
    legible. Centered on line_chat.py's PANEL_TOP(50)..PANEL_BOTTOM(700)
    midpoint rather than the literal frame center, since that's where the
    bubbles actually are — a plain Gaussian falloff so there's no visible
    hard edge."""
    band_center_y = 375  # (PANEL_TOP + PANEL_BOTTOM) / 2, kept as a literal to avoid importing line_chat.py here
    sigma = 260
    ys = np.arange(H)
    weight = np.exp(-0.5 * ((ys - band_center_y) / sigma) ** 2)
    alpha = (weight * 0.16 * 255).astype(np.uint8)
    arr = np.zeros((H, W, 4), dtype=np.uint8)
    arr[..., 0:3] = 255
    arr[..., 3] = alpha[:, None]
    return Image.fromarray(arr, mode="RGBA")


def _build_layers(seed: int) -> tuple[Image.Image, Image.Image, Image.Image, Image.Image]:
    rng = np.random.default_rng(seed)
    far = _build_far_tile(rng)
    mid = _build_mid_tile(rng)
    near = _build_near_tile(rng)
    brighten = _build_brighten_overlay()
    return far, mid, near, brighten


def _scroll_offset(speed: float, t: float) -> int:
    return -(round(speed * t) % TILE_W)


def compose_frame(layers: tuple[Image.Image, Image.Image, Image.Image, Image.Image], t: float) -> Image.Image:
    """Renders one frame (far -> mid -> near, each scrolled to its own
    offset at time `t`, then the brighten overlay) at time `t`. Pulled out
    of `render_frames`'s loop, same reason the earlier versions did this —
    line_chat.py composites the LINE UI on top of this directly."""
    far, mid, near, brighten = layers

    fx = _scroll_offset(FAR_SPEED, t)
    canvas = Image.new("RGB", (W, H))
    canvas.paste(far, (fx, 0))
    canvas.paste(far, (fx + TILE_W, 0))
    canvas = canvas.convert("RGBA")

    mx = _scroll_offset(MID_SPEED, t)
    canvas.alpha_composite(mid, (mx, 0))
    canvas.alpha_composite(mid, (mx + TILE_W, 0))

    nx = _scroll_offset(NEAR_SPEED, t)
    canvas.alpha_composite(near, (nx, 0))
    canvas.alpha_composite(near, (nx + TILE_W, 0))

    canvas.alpha_composite(brighten, (0, 0))
    return canvas.convert("RGB")


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
    parser = argparse.ArgumentParser(description="Render the モヤスカ Minecraft-style parallax background video.")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    render_video(args.out, args.seconds, args.seed)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
