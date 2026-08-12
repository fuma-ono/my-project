"""Generate channel art (YouTube banner + profile photo) to match the
brand palette used elsewhere (dashboard, setup guide). Pure PIL, no stock
assets or paid design tools.
"""
from __future__ import annotations

import argparse
import math
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

FONT_DIR = "/mnt/skills/examples/canvas-design/canvas-fonts"
GLOOCK = f"{FONT_DIR}/Gloock-Regular.ttf"
WORKSANS = f"{FONT_DIR}/WorkSans-Regular.ttf"

# GLOOCK/WORKSANS have no CJK glyphs — rendering Japanese text with them
# produces tofu boxes (this is what caused the 文字化け bug reported
# 2026-08-04 on the live thumbnails). WenQuanYi Zen Hei ships preinstalled
# in this environment's base image (verified via `fc-list`, no apt-get
# needed at render time — important since Routines may run in a fresh
# container) and covers Japanese kana/kanji.
JP_FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

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


def draw_glow_moon(img: Image.Image, center: tuple[int, int], radius: int, color,
                    glow_reach: float = 3.6, glow_strength: int = 130) -> None:
    """A full glowing moon (not the crescent used elsewhere) — a smooth,
    continuous radial falloff (built as a numpy distance field, not stacked
    discrete circles, which banded visibly at thumbnail scale) for scenes
    that want an atmospheric night-sky moon rather than the abstract
    crescent mark. `img` must be RGBA (composites the glow via
    alpha_composite)."""
    cx, cy = center
    w, h = img.size
    ys, xs = np.mgrid[0:h, 0:w]
    dist = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    max_r = radius * glow_reach
    t = np.clip(dist / max_r, 0, 1)
    alpha = (np.clip(1 - t, 0, 1) ** 2) * glow_strength
    alpha_img = Image.fromarray(alpha.astype(np.uint8), mode="L")
    glow_rgba = Image.new("RGBA", img.size, (*color, 0))
    glow_rgba.putalpha(alpha_img)
    img.alpha_composite(glow_rgba)
    draw = ImageDraw.Draw(img)
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(255, 250, 240, 255))


def draw_water_moonpath(img: Image.Image, moon_center: tuple[int, int], horizon_y: int,
                         bottom_y: int, color, width_top: int = 24, width_bottom: int = 220) -> None:
    """The reflected light path a moon casts on calm water: a widening
    vertical band of light from the horizon down to the bottom of the frame,
    built from short horizontal light strokes (like broken reflections on
    ripples) rather than a flat gradient, so it reads as water, not a beam."""
    cx = moon_center[0]
    draw = ImageDraw.Draw(img, "RGBA")
    n_rows = 46
    rng = np.random.default_rng(42)
    for i in range(n_rows):
        t = i / (n_rows - 1)
        y = horizon_y + t * (bottom_y - horizon_y)
        w = width_top + (width_bottom - width_top) * t
        alpha = int(120 * (1 - t) ** 0.6 + 12)
        n_segments = 3 + int(t * 4)
        for _ in range(n_segments):
            seg_w = w / n_segments * rng.uniform(0.4, 0.95)
            seg_x = cx - w / 2 + rng.uniform(0, w - seg_w)
            draw.line([(seg_x, y), (seg_x + seg_w, y)], fill=(*color, alpha), width=2 + int(t * 3))


def draw_seated_silhouette(img: Image.Image, ground_center: tuple[int, int], height: int, color) -> None:
    """A simple seated, cross-legged meditating figure, drawn as flat
    silhouette shapes (head, torso, folded legs, resting arms) — deliberately
    abstract/anonymous rather than a detailed figure, so it reads instantly
    at thumbnail size as 'a person sitting quietly' without needing a photo."""
    cx, gy = ground_center  # gy = the ground line the figure sits on
    draw = ImageDraw.Draw(img, "RGBA")
    fill = (*color, 255)

    # anchored from the bottom up: legs' lowest point sits exactly on `gy`
    # (the ground/horizon line) so the figure doesn't float above it — the
    # head is anchored from the top via `height` as before, and the torso
    # simply spans whatever gap is left between the two.
    leg_w = int(height * 0.42)
    leg_h = int(height * 0.18)
    hip_y = gy - leg_h // 2

    head_r = int(height * 0.11)
    head_cy = gy - height + head_r
    draw.ellipse([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], fill=fill)

    torso_top = head_cy + head_r - int(height * 0.02)
    torso_bottom = hip_y
    torso_w_top = int(height * 0.20)
    torso_w_bottom = int(height * 0.30)
    draw.polygon(
        [
            (cx - torso_w_top // 2, torso_top), (cx + torso_w_top // 2, torso_top),
            (cx + torso_w_bottom // 2, torso_bottom), (cx - torso_w_bottom // 2, torso_bottom),
        ],
        fill=fill,
    )

    # folded legs: two flattened lobes fanning out from the hips, cross-legged,
    # bottom edge flush with `gy`
    draw.ellipse([cx - leg_w, gy - leg_h, cx, gy], fill=fill)
    draw.ellipse([cx, gy - leg_h, cx + leg_w, gy], fill=fill)
    draw.ellipse([cx - int(leg_w * 0.32), hip_y - int(leg_h * 0.75), cx + int(leg_w * 0.32), hip_y + int(leg_h * 0.75)], fill=fill)

    # arms resting on knees
    arm_w = int(height * 0.05)
    for side in (-1, 1):
        knee_x = cx + side * int(leg_w * 0.82)
        draw.line([(cx + side * torso_w_bottom // 3, torso_bottom - int(height * 0.05)), (knee_x, hip_y)],
                  fill=fill, width=arm_w)


def draw_breath_wave(img: Image.Image, y_baseline: int, x_range: tuple[int, int], amplitude: int,
                      color, inhale_frac: float = 0.4, cycles: float = 3.0, width: int = 4) -> None:
    """A light ribbon tracing the same asymmetric rhythm as the audio itself
    (slow rise, longer fall — see presets._breath_envelope) instead of a
    generic symmetric wave, so the thumbnail visually echoes the 4s-in/6s-out
    pattern the video is actually built around."""
    x0, x1 = x_range
    n = 400
    pts = []
    for i in range(n + 1):
        frac = i / n
        cycle_pos = (frac * cycles) % 1.0
        if cycle_pos < inhale_frac:
            local = cycle_pos / inhale_frac
            v = (1 - math.cos(local * math.pi)) / 2
        else:
            local = (cycle_pos - inhale_frac) / (1 - inhale_frac)
            v = (1 + math.cos(local * math.pi)) / 2
        x = x0 + frac * (x1 - x0)
        y = y_baseline - v * amplitude
        pts.append((x, y))
    draw = ImageDraw.Draw(img, "RGBA")
    draw.line(pts, fill=(*color, 190), width=width, joint="curve")


def draw_notebook_pencil(img: Image.Image, center: tuple[int, int], size: int, color) -> None:
    """A literal, unambiguous "studying" icon (notebook + pencil) for the
    focus/study presets — the moon motif reads as sleep, not study, and a
    concrete recognizable object beats another abstract shape here
    (owner feedback 2026-08-04: "勉強用ならノートや鉛筆などわかりやすいものに")."""
    cx, cy = center
    draw = ImageDraw.Draw(img, "RGBA")

    # notebook: a slightly rotated rounded rectangle with ruled lines and a spine
    nb_w, nb_h = int(size * 0.85), int(size * 1.05)
    nb_left, nb_top = cx - nb_w // 2, cy - nb_h // 2
    notebook = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ndraw = ImageDraw.Draw(notebook)
    ndraw.rounded_rectangle(
        [nb_left, nb_top, nb_left + nb_w, nb_top + nb_h], radius=int(size * 0.08), fill=(*color, 255)
    )
    # spine
    ndraw.rectangle([nb_left, nb_top, nb_left + int(nb_w * 0.12), nb_top + nb_h], fill=(*color, 255))
    # ruled lines (cut out, lighter than fill so they read against any bg)
    line_color = tuple(min(255, c + 40) for c in color) + (140,)
    for i in range(4):
        ly = nb_top + int(nb_h * 0.32) + i * int(nb_h * 0.16)
        ndraw.line(
            [nb_left + int(nb_w * 0.24), ly, nb_left + nb_w - int(nb_w * 0.14), ly],
            fill=line_color, width=max(2, size // 40),
        )
    notebook = notebook.rotate(-6, resample=Image.BICUBIC, center=(cx, cy))
    img.paste(notebook, (0, 0), notebook)

    # pencil: a diagonal rounded rectangle body + triangular tip, laid across the notebook
    pc_len, pc_w = int(size * 1.15), int(size * 0.16)
    pencil = Image.new("RGBA", img.size, (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(pencil)
    px0 = cx - pc_len // 2
    py0 = cy - pc_w // 2
    body_len = int(pc_len * 0.8)
    pdraw.rounded_rectangle(
        [px0, py0, px0 + body_len, py0 + pc_w], radius=pc_w // 2, fill=(255, 255, 255, 255)
    )
    tip_color = (60, 40, 25, 255)
    pdraw.polygon(
        [(px0 + body_len, py0), (px0 + pc_len, py0 + pc_w // 2), (px0 + body_len, py0 + pc_w)],
        fill=tip_color,
    )
    lead_len = int(pc_w * 0.35)
    pdraw.polygon(
        [
            (px0 + body_len + (pc_len - body_len) - lead_len, py0 + pc_w * 0.32),
            (px0 + pc_len, py0 + pc_w // 2),
            (px0 + body_len + (pc_len - body_len) - lead_len, py0 + pc_w * 0.68),
        ],
        fill=(30, 30, 30, 255),
    )
    pencil = pencil.rotate(38, resample=Image.BICUBIC, center=(cx, cy))
    img.paste(pencil, (0, 0), pencil)


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


def make_app_icon(path: str, size: int = 1024) -> None:
    """Opaque icon for iOS / the Expo `icon` field. iOS applies its own
    rounded-corner mask, so this must fill the full square with no
    transparency."""
    img = vertical_gradient((size, size), BG_TOP, BG_BOTTOM)
    draw_stars(
        img,
        [(size * 0.20, size * 0.18, 5), (size * 0.80, size * 0.16, 4), (size * 0.74, size * 0.30, 3)],
        (255, 255, 255),
    )
    draw_crescent_moon(img, (size // 2, size // 2), int(size * 0.30), ACCENT)
    img.save(path)


def make_adaptive_icon_layers(fg_path: str, bg_path: str, size: int = 1024) -> None:
    """Android adaptive icon: separate foreground (transparent, moon only,
    kept inside the ~66% safe zone that survives circle/squircle/rounded-square
    masks) and background (opaque fill) layers."""
    bg = vertical_gradient((size, size), BG_TOP, BG_BOTTOM)
    bg.save(bg_path)

    fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_crescent_moon(fg, (size // 2, size // 2), int(size * 0.22), ACCENT)
    fg.save(fg_path)


def make_monochrome_icon(path: str, size: int = 432) -> None:
    """Android 13+ themed-icon silhouette: single opaque color on transparent,
    the OS applies its own tint."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_crescent_moon(img, (size // 2, size // 2), int(size * 0.30), (255, 255, 255))
    img.save(path)


def make_favicon(path: str, size: int = 48) -> None:
    """Small and simple: no stars, just background + moon, for legibility at tiny sizes."""
    img = vertical_gradient((size, size), BG_TOP, BG_BOTTOM)
    draw_crescent_moon(img, (size // 2, size // 2), int(size * 0.34), ACCENT)
    img.save(path)


def make_splash_icon(path: str, size: int = 1024) -> None:
    """Transparent moon mark meant to sit on the splash screen's own
    background color, not a full gradient canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_crescent_moon(img, (size // 2, size // 2), int(size * 0.20), ACCENT)
    img.save(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate YouTube channel art and app icons.")
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

    app_icon_path = f"{args.outdir}/app_icon_1024.png"
    fg_path = f"{args.outdir}/android_icon_foreground_1024.png"
    bg_path = f"{args.outdir}/android_icon_background_1024.png"
    mono_path = f"{args.outdir}/android_icon_monochrome_432.png"
    favicon_path = f"{args.outdir}/favicon_48.png"
    splash_path = f"{args.outdir}/splash_icon_1024.png"

    make_app_icon(app_icon_path)
    make_adaptive_icon_layers(fg_path, bg_path)
    make_monochrome_icon(mono_path)
    make_favicon(favicon_path)
    make_splash_icon(splash_path)
    for p in (app_icon_path, fg_path, bg_path, mono_path, favicon_path, splash_path):
        print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
