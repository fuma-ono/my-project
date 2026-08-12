"""Generate a custom YouTube thumbnail (1280x720) per preset.

Thumbnails matter far more for click-through than tags/hashtags do, so
this exists as its own step rather than relying on YouTube's auto-picked
video frame. Reuses the brand palette and PIL primitives from
branding.py (same gradient/moon/star look as the channel art).

Rewritten 2026-08-04 after owner feedback on the live thumbnails:
  - "文字化け" (mojibake): WORKSANS has no Japanese glyphs, and titles are
    Japanese now — fixed by switching to branding.JP_FONT for all text.
  - "サムネイルが引き付けられない" (not eye-catching): bigger/bolder short
    hook text instead of the full SEO title crammed in, higher-contrast
    panel, a concrete per-category icon instead of always the same moon.
  - "勉強用ならノートや鉛筆などわかりやすいものに": sleep presets keep the
    moon+stars motif, but focus/study presets now get a literal
    notebook+pencil icon (branding.draw_notebook_pencil) — a recognizable
    object beats another abstract shape for "this is for studying."
"""
from __future__ import annotations

import argparse
import sys

from PIL import Image, ImageDraw, ImageFont

from . import video
from .branding import (
    ACCENT,
    JP_FONT,
    draw_breath_wave,
    draw_crescent_moon,
    draw_glow_moon,
    draw_notebook_pencil,
    draw_seated_silhouette,
    draw_stars,
    draw_water_moonpath,
    vertical_gradient,
)

SIZE = (1280, 720)


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.replace("0x", "")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _duration_label(minutes: float) -> str:
    if minutes >= 60:
        hours = minutes / 60
        return f"{hours:g}時間" if hours != 1 else "1時間"
    return f"{minutes:g}分"


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Character-wrap (not word-wrap) since Japanese has no spaces between words."""
    lines: list[str] = []
    current = ""
    for ch in text:
        candidate = current + ch
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines


def make_thumbnail(path: str, preset: str, thumb_hook: str, icon_category: str, minutes: float) -> None:
    colors = video.THEME_COLORS.get(preset, ["0x0b0e1a", "0x141a30", "0x1e2648"])
    top, bottom = _hex_to_rgb(colors[0]), _hex_to_rgb(colors[-1])
    base = vertical_gradient(SIZE, top, bottom)

    draw_stars(
        base,
        [(SIZE[0] * 0.06, SIZE[1] * 0.10, 4), (SIZE[0] * 0.93, SIZE[1] * 0.08, 3),
         (SIZE[0] * 0.88, SIZE[1] * 0.16, 2), (SIZE[0] * 0.10, SIZE[1] * 0.22, 2)],
        (255, 255, 255),
    )

    icon_cx, icon_cy = int(SIZE[0] * 0.83), int(SIZE[1] * 0.30)
    if icon_category == "focus":
        draw_notebook_pencil(base, (icon_cx, icon_cy), 190, ACCENT)
    else:
        draw_crescent_moon(base, (icon_cx, icon_cy), 90, ACCENT)

    img = base.convert("RGBA")
    probe = ImageDraw.Draw(img)

    # big, short hook text — this is what needs to read in under a second
    # at thumbnail-grid size, not the full SEO title (that's what the
    # video's actual `title` field is for)
    hook_font = ImageFont.truetype(JP_FONT, 108)
    lines = _wrap_text(probe, thumb_hook, hook_font, max_width=int(SIZE[0] * 0.62))
    line_height = 122
    total_h = line_height * len(lines)
    top_y = (SIZE[1] - total_h) // 2

    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    odraw.rounded_rectangle(
        [56, top_y - 34, int(SIZE[0] * 0.70), top_y + total_h - (line_height - 96) + 34],
        radius=22, fill=(6, 8, 16, 165),
    )
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    y = top_y
    for line in lines:
        draw.text((90, y), line, font=hook_font, fill=(255, 255, 255, 255))
        y += line_height

    badge_font = ImageFont.truetype(JP_FONT, 50)
    badge_text = _duration_label(minutes)
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    pad_x, pad_y = 30, 16
    badge_w = (bbox[2] - bbox[0]) + pad_x * 2
    badge_h = (bbox[3] - bbox[1]) + pad_y * 2
    badge_x, badge_y = 56, 40
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h], radius=16, fill=(*ACCENT, 255)
    )
    draw.text((badge_x + pad_x, badge_y + pad_y - bbox[1]), badge_text, font=badge_font, fill=(20, 14, 10, 255))

    img.convert("RGB").save(path, quality=92)


def make_breath_scene_thumbnail(path: str, caption: str, minutes: float) -> None:
    """A different thumbnail treatment from `make_thumbnail()`, built for
    Scene 03 (breath_guide_coherent) after direct owner feedback that the
    standard gradient+icon+big-text layout didn't fit this scene: a quiet
    night scene (moon, water, a seated figure) that communicates
    "breathe → settle" through the image itself, with text kept small and
    off to the side rather than the visual focus. Still 100% PIL/procedural
    — no photos or external assets, consistent with the channel's
    self-generated-only policy. Reserved for scenes that specifically call
    for this atmospheric style; `make_thumbnail()` stays untouched for the
    rest of the catalog."""
    sky_top, sky_bottom = (7, 9, 22), (52, 36, 84)
    img = vertical_gradient(SIZE, sky_top, sky_bottom).convert("RGBA")

    draw_stars(
        img,
        [(SIZE[0] * 0.08, SIZE[1] * 0.08, 3), (SIZE[0] * 0.90, SIZE[1] * 0.07, 3),
         (SIZE[0] * 0.15, SIZE[1] * 0.18, 2), (SIZE[0] * 0.82, SIZE[1] * 0.20, 2),
         (SIZE[0] * 0.06, SIZE[1] * 0.28, 2), (SIZE[0] * 0.94, SIZE[1] * 0.30, 2)],
        (235, 235, 245),
    )

    moon_center = (int(SIZE[0] * 0.5), int(SIZE[1] * 0.19))
    moon_glow_color = (232, 214, 176)
    draw_glow_moon(img, moon_center, radius=58, color=moon_glow_color, glow_reach=3.6, glow_strength=130)

    # water: a visually distinct region below the horizon (darker, more
    # saturated purple than the sky) so the moonlight reflection and ripples
    # read as "on water," not floating in empty sky
    horizon_y = int(SIZE[1] * 0.60)
    water = vertical_gradient((SIZE[0], SIZE[1] - horizon_y), (34, 24, 58), (14, 12, 30)).convert("RGBA")
    img.alpha_composite(water, (0, horizon_y))
    draw = ImageDraw.Draw(img, "RGBA")
    draw.line([(0, horizon_y), (SIZE[0], horizon_y)], fill=(180, 170, 210, 90), width=2)

    draw_water_moonpath(img, moon_center, horizon_y, SIZE[1], color=(214, 206, 232),
                         width_top=20, width_bottom=260)

    # a couple of very low-alpha horizontal ripple lines for water texture
    for i, y_frac in enumerate((0.72, 0.84, 0.94)):
        y = int(SIZE[1] * y_frac)
        draw.line([(0, y), (SIZE[0], y)], fill=(200, 200, 225, 18 + i * 6), width=2)

    # the breathing rhythm itself, echoed as a light ribbon on the water,
    # kept clear of the caption box in the bottom-left corner
    draw_breath_wave(
        img, y_baseline=int(SIZE[1] * 0.80), x_range=(SIZE[0] * 0.08, SIZE[0] * 0.92),
        amplitude=24, color=ACCENT, inhale_frac=0.4, cycles=3.0, width=4,
    )

    draw_seated_silhouette(img, (SIZE[0] // 2, horizon_y + 4), height=210, color=(6, 7, 14))

    # text kept deliberately small and off to the side — the image carries
    # "breathe → settle", not a bold caption
    draw = ImageDraw.Draw(img, "RGBA")
    cap_font = ImageFont.truetype(JP_FONT, 38)
    cap_bbox = draw.textbbox((0, 0), caption, font=cap_font)
    cap_w, cap_h = cap_bbox[2] - cap_bbox[0], cap_bbox[3] - cap_bbox[1]
    cap_x, cap_y = 44, SIZE[1] - 74
    draw.rounded_rectangle(
        [cap_x - 16, cap_y - 12, cap_x + cap_w + 16, cap_y + cap_h + 24], radius=12, fill=(6, 8, 16, 130)
    )
    draw.text((cap_x, cap_y - cap_bbox[1]), caption, font=cap_font, fill=(240, 240, 248, 235))

    badge_font = ImageFont.truetype(JP_FONT, 40)
    badge_text = _duration_label(minutes)
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    pad_x, pad_y = 22, 12
    badge_w = (bbox[2] - bbox[0]) + pad_x * 2
    badge_h = (bbox[3] - bbox[1]) + pad_y * 2
    badge_x, badge_y = SIZE[0] - badge_w - 40, 36
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h], radius=14, fill=(*ACCENT, 220)
    )
    draw.text((badge_x + pad_x, badge_y + pad_y - bbox[1]), badge_text, font=badge_font, fill=(20, 14, 10, 255))

    img.convert("RGB").save(path, quality=92)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a custom YouTube thumbnail.")
    parser.add_argument("--preset", required=True, choices=sorted(video.THEME_COLORS.keys()))
    parser.add_argument("--hook", required=True, help="short thumbnail hook text (not the full title)")
    parser.add_argument("--icon-category", required=True, choices=["sleep", "focus"])
    parser.add_argument("--minutes", type=float, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    make_thumbnail(args.out, args.preset, args.hook, args.icon_category, args.minutes)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
