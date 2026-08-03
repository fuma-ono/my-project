"""Generate a custom YouTube thumbnail (1280x720) per preset.

Thumbnails matter far more for click-through than tags/hashtags do, so
this exists as its own step rather than relying on YouTube's auto-picked
video frame. Reuses the brand palette and PIL primitives from
branding.py (same gradient/moon/star look as the channel art) plus a
duration badge — a well-established convention for long-form sleep/study
content that helps viewers self-select before clicking.
"""
from __future__ import annotations

import argparse
import sys

from PIL import Image, ImageDraw, ImageFont

from . import video
from .branding import ACCENT, WORKSANS, draw_crescent_moon, draw_stars, vertical_gradient

WORKSANS_BOLD = WORKSANS.replace("WorkSans-Regular.ttf", "WorkSans-Bold.ttf")
SIZE = (1280, 720)


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.replace("0x", "")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _duration_label(minutes: float) -> str:
    if minutes >= 60:
        hours = minutes / 60
        return f"{hours:g} HOUR" + ("S" if hours != 1 else "")
    return f"{minutes:g} MIN"


def _wrap_title(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def make_thumbnail(path: str, preset: str, title: str, minutes: float) -> None:
    colors = video.THEME_COLORS.get(preset, ["0x0b1026", "0x1a2a6c", "0x2d1b4e"])
    top, bottom = _hex_to_rgb(colors[0]), _hex_to_rgb(colors[-1])
    base = vertical_gradient(SIZE, top, bottom)

    draw_stars(
        base,
        [(SIZE[0] * 0.06, SIZE[1] * 0.12, 4), (SIZE[0] * 0.93, SIZE[1] * 0.10, 3),
         (SIZE[0] * 0.87, SIZE[1] * 0.20, 2)],
        (255, 255, 255),
    )
    draw_crescent_moon(base, (int(SIZE[0] * 0.90), int(SIZE[1] * 0.80)), 66, ACCENT)

    img = base.convert("RGBA")
    probe = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(WORKSANS_BOLD, 96)
    lines = _wrap_title(probe, title.upper(), title_font, max_width=int(SIZE[0] * 0.80))
    line_height = 108
    total_h = line_height * len(lines)
    top_y = (SIZE[1] - total_h) // 2

    # translucent panel behind the title so it stays legible over any gradient
    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    odraw.rounded_rectangle(
        [60, top_y - 28, SIZE[0] - 60, top_y + total_h - (line_height - 84) + 28],
        radius=20, fill=(10, 10, 20, 130),
    )
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    y = top_y
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=title_font)
        x = (SIZE[0] - (bbox[2] - bbox[0])) // 2
        draw.text((x, y), line, font=title_font, fill=(255, 255, 255, 255))
        y += line_height

    badge_font = ImageFont.truetype(WORKSANS_BOLD, 46)
    badge_text = _duration_label(minutes)
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    pad_x, pad_y = 28, 16
    badge_w = (bbox[2] - bbox[0]) + pad_x * 2
    badge_h = (bbox[3] - bbox[1]) + pad_y * 2
    badge_x, badge_y = 40, 40
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h], radius=14, fill=(*ACCENT, 255)
    )
    draw.text((badge_x + pad_x, badge_y + pad_y - bbox[1]), badge_text, font=badge_font, fill=(20, 14, 10, 255))

    img.convert("RGB").save(path, quality=92)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a custom YouTube thumbnail.")
    parser.add_argument("--preset", required=True, choices=sorted(video.THEME_COLORS.keys()))
    parser.add_argument("--title", required=True)
    parser.add_argument("--minutes", type=float, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    make_thumbnail(args.out, args.preset, args.title, args.minutes)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
