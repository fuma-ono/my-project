"""Generate channel art (YouTube profile photo + banner) for the モヤスカ
channel, decided 2026-08-06 (see docs/projects/moyasuka/naming.md).

Pure PIL, no stock assets or paid design tools — same approach as
bgm_pipeline/branding.py (Quiet Hours' moon-badge channel art) and this
module's own background_gen.py. The chat-bubble motif here is the same
shape used in background_gen.py's _draw_ball, at logo scale, so the
background video and the channel art read as the same show.

Palette is deliberately its own sub-brand (pink/violet on dark
violet-navy) rather than a reuse of Quiet Hours' navy+amber: モヤスカ is a
different YouTube channel for a different audience (LINE-style スカッと
drama, not ambient/sleep BGM), and distinct channels under the same
company having their own look is normal practice — the two touchpoints
that DO need to match are internal (this module's own background video
and its own channel art), and they do.

IMPORTANT: any Japanese text must use JP_FONT (wqy-zenhei). WorkSans/
Gloock (used elsewhere in this repo for Latin text) have no CJK glyphs —
this is the exact bug (文字化け) found and fixed on the BGM channel's
thumbnails/videos on 2026-08-05. wqy-zenhei ships preinstalled in this
environment's base image (verified via `fc-list`, no apt-get needed at
render time) so this stays portable across fresh containers.
"""
from __future__ import annotations

import argparse

from PIL import Image, ImageDraw, ImageFont

JP_FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

BG_TOP = (14, 11, 24)
BG_BOTTOM = (36, 24, 58)
BUBBLE_A = (255, 99, 132)   # pop pink — same swatch as background_gen.py PALETTE
BUBBLE_B = (154, 138, 255)  # violet
SPARK = (99, 220, 255)      # electric cyan
TEXT = (240, 240, 250)
TEXT_DIM = (176, 172, 205)


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    for y in range(h):
        t = y / max(h - 1, 1)
        row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        ImageDraw.Draw(img).line([(0, y), (w, y)], fill=row)
    return img


def draw_bubble(img: Image.Image, center: tuple[int, int], radius: int, tail: str = "left") -> None:
    """The chat-bubble motif from background_gen.py's _draw_ball, at logo
    scale: a pink-to-violet gradient bubble with a tail and a glossy
    highlight, composited with alpha so it sits cleanly on the background
    gradient.

    Drawing order matters here: the tail is drawn FIRST with its base deep
    inside where the circle will land, then the circle (opaque) is drawn
    on top — this fuses the two shapes with no seam, instead of the tail
    reading as a disconnected triangle floating next to the circle. The
    highlight is composited as its own alpha layer (not drawn directly
    with an alpha fill onto the RGBA layer) because ImageDraw.ellipse
    *replaces* pixels rather than blending them — drawing a translucent
    white fill straight onto the gradient would show the layer's own
    (transparent) background through it instead of blending with the
    pink/violet underneath, which reads as a muddy grey smudge.
    """
    cx, cy = center
    pad = int(radius * 0.65) + 10
    d = radius * 2
    lw, lh = d + pad * 2, d + pad * 2

    tail_layer = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    td = ImageDraw.Draw(tail_layer)
    tail_w = radius * 0.42
    tail_len = radius * 0.55
    ty = pad + d * 0.72
    if tail == "left":
        base_x = pad + radius * 0.35  # inside the circle, so the body below covers it
        tip_x = pad - tail_len
        td.polygon([(base_x, ty - tail_w / 2), (tip_x, ty), (base_x, ty + tail_w / 2)], fill=(*BUBBLE_A, 255))
    else:
        base_x = pad + d - radius * 0.35
        tip_x = pad + d + tail_len
        td.polygon([(base_x, ty - tail_w / 2), (tip_x, ty), (base_x, ty + tail_w / 2)], fill=(*BUBBLE_B, 255))

    grad = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    for y in range(lh):
        t = y / max(lh - 1, 1)
        row = tuple(int(BUBBLE_A[i] + (BUBBLE_B[i] - BUBBLE_A[i]) * t) for i in range(3))
        ImageDraw.Draw(grad).line([(0, y), (lw, y)], fill=(*row, 255))
    mask = Image.new("L", (lw, lh), 0)
    ImageDraw.Draw(mask).ellipse([pad, pad, pad + d, pad + d], fill=255)
    layer = Image.composite(grad, tail_layer, mask)

    highlight = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    hl_r = radius * 0.4
    ImageDraw.Draw(highlight).ellipse(
        [pad + radius * 0.35, pad + radius * 0.28, pad + radius * 0.35 + hl_r, pad + radius * 0.28 + hl_r],
        fill=(255, 255, 255, 130),
    )
    layer = Image.alpha_composite(layer, highlight)

    img.paste(layer, (int(cx - lw / 2), int(cy - lh / 2)), layer)


def draw_scatter_bubbles(img: Image.Image, points: list[tuple[float, float, float]], colors: list[tuple[int, int, int]], alpha: int = 55) -> None:
    """Decorative dots echoing the background video's bouncing-ball motif.
    Low alpha for corner texture outside the safe area; a higher alpha is
    used for the small cluster placed inside the safe area (see
    make_banner) so it reads as a deliberate accent, not noise."""
    draw = ImageDraw.Draw(img, "RGBA")
    for (x, y, r), color in zip(points, colors):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(*color, alpha))


def make_profile_icon(path: str, size: int = 800) -> None:
    img = vertical_gradient((size, size), BG_TOP, BG_BOTTOM)
    # displayed as a circle by YouTube — keep the bubble well inside the
    # center so the tail/highlight never get clipped by the circular mask
    draw_bubble(img, (size // 2, size // 2), int(size * 0.28), tail="right")
    img.save(path)


def make_banner(path: str, size: tuple[int, int] = (2560, 1440)) -> None:
    w, h = size
    img = vertical_gradient(size, BG_TOP, BG_BOTTOM)

    draw_scatter_bubbles(
        img,
        [
            (w * 0.06, h * 0.20, 30), (w * 0.94, h * 0.18, 22), (w * 0.90, h * 0.82, 34),
            (w * 0.08, h * 0.84, 20), (w * 0.96, h * 0.50, 16), (w * 0.04, h * 0.52, 24),
        ],
        [BUBBLE_A, SPARK, BUBBLE_B, SPARK, BUBBLE_A, BUBBLE_B],
    )

    # safe area: centered 1546x423 box where all platforms show the banner uncropped
    safe_w, safe_h = 1546, 423
    cx, cy = w // 2, h // 2

    # a small accent cluster inside the safe area, right of the text block —
    # otherwise the right two-thirds of the safe area sits empty. Echoes
    # background_gen.py's multi-ball composition at a much higher alpha
    # than the corner texture dots since this one is meant to be seen.
    draw_scatter_bubbles(
        img,
        [(cx + 330, cy - 60, 46), (cx + 430, cy + 70, 26), (cx + 260, cy + 130, 18)],
        [BUBBLE_B, SPARK, BUBBLE_A],
        alpha=115,
    )

    bubble_r = int(safe_h * 0.34)
    bubble_cx = cx - safe_w // 2 + bubble_r + 30
    bubble_cy = cy - 10
    draw_bubble(img, (bubble_cx, bubble_cy), bubble_r, tail="left")

    title_font = ImageFont.truetype(JP_FONT, 100)
    tagline_font = ImageFont.truetype(JP_FONT, 34)
    badge_font = ImageFont.truetype(JP_FONT, 26)
    draw = ImageDraw.Draw(img)

    title = "モヤスカ"
    tagline = "LINEで見るスカッと系ショートドラマ"
    badge = "毎日20:00更新"

    text_x = bubble_cx + bubble_r + 60

    # wqy-zenhei ships one weight only — fake a bold title with a text
    # stroke rather than drawing it twice offset (cleaner edges at this size)
    title_bbox = draw.textbbox((0, 0), title, font=title_font, stroke_width=3)
    title_h = title_bbox[3] - title_bbox[1]
    tag_bbox = draw.textbbox((0, 0), tagline, font=tagline_font)
    tag_h = tag_bbox[3] - tag_bbox[1]
    block_h = title_h + 16 + tag_h
    top_y = cy - block_h // 2 - 34

    draw.text((text_x, top_y - title_bbox[1]), title, font=title_font, fill=TEXT, stroke_width=3, stroke_fill=TEXT)
    draw.text((text_x, top_y + title_h + 16 - tag_bbox[1]), tagline, font=tagline_font, fill=TEXT_DIM)

    # posting-cadence badge (ties to docs/projects/moyasuka/posting-policy.md)
    badge_bbox = draw.textbbox((0, 0), badge, font=badge_font)
    bw, bh = badge_bbox[2] - badge_bbox[0], badge_bbox[3] - badge_bbox[1]
    badge_y = top_y + title_h + 16 + tag_h + 28
    pad_x, pad_y = 18, 10
    pill = [text_x, badge_y, text_x + bw + pad_x * 2, badge_y + bh + pad_y * 2]
    draw.rounded_rectangle(pill, radius=(pill[3] - pill[1]) // 2, outline=SPARK, width=2)
    draw.text((text_x + pad_x, badge_y + pad_y - badge_bbox[1]), badge, font=badge_font, fill=SPARK)

    img.save(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate モヤスカ channel art (profile photo + banner).")
    parser.add_argument("--outdir", default=".")
    args = parser.parse_args(argv)
    banner_path = f"{args.outdir}/youtube_banner_2560x1440.png"
    icon_path = f"{args.outdir}/profile_icon_800x800.png"
    make_banner(banner_path)
    make_profile_icon(icon_path)
    print(f"wrote {banner_path}")
    print(f"wrote {icon_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
