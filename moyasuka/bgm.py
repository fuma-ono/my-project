"""Self-composed background music loop for モヤスカ shorts — owner request
(2026-08-06): "小さい音でいいからBGMは付けて" (add BGM, quiet is fine).
Owner feedback (2026-08-07): "BGMをポップなものに変えて" (make the BGM
poppy) — the original was a plain music-box/pizzicato melody with no
rhythm section, which read as background-ambient rather than pop. Kept
the quiet-under-the-chat-scene mix level, but replaced the loop itself
with a kick/snare/hihat beat under a brighter, syncopated pentatonic riff
— same idea as a basic J-pop/idol-tune backing track, just short and
simple enough to loop for a minute without getting grating.

Pure numpy synthesis, no samples or licensed loops — same "100% self-
generated" policy as bgm_pipeline's actual BGM-generation business
(bgm-pipeline/bgm_pipeline/), reused here at a much smaller scale. This
isn't meant to be a foreground piece — it's mixed in quietly under the
chat scene, so it just needs to feel upbeat and non-fatiguing on repeat,
not sophisticated.

Each melody note is a plucked tone (a decaying sine + a detuned harmonic,
same "decay envelope = percussive" idea as sfx.py's drum hits). The kick
is a pitch-swept sine (classic synth-kick trick: start high, sweep down
fast), the snare/hihat are enveloped noise bursts. All four layers are
placed on a 16th-note step grid, tiled to cover the video's full length,
and faded out at the very end.
"""
from __future__ import annotations

import wave

import numpy as np

SR = 44100

NOTE_FREQS = {
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "G4": 392.00,
    "A4": 440.00, "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99,
}

TEMPO_BPM = 128
STEPS_PER_BAR = 16  # 16th notes, 4/4
STEP_SECONDS = 60.0 / TEMPO_BPM / 4.0
PATTERN_STEPS = STEPS_PER_BAR * 2  # 2-bar riff before it repeats

# a bright, bouncy pentatonic riff over 2 bars (32 steps) — missing step
# indices are rests, which is what gives it the syncopated "poppy" bounce
# rather than a flat run of even notes
MELODY = {
    0: "C5", 2: "E5", 4: "G5", 6: "E5", 8: "D5", 10: "E5", 12: "C5",
    16: "G4", 18: "C5", 20: "E5", 22: "D5", 24: "C5", 28: "E5", 30: "G5",
}
NOTE_SECONDS = STEP_SECONDS * 1.8  # slight overlap so notes aren't clipped short

# classic pop backbeat: kick on 1 & 3, snare/clap on 2 & 4, hihat on every 8th
KICK_STEPS = {0, 8, 16, 24}
SNARE_STEPS = {4, 12, 20, 28}
HIHAT_STEPS = {i for i in range(PATTERN_STEPS) if i % 2 == 0}

_NOISE_RNG = np.random.default_rng(7)  # fixed seed: renders are reproducible run to run


def _pluck(freq: float, duration: float) -> np.ndarray:
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    envelope = np.exp(-7.0 * t)
    tone = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)
    return envelope * tone


def _kick(duration: float = 0.18) -> np.ndarray:
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    freq = 150 * np.exp(-25 * t) + 45  # pitch sweep: thump on attack, settles low
    phase = 2 * np.pi * np.cumsum(freq) / SR
    envelope = np.exp(-18 * t)
    return np.sin(phase) * envelope


def _snare(duration: float = 0.14) -> np.ndarray:
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    noise = _NOISE_RNG.standard_normal(len(t))
    tone = np.sin(2 * np.pi * 190 * t) * 0.4
    envelope = np.exp(-22 * t)
    return (noise * 0.6 + tone) * envelope


def _hihat(duration: float = 0.05) -> np.ndarray:
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    noise = _NOISE_RNG.standard_normal(len(t))
    noise = np.diff(noise, prepend=0.0)  # crude high-pass: keeps the noisy transient, cuts the rumble
    envelope = np.exp(-45 * t)
    return noise * envelope


def _place(buf: np.ndarray, sound: np.ndarray, start_sample: int, gain: float) -> None:
    end = min(start_sample + len(sound), len(buf))
    if end <= start_sample:
        return
    buf[start_sample:end] += sound[: end - start_sample] * gain


def render_bgm_loop(total_seconds: float, out_path: str, amplitude: float = 0.16) -> None:
    """Writes a looped, poppy BGM track (melody + kick/snare/hihat beat)
    covering `total_seconds` to `out_path`. `amplitude` defaults low (0.16)
    since this always plays under the chat scene, per the owner's "小さい
    音でいいからBGMは付けて" request — narration audio needs to stay
    clearly on top of it."""
    pattern_seconds = PATTERN_STEPS * STEP_SECONDS
    pattern = np.zeros(int(pattern_seconds * SR), dtype=np.float64)

    for step, note in MELODY.items():
        _place(pattern, _pluck(NOTE_FREQS[note], NOTE_SECONDS), int(step * STEP_SECONDS * SR), 0.9)
    for step in KICK_STEPS:
        _place(pattern, _kick(), int(step * STEP_SECONDS * SR), 1.0)
    for step in SNARE_STEPS:
        _place(pattern, _snare(), int(step * STEP_SECONDS * SR), 0.55)
    for step in HIHAT_STEPS:
        _place(pattern, _hihat(), int(step * STEP_SECONDS * SR), 0.35)

    reps = int(np.ceil(total_seconds / pattern_seconds)) + 1
    full = np.tile(pattern, reps)[: int(total_seconds * SR)]

    fade_len = min(int(0.6 * SR), len(full))
    if fade_len > 0:
        full[-fade_len:] *= np.linspace(1.0, 0.0, fade_len)

    full = np.clip(full * amplitude, -1.0, 1.0)
    pcm = (full * 32767).astype(np.int16)

    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
