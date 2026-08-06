"""Self-synthesized sound effects for モヤスカ shorts — no sample libraries
or stock SFX packs, same "100% self-generated" policy as this module's
visuals (background_gen.py, channel_art.py, line_chat.py's evidence
charts/stickers).

Owner request (2026-08-06): "最後スカッとするタイミングでこうかおんを
付けて、スクラッチみたいなウェイ系の音" — a record-scratch into a bright
hype-horn stinger, placed at the story's climactic payoff beat.

Both halves are pure ffmpeg lavfi synthesis:
  - the "scratch" is pink noise run through a fast vibrato (wobbling
    pitch), which is what a scratched record actually sounds like —
    rapid pitch modulation on a noisy source
  - the "hype horn" is additive synthesis (three stacked sine partials,
    not a single pure tone) with a fast attack, so it reads as a bright
    brassy honk rather than an electronic beep
"""
from __future__ import annotations

import subprocess


def generate_scratch_hype(out_path: str) -> None:
    """Writes a ~0.7s record-scratch → hype-horn stinger to `out_path`."""
    filter_complex = (
        "anoisesrc=d=0.22:c=pink:a=0.6,vibrato=f=22:d=1[scratch];"
        "aevalsrc=0.5*sin(2*PI*500*t)+0.3*sin(2*PI*1000*t)+0.2*sin(2*PI*1500*t):d=0.5,"
        "afade=t=in:st=0:d=0.03,afade=t=out:st=0.35:d=0.15,volume=1.5[honk];"
        "[scratch][honk]concat=n=2:v=0:a=1[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_complex, "-map", "[out]", out_path],
        check=True, capture_output=True,
    )


SFX_GENERATORS = {
    "scratch_hype": generate_scratch_hype,
}
