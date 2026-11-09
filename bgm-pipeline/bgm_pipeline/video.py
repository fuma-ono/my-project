"""Render a finished BGM WAV into upload-ready MP4s using ffmpeg.

Visuals are procedurally generated with ffmpeg's `gradients` source filter
(a slow-moving animated gradient) plus a text overlay — no stock footage,
stock images, or paid assets required.

Produces:
  - a 16:9 file for YouTube (long-form)
  - a 9:16 file for TikTok / Instagram Reels / YouTube Shorts
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import wave

# DejaVu Sans has no Japanese glyphs — titles are Japanese now (2026-08-04
# SEO pass), so this was silently drawing tofu boxes into every rendered
# video's burned-in title text. WenQuanYi Zen Hei ships preinstalled in
# this environment's base image (verified via `fc-list`) and covers
# Japanese kana/kanji; see branding.JP_FONT for the same fix applied to
# thumbnails.
FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

# Unified brand palette (matches branding.py's BG_TOP/BG_BOTTOM + ACCENT,
# used everywhere else — channel art, thumbnails, the app, the company
# site) instead of a different, off-brand hue per preset (owner feedback
# 2026-08-04: "色遣いが悪い。なんで紫なの？" about study_focus_binaural's
# purple). Presets are now differentiated by icon and thumbnail text, not
# by the channel's background color scheme.
THEME_COLORS = {
    "sleep_deep_drone": ["0x0b0e1a", "0x141a30", "0x1e2648"],
    "sleep_rain_focus": ["0x0b0e1a", "0x142230", "0x1e3648"],
    "study_lofi_chill": ["0x0b0e1a", "0x1a1a30", "0x2a2040"],
    "study_focus_binaural": ["0x0b0e1a", "0x141a30", "0x1e2648"],
}


def wav_duration_seconds(path: str) -> float:
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def _gradient_source(size: str, colors: list[str], duration: float, seed: int) -> str:
    color_args = ":".join(f"c{i}={c}" for i, c in enumerate(colors))
    return (
        f"gradients=size={size}:{color_args}:nb_colors={len(colors)}"
        f":speed=0.003:type=spiral:seed={seed}:duration={duration}:rate=24"
    )


def _escape_drawtext(text: str) -> str:
    return text.replace("\\", r"\\").replace(":", r"\:").replace("'", r"\'")


def render(audio_path: str, out_path: str, title: str, preset: str,
           orientation: str = "landscape", seed: int = 42) -> None:
    duration = wav_duration_seconds(audio_path)
    size = "1920x1080" if orientation == "landscape" else "1080x1920"
    colors = THEME_COLORS.get(preset, ["0x0b1026", "0x1a2a6c", "0x2d1b4e"])
    fontsize = 54 if orientation == "landscape" else 64
    title = _escape_drawtext(title)

    gradient = _gradient_source(size, colors, duration, seed)
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", gradient,
        "-i", audio_path,
        "-vf", f"gblur=sigma=40,drawtext=fontfile={FONT_PATH}:text='{title}':"
               f"fontcolor=white@0.85:fontsize={fontsize}:x=(w-text_w)/2:y=(h-text_h)/2:"
               f"box=1:boxcolor=black@0.25:boxborderw=20",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        out_path,
    ]
    subprocess.run(cmd, check=True)


def _countdown_drawtext(total_seconds: float, fontsize: int) -> str:
    """ffmpeg drawtext filter fragment showing a live H:MM:SS countdown from
    `total_seconds` down to 0:00:00, driven entirely by ffmpeg's per-frame
    `t` (presentation timestamp) expression — no per-frame text file or
    Python-side frame generation needed. Added 2026-08-27 per owner request
    ("動画側にも時間表示させたい。1時間から1秒ずつ減っていく仕組みは作れ
    る？").

    Built from three independent %{eif:EXPR:d[:WIDTH]} expansions (hours,
    minutes, seconds), each clamped with max(...,0) so it holds at 0:00:00
    rather than going negative if the video runs a hair past `total_seconds`
    (encoder rounding). `:` and `,` inside the expression have to be
    backslash-escaped because they're also ffmpeg filter-graph syntax
    characters — verified against a real rendered/frame-extracted test
    clip, not just read from docs, since this is easy to get subtly wrong.
    """
    remaining = f"max(({total_seconds}-t)\\,0)"
    hours = f"trunc({remaining}/3600)"
    minutes = f"trunc(mod({remaining}\\,3600)/60)"
    seconds = f"trunc(mod({remaining}\\,60))"
    text = f"%{{eif\\:{hours}\\:d}}\\:%{{eif\\:{minutes}\\:d\\:2}}\\:%{{eif\\:{seconds}\\:d\\:2}}"
    return (
        f"drawtext=fontfile={FONT_PATH}:text='{text}':fontcolor=white:fontsize={fontsize}:"
        f"x=w-text_w-40:y=h-text_h-40:box=1:boxcolor=black@0.45:boxborderw=14"
    )


def render_photo_background(audio_path: str, out_path: str, image_path: str,
                             orientation: str = "landscape", countdown_seconds: float | None = None) -> None:
    """Static photo as the entire visual — no animated gradient. Standard as
    of 2026-08-12 for presets on the photo-thumbnail track (see
    thumbnail.make_photo_thumbnail()): the same real image that carries the
    thumbnail also carries the video body, cover-cropped to fill the frame
    and held static for the whole duration.

    2026-08-27: `countdown_seconds` optionally adds a live H:MM:SS countdown
    timer in the bottom-right corner (see _countdown_drawtext) — the one
    intentional bit of motion in an otherwise still frame, so it doesn't
    compete with "動きは控えめ" (minimal movement) as a design goal. Pass
    the track's actual duration in seconds (matching the audio) so it lands
    on 0:00:00 right as the video ends. Off (None) by default — not yet
    rolled out to every existing preset, just available where wired in."""
    w, h = (1920, 1080) if orientation == "landscape" else (1080, 1920)
    vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
    if countdown_seconds is not None:
        fontsize = w // 24
        vf += "," + _countdown_drawtext(countdown_seconds, fontsize)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", image_path,
        "-i", audio_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        out_path,
    ]
    subprocess.run(cmd, check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render a BGM WAV to an upload-ready MP4.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--preset", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--orientation", choices=["landscape", "vertical"], default="landscape")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)

    render(args.audio, args.out, args.title, args.preset, args.orientation, args.seed)
    print(f"rendered {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
