"""Generate channel art (YouTube profile photo + banner) for the モヤスカ
channel, decided 2026-08-06 (see docs/projects/moyasuka/naming.md).

Pure PIL, no stock assets or paid design tools — same approach as
bgm_pipeline/branding.py (Quiet Hours' moon-badge channel art) and this
module's own background_gen.py. The chat-bubble motif here is the same
shape used in background_gen.py's _draw_ball, at logo scale, so the
background video and the channel art read as the same show.

Palette is deliberately its own sub-brand (bright warm cream/coral, not
Quiet Hours' navy+amber): モヤスカ is a different YouTube channel for a
different audience (LINE-style スカッと drama, not ambient/sleep BGM), and
distinct channels under the same company having their own look is normal
practice — the two touchpoints that DO need to match are internal (this
module's own background video and its own channel art), and they do.
First pass used a dark navy background to match the background video's
BG color; owner feedback (2026-08-06) was that it read as too dark/gloomy
for a "スカッと" (refreshing, satisfying) mood, so this version flips to a
bright warm gradient and darkens the text/accent colors accordingly for
contrast. The background video itself is unaffected — its dark arena is a
different, deliberate design (satisfying-video genre convention), not
something the owner commented on.

IMPORTANT: any Japanese text must use JP_FONT (wqy-zenhei). WorkSans/
Gloock (used elsewhere in this repo for Latin text) have no CJK glyphs —
this is the exact bug (文字化け) found and fixed on the BGM channel's
thumbnails/videos on 2026-08-05. wqy-zenhei ships preinstalled in this
environment's base image (verified via `fc-list`, no apt-get needed at
render time) so this stays portable across fresh containers.
"""
from __future__ import annotations

import argparse

from PIL import Image, ImageChops, ImageDraw, ImageFont

JP_FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

BG_TOP = (255, 242, 217)    # warm cream
BG_BOTTOM = (255, 158, 158) # bright coral
BUBBLE_A = (255, 79, 129)   # hot pink — brighter cousin of background_gen.py's pop pink
BUBBLE_B = (255, 205, 86)   # sunflower yellow, in place of the violet (reads better against a warm bg)
SPARK = (0, 176, 176)       # teal — enough contrast against the cream/coral bg to still pop
TEXT = (58, 24, 46)         # deep plum, dark enough for contrast on the light bg
TEXT_DIM = (150, 92, 104)   # muted warm rose


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    for y in range(h):
        t = y / max(h - 1, 1)
        row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        ImageDraw.Draw(img).line([(0, y), (w, y)], fill=row)
    return img


def draw_bubble(img: Image.Image, center: tuple[int, int], size: int, tail: str = "left") -> None:
    """A proper chat-bubble mark: a rounded rectangle (not a circle — owner
    feedback 2026-08-06: "アイコンの画像の○はいやかな", a plain circle just
    reads as a ball, not a logo) with a tail and a three-dot "typing..."
    indicator inside. The three dots are a deliberate, universally
    recognizable nod to the LINE-chat content itself, the same way
    bgm_pipeline's notebook+pencil icon replaced an abstract shape with a
    concrete, unambiguous image (owner feedback 2026-08-04).

    `size` is roughly the bubble's half-height (kept as the same argument
    name/shape as the old circle-radius version so call sites read the
    same way).

    Drawing order matters: the tail is drawn FIRST with its base deep
    inside where the rounded rect will land, then the rect (opaque) is
    drawn on top — this fuses the two shapes with no seam. The highlight
    and dots are each composited as their own alpha layer (not drawn
    directly with an alpha fill onto the RGBA layer) because
    ImageDraw.ellipse *replaces* pixels rather than blending them —
    drawing a translucent fill straight onto the gradient would show the
    layer's own (transparent) background through it instead of blending
    with the pink/yellow underneath, which reads as a muddy grey smudge.
    """
    cx, cy = center
    w, h = int(size * 2.7), int(size * 2.0)
    corner_r = int(h * 0.32)
    pad = int(size * 0.9)
    lw, lh = w + pad * 2, h + pad * 2
    rect = [pad, pad, pad + w, pad + h]

    tail_w = h * 0.24
    tail_len = h * 0.34
    tail_layer = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    td = ImageDraw.Draw(tail_layer)
    ty = rect[1] + h * 0.78
    if tail == "left":
        base_x = rect[0] + w * 0.16  # inside the rect, so the body below covers it
        tip_x = rect[0] - tail_len
        td.polygon([(base_x, ty - tail_w / 2), (tip_x, ty), (base_x, ty + tail_w / 2)], fill=(*BUBBLE_A, 255))
    else:
        base_x = rect[2] - w * 0.16
        tip_x = rect[2] + tail_len
        td.polygon([(base_x, ty - tail_w / 2), (tip_x, ty), (base_x, ty + tail_w / 2)], fill=(*BUBBLE_B, 255))

    grad = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    for y in range(lh):
        t = y / max(lh - 1, 1)
        row = tuple(int(BUBBLE_A[i] + (BUBBLE_B[i] - BUBBLE_A[i]) * t) for i in range(3))
        ImageDraw.Draw(grad).line([(0, y), (lw, y)], fill=(*row, 255))
    mask = Image.new("L", (lw, lh), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=corner_r, fill=255)
    layer = Image.composite(grad, tail_layer, mask)

    # highlight/dots are clipped to `mask` before compositing — otherwise
    # they're alpha_composite'd over the *whole* transparent layer canvas,
    # not just the bubble shape, and the highlight ends up floating above
    # the bubble's rounded top edge as a stray circle instead of sitting
    # inside it.
    highlight = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    hl_r = h * 0.42
    ImageDraw.Draw(highlight).ellipse(
        [rect[0] + w * 0.08, rect[1] - hl_r * 0.35, rect[0] + w * 0.08 + hl_r, rect[1] - hl_r * 0.35 + hl_r],
        fill=(255, 255, 255, 90),
    )
    highlight.putalpha(ImageChops.multiply(highlight.getchannel("A"), mask))
    layer = Image.alpha_composite(layer, highlight)

    dots = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    dot_r = h * 0.09
    gap = w * 0.145
    dcx, dcy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2 + h * 0.02
    for dx in (-gap, 0, gap):
        dd.ellipse([dcx + dx - dot_r, dcy - dot_r, dcx + dx + dot_r, dcy + dot_r], fill=(255, 255, 255, 235))
    dots.putalpha(ImageChops.multiply(dots.getchannel("A"), mask))
    layer = Image.alpha_composite(layer, dots)

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
    # center so the tail/highlight/dots never get clipped by the circular mask
    draw_bubble(img, (size // 2, size // 2), int(size * 0.175), tail="right")
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

    bubble_size = int(safe_h * 0.21)
    bubble_cx = cx - safe_w // 2 + bubble_size * 1.5 + 30
    bubble_cy = cy - 10
    draw_bubble(img, (int(bubble_cx), bubble_cy), bubble_size, tail="left")

    title_font = ImageFont.truetype(JP_FONT, 100)
    tagline_font = ImageFont.truetype(JP_FONT, 34)
    badge_font = ImageFont.truetype(JP_FONT, 26)
    draw = ImageDraw.Draw(img)

    title = "モヤスカ"
    tagline = "LINEで見るスカッと系ショートドラマ"
    badge = "毎日20:00更新"

    text_x = int(bubble_cx + bubble_size * 1.6 + 60)

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
