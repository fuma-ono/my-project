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

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from . import video
from .branding import ACCENT, JP_FONT, draw_crescent_moon, draw_notebook_pencil, draw_stars, vertical_gradient

SIZE = (1280, 720)

# Bold Japanese serif (明朝体), index 0 = the JP face in this CJK-bundled
# ttc (checked via ImageFont.truetype(..., index=N).getname() — JP/KR/SC/
# TC/HK in that order). This is the font actually used for the 2026-08-16
# hand-revised live thumbnails (breath_guide_coherent/study_lofi_chill/
# baby_sleep_noise _thumb_v2/v3.png) — see make_photo_thumbnail()'s
# docstring for why it matters that this matches, not just "some big font."
JP_SERIF_BOLD = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.replace("0x", "")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _duration_label(minutes: float) -> str:
    if minutes >= 60:
        hours = minutes / 60
        return f"{hours:g}時間" if hours != 1 else "1時間"
    if minutes < 1:
        # 2026-08-25: Shorts durations (e.g. 46s = 0.77min) used to render
        # as "0.77分" — nonsensical. Found while wiring up Shorts'
        # first-ever custom thumbnail (see make_photo_thumbnail_vertical).
        return f"{round(minutes * 60)}秒"
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


def make_photo_thumbnail(path: str, source_path: str, caption: str, minutes: float,
                          crop_top_px: int | None = None, size: tuple[int, int] = SIZE,
                          text_anchor: str = "center") -> None:
    """Thumbnail built from a real (owner-supplied, AI-generated) photo
    instead of the abstract gradient+icon style — standard as of 2026-08-12
    per owner direction: a realistic image draws the eye far better than a
    solid-color background with text on it. Crops the source to `size`'s
    aspect ratio (a center crop by default — `crop_top_px` only needs to be
    passed when a source image carries an unrelated artifact, e.g. a
    screenshot's status bar, along one edge that a centered crop wouldn't
    remove).

    2026-08-25 (owner correction — "中央に大きな文字で書くって統一した
    よね？", then "前作ったサムネイルは覚えてないの？... 前のサムネと全然
    違うやん"): this function's caption used to be a small (40px) line in
    the bottom-left corner — never actually "large, centered text." But the
    *real* large-centered-text standard already existed and had been
    hand-applied to 3 live thumbnails back on 2026-08-16 (see
    assets/thumbnails/breath_guide_coherent_thumb_v3.png,
    study_lofi_chill_thumb_v2.png, baby_sleep_noise_thumb_v2.png, and the
    "hand-revised past what make_photo_thumbnail() produces" comments on
    those presets below) — bold serif (JP_SERIF_BOLD), no background
    panel/band, a soft drop-shadow instead, text placed in whatever open
    part of the photo doesn't cover the subject. A first attempt at fixing
    this function invented a *different* look from scratch (sans-serif,
    dark band across the middle) and overwrote those hand-tuned live
    thumbnails with it — a real mistake, caught by the owner, not by
    re-reading the existing hand-revision notes first as should have
    happened. This version matches the actual established style instead.

    `text_anchor` picks where the text sits, per-photo, same as the 08-16
    hand revisions did by eye: "center" places it horizontally and
    vertically centered (used where the photo has open space in the
    middle, e.g. a night sky/forest/mountain shot); "left" places it near
    the top-left (used where the subject — a face, a busy desk — occupies
    the center/right and would otherwise be covered). Set per preset via
    PRESET_METADATA's "thumbnail_text_anchor" (defaults to "center").
    Captions with an embedded "\\n" (e.g. "集中できる\\nカフェBGM") render
    as their own explicit line break via PIL's native multiline handling,
    not the character-wrap helper used elsewhere in this file.

    Also 2026-08-25: `size` was added so this same function can generate a
    vertical (1080x1920) thumbnail for Shorts — see
    make_photo_thumbnail_vertical() below and its docstring for why Shorts
    never had *any* custom thumbnail (text or otherwise) before today.

    This pipeline does not generate the photo — nothing in this environment
    can produce a photorealistic image. `source_path` must point to an
    existing image (owner-supplied, saved under bgm-pipeline/assets/
    thumbnails/ so it's reproducible without re-asking the owner)."""
    img = Image.open(source_path).convert("RGB")
    w, h = img.size
    target_ratio = size[0] / size[1]
    if w / h > target_ratio:
        # source is wider than target ratio relative to its height — crop width, keep full height
        new_w = round(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        # source is taller/narrower than target ratio — crop height, keep full width
        new_h = round(w / target_ratio)
        top = (h - new_h) // 2 if crop_top_px is None else min(crop_top_px, h - new_h)
        img = img.crop((0, top, w, top + new_h))
    img = img.resize(size, Image.LANCZOS).convert("RGBA")

    scale = size[0] / SIZE[0]
    spacing = round(14 * scale)
    align = "center" if text_anchor == "center" else "left"
    margin = round(80 * scale)
    max_text_w = size[0] - (2 * margin if text_anchor == "center" else margin + round(40 * scale))

    # auto-shrink from 130px (scaled) until the longest line fits — a
    # fixed size clipped off the right edge for 2-line captions like
    # "赤ちゃんが\nやさしく眠れる1時間" (found while re-matching the 08-16
    # hand-revised style: that version was sized by eye per image, this
    # has to work for every caption without per-preset font-size tuning).
    probe = ImageDraw.Draw(img)
    font_size = round(130 * scale)
    while True:
        cap_font = ImageFont.truetype(JP_SERIF_BOLD, font_size, index=0)
        bbox = probe.multiline_textbbox((0, 0), caption, font=cap_font, align=align, spacing=spacing)
        text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if text_w <= max_text_w or font_size <= 40:
            break
        font_size -= 4
    if text_anchor == "center":
        text_x = (size[0] - text_w) // 2 - bbox[0]
        text_y = (size[1] - text_h) // 2 - bbox[1]
    else:
        text_x = margin - bbox[0]
        text_y = margin - bbox[1]

    # soft drop-shadow (blurred, offset-free) instead of a background
    # panel — legible over a photo without hiding it, matching the 08-16
    # hand revisions.
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.multiline_text(
        (text_x, text_y), caption, font=cap_font, fill=(0, 0, 0, 255), align=align, spacing=spacing,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(1, round(6 * scale))))
    img = Image.alpha_composite(img, shadow)
    draw = ImageDraw.Draw(img, "RGBA")
    draw.multiline_text(
        (text_x, text_y), caption, font=cap_font, fill=(255, 255, 255, 255), align=align, spacing=spacing,
    )

    badge_font = ImageFont.truetype(JP_FONT, round(38 * scale))
    badge_text = _duration_label(minutes)
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    pad_x, pad_y = round(20 * scale), round(10 * scale)
    badge_w, badge_h = (bbox[2] - bbox[0]) + pad_x * 2, (bbox[3] - bbox[1]) + pad_y * 2
    badge_x, badge_y = size[0] - badge_w - round(36 * scale), round(32 * scale)
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h], radius=12, fill=(*ACCENT, 215)
    )
    draw.text((badge_x + pad_x, badge_y + pad_y - bbox[1]), badge_text, font=badge_font, fill=(20, 14, 10, 255))

    img.convert("RGB").save(path, quality=92)


VERTICAL_SIZE = (1080, 1920)


def make_photo_thumbnail_vertical(path: str, source_path: str, caption: str, minutes: float,
                                   crop_top_px: int | None = None, text_anchor: str = "center") -> None:
    """Vertical (1080x1920) counterpart of make_photo_thumbnail(), for
    Shorts. Added 2026-08-25 after discovering — while investigating the
    owner's "サムネの文字が変わってない" complaint — that publish_shorts.py
    had never called any thumbnail-generation function at all, for any
    preset, ever. Shorts got no custom thumbnail and no burned-in video
    text (render_photo_background() draws no text on the frame either), so
    YouTube auto-picked a plain video frame for the browse/search-grid
    thumbnail. Since Shorts publish daily and are this channel's dominant
    traffic surface (see docs/marketing/2026-08-17-bgm-engagement-
    analysis.md), that gap — not just small text on long-form — is the
    main reason nothing looked different across videos."""
    make_photo_thumbnail(
        path, source_path, caption, minutes, crop_top_px=crop_top_px, size=VERTICAL_SIZE,
        text_anchor=text_anchor,
    )


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
