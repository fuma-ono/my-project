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
        "hook": "A low, slow-moving ambient drone with a warm brown-noise bed — made to help you fall into deep sleep and stay there.",
        "about": (
            "No melody to follow, no sudden changes — just a steady, low-frequency wash of sound "
            "designed to mask household noise and quiet a racing mind. The brown-noise layer sits "
            "lower and warmer than white noise, which many people find gentler for all-night listening."
        ),
        "use_cases": ["Falling asleep and staying asleep", "Masking noisy neighbors, traffic, or a snoring partner", "Naps", "Newborn/baby white noise (played at a safe, low volume)"],
        "tags": [
            "sleep music", "deep sleep music", "brown noise", "sleep sounds", "ambient sleep music",
            "insomnia relief", "relaxing sleep music", "sleep drone", "calming ambient", "8 hours sleep music",
            "white noise for sleep", "background noise for sleeping",
        ],
        "hashtags": ["sleepmusic", "deepsleep", "brownnoise", "ambientmusic", "insomnia"],
    },
    "sleep_rain_focus": {
        "title": "Rain & Soft Pad for Sleep",
        "description": "Filtered rain texture layered with a gentle ambient pad.",
        "hook": "Continuous rain sounds layered with a soft ambient pad — steady, warm rainfall for sleep, studying, or just tuning out the world.",
        "about": (
            "A filtered rain texture (no thunder, no jump-scares) layered under a slow-moving pad. "
            "Rain is one of the most requested sounds for sleep because it's a natural example of "
            "1/f (\"pink\") noise — predictable enough to relax into, varied enough not to feel robotic."
        ),
        "use_cases": ["Falling asleep to rain", "Deep, uninterrupted focus while studying or working", "Meditation and unwinding after a long day", "Drowning out city or apartment noise"],
        "tags": [
            "rain sounds", "rain sounds for sleeping", "sleep music", "relaxing rain", "rain and ambient music",
            "study music", "focus music", "relaxation music", "calming rain sounds", "rain for studying",
            "ambient rain", "nature sounds for sleep",
        ],
        "hashtags": ["rainsounds", "sleepmusic", "relaxation", "ambientmusic", "focusmusic"],
    },
    "study_lofi_chill": {
        "title": "Lo-Fi Chill Beats to Study To",
        "description": "Warm lo-fi chords with vinyl texture and a laid-back pulse.",
        "hook": "Warm lo-fi chords, vinyl crackle, and a laid-back beat — chill background music for studying, working, or just relaxing.",
        "about": (
            "A continuous, non-distracting lo-fi loop: warm jazzy chords, a soft backbeat, and a "
            "little vinyl texture for warmth. No vocals, no sudden drops — built to sit in the "
            "background while you actually get things done."
        ),
        "use_cases": ["Studying and reading", "Deep work / productivity sessions", "Coding and writing", "Cooking, chores, or a chill hangout playlist"],
        "tags": [
            "lofi hip hop", "lofi beats", "study music", "chill beats", "focus music", "lofi chill",
            "study lofi", "vinyl lofi", "relaxing beats", "background music for studying", "lofi radio",
            "productivity music",
        ],
        "hashtags": ["lofi", "lofihiphop", "studymusic", "chillbeats", "focusmusic"],
    },
    "study_focus_binaural": {
        "title": "Alpha Focus Binaural + Pad",
        "description": "10Hz alpha-range binaural beat under a soft pad for study focus.",
        "hook": "A 10Hz alpha-range binaural beat under a soft ambient pad — background audio built for focused study and deep work (headphones recommended).",
        "about": (
            "Two very slightly different tones, one in each ear, create a perceived \"beat\" at 10Hz — "
            "the alpha brainwave range associated with relaxed, focused alertness. Layered under a "
            "gentle pad so it's pleasant to listen to, not just clinical. Best experienced with headphones."
        ),
        "use_cases": ["Studying and reading", "Focused work sessions", "Light meditation", "Pre-exam or pre-deadline focus sessions"],
        "tags": [
            "binaural beats", "binaural beats focus", "study music", "focus music", "alpha waves",
            "10hz binaural beats", "concentration music", "brainwave music", "study binaural beats",
            "deep focus music", "binaural beats study", "ambient focus music",
        ],
        "hashtags": ["binauralbeats", "focusmusic", "studymusic", "alphawaves", "concentration"],
    },
}


def duration_label(minutes: float) -> str:
    if minutes >= 60:
        hours = minutes / 60
        return f"{hours:g} Hour" + ("s" if hours != 1 else "")
    return f"{minutes:g} Min"


def build_description(preset: str, minutes: float) -> str:
    """Composes the full YouTube description: a keyword-rich hook (the first
    ~150 chars are what shows before "Show more" and in search results),
    an expanded blurb, a use-case list, an AI/royalty-free disclosure, and
    a hashtag block (YouTube surfaces the first 3 above the title).
    """
    meta = PRESET_METADATA[preset]
    hours = minutes / 60
    duration_txt = (f"{hours:g} hour" + ("s" if hours != 1 else "")) if minutes >= 60 else f"{minutes:g} minutes"
    use_cases = "\n".join(f"- {u}" for u in meta["use_cases"])
    hashtags = " ".join(f"#{h}" for h in meta["hashtags"])

    return (
        f"{meta['hook']}\n\n"
        f"{meta['about']}\n\n"
        f"This video runs {duration_txt} continuously — fine to loop, leave playing overnight, "
        "or use as background audio in another app.\n\n"
        f"Good for:\n{use_cases}\n\n"
        "100% AI-generated, royalty-free ambient audio — no samples or copyrighted material, "
        "so it's safe for background listening, streams, or your own projects.\n\n"
        "New tracks posted regularly — subscribe if this helped you relax, focus, or sleep.\n\n"
        f"{hashtags}"
    )
