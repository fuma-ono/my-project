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

Owner request, round 3: "全然参考にしてないよね？同じような音を使用し
てよ" — tried to literally pull audio from the reference video/channel to
match it directly (yt-dlp), but this sandbox's network policy blocks
YouTube's video/audio CDN the same way it blocks WebFetch on youtube.com
(confirmed: 403 through the proxy, not a code bug) — there is no way to
extract or clone that specific audio from here. What *is* fixable without
that: this whole genre's videos play a short notification "pop" on every
single message bubble as it appears, not just one climax sting — that's
the actual gap, not a wrong stinger. `generate_message_pop` below adds it.

Owner request, round 4: pointed at a specific track — 効果音ラボ(sound
effect-lab.info)'s 男衆「イヤッホー！」("men's crowd cheer") — and asked
for that one specifically ("これがいい"). This session's network policy
blocks soundeffect-lab.info the same way it blocks YouTube (confirmed via
curl: 403 at the proxy), so it couldn't be fetched here either; the owner
downloaded it on their own machine and attached it in chat instead. It now
lives at moyasuka/assets/sfx/otoko_iyahho.mp3 — see NOTICE.md in that
folder for the license terms and how it was obtained. This is the one
exception to this module's "everything is synthesized" rule, and it's
used only for the climax cue; `generate_message_pop` (the per-message
notification) stays synthesized.

The synthesized stingers below are pure ffmpeg lavfi synthesis, no
samples:
  - the "scratch" (superseded as the climax cue by otoko_iyahho.mp3, kept
    here since it's still valid, reusable synthesis) is pink noise run
    through a fast vibrato (wobbling pitch), which is what a scratched
    record actually sounds like — rapid pitch modulation on a noisy source
  - the "de-de-de-de-DUN" (also superseded as the climax cue) is additive
    synthesis: each hit is a low sine fundamental + a detuned harmonic,
    under a fast exponential-decay envelope (`aevalsrc` evaluates the
    expression directly, sample by sample) — that decay shape is what
    makes a synthesized tone read as a "hit" instead of a held note
  - the message-arrival "pop" (still in active use) is the same
    sine+harmonic+decay idea, just pitched high and short
"""
from __future__ import annotations

import subprocess
from pathlib import Path

ASSETS_DIR = Path(__file__).parent / "assets" / "sfx"


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


def generate_message_pop(out_path: str) -> None:
    """Writes a ~0.15s two-note notification "pop" — the sound every
    message-drama Shorts channel plays on each new bubble. A short
    ascending two-tone chime (not a copy of any app's actual trademarked
    notification sound, just the same shape: two quick rising pitches),
    synthesized the same way as the drum hits above (sine + harmonic
    under a fast decay envelope)."""
    filter_complex = (
        f"aevalsrc={_hit_expr(660, 40, 0.5)}:d=0.07[n1];"
        f"aevalsrc={_hit_expr(880, 35, 0.55)}:d=0.09[n2];"
        "[n1][n2]concat=n=2:v=0:a=1[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_complex, "-map", "[out]", out_path],
        check=True, capture_output=True,
    )


def generate_surprise_hit(out_path: str) -> None:
    """Writes a ~0.38s "shock reveal" stinger: a fast rising pitch sweep
    (the classic anime/variety "ヒュン!" gasp) straight into a short low
    thud — for the instant a harsh or shocking line lands mid-conversation.

    Owner request (2026-08-10): "ひどい言葉や衝撃的な言葉を言われた際に、
    BGMとして驚きのような効果音入れて" — a surprise cue triggered by what's
    actually said, not just the one climax beat. line_chat.py scans every
    spoken line against HARSH_TRIGGER_WORDS and fires this cue on a match,
    so unlike otoko_iyahho/scratch_dun (exactly once, at the manually
    placed !sfx: line) or message_pop (every bubble, same subtle chime
    regardless of content), this one is content-triggered and can fire
    zero, one, or several times per video depending on the dialogue.

    Same additive-synthesis approach as the other stingers here: no
    samples, just aevalsrc expressions. The sweep is a sine whose
    instantaneous frequency climbs (300Hz→~2600Hz over the sweep) under a
    fast decay so it reads as a quick intake-of-breath rather than a siren;
    the thud reuses _hit_expr the same way generate_scratch_dun's hits do."""
    sweep_dur = 0.16
    thud_dur = 0.22
    sweep_expr = "sin(2*PI*(300+13000*t)*t)*exp(-6*t)*0.6"
    thud_expr = _hit_expr(90, 16, 1.0)
    filter_complex = (
        f"aevalsrc={sweep_expr}:d={sweep_dur}[sweep];"
        f"aevalsrc={thud_expr}:d={thud_dur}[thud];"
        "[sweep][thud]concat=n=2:v=0:a=1[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_complex, "-map", "[out]", out_path],
        check=True, capture_output=True,
    )


def use_otoko_iyahho(out_path: str) -> None:
    """Copies the licensed 効果音ラボ track (see assets/sfx/NOTICE.md for
    source/license) to `out_path` as wav, so it fits the same pipeline as
    the synthesized cues (_mix_audio expects a readable audio file, it
    doesn't care whether ffmpeg generated it from scratch or transcoded
    an existing one)."""
    src = ASSETS_DIR / "otoko_iyahho.mp3"
    subprocess.run(["ffmpeg", "-y", "-i", str(src), out_path], check=True, capture_output=True)


def generate_notification(out_path: str) -> None:
    """Writes a ~0.4s opening "notification" chime — owner request
    (2026-08-16): "まず最初に通知音を出して". Distinct from
    generate_message_pop (which plays on every bubble, a quick 0.16s
    tick): this is the one-time hook at the very start of the video, a
    slightly warmer/more resonant two-note bell (slower decay, lower
    pitch) so it reads as "your phone just got a notification" rather
    than blending into the per-message pops that follow it. Same additive
    sine+harmonic-under-decay synthesis as everything else in this module."""
    filter_complex = (
        f"aevalsrc={_hit_expr(784, 9, 0.55)}:d=0.22[n1];"
        f"aevalsrc={_hit_expr(1046, 7, 0.5)}:d=0.3[n2];"
        "[n1][n2]concat=n=2:v=0:a=1[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_complex, "-map", "[out]", out_path],
        check=True, capture_output=True,
    )


def use_yome_nanimo_shinai(out_path: str) -> None:
    """Copies an owner-provided clip (see assets/sfx/NOTICE.md for source/
    license — pending confirmation, 2026-08-16) to `out_path` as wav, same
    transcode-through-ffmpeg approach as use_otoko_iyahho. Placed via a
    manual `!sfx:yome_nanimo_shinai` line right after 義母's "嫁は何もしな
    いから私が全部って" in scripts/01-sample.md (owner request, 2026-08-16),
    not auto-triggered — this is a one-off cue for that specific line, not
    a content-pattern match like surprise_hit."""
    src = ASSETS_DIR / "yome_nanimo_shinai.mp3"
    subprocess.run(["ffmpeg", "-y", "-i", str(src), out_path], check=True, capture_output=True)


def generate_screenshot(out_path: str) -> None:
    """Writes a ~0.13s two-click camera-shutter sound for the "証拠提示"
    beat — an [image] evidence-chart cue landing (owner request,
    2026-08-14: 証拠提示 → sfx:screenshot). Two short bursts of
    high-passed white noise with a fast fade-out envelope (mechanical
    shutter's open/close clicks), separated by a brief gap. Same
    "no samples" synthesis approach as the rest of this module —
    `anoisesrc` generates the raw noise, `highpass` + `afade` shape each
    click, `concat` joins them. Auto-triggered by line_chat.py on every
    `[image]`/`[image:...]` cue, the same way message_pop/surprise_hit are
    auto-triggered rather than requiring a manual `!sfx:` line per cue."""
    filter_complex = (
        "anoisesrc=d=0.03:c=white:a=0.9,highpass=f=2200,afade=t=out:st=0:d=0.03[c1];"
        "anoisesrc=d=0.05:c=white:a=0[gap];"
        "anoisesrc=d=0.045:c=white:a=0.85,highpass=f=1600,afade=t=out:st=0:d=0.045[c2];"
        "[c1][gap][c2]concat=n=3:v=0:a=1[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_complex, "-map", "[out]", out_path],
        check=True, capture_output=True,
    )


SFX_GENERATORS = {
    "scratch_dun": generate_scratch_dun,  # superseded as the climax cue, kept as reusable synthesis
    "notification": generate_notification,  # auto-fired once at the very start of the video, see line_chat.py
    "message_pop": generate_message_pop,
    "otoko_iyahho": use_otoko_iyahho,  # current climax cue (licensed track, see round 4 above)
    "yome_nanimo_shinai": use_yome_nanimo_shinai,  # owner-provided clip, see NOTICE.md
    "surprise_hit": generate_surprise_hit,  # content-triggered, see HARSH_TRIGGER_WORDS in line_chat.py
    "screenshot": generate_screenshot,  # content-triggered, see kind=="image" handling in line_chat.py
}
