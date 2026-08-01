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

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

THEME_COLORS = {
    "sleep_deep_drone": ["0x0b1026", "0x1a2a6c", "0x2d1b4e"],
    "sleep_rain_focus": ["0x0f2027", "0x203a43", "0x2c5364"],
    "study_lofi_chill": ["0x3a1c1c", "0x6f4e37", "0x2b1b17"],
    "study_focus_binaural": ["0x1b1b3a", "0x3a1b5a", "0x0d0d2b"],
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
