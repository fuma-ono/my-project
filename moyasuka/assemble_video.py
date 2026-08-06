"""Assembles a モヤスカ short: background video + narration audio + burned-in
Japanese captions, synced by estimated per-line reading duration.

Two things are deliberately left as placeholders here, both because
VOICEVOX itself cannot be reached from this sandbox (see moyasuka/README.md
— GitHub release-binary downloads, Docker, and direct API fetch were all
tried and blocked; it needs to run on the owner's own PC):

  1. Real narration audio. When no --audio is passed, a silent placeholder
     track is generated so the assembly pipeline itself can still be built
     and tested end-to-end right now, instead of blocking on VOICEVOX
     before any of this code exists.
  2. Precise per-line timing. VOICEVOX's own query API returns exact mora
     (syllable) timings once it's running — that should replace the
     estimator below (`estimate_timings`) for the real thing. The
     character-count heuristic here is only an approximation for testing.

Captions use JP_FONT_FAMILY (wqy-zenhei's fontconfig name), same font
file as bgm_pipeline/branding.py and this module's channel_art.py — see
those files for why (the 2026-08-05 文字化け bug).
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

JP_FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
JP_FONT_FAMILY = "WenQuanYi Zen Hei"  # fontconfig family name, used by the .ass style
CAPTION_FONT_SIZE = 44

CHARS_PER_SECOND = 6.5  # rough JP narration reading speed (≈390 chars/min)
MIN_LINE_SECONDS = 1.2
GAP_SECONDS = 0.15  # small breathing gap between lines


def parse_script(path: str) -> list[str]:
    """Pulls narration lines out of a scripts/*.md file: skips the
    title/cast header (everything before the `---` separator) and the
    trailing fiction disclaimer, keeps one caption per paragraph."""
    text = Path(path).read_text(encoding="utf-8")
    if "---" in text:
        text = text.split("---", 1)[1]
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    lines = [ln for ln in lines if not ln.startswith("（この物語はフィクションです")]
    return lines


def estimate_timings(lines: list[str]) -> list[tuple[float, float, str]]:
    """TODO once VOICEVOX is live: replace with real mora timings from its
    query API instead of this character-count estimate."""
    t = 0.0
    out = []
    for line in lines:
        dur = max(MIN_LINE_SECONDS, len(line) / CHARS_PER_SECOND)
        out.append((t, t + dur, line))
        t += dur + GAP_SECONDS
    return out


def _wrap_jp_text(text: str, max_width_px: int, font_size: int = CAPTION_FONT_SIZE) -> str:
    """Character-wrap (not word-wrap) since Japanese has no spaces between
    words — same approach as bgm_pipeline/thumbnail.py's `_wrap_text`.

    This is necessary, not cosmetic: libass's own automatic line-wrapping
    only breaks at whitespace, which Japanese text doesn't have, so without
    this every caption rendered as a single line running off the right
    edge of the frame (found by actually rendering a frame and looking at
    it — see git history for the before/after).
    """
    font = ImageFont.truetype(JP_FONT_PATH, font_size)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lines: list[str] = []
    current = ""
    for ch in text:
        candidate = current + ch
        if probe.textbbox((0, 0), candidate, font=font)[2] <= max_width_px:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return "\\N".join(lines)


def _ass_timestamp(seconds: float) -> str:
    cs = int(round(seconds * 100))  # ASS uses centiseconds
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6_000)
    s, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


# Video is 720x1280 (see background_gen.py). A plain SRT carries no
# resolution info, so ffmpeg's `subtitles` filter has to guess a script
# resolution to scale FontSize/wrap-width against — the guess didn't match
# a 720x1280 portrait frame, and the result (found by actually rendering a
# frame and looking at it) was wildly oversized text. Writing the .ass file
# directly and setting PlayResX/PlayResY to the real video size makes
# FontSize an actual pixel size and wrap width a real fraction of the frame,
# instead of a guess.
MARGIN_L = MARGIN_R = 60


def write_ass(timings: list[tuple[float, float, str]], path: str, video_w: int = 720, video_h: int = 1280) -> None:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{JP_FONT_FAMILY},{CAPTION_FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,{MARGIN_L},{MARGIN_R},150,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    max_width_px = video_w - MARGIN_L - MARGIN_R
    lines = [header]
    for start, end, text in timings:
        wrapped = _wrap_jp_text(text, max_width_px)
        lines.append(f"Dialogue: 0,{_ass_timestamp(start)},{_ass_timestamp(end)},Default,,0,0,0,,{wrapped}\n")
    Path(path).write_text("".join(lines), encoding="utf-8")


def assemble(script_path: str, background_path: str, out_path: str, audio_path: str | None = None) -> float:
    lines = parse_script(script_path)
    if not lines:
        raise ValueError(f"no narration lines found in {script_path}")
    timings = estimate_timings(lines)
    total_seconds = timings[-1][1] + 0.4

    with tempfile.TemporaryDirectory() as tmp:
        ass_path = f"{tmp}/captions.ass"
        write_ass(timings, ass_path)

        if audio_path is None:
            audio_path = f"{tmp}/silence.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                 "-t", str(total_seconds), audio_path],
                check=True, capture_output=True,
            )

        vf = f"ass={ass_path}"

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-stream_loop", "-1", "-i", background_path,  # loop if shorter than the narration
                "-i", audio_path,
                "-vf", vf,
                "-map", "0:v", "-map", "1:a",
                "-c:v", "libx264", "-c:a", "aac", "-shortest", out_path,
            ],
            check=True, capture_output=True,
        )

    return total_seconds


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Assemble a モヤスカ short from a script + background video (+ optional narration audio)."
    )
    parser.add_argument("--script", required=True, help="path to a scripts/*.md file")
    parser.add_argument("--background", required=True, help="path to a background_gen.py output video")
    parser.add_argument(
        "--audio", default=None,
        help="narration audio (wav/mp3); omit for a silent placeholder (for testing the pipeline before VOICEVOX is set up)",
    )
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    total = assemble(args.script, args.background, args.out, args.audio)
    print(f"wrote {args.out} ({total:.1f}s of narration)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
