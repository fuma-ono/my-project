"""Track presets: each one is a small recipe that composes the primitives in
core.py into a finished ambient/lo-fi bed. Add a new preset by adding a new
function here and registering it in PRESETS.
"""
from __future__ import annotations

import numpy as np

from . import core

PADS_SLEEP = [
    [48, 55, 60, 63],  # Cm add11 - low, calm
    [46, 53, 58, 61],  # Bbm
    [43, 50, 55, 58],  # Abmaj
    [45, 52, 57, 60],  # Bbm/inversion-ish, keeps motion subtle
]

PADS_STUDY = [
    [60, 64, 67, 71],  # Cmaj7
    [57, 60, 64, 67],  # Am7
    [53, 57, 60, 64],  # Fmaj7
    [55, 59, 62, 65],  # G7
]


def midi_to_freq(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _chord_pad(chords: list[list[int]], seconds: float, chord_seconds: float,
               sr: int = core.SAMPLE_RATE) -> np.ndarray:
    out = np.zeros(int(seconds * sr))
    pos = 0.0
    i = 0
    while pos < seconds:
        chord = chords[i % len(chords)]
        this_len = min(chord_seconds, seconds - pos)
        if this_len <= 0:
            break
        segment = np.zeros(int(this_len * sr))
        for midi_note in chord:
            freq = midi_to_freq(midi_note)
            segment = segment + core.detuned_stack(freq, this_len, voices=3, detune_cents=5, sr=sr)
        segment /= len(chord)
        # cosine crossfade at chord boundaries so changes are smooth, not clicky
        edge = min(int(2.0 * sr), len(segment) // 2)
        if edge > 0:
            fade = (1 - np.cos(np.linspace(0, np.pi, edge))) / 2
            segment[:edge] *= fade
            segment[-edge:] *= fade[::-1]
        start = int(pos * sr)
        end = start + len(segment)
        out[start:end] += segment[: end - start]
        pos += this_len
        i += 1
    return out


def sleep_deep_drone(minutes: float = 3.0) -> core.StereoTrack:
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    pad = _chord_pad(PADS_SLEEP, seconds, chord_seconds=24.0, sr=sr)
    pad = core.one_pole_lowpass(pad, cutoff_hz=500, sr=sr)
    bed = core.brown_noise(seconds, sr) * 0.06
    breathing = core.lfo(0.05, seconds, sr, depth=0.15, offset=0.85)
    mix = (pad * 0.8 + bed) * breathing
    mix = core.simple_reverb(mix, sr, room_seconds=3.0, mix=0.4)
    mix = core.fade_in_out(mix, sr, fade_seconds=6.0)
    mix = core.normalize(mix, peak=0.75)
    return core.widen(mix, width=0.2, sr=sr)


def sleep_rain_focus(minutes: float = 3.0) -> core.StereoTrack:
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    rain = core.pink_noise(seconds, sr)
    rain = core.one_pole_lowpass(rain, cutoff_hz=3500, sr=sr)
    rain = core.one_pole_highpass(rain, cutoff_hz=200, sr=sr)
    pad = _chord_pad(PADS_SLEEP, seconds, chord_seconds=30.0, sr=sr)
    pad = core.one_pole_lowpass(pad, cutoff_hz=400, sr=sr) * 0.5
    mix = rain * 0.5 + pad
    mix = core.simple_reverb(mix, sr, room_seconds=2.2, mix=0.25)
    mix = core.fade_in_out(mix, sr, fade_seconds=5.0)
    mix = core.normalize(mix, peak=0.7)
    return core.widen(mix, width=0.35, sr=sr)


def study_lofi_chill(minutes: float = 3.0) -> core.StereoTrack:
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    pad = _chord_pad(PADS_STUDY, seconds, chord_seconds=8.0, sr=sr)
    pad = core.one_pole_lowpass(pad, cutoff_hz=2200, sr=sr)

    bpm = 78
    beat_len = 60 / bpm
    n_beats = int(seconds / beat_len) + 1
    pulse = np.zeros(int(seconds * sr))
    for b in range(n_beats):
        if b % 2 == 0:
            continue  # backbeat-style ducking, not every beat
        start = int(b * beat_len * sr)
        dur = int(beat_len * 0.9 * sr)
        env = np.linspace(1.0, 0.0, dur) ** 2
        end = min(start + dur, len(pulse))
        pulse[start:end] = np.maximum(pulse[start:end], env[: end - start])
    duck = 1.0 - pulse * 0.25
    mix = pad * duck

    vinyl = core.white_noise(seconds, sr)
    vinyl = core.one_pole_highpass(vinyl, cutoff_hz=4000, sr=sr) * 0.03
    crackle_mask = (np.random.uniform(0, 1, len(vinyl)) > 0.9995).astype(float)
    crackle = vinyl * 8 * crackle_mask
    mix = mix + vinyl + crackle

    mix = core.simple_reverb(mix, sr, room_seconds=1.2, mix=0.2)
    mix = core.fade_in_out(mix, sr, fade_seconds=3.0)
    mix = core.normalize(mix, peak=0.8)
    return core.widen(mix, width=0.15, sr=sr)


def study_focus_binaural(minutes: float = 3.0) -> core.StereoTrack:
    """Alpha-range (10 Hz) binaural beat under a soft pad, aimed at focus/study."""
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    base = 220.0
    beat_hz = 10.0
    left = core.sine(base, seconds, sr)
    right = core.sine(base + beat_hz, seconds, sr)

    pad = _chord_pad(PADS_STUDY, seconds, chord_seconds=16.0, sr=sr)
    pad = core.one_pole_lowpass(pad, cutoff_hz=1200, sr=sr) * 0.5

    left = core.normalize(left * 0.25 + pad, peak=0.7)
    right = core.normalize(right * 0.25 + pad, peak=0.7)
    left = core.fade_in_out(left, sr, fade_seconds=5.0)
    right = core.fade_in_out(right, sr, fade_seconds=5.0)
    return core.StereoTrack(left, right, sr)


PRESETS = {
    "sleep_deep_drone": sleep_deep_drone,
    "sleep_rain_focus": sleep_rain_focus,
    "study_lofi_chill": study_lofi_chill,
    "study_focus_binaural": study_focus_binaural,
}

PRESET_METADATA = {
    "sleep_deep_drone": {
        "title": "Deep Sleep Drone",
        "description": "Low, slow-moving ambient pad with a brown-noise bed for deep sleep.",
        "tags": ["sleep music", "deep sleep", "ambient", "relaxing music"],
    },
    "sleep_rain_focus": {
        "title": "Rain & Soft Pad for Sleep",
        "description": "Filtered rain texture layered with a gentle ambient pad.",
        "tags": ["rain sounds", "sleep music", "relaxation", "ambient"],
    },
    "study_lofi_chill": {
        "title": "Lo-Fi Chill Beats to Study To",
        "description": "Warm lo-fi chords with vinyl texture and a laid-back pulse.",
        "tags": ["lofi hip hop", "study music", "chill beats", "focus"],
    },
    "study_focus_binaural": {
        "title": "Alpha Focus Binaural + Pad",
        "description": "10Hz alpha-range binaural beat under a soft pad for study focus.",
        "tags": ["binaural beats", "study music", "focus music", "alpha waves"],
    },
}
