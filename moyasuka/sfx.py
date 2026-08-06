"""Self-synthesized sound effects for モヤスカ shorts — no sample libraries
or stock SFX packs, same "100% self-generated" policy as this module's
visuals (background_gen.py, channel_art.py, line_chat.py's evidence
charts/stickers).

Owner request (2026-08-06), round 1: "最後スカッとするタイミングでこう
かおんを付けて、スクラッチみたいなウェイ系の音" — record-scratch into
something hype at the story's climactic payoff beat.

Owner request, round 2 (after hearing round 1): "ホーンはだめだよ　でで
でででデェェェェン　みたいなの音がいいのに" — the bright horn was wrong;
what they want is a dramatic building drum hit (five short low thumps
building tension, then one long sustained hit) — the classic "revelation
sting" used constantly in Japanese variety/drama edits, not a hype horn.

Both halves are pure ffmpeg lavfi synthesis, no samples:
  - the "scratch" is pink noise run through a fast vibrato (wobbling
    pitch), which is what a scratched record actually sounds like —
    rapid pitch modulation on a noisy source
  - the "de-de-de-de-DUN" is additive synthesis: each hit is a low sine
    fundamental + a detuned harmonic, under a fast exponential-decay
    envelope (`aevalsrc` evaluates the expression directly, sample by
    sample) — that decay shape is what makes a synthesized tone read as
    a "hit" instead of a held note. The five short hits share one decay
    rate and a mild volume crescendo; the final hit uses a lower
    fundamental and a much slower decay so it rings out instead of
    cutting off.
"""
from __future__ import annotations

import subprocess


def _hit_expr(freq: float, decay: float, amp: float) -> str:
    return f"(sin(2*PI*{freq}*t)+0.4*sin(2*PI*{freq * 2}*t))*exp(-{decay}*t)*{amp}"


def generate_scratch_dun(out_path: str) -> None:
    """Writes a ~1.9s record-scratch → "でででででデェェェェン" stinger to
    `out_path`: a scratch, five short building thumps, then one long
    dramatic hit."""
    hit_dur = 0.11
    gap_dur = 0.07
    n_hits = 5

    parts = ["anoisesrc=d=0.2:c=pink:a=0.55,vibrato=f=22:d=1[scratch]"]
    seq = ["[scratch]"]
    for i in range(n_hits):
        amp = 0.75 + 0.07 * i  # slight crescendo across the five hits
        parts.append(f"aevalsrc={_hit_expr(95, 22, amp)}:d={hit_dur}[h{i}]")
        parts.append(f"aevalsrc=0:d={gap_dur}[g{i}]")
        seq += [f"[h{i}]", f"[g{i}]"]
    parts.append(f"aevalsrc={_hit_expr(62, 3.4, 1.3)}:d=1.1[dun]")
    seq.append("[dun]")

    filter_complex = ";".join(parts) + ";" + "".join(seq) + f"concat=n={len(seq)}:v=0:a=1[out]"
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_complex, "-map", "[out]", out_path],
        check=True, capture_output=True,
    )


SFX_GENERATORS = {
    "scratch_dun": generate_scratch_dun,
}
