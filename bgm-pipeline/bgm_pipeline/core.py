"""Procedural audio synthesis primitives.

Everything here is generated from scratch with numpy (oscillators, noise,
envelopes, a light delay-based reverb). No external audio APIs, sample
packs, or paid services are required, which keeps the BGM channel's
marginal cost near zero and avoids copyright/licensing risk.
"""
from __future__ import annotations

import wave
from dataclasses import dataclass

import numpy as np
from scipy.signal import lfilter

SAMPLE_RATE = 44100


def t_axis(seconds: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return np.arange(int(seconds * sr)) / sr


def sine(freq: float, seconds: float, sr: int = SAMPLE_RATE, phase: float = 0.0) -> np.ndarray:
    t = t_axis(seconds, sr)
    return np.sin(2 * np.pi * freq * t + phase)


def detuned_stack(freq: float, seconds: float, voices: int = 3, detune_cents: float = 6.0,
                   sr: int = SAMPLE_RATE) -> np.ndarray:
    """Several slightly detuned sine voices summed together for a lush pad tone."""
    out = np.zeros(int(seconds * sr))
    for v in range(voices):
        spread = (v - (voices - 1) / 2) * detune_cents
        f = freq * (2 ** (spread / 1200))
        phase = np.random.uniform(0, 2 * np.pi)
        out += sine(f, seconds, sr, phase)
    return out / voices


def lfo(rate_hz: float, seconds: float, sr: int = SAMPLE_RATE, depth: float = 1.0,
        offset: float = 0.0) -> np.ndarray:
    t = t_axis(seconds, sr)
    return offset + depth * np.sin(2 * np.pi * rate_hz * t)


def white_noise(seconds: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return np.random.uniform(-1, 1, int(seconds * sr))


def pink_noise(seconds: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Voss-McCartney approximation of pink (1/f) noise."""
    n = int(seconds * sr)
    n_rows = 16
    array = np.zeros((n_rows, n))
    rng = np.random.default_rng()
    for row in range(n_rows):
        step = 2 ** row
        vals = rng.uniform(-1, 1, n // step + 1)
        array[row] = np.repeat(vals, step)[:n]
    pink = array.sum(axis=0)
    return pink / np.max(np.abs(pink))


def brown_noise(seconds: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    n = int(seconds * sr)
    steps = np.random.uniform(-1, 1, n)
    brown = np.cumsum(steps)
    brown -= np.mean(brown)
    return brown / np.max(np.abs(brown))


def one_pole_lowpass(signal: np.ndarray, cutoff_hz: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    alpha = 1 - np.exp(-2 * np.pi * cutoff_hz / sr)
    return lfilter([alpha], [1, -(1 - alpha)], signal)


def one_pole_highpass(signal: np.ndarray, cutoff_hz: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return signal - one_pole_lowpass(signal, cutoff_hz, sr)


def simple_reverb(signal: np.ndarray, sr: int = SAMPLE_RATE, room_seconds: float = 1.6,
                   mix: float = 0.35) -> np.ndarray:
    """Cheap Schroeder-style reverb: a handful of feedback comb filters in parallel."""
    delays_ms = [29.7, 37.1, 41.3, 47.9]
    out = np.zeros_like(signal)
    for d_ms in delays_ms:
        d = max(1, int(sr * d_ms / 1000))
        decay = 0.001 ** (d / sr / room_seconds)
        a = np.zeros(d + 1)
        a[0] = 1.0
        a[d] = -decay
        out += lfilter([1.0], a, signal)
    out /= len(delays_ms)
    return signal * (1 - mix) + out * mix


def fade_in_out(signal: np.ndarray, sr: int = SAMPLE_RATE, fade_seconds: float = 3.0) -> np.ndarray:
    n_fade = int(fade_seconds * sr)
    n_fade = min(n_fade, len(signal) // 2)
    window = np.ones(len(signal))
    window[:n_fade] = np.linspace(0, 1, n_fade)
    window[-n_fade:] = np.linspace(1, 0, n_fade)
    return signal * window


def normalize(signal: np.ndarray, peak: float = 0.9) -> np.ndarray:
    m = np.max(np.abs(signal))
    if m == 0:
        return signal
    return signal / m * peak


@dataclass
class StereoTrack:
    left: np.ndarray
    right: np.ndarray
    sr: int = SAMPLE_RATE

    def to_wav(self, path: str) -> None:
        left = normalize(self.left)
        right = normalize(self.right)
        interleaved = np.empty(len(left) * 2, dtype=np.int16)
        interleaved[0::2] = (left * 32767).astype(np.int16)
        interleaved[1::2] = (right * 32767).astype(np.int16)
        with wave.open(path, "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(self.sr)
            wf.writeframes(interleaved.tobytes())


def widen(mono: np.ndarray, width: float = 0.15, sr: int = SAMPLE_RATE) -> StereoTrack:
    """Turn a mono signal into a gently widened stereo pair using a short delay + LFO pan."""
    delay_samples = int(0.012 * sr)
    right = np.concatenate([np.zeros(delay_samples), mono])[: len(mono)]
    pan = lfo(0.03, len(mono) / sr, sr, depth=width, offset=1.0)
    left = mono * pan
    right = right * (2 - pan)
    return StereoTrack(left, right, sr)
