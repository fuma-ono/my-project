"""Generate channel art (YouTube banner + profile photo) to match the
brand palette used elsewhere (dashboard, setup guide). Pure PIL, no stock
assets or paid design tools.
"""
from __future__ import annotations

import argparse
import math
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

FONT_DIR = "/mnt/skills/examples/canvas-design/canvas-fonts"
GLOOCK = f"{FONT_DIR}/Gloock-Regular.ttf"
WORKSANS = f"{FONT_DIR}/WorkSans-Regular.ttf"

BG_TOP = (11, 14, 26)
BG_BOTTOM = (30, 38, 72)
ACCENT = (240, 149, 92)
ACCENT_DIM = (198, 118, 70)
TEXT = (238, 240, 250)
TEXT_DIM = (154, 160, 195)


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    for y in range(h):
        t = y / max(h - 1, 1)
        row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        ImageDraw.Draw(img).line([(0, y), (w, y)], fill=row)
    return img


def draw_crescent_moon(img: Image.Image, center: tuple[int, int], radius: int, color) -> None:
    """Composites a crescent through a boolean-subtracted mask, so the inner
    edge reveals whatever is already on `img` (gradient, stars, ...) instead
    of a flat fill color that would show a seam against a gradient backdrop.
    """
    cx, cy = center
    full = Image.new("L", img.size, 0)
    ImageDraw.Draw(full).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)

    offset = int(radius * 0.42)
    cut_r = int(radius * 0.92)
    cut = Image.new("L", img.size, 0)
    ImageDraw.Draw(cut).ellipse(
        [cx - cut_r + offset, cy - cut_r, cx + cut_r + offset, cy + cut_r], fill=255
    )

    mask = ImageChops.subtract(full, cut)
    color_layer = Image.new("RGB", img.size, color)
    img.paste(color_layer, (0, 0), mask)


def draw_stars(img: Image.Image, points: list[tuple[int, int, int]], color) -> None:
    draw = ImageDraw.Draw(img)
    for x, y, r in points:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def make_profile_icon(path: str, size: int = 800) -> None:
    img = vertical_gradient((size, size), BG_TOP, BG_BOTTOM)
    draw_stars(
        img,
        [(size * 0.22, size * 0.24, 4), (size * 0.78, size * 0.20, 3), (size * 0.70, size * 0.34, 2)],
        (255, 255, 255),
    )
    draw_crescent_moon(img, (size // 2, size // 2), int(size * 0.30), ACCENT)
    img.save(path)


def make_banner(path: str, size: tuple[int, int] = (2560, 1440)) -> None:
    w, h = size
    img = vertical_gradient(size, BG_TOP, BG_BOTTOM)
    draw_stars(
        img,
        [(w * 0.08, h * 0.18, 5), (w * 0.90, h * 0.16, 4), (w * 0.85, h * 0.30, 3), (w * 0.12, h * 0.34, 3)],
        (255, 255, 255),
    )

    # safe area: centered 1546x423 box where all platforms show the banner uncropped
    safe_w, safe_h = 1546, 423
    cx, cy = w // 2, h // 2

    moon_r = int(safe_h * 0.30)
    moon_cx = cx - safe_w // 2 + moon_r + 20
    moon_cy = cy - 20
    draw_crescent_moon(img, (moon_cx, moon_cy), moon_r, ACCENT)

    title_font = ImageFont.truetype(GLOOCK, 92)
    tagline_font = ImageFont.truetype(WORKSANS, 34)
    draw = ImageDraw.Draw(img)

    title = "Focus & Sleep Sounds"
    tagline = "Sleep  ·  Focus  ·  Lo-Fi  ·  Ambient"

    text_x = moon_cx + moon_r + 50
    title_bbox = draw.textbbox((0, 0), title, font=title_font)
    title_h = title_bbox[3] - title_bbox[1]
    tag_bbox = draw.textbbox((0, 0), tagline, font=tagline_font)
    tag_h = tag_bbox[3] - tag_bbox[1]
    block_h = title_h + 18 + tag_h
    top_y = cy - block_h // 2 - 20

    draw.text((text_x, top_y - title_bbox[1]), title, font=title_font, fill=TEXT)
    draw.text((text_x, top_y + title_h + 18 - tag_bbox[1]), tagline, font=tagline_font, fill=TEXT_DIM)

    img.save(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate YouTube channel art.")
    parser.add_argument("--outdir", default="output/branding")
    args = parser.parse_args(argv)

    import os

    os.makedirs(args.outdir, exist_ok=True)
    banner_path = f"{args.outdir}/youtube_banner_2560x1440.png"
    icon_path = f"{args.outdir}/profile_icon_800x800.png"
    make_banner(banner_path)
    make_profile_icon(icon_path)
    print(f"wrote {banner_path}")
    print(f"wrote {icon_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
