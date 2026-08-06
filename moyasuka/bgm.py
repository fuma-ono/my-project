"""Self-composed background music loop for モヤスカ shorts — owner request
(2026-08-06): "小さい音でいいからBGMは付けて" (add BGM, quiet is fine).

Pure numpy synthesis, no samples or licensed loops — same "100% self-
generated" policy as bgm_pipeline's actual BGM-generation business
(bgm-pipeline/bgm_pipeline/), reused here at a much smaller scale for a
short, light, comedic-daily-life music-box/pizzicato loop rather than the
ambient sleep/focus drones that business makes. This isn't meant to be a
foreground piece — it's mixed in quietly under the chat scene, so the
melody just needs to be pleasant and non-fatiguing on repeat, not
sophisticated.

Each note is a plucked tone (a decaying sine + a detuned harmonic, same
"decay envelope = percussive" idea as sfx.py's drum hits) rendered with
numpy, concatenated into one bar, then tiled to cover the video's full
length and faded out at the very end.
"""
from __future__ import annotations

import wave

import numpy as np

SR = 44100

NOTE_FREQS = {
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "G4": 392.00,
    "A4": 440.00, "C5": 523.25, "D5": 587.33, "E5": 659.25,
}

# a light, bouncy C-major-pentatonate phrase — safe (no dissonant
# intervals), simple enough to loop for a minute without getting grating
MELODY = ["C4", "E4", "G4", "E4", "A4", "G4", "E4", "D4"]
NOTE_SECONDS = 0.3


def _pluck(freq: float, duration: float) -> np.ndarray:
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    envelope = np.exp(-7.0 * t)
    tone = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)
    return envelope * tone


def render_bgm_loop(total_seconds: float, out_path: str, amplitude: float = 0.16) -> None:
    """Writes a looped BGM track covering `total_seconds` to `out_path`.
    `amplitude` defaults low (0.16) since this always plays under the
    chat scene, per the owner's "小さい音でいいから" request — narration
    audio (once VOICEVOX is set up) needs to stay clearly on top of it."""
    bar = np.concatenate([_pluck(NOTE_FREQS[n], NOTE_SECONDS) for n in MELODY])
    bar_seconds = len(bar) / SR
    reps = int(np.ceil(total_seconds / bar_seconds)) + 1
    full = np.tile(bar, reps)[: int(total_seconds * SR)]

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
