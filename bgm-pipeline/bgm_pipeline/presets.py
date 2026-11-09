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


def _heartbeat_pulse(seconds: float, bpm: float = 52.0, sr: int = 44100) -> np.ndarray:
    """A quiet, slow lub-dub pulse (two low thumps per beat, resting-heart-rate
    tempo) — the one new element `sleep_insomnia_pulse` adds on top of
    `sleep_deep_drone`'s existing pad+brown-noise bed. Deliberately built as
    a small addition to an existing preset rather than a new system: reuses
    `_chord_pad`'s envelope-and-place approach at a much simpler scale (two
    fixed low tones instead of chords)."""
    beat_len = 60.0 / bpm
    n_beats = int(seconds / beat_len) + 1
    out = np.zeros(int(seconds * sr))
    lub_freq, dub_freq = 55.0, 46.0  # dub slightly lower, like a real second heart sound
    for b in range(n_beats):
        beat_start = b * beat_len
        for offset, freq, amp in ((0.0, lub_freq, 1.0), (0.14, dub_freq, 0.7)):
            t0 = beat_start + offset
            if t0 >= seconds:
                continue
            dur = 0.09
            n = int(dur * sr)
            env = np.exp(-np.linspace(0, 14, n))
            tone = np.sin(2 * np.pi * freq * np.linspace(0, dur, n)) * env * amp
            start = int(t0 * sr)
            end = min(start + n, len(out))
            out[start:end] += tone[: end - start]
    return out


def sleep_insomnia_pulse(minutes: float = 3.0, include_pulse: bool = True) -> core.StereoTrack:
    """Scene: someone who can't fall asleep and is watching the clock,
    2-3am, growing more anxious the longer it takes (docs/marketing/
    bgm-content-audit/, scene 01 — 2026-08-12 approved first market test).
    Deliberately the smallest possible delta on `sleep_deep_drone`: same
    pad/noise bed, same PADS_SLEEP harmony (reused per the production
    standard's rule 3 — differentiation doesn't require new harmonic
    material when the scene doesn't call for it), plus one new element: a
    barely-audible resting-heart-rate pulse underneath, aimed at the
    specific anxious-wakefulness scene rather than sleep in general.

    `include_pulse` isn't a design decision made here — the owner treats the
    pulse as an open question ("does a regular pulse under a sleep drone
    help or hurt retention?"), not a settled feature. Once Scene 01's data
    is in, a `sleep_insomnia_pulse(include_pulse=False)` variant can be
    generated and published for an A/B comparison without touching this
    function further. Defaults to True so the already-published video's
    behavior is unaffected."""
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    pad = _chord_pad(PADS_SLEEP, seconds, chord_seconds=28.0, sr=sr)
    pad = core.one_pole_lowpass(pad, cutoff_hz=450, sr=sr)
    bed = core.brown_noise(seconds, sr) * 0.05
    pulse = _heartbeat_pulse(seconds, bpm=52.0, sr=sr) * 0.05 if include_pulse else 0.0
    breathing = core.lfo(0.045, seconds, sr, depth=0.12, offset=0.88)
    mix = (pad * 0.78 + bed + pulse) * breathing
    mix = core.simple_reverb(mix, sr, room_seconds=3.2, mix=0.42)
    mix = core.fade_in_out(mix, sr, fade_seconds=7.0)
    mix = core.normalize(mix, peak=0.72)
    return core.widen(mix, width=0.18, sr=sr)


def _breath_envelope(seconds: float, inhale_s: float = 4.0, exhale_s: float = 6.0,
                      floor: float = 0.35, sr: int = 44100) -> np.ndarray:
    """One breath cycle (rise over `inhale_s`, fall over `exhale_s`) built as a
    raised-cosine ease in/out, then tiled across the full duration — the same
    "build one cycle, place it repeatedly" pattern as `_heartbeat_pulse`, just
    with a longer, consciously-followable cycle instead of a short percussive
    one. Deliberately asymmetric (exhale longer than inhale) and floor-limited
    (never drops to silence) so the listener has something continuous to
    track, not a pulse to react to."""
    cycle_s = inhale_s + exhale_s
    n_cycles = int(seconds / cycle_s) + 1
    out = np.zeros(int(seconds * sr))
    n_in = int(inhale_s * sr)
    n_out = int(exhale_s * sr)
    rise = floor + (1 - floor) * (1 - np.cos(np.linspace(0, np.pi, n_in))) / 2
    fall = floor + (1 - floor) * (1 + np.cos(np.linspace(0, np.pi, n_out))) / 2
    cycle = np.concatenate([rise, fall])
    for c in range(n_cycles):
        start = int(c * cycle_s * sr)
        end = min(start + len(cycle), len(out))
        if start >= len(out):
            break
        out[start:end] = cycle[: end - start]
    return out


def breath_guide_coherent(minutes: float = 15.0) -> core.StereoTrack:
    """Scene: someone who wants to consciously settle their breathing for a
    few minutes — between tasks, before a stressful moment, or winding down
    before sleep (docs/ai-company-os/2026-08-12-bgm-scene03-definition.md,
    scene 03 — third and final market test of the approved trio). Unlike
    every other preset here, this one is meant to be actively followed, not
    played passively in the background: a single sustained tone (one chord
    from PADS_SLEEP, held rather than progressed, so nothing competes with
    the breath cue) whose volume rises over 4 seconds and falls over 6 —
    inhale/exhale, 6 breaths/minute. No new synthesis system: reuses
    `detuned_stack`/`brown_noise`/`simple_reverb`/`fade_in_out`/`normalize`/
    `widen`, plus the one small `_breath_envelope` helper above."""
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    chord = PADS_SLEEP[0]
    pad = np.zeros(int(seconds * sr))
    for midi_note in chord:
        pad = pad + core.detuned_stack(midi_to_freq(midi_note), seconds, voices=3, detune_cents=4, sr=sr)
    pad /= len(chord)
    pad = core.one_pole_lowpass(pad, cutoff_hz=900, sr=sr)
    bed = core.brown_noise(seconds, sr) * 0.03
    breath = _breath_envelope(seconds, inhale_s=4.0, exhale_s=6.0, floor=0.35, sr=sr)
    mix = pad * breath + bed
    mix = core.simple_reverb(mix, sr, room_seconds=2.6, mix=0.35)
    mix = core.fade_in_out(mix, sr, fade_seconds=6.0)
    mix = core.normalize(mix, peak=0.7)
    return core.widen(mix, width=0.12, sr=sr)


def baby_sleep_noise(minutes: float = 3.0) -> core.StereoTrack:
    """Scene: a parent building a calm sleep environment for an infant/
    toddler — at bedtime, during a night wake-up, or for a daytime nap
    (docs/marketing/bgm-content-audit/, scene 02 — 2026-08-12 approved
    second market test). Deliberately shaped differently from every other
    preset here, on purpose: no `_chord_pad`, no melody, no chord motion,
    no breathing LFO swell. Just a very steady, unchanging noise bed —
    infant white-noise use is about a constant, predictable sound rather
    than musical content, so removing the pad *is* the scene-driven
    differentiation, not an omission. Reuses only existing primitives
    (brown_noise/pink_noise/filters/fade/normalize/widen); no new
    synthesis system. Stereo width is held much narrower than the other
    presets (near-mono, minimal panning motion) — final loudness is
    normalized to the same level as every other preset by
    `StereoTrack.to_wav()`, so steadiness/width is the real, honest
    difference here, not volume."""
    seconds = minutes * 60
    sr = core.SAMPLE_RATE
    brown = core.brown_noise(seconds, sr)
    pink = core.pink_noise(seconds, sr)
    mix = brown * 0.8 + pink * 0.2
    mix = core.one_pole_lowpass(mix, cutoff_hz=1800, sr=sr)   # softens anything sharp/hissy
    mix = core.one_pole_highpass(mix, cutoff_hz=40, sr=sr)    # trims inaudible sub-rumble
    mix = core.fade_in_out(mix, sr, fade_seconds=10.0)        # slow in/out — no abrupt start
    mix = core.normalize(mix, peak=0.65)                      # quieter than other presets, on purpose
    return core.widen(mix, width=0.08, sr=sr)                 # near-mono — steady, non-moving noise


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


def _piano_note(freq: float, seconds: float, sr: int = core.SAMPLE_RATE,
                 brightness: float = 0.75) -> np.ndarray:
    """One struck piano-like note. Added 2026-08-26 per owner request
    ("BGMのジャンルにピアノを増やしたい"); rewritten same day per owner
    feedback ("電子音的な感じだから") — a clean stack of phase-aligned
    sine harmonics with a smooth 1/h falloff *is* basically what a
    subtractive/additive synth pad sounds like, no matter how the decay
    envelope is shaped. What was missing is what actually separates a
    struck acoustic string from an oscillator bank:

    1. **Hammer noise**: a real piano hammer hitting a string produces a
       brief broadband "thud" before the tone settles, not a pure tone
       from sample zero. Added as a short bandpassed noise burst under
       the attack.
    2. **Unison-string beating**: each piano key (above the lowest
       register) rings 2-3 physical strings tuned *almost* but not quite
       identically — the slight beating between them is a large part of
       piano's characteristic shimmer/warmth. Modeled as `unison` detuned
       copies of the harmonic stack summed together, each with independent
       random phase (a single phase-locked oscillator bank per note is
       part of what reads as "electronic").
    3. **Strike-position comb filtering**: a hammer strikes a string at a
       fixed fraction of its length (~1/7, a real piano-design constant),
       which suppresses harmonics near multiples of that ratio rather than
       rolling off smoothly — a big part of why a piano's spectrum doesn't
       look (or sound) like a clean synth pad's.

    `brightness` < 1 rolls off the harmonics faster, for a softer
    felt/una-corda character suited to sleep/relax genres; keep close to
    1.0 for a more present, percussive tone.
    """
    n = int(seconds * sr)
    t = np.arange(n) / sr
    out = np.zeros(n)
    n_harmonics = 10
    base_decay_s = 2.4  # roughly how long the fundamental takes to decay ~63%
    strike_ratio = 1.0 / 7.0  # hammer strike position along the string (standard piano design)
    unison = 3
    detune_cents = 4.0
    # deterministic-per-pitch seed so a given note is reproducible run to
    # run, but different notes don't all share identical unison phase
    rng = np.random.default_rng(int(freq * 97) % (2 ** 31 - 1))

    for u in range(unison):
        spread_cents = (u - (unison - 1) / 2) * detune_cents
        detune_mult = 2 ** (spread_cents / 1200)
        phases = rng.uniform(0, 2 * np.pi, n_harmonics + 1)
        for h in range(1, n_harmonics + 1):
            partial_freq = freq * detune_mult * h * (1 + 0.0004 * h ** 2) ** 0.5  # inharmonicity stretch
            if partial_freq > sr * 0.45:
                break
            strike_atten = max(abs(np.sin(h * np.pi * strike_ratio)), 0.15)  # comb-filtered by strike position
            amp = (1.0 / h ** 1.15) * (brightness ** (h - 1)) * strike_atten / unison
            decay_rate = (1 + 0.35 * (h - 1)) / base_decay_s  # higher harmonics decay faster
            out += amp * np.exp(-t * decay_rate) * np.sin(2 * np.pi * partial_freq * t + phases[h])

    attack_n = max(1, int(0.006 * sr))  # a few ms — struck, not faded in
    out[:attack_n] *= np.linspace(0, 1, attack_n)

    hammer_n = min(n, int(0.018 * sr))
    if hammer_n > 4:
        hammer = core.white_noise(hammer_n / sr, sr)
        hammer = core.one_pole_highpass(hammer, cutoff_hz=min(freq * 0.8, sr * 0.4), sr=sr)
        hammer = core.one_pole_lowpass(hammer, cutoff_hz=min(freq * 6, sr * 0.45), sr=sr)
        hammer_env = np.exp(-np.arange(hammer_n) / sr * 110)
        # 2026-08-26(4) bugfix: found via QA on the full 1-hour render (a
        # spike in >0.35-per-sample amplitude jumps at thousands of
        # points) — this noise burst was being added starting at its full
        # instantaneous value (hammer_env[0] == 1.0), a genuine digital
        # click at every single note onset, not an intentional "thud".
        # A ~1ms ramp-in removes the discontinuity while keeping the
        # burst itself just as short/percussive.
        ramp_n = min(hammer_n, max(1, int(0.001 * sr)))
        hammer_env[:ramp_n] *= np.linspace(0, 1, ramp_n)
        out[:hammer_n] += hammer * hammer_env * 0.09
    return out


# 2026-08-26: rewritten per owner feedback on the first preview
# ("久石譲的なピアノがいい" — "I want something like Joe Hisaishi's
# piano"). The first version (_piano_arpeggio, now unused — see git
# history) picked notes randomly from each chord with no melodic line;
# that's a fine texture for pure ambient/sleep presets but isn't what
# "Hisaishi-style" means. His piano writing (「One Summer's Day」「Merry-
# Go-Round of Life」etc.) has: a clear, mostly-stepwise, singable melody
# in the right hand; a continuous flowing broken-chord ("Alberti bass"-
# style) accompaniment in the left hand, not sparse scattered notes;
# moderate concert-hall reverb rather than a heavy ambient wash; a
# melody that repeats/develops (a recognizable rhythmic cell reused
# across phrases) instead of wandering. The functions below aim at that,
# within what's feasible from procedural synthesis — genuinely composing
# "a Hisaishi piece" isn't something this can claim, but the goal is to
# get closer to that character than generic random-note ambient piano.
# 2026-08-26(2): brightened per owner feedback ("もっと明るい感じがいい")
# on the first melody-driven preview. That version's I-V-vi-iii-IV-I-ii-V
# progression leaned on minor chords (Bm/F#m/Em) for a wistful, "One
# Summer's Day"-ish color — nice, but read as melancholic rather than
# bright. Switched to an all-major I-IV-V progression (no minor chords at
# all) — closer to Hisaishi's more cheerful, pastoral pieces (「さんぽ」
# 「海の見える街」) than his bittersweet ones. The I chord adds a 9th
# (E, a 5th entry per chord) for a bit of shimmer without introducing a
# minor color.
PIANO_CHORDS_HISAISHI = [
    [62, 66, 69, 76],  # I(add9)  D  (D F# A E)
    [67, 71, 74],       # IV       G  (G B D)
    [69, 73, 76],       # V        A  (A C# E)
    [62, 66, 69, 76],  # I(add9)  D
    [67, 71, 74],       # IV       G
    [69, 73, 76],       # V        A
    [62, 66, 69, 76],  # I(add9)  D
    [62, 66, 69, 76],  # I(add9)  D
]

# 2026-08-26(3): a second, contrasting progression — added per owner
# feedback on the long-form structure ("曲A→曲B→曲C→曲D→曲A'→曲B'のよう
# に微妙に展開を変えて、「同じ曲を延々ループしている感」を減らします").
# Still all-major/D-major (same brightness direction), but opens on IV
# instead of I and reorders the middle, so the melody generator's chord-
# tone landings trace a different contour — piano_hisaishi_style()
# alternates between this and PIANO_CHORDS_HISAISHI pass by pass instead
# of tiling one progression for the full hour.
PIANO_CHORDS_HISAISHI_B = [
    [67, 71, 74],       # IV       G
    [69, 73, 76],       # V        A
    [62, 66, 69, 76],  # I(add9)  D
    [67, 71, 74],       # IV       G
    [62, 66, 69, 76],  # I(add9)  D
    [69, 73, 76],       # V        A
    [67, 71, 74],       # IV       G
    [62, 66, 69, 76],  # I(add9)  D
]


def _scale_notes(root_midi: int, steps: list[int], low: int = 48, high: int = 88) -> list[int]:
    """All MIDI notes of a diatonic scale (root + `steps`, semitone offsets
    within an octave) across a wide register, for melody generation to walk
    through by index (adjacent index = adjacent scale step, not adjacent
    semitone — keeps melodic motion diatonic without per-note key-signature
    bookkeeping)."""
    notes = set()
    for octave in range(-3, 4):
        for s in steps:
            n = root_midi + s + 12 * octave
            if low <= n <= high:
                notes.add(n)
    return sorted(notes)


D_MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]


def _generate_melody(chords: list[list[int]], beats_per_chord: float, seed: int,
                      scale_notes: list[int] | None = None) -> list[tuple[float, float, int | None]]:
    """A right-hand melody over `chords`: mostly stepwise motion through the
    diatonic scale (occasional small leap), biased to land on a current-
    chord tone at the start of each bar, using a fixed asymmetric 7-event
    rhythmic cell (sums to 8 beats = 2 bars) reused throughout — a
    repeating rhythmic "shape" is what makes a generated line read as a
    phrase rather than a wander, even though the pitches themselves vary
    with the chords/seed. Occasional rests give it room to breathe instead
    of being a constant stream of notes. Returns (start_beat, duration_beats,
    midi_note_or_None) tuples."""
    scale_notes = scale_notes or _scale_notes(62, D_MAJOR_STEPS)
    rng = np.random.default_rng(seed)
    rhythm_cell = [1.0, 1.0, 2.0, 1.0, 0.5, 0.5, 2.0]
    total_beats = beats_per_chord * len(chords)

    start_note = min(scale_notes, key=lambda n: abs(n - (chords[0][0] + 12)))
    idx = scale_notes.index(start_note)
    events: list[tuple[float, float, int | None]] = []
    t = 0.0
    cell_pos = 0
    while t < total_beats:
        dur = rhythm_cell[cell_pos % len(rhythm_cell)]
        cell_pos += 1
        chord = chords[int(t // beats_per_chord) % len(chords)]
        beat_in_bar = t % beats_per_chord

        if rng.uniform(0, 1) < 0.12:
            events.append((t, dur, None))  # a breath — real melodies aren't wall-to-wall notes
            t += dur
            continue

        on_strong_beat = beat_in_bar < 1e-6 or abs(beat_in_bar - 2.0) < 1e-6
        if on_strong_beat and rng.uniform(0, 1) < 0.65:
            chord_pcs = {c % 12 for c in chord}
            nearest_chord_tone = min(
                (n for n in scale_notes if n % 12 in chord_pcs),
                key=lambda n: abs(n - scale_notes[idx]),
            )
            idx = scale_notes.index(nearest_chord_tone)
        else:
            step = int(rng.choice([-2, -1, -1, 1, 1, 2]))  # stepwise-biased random walk
            idx = int(np.clip(idx + step, 0, len(scale_notes) - 1))

        events.append((t, dur, scale_notes[idx]))
        t += dur
    return events


def _rolling_arpeggio(chords: list[list[int]], beats_per_chord: float, bpm: float,
                       sr: int = core.SAMPLE_RATE, brightness: float = 0.6,
                       seed: int | None = None) -> np.ndarray:
    """Continuous eighth-note broken-chord accompaniment — root/3rd/5th/3rd
    per bar (Alberti-bass-style), one octave below the chord's written
    register — the flowing left-hand texture under Hisaishi's melodies
    (most recognizably in 「One Summer's Day」), as opposed to the sparse
    scattered notes of the first draft's _piano_arpeggio."""
    rng = np.random.default_rng(seed)
    beat_s = 60.0 / bpm
    step_s = beat_s * 0.5
    total_beats = beats_per_chord * len(chords)
    total_s = total_beats * beat_s
    tail_s = 3.0
    out = np.zeros(int((total_s + tail_s) * sr))
    pattern = [0, 1, 2, 1]  # chord-tone index: root, 3rd, 5th, 3rd
    t = 0.0
    step_i = 0
    while t < total_s:
        chord = chords[int((t / beat_s) // beats_per_chord) % len(chords)]
        tone_midi = chord[pattern[step_i % len(pattern)]] - 12
        note = _piano_note(midi_to_freq(tone_midi), step_s * 2.2, sr, brightness=brightness)
        note *= rng.uniform(0.32, 0.45)
        start = int(t * sr)
        end = min(start + len(note), len(out))
        out[start:end] += note[: end - start]
        t += step_s
        step_i += 1
    return out[: int(total_s * sr)]


def _render_melody(events: list[tuple[float, float, int | None]], bpm: float,
                    sr: int = core.SAMPLE_RATE, brightness: float = 0.85,
                    velocity_seed: int | None = None) -> np.ndarray:
    rng = np.random.default_rng(velocity_seed)
    beat_s = 60.0 / bpm
    total_s = (events[-1][0] + events[-1][1]) * beat_s if events else 0.0
    tail_s = 4.0
    out = np.zeros(int((total_s + tail_s) * sr))
    for start_beat, dur_beats, midi_note in events:
        if midi_note is None:
            continue
        note_s = start_beat * beat_s
        note_len = dur_beats * beat_s * 1.3  # 2026-08-26(2): shortened from 1.6 — less legato wash, crisper/brighter
        note = _piano_note(midi_to_freq(midi_note), note_len, sr, brightness=brightness)
        note *= rng.uniform(0.75, 1.0)
        start = int(note_s * sr)
        end = min(start + len(note), len(out))
        out[start:end] += note[: end - start]
    return out


def piano_hisaishi_style(minutes: float = 3.0) -> core.StereoTrack:
    """Solo-piano preset in the vein of Joe Hisaishi's brighter, more
    cheerful pieces — added 2026-08-26 per owner request ("BGMのジャンル
    にピアノを増やしたい"), refined twice from the first draft: "久石譲
    的なピアノがいい" (→ melody-driven rewrite, see the module comment
    above PIANO_CHORDS_HISAISHI) then "もっと明るい感じがいい" (→ all-
    major chords, faster ~104 BPM, brighter timbre, drier reverb — see
    that constant's second comment). A clear right-hand melody
    (_generate_melody + _render_melody) over a continuous rolling left-
    hand accompaniment (_rolling_arpeggio), lighter reverb than the
    ambient presets (clarity over wash — closer to a concert-hall piano
    recording than a sleep-noise texture). No sample library or paid
    instrument is used; every note is synthesized from scratch
    (_piano_note), same as the rest of this pipeline.

    The ~74s composed piece (32 bars — PIANO_CHORDS_HISAISHI tiled 4x,
    see `chords` below) loops for the full requested duration rather
    than generating fresh material for a whole hour — real "relaxing
    piano" compilations on YouTube do the same (a handful of pieces
    repeated), and it keeps the melody actually recognizable/thematic
    instead of aimless. Alternate passes shift the melody up an octave
    and re-seed its rhythmic phrasing slightly, so it's not a bit-for-bit
    identical loop, and each pass is separated by a couple of quiet
    seconds (not a hard cut).

    NOT YET added to PRESETS/PRESET_METADATA — same reasoning as before:
    get the owner's listen on a preview first.
    """
    sr = core.SAMPLE_RATE
    bpm = 104.0  # 2026-08-26(2): up from 76 — more forward momentum, less languid
    beats_per_chord = 4.0
    scale_notes = _scale_notes(62, D_MAJOR_STEPS)

    # 2026-08-26(2) bugfix: PIANO_CHORDS_HISAISHI is only 8 bars — at this
    # tempo that's ~18s, not the ~100s a "piece" was assumed to be when
    # n_passes was first computed (it was ceil(seconds/100), so a 3-minute
    # preview rendered only 2 real passes and ~2.5 minutes of silence
    # padding). Tiling a progression 4x gives a proper ~74s piece (32
    # bars); the melody generator's random walk still produces different
    # notes each time through the repeated harmony (it's one continuous
    # walk across all 32 bars, not reset every 8), so this isn't a literal
    # note-for-note loop within a pass.
    section_chords = [PIANO_CHORDS_HISAISHI * 4, PIANO_CHORDS_HISAISHI_B * 4]
    pass_beats = beats_per_chord * len(section_chords[0])
    pass_seconds = pass_beats * 60 / bpm

    def render_pass(chords: list[list[int]], seed: int, octave_shift: int) -> np.ndarray:
        melody_events = _generate_melody(chords, beats_per_chord, seed, scale_notes)
        melody_events = [
            (s, d, (n + 12 * octave_shift if n is not None else n)) for s, d, n in melody_events
        ]
        # brightness bumped (0.85→0.92, 0.6→0.68) — more upper-harmonic
        # content survives per note, a more present/shimmering tone
        melody = _render_melody(melody_events, bpm, sr, brightness=0.92, velocity_seed=seed)
        accomp = _rolling_arpeggio(chords, beats_per_chord, bpm, sr, brightness=0.68, seed=seed + 1)
        n = max(len(melody), len(accomp))
        melody = np.pad(melody, (0, n - len(melody)))
        accomp = np.pad(accomp, (0, n - len(accomp)))
        return melody + accomp

    passes = []
    n_passes = max(1, int(np.ceil((minutes * 60) / pass_seconds)))
    for p in range(n_passes):
        # 2026-08-26(3): A/B/A/B... instead of always A — see
        # PIANO_CHORDS_HISAISHI_B's comment. Every 3rd pass (of either
        # section) also shifts up an octave for a brighter variation, so
        # the full sequence over an hour reads roughly A,B,A',B,A,B',...
        # rather than one identical loop.
        chords = section_chords[p % 2]
        octave_shift = 1 if (p % 3 == 2) else 0
        pass_audio = render_pass(chords, seed=1000 + p, octave_shift=octave_shift)
        passes.append(pass_audio)
        passes.append(np.zeros(int(2.2 * sr)))  # a breath between passes, not a hard loop

    mix = np.concatenate(passes)
    target_n = int(minutes * 60 * sr)
    if len(mix) > target_n:
        mix = mix[:target_n]
    else:
        mix = np.pad(mix, (0, target_n - len(mix)))

    mix = core.simple_reverb(mix, sr, room_seconds=1.5, mix=0.16)  # 2026-08-26(2): drier still, for brightness
    mix = core.fade_in_out(mix, sr, fade_seconds=4.0)
    mix = core.normalize(mix, peak=0.82)
    return core.widen(mix, width=0.15, sr=sr)


PRESETS = {
    "sleep_deep_drone": sleep_deep_drone,
    "sleep_rain_focus": sleep_rain_focus,
    "study_lofi_chill": study_lofi_chill,
    "study_focus_binaural": study_focus_binaural,
    "sleep_insomnia_pulse": sleep_insomnia_pulse,
    "baby_sleep_noise": baby_sleep_noise,
    "breath_guide_coherent": breath_guide_coherent,
    "piano_hisaishi_style": piano_hisaishi_style,
}

# title: JP-first, leads with a 【】bracket category tag — this is the
# dominant convention among actual popular JP作業用BGM/勉強用BGM channels
# (checked via web search 2026-08-04, e.g. "【集中したい時に聴く勉強用BGM】...",
# "【作業用BGM】静かに集中モードへ..."), not something we were doing before.
# icon_category: which thumbnail icon to draw — "sleep" (moon+stars) or
# "focus" (notebook+pencil, per owner feedback that the moon doesn't read
# as "study" — a literal recognizable object does).
# thumb_hook: short punchy JP phrase for the thumbnail overlay. Distinct
# from title: title is written for search, thumb_hook is written to be
# read in under a second at thumbnail size.
PRESET_METADATA = {
    "sleep_deep_drone": {
        "title": "【睡眠用BGM】深い眠りへ誘う低音ドローン 1時間耐久",
        "icon_category": "sleep",
        "thumb_hook": "深い眠りへ",
        "description": "低く緩やかなアンビエントパッドに、温かみのあるブラウンノイズを重ねた深い眠りのためのBGM。",
        "hook": "低く緩やかに続くアンビエントドローンに、温かみのあるブラウンノイズを重ねた1曲。呼吸を合わせるように、深い眠りへ誘います。",
        "about": (
            "追いかけるようなメロディも、急な展開もありません。生活音を和らげ、頭の中の雑音を鎮める、"
            "低い周波数の音の層だけです。ブラウンノイズはホワイトノイズより低く温かみがあり、"
            "一晩中流すのに向いていると感じる方が多い音です。"
        ),
        "use_cases": ["寝つき・夜通しの睡眠サポートに", "隣人・交通音・いびきなどの生活音マスキングに", "昼寝のお供に", "赤ちゃんのホワイトノイズに(音量は控えめに)"],
        "tags": [
            "睡眠用bgm", "睡眠導入", "作業用bgm", "ブラウンノイズ", "熟睡",
            "sleep music", "deep sleep music", "brown noise", "sleep sounds", "ambient sleep music",
            "insomnia relief", "relaxing sleep music", "sleep drone",
        ],
        "hashtags": ["睡眠用bgm", "熟睡", "ブラウンノイズ", "sleepmusic", "ambientmusic"],
        # 2026-08-25追加: sleep_deep_droneは08-12の実写化方針転換(study_lofi_chill/
        # baby_sleep_noise/breath_guide_coherentの3本のみ対象)を、当時一度も
        # 公開経験が無かったため取りこぼしていた(オーナー指摘で発覚)。オーナー
        # 提供の写真(月明かりの森・小川)で他3プリセットと統一。
        "thumbnail_style": "photo",
        # 2026-08-25: オーナー指示「これから全写真使って」を受け、単一画像
        # (thumbnail_source)から複数画像のプール(thumbnail_sources)に変更。
        # 公開のたびにrotation.next_thumbnail_source()が順番に選ぶ(詳細は
        # rotation.pyのdocstring参照)。毎日Shorts公開が始まり同じプリセットが
        # 短い周期で繰り返し使われるようになったため、同じ写真の連続露出を
        # 避ける狙いもある。
        "thumbnail_sources": [
            "assets/thumbnails/sleep_deep_drone_source.jpg",
            "assets/thumbnails/sleep_deep_drone_alt2.jpg",
        ],
        "thumbnail_text_anchor": "center",  # both photos in the pool have open sky/mist in the middle
    },
    "sleep_rain_focus": {
        "title": "【睡眠・作業用BGM】雨音とやわらかなパッドで眠れる 1時間",
        "icon_category": "sleep",
        "thumb_hook": "雨音で眠る",
        "description": "こもった質感の雨音に、静かなアンビエントパッドを重ねた睡眠・作業両用のBGM。",
        "hook": "こもった質感の雨音に、静かなアンビエントパッドをそっと重ねた1曲。眠りにも、作業中の「ながら聴き」にも。",
        "about": (
            "雷や急な音の変化がない、フィルターを通した雨音を、ゆっくり動くパッドの下に重ねています。"
            "雨音が眠りに人気なのは、「1/fゆらぎ」と呼ばれる自然なリズムを持っているから — "
            "予測できる安心感がありながら、単調すぎて機械的に感じることもありません。"
        ),
        "use_cases": ["雨音を聴きながら眠りたいときに", "作業・勉強中の集中力を切らさないために", "1日の終わりの瞑想・リラックスに", "都市騒音・生活音を遮りたいときに"],
        "tags": [
            "雨音bgm", "作業用bgm", "睡眠用bgm", "集中", "リラックス",
            "rain sounds", "rain sounds for sleeping", "sleep music", "study music", "focus music",
            "relaxing rain", "ambient rain",
        ],
        "hashtags": ["雨音bgm", "作業用bgm", "睡眠用bgm", "rainsounds", "relaxation"],
        # 2026-08-25追加: sleep_rain_focusは08-05の文字化け修正止まりで、08-12の
        # 実写化方針転換の対象に入っていなかった(オーナー指摘で発覚)。オーナー
        # 提供の写真(雨の竹林・灯り)に更新、雨音プリセットに文字通り合う絵柄。
        "thumbnail_style": "photo",
        "thumbnail_sources": ["assets/thumbnails/sleep_rain_focus_source.jpg"],
        "thumbnail_text_anchor": "center",  # dark uniform bamboo path, open in the middle
    },
    "study_lofi_chill": {
        "title": "【作業用BGM】カフェ気分で集中できる1時間BGM ｜勉強・作業用",  # 2026-08-16: briefly retitled to "ローファイの音だけの1時間｜集中がはかどる作業用タイム" (same direction as breath_guide_coherent), reverted same day — owner: "日本語として不自然". Thumbnail (v2, centered/no-outline) stayed, only the title reverted.
        "icon_category": "focus",
        # 2026-08-12: switched to the photo-thumbnail standard with an
        # owner-supplied AI-generated image (see breath_guide_coherent's note).
        #
        # 2026-08-16: hand-revised past what make_photo_thumbnail() produces
        # — same treatment as breath_guide_coherent's v2 (see that preset's
        # note): centered 2-line Noto Serif Bold hook text, no caption
        # panel, soft shadow instead of an outline. Live file:
        # assets/thumbnails/study_lofi_chill_thumb_v2.png, uploaded via
        # youtube_upload.set_thumbnail. thumbnail_source/thumb_hook below
        # describe the *previous* generated thumbnail, kept for reference.
        "thumbnail_style": "photo",
        "thumbnail_sources": ["assets/thumbnails/study_lofi_chill_source.jpeg"],
        "thumbnail_text_anchor": "left",  # matches the 08-16 hand revision: top-left, avoids the desk/laptop on the right
        "thumb_hook": "集中できる\nカフェBGM",  # updated 2026-08-16 (was "はかどる作業用BGM") to match the live hand-revised thumbnail's 2-line text
        "description": "温かみのあるローファイコードにヴァイナルの質感を重ねた、カフェのような作業用BGM。",
        "hook": "温かみのあるローファイコードに、ヴァイナルの質感をまとわせた力の抜けるビート。カフェで作業しているような、集中しやすい空気感です。",
        "about": (
            "耳障りにならない、ずっと流せるローファイループです。温かみのあるジャジーなコード、"
            "柔らかいビート、少しのヴァイナルノイズで質感を出しています。ボーカルなし、急な展開なし — "
            "作業の邪魔をしないことを一番に作っています。"
        ),
        "use_cases": ["勉強・読書のお供に", "作業・仕事の集中セッションに", "コーディングや執筆に", "家事や作業用プレイリストに"],
        "tags": [
            "作業用bgm", "勉強用bgm", "集中用bgm", "ローファイ", "カフェ音楽",
            "lofi hip hop", "lofi beats", "study music", "chill beats", "focus music", "lofi chill",
            "study lofi",
        ],
        "hashtags": ["作業用bgm", "勉強用bgm", "ローファイ", "lofi", "studymusic"],
    },
    "study_focus_binaural": {
        "title": "【勉強用BGM】アルファ波バイノーラルビートで集中力アップ 1時間",
        "icon_category": "focus",
        "thumb_hook": "集中力アップ",
        "description": "10Hzのアルファ波バイノーラルビートを、穏やかなパッドの下に重ねた勉強・集中用BGM(ヘッドホン推奨)。",
        "hook": "10Hzのアルファ波バイノーラルビートを、穏やかなアンビエントパッドの下に。勉強・集中作業のためのBGMです(ヘッドホン推奨)。",
        "about": (
            "左右の耳にごくわずかに異なる周波数の音を届けると、脳内で10Hzの「うなり」が知覚されます — "
            "リラックスしながらも集中している状態と関連づけられる、アルファ波の帯域です。"
            "耳にやさしい柔らかなパッドを重ねているので、実験音のようにならず、心地よく聴けます。"
        ),
        "use_cases": ["勉強・読書に", "集中したい作業セッションに", "軽い瞑想に", "試験前・締切前の集中に"],
        "tags": [
            "集中用bgm", "勉強用bgm", "作業用bgm", "バイノーラルビート", "アルファ波",
            "binaural beats", "binaural beats focus", "study music", "focus music", "alpha waves",
            "10hz binaural beats", "concentration music",
        ],
        "hashtags": ["集中用bgm", "勉強用bgm", "バイノーラルビート", "binauralbeats", "focusmusic"],
        # 2026-08-25追加: study_focus_binauralも08-12の実写化方針転換の対象漏れ
        # だった(sleep系3プリセットと同じ経緯)。オーナー提供の写真(和の書斎、
        # 日本語の画面表示・掛け軸)で他プリセットと統一。
        "thumbnail_style": "photo",
        "thumbnail_sources": [
            "assets/thumbnails/study_focus_binaural_source.jpg",
            "assets/thumbnails/study_focus_binaural_alt2.jpg",
            "assets/thumbnails/study_focus_binaural_alt3.jpg",
            "assets/thumbnails/study_focus_binaural_alt4.jpg",
            "assets/thumbnails/study_focus_binaural_alt5.jpg",
        ],
        "thumbnail_text_anchor": "left",  # busy desk scenes — top-left keeps clear of the laptop screen/subject
    },
    "sleep_insomnia_pulse": {
        # Scene 01 (docs/marketing/bgm-content-audit/, 2026-08-12 approved
        # first market test). use_cases/tags deliberately hold to sleep/
        # insomnia only — no "作業用bgm" — per the audit's finding that
        # every prior preset carried that tag regardless of fit.
        "title": "眠れない夜、考えすぎた心と体をゆっくり静める音 1時間",
        "icon_category": "sleep",
        "thumb_hook": "眠れない夜に",
        "description": "深夜、時計が気になって余計に眠れなくなる夜のための音。低いドローンに、ごく静かな心拍のような響きを重ねています。",
        "hook": "時計を見るほど、余計に眠れなくなる夜に。低く続くドローンの奥に、ごく静かな心拍のような響きをそっと重ねました。",
        "about": (
            "焦って眠ろうとするほど眠れない、という経験がある方向けに作りました。"
            "急に音が変わることも、目立つメロディもありません。ゆっくりとした低い響きの下に、"
            "安静時の心拍に近いテンポの音をかすかに重ねているだけです。"
        ),
        "use_cases": ["寝つけない夜に", "焦りで眠れなくなったときに", "静かな寝室環境を作りたいときに"],
        "tags": [
            "睡眠用bgm", "不眠", "寝つけない", "安眠",
            "sleep music", "insomnia", "can't sleep music", "deep sleep", "ambient sleep music",
            "relaxing sleep music",
        ],
        "hashtags": ["睡眠用bgm", "不眠", "安眠", "sleepmusic", "insomnia"],
        # 2026-08-25追加: sleep_insomnia_pulseも08-12の実写化方針転換の対象漏れ
        # だった。オーナー提供の写真(霧の山あいの夜景)に更新、広く静かな
        # 視点が「考えすぎた心を静める」というコンセプトに合う。
        "thumbnail_style": "photo",
        "thumbnail_sources": ["assets/thumbnails/sleep_insomnia_pulse_source.jpg"],
        "thumbnail_text_anchor": "center",  # uniform dark mountain/mist, open in the middle
    },
    "baby_sleep_noise": {
        # Scene 02 (docs/marketing/bgm-content-audit/, 2026-08-12 approved
        # second market test). Positioning is deliberately limited to "usable
        # for building a sleep environment" — no claim that it makes a baby
        # fall asleep, improves sleep, has a medical effect, or is
        # guaranteed safe. use_cases/tags stay infant-specific only; no
        # "作業用bgm" or other scene that doesn't match actual use.
        "title": "ホワイトノイズだけの1時間｜赤ちゃんの寝かしつけタイム",  # retitled 2026-08-16 (was "赤ちゃんの睡眠環境づくりに使えるホワイトノイズ 1時間"), same direction as breath_guide_coherent's retitle — ⚠️ see 2026-08-16 note below re: positioning_constraints
        "icon_category": "sleep",
        # 2026-08-12: switched to the photo-thumbnail standard (see
        # breath_guide_coherent's note) with an owner-supplied AI-generated
        # image; thumb_hook doubles as the on-image caption.
        #
        # 2026-08-16: hand-revised past what make_photo_thumbnail() produces
        # — same treatment as breath_guide_coherent's v2 (see that preset's
        # note): centered 2-line Noto Serif Bold hook text ("赤ちゃんが" /
        # "やさしく眠れる1時間"), positioned upper-left to avoid the baby's
        # face rather than overlapping it, soft shadow instead of an
        # outline. Live file: assets/thumbnails/baby_sleep_noise_thumb_v2.png,
        # uploaded via youtube_upload.set_thumbnail. thumbnail_source/
        # thumb_hook below describe the *previous* generated thumbnail, kept
        # for reference. ⚠️ "やさしく眠れる" reads closer to an effect claim
        # ("the baby will sleep") than this preset's own documented
        # positioning rule allows (no claim that it makes a baby fall
        # asleep — see the class comment above and positioning_constraints
        # in docs/company-os/experiments/bgm-scene02-baby-sleep-noise.json).
        # Shipped as explicitly instructed by the owner; flagged here rather
        # than silently softened, in case it needs revisiting.
        "thumbnail_style": "photo",
        "thumbnail_sources": ["assets/thumbnails/baby_sleep_noise_source.jpeg"],
        "thumbnail_text_anchor": "left",  # matches the 08-16 hand revision: top-left, avoids the baby's face
        "thumb_hook": "赤ちゃんが\nやさしく眠れる1時間",  # updated 2026-08-16 (was "赤ちゃんの睡眠環境に")
        "description": "赤ちゃんの睡眠環境づくりに使える、一定のホワイトノイズです。メロディやコードは使わず、ブラウンノイズとピンクノイズだけを一定の音量で流し続けるシンプルな作りにしています。",
        "hook": "赤ちゃんの睡眠環境づくりに使える、一定のホワイトノイズです。メロディや展開はなく、ブラウンノイズとピンクノイズだけを一定の音量で流し続けます。",
        "about": (
            "ホワイトノイズは、周りの生活音を和らげる目的で使われることがある音です。この動画はメロディや"
            "音の展開を一切使わず、始まりから終わりまで一定の音量のノイズだけで構成しています。"
            "左右の広がりも抑え、音が動き回らない落ち着いた音にしています。"
            "睡眠を改善する、必ず眠るといった効果を保証するものではなく、医学的な効果を示すものでもありません。"
            "あくまで睡眠環境づくりの一つの選択肢としてご活用ください。"
        ),
        "use_cases": ["赤ちゃんの睡眠環境づくりに", "夜泣き対応中の生活音マスキングに", "お昼寝タイムに", "静かな寝室環境をつくりたいときに"],
        "tags": [
            "ホワイトノイズ", "赤ちゃん 寝かしつけ", "ベビー ホワイトノイズ", "夜泣き", "赤ちゃん 睡眠",
            "white noise", "baby white noise", "white noise for babies", "baby sleep sounds", "newborn sleep",
        ],
        "hashtags": ["赤ちゃん", "ホワイトノイズ", "babysleep", "whitenoise", "newbornsleep"],
    },
    "breath_guide_coherent": {
        # Scene 03 (docs/ai-company-os/2026-08-12-bgm-scene03-definition.md,
        # 2026-08-12 approved third and final market test of the trio).
        # Non-verbal, non-branded pace (no "4-7-8"/"コヒーレント呼吸法" name —
        # avoids the therapeutic-technique framing those carry). Positioning
        # stays experience-first per the owner's explicit ban on medical
        # claims: no 自律神経を整える/不安を治す/睡眠を改善する/ストレスを治療する.
        "title": "心を落ち着かせる15分｜静かな集中とリラックスのために",  # retitled 2026-08-16 again (v1: "呼吸のペースを意識しやすくなる音、吸って4秒・吐いて6秒の呼吸ガイド 15分" -> v2: "海の音だけの15分｜疲れた心を癒すリラックスタイム" -> v3: current), owner request each time
        "icon_category": "sleep",
        # 2026-08-12: the standard gradient+icon+bold-text thumbnail didn't
        # fit this scene. First attempt was a procedural "atmospheric"
        # illustration (moon/water/silhouette) — owner rejected it outright:
        # a real photo draws the eye far more than any abstract background,
        # and asked for the actual owner-supplied AI-generated photo with
        # minimal text on it instead. That's now the standard for future
        # scenes too — see thumbnail.make_photo_thumbnail(). This
        # environment can't generate photorealistic images itself, so
        # `thumbnail_source` must point to an owner-supplied image, saved
        # under assets/thumbnails/ so it's reproducible without re-asking.
        #
        # 2026-08-16: the live thumbnail was hand-revised past what
        # make_photo_thumbnail() produces (bigger serif-font hook text
        # overlapping the figure, no caption box/panel, soft shadow instead
        # of an outline) and uploaded directly via youtube_upload.set_thumbnail
        # — see assets/thumbnails/breath_guide_coherent_thumb_v2.png, then
        # v3.png (owner asked for another text swap same day: "心が静まる
        # 15分", still centered/no-outline/soft-shadow, v3 is what's live).
        # The fields below (thumbnail_source/thumb_hook) describe how the
        # *original* (pre-hand-revision) live thumbnail was generated, kept
        # for reference; they no longer regenerate what's actually live on
        # this specific video unless make_photo_thumbnail() itself is
        # updated to match the v2/v3 style.
        "thumbnail_style": "photo",
        "thumbnail_sources": ["assets/thumbnails/breath_guide_coherent_source.png"],
        "thumbnail_text_anchor": "center",  # matches the 08-16 hand revision (v3): centered over open sea/sky
        "thumbnail_crop_top_px": 300,  # trims a UI artifact strip along the top of the source image
        "thumb_hook": "心が静まる15分",  # updated 2026-08-16, 2nd revision (v1: "心を落ち着かせるBGM" -> v2: "波に癒やされる15分" -> v3: current) to match the live hand-revised thumbnail's text
        "description": "吸って4秒・吐いて6秒のリズムで、呼吸のペースを意識しやすくする音です。声によるガイドはなく、一つの持続音の強弱だけでリズムを示します。",
        "hook": "吸って4秒、吐いて6秒。声のガイドなしで、呼吸のペースを意識しやすくする音です。",
        "about": (
            "音量がゆっくり満ちていくときに息を吸い、ゆっくり静まっていくときに息を吐く — それを繰り返すだけの"
            "シンプルな作りです。ナレーションやベルの音は使わず、一つの持続音の強弱だけで呼吸のリズムを示しています。"
            "自律神経を整える、不安を治すといった医学的な効果を示すものではありません。呼吸のペースを意識するための音として、"
            "休憩時間やリラックスタイムにご活用ください。"
        ),
        "use_cases": ["仕事や勉強の合間の小休憩に", "就寝前のリラックスタイムに", "緊張する場面の前に", "声によるガイドが苦手な方の呼吸法の練習に"],
        "tags": [
            "呼吸ガイド", "呼吸法", "深呼吸", "リラックス",
            "breathing exercise", "breathing guide", "guided breathing music", "box breathing music",
            "breathing meditation", "calm breathing",
        ],
        "hashtags": ["呼吸ガイド", "深呼吸", "リラックス", "breathingexercise", "guidedbreathing"],
    },
    "piano_hisaishi_style": {
        # 2026-08-26追加。オーナー指示「BGMのジャンルにピアノを増やしたい」
        # →「久石譲的なピアノがいい」→「もっと明るい感じがいい」→「電子音的
        # な感じだからピアノの音で作成して」の4段階のフィードバックを経て
        # 確定(presets.piano_hisaishi_style()参照)。オーナー自身も用途を
        # 「カフェでの作業や明るい気持ちになりたいときに聞く音楽」と明言、
        # さらに詳細な運営方針(タイトルは「曲」でなく「用途」を売る/
        # シリーズ化/複数枚の写真を使った世界観づくり)の提案あり。
        # タイトルはオーナー提案をほぼそのまま採用。
        "title": "【作業用BGM】静かなピアノで集中する1時間｜仕事・勉強・読書",
        "icon_category": "focus",
        "thumb_hook": "静かなピアノで\n集中する時間",
        "description": "久石譲さんの穏やかな曲調を思わせる、明るいアコースティックピアノのBGM。カフェでの作業や読書に。",
        "hook": "はっきりしたメロディラインと、流れるようなアルベルティ・バス風の伴奏。明るい長調で、聴いていて疲れない、それでいて主張しすぎないピアノの音です。",
        "about": (
            "サンプル音源は使わず、ハンマーが弦を叩くノイズ・複数弦のうなり・打弦位置による倍音の凹凸まで、"
            "音の一つ一つをゼロから合成しています。メロディは主張しすぎず、同じ雰囲気を長時間保つように作っているので、"
            "「なんとなく流しておきたい」作業用BGMとして使いやすいはずです。"
        ),
        "use_cases": ["カフェ気分で作業・仕事に集中したいときに", "読書のお供に", "気分を明るくしたいときに", "勉強・在宅ワークのBGMに"],
        "tags": [
            "作業用bgm", "勉強用bgm", "ピアノbgm", "集中",
            "piano music", "relaxing piano", "study piano", "focus music", "acoustic piano",
            "cafe music", "work music",
        ],
        "hashtags": ["作業用bgm", "ピアノbgm", "集中", "pianomusic", "focusmusic"],
        # サムネイル: 2026-08-27、オーナーから再送いただいた3枚がようやく
        # ファイルとしてこの環境のディスクに保存できたため実写化。最も
        # ピアノ+カフェの世界観が明確な1枚(暖色のカフェ、背景にピアノ、
        # 壁に「Slow down / breathe deep / enjoy the moment」の文字)を
        # source(プールの先頭=最初に使われる)に、ピアノが写り込む書斎风の
        # 1枚をalt2、ピアノは写っていないが明るい作業机の1枚をalt3にした。
        "thumbnail_style": "photo",
        "thumbnail_sources": [
            "assets/thumbnails/piano_hisaishi_style_source.jpg",
            "assets/thumbnails/piano_hisaishi_style_alt2.jpg",
            "assets/thumbnails/piano_hisaishi_style_alt3.jpg",
        ],
        "thumbnail_text_anchor": "left",  # 3枚とも右下〜中央に主要な被写体があるため、左上に配置
        # 2026-08-27追加(STEP3): オーナー指示「動画側にも時間表示させたい」
        # を受け、video.render_photo_background()に実装したカウントダウン
        # タイマー(video._countdown_drawtext参照)をこのプリセットで有効化。
        # 他7プリセットはまだ無効(見た目を勝手に変えないため) — 展開する
        # 場合はオーナー確認の上、各presetに同じフラグを追加する。
        "video_countdown": True,
    },
}


def duration_label(minutes: float) -> str:
    if minutes >= 60:
        hours = minutes / 60
        return f"{hours:g} Hour" + ("s" if hours != 1 else "")
    return f"{minutes:g} Min"


NOTE_URL = "https://note.com/unique_condor276"


# 2026-08-25: エンゲージメント導線が弱いという仮説(docs/marketing/
# 2026-08-17-bgm-engagement-analysis.md)への対応として追加。カテゴリ別に
# コメントを誘発する質問文を用意(「高評価お願いします」的な一方的な
# お願いより、答えやすい質問の方がコメント率が上がるとされる定石)。
ENGAGEMENT_QUESTION = {
    "sleep": "この音、寝つくまで何分くらいで効きましたか?コメントで教えてください。",
    "focus": "作業中に流すなら、これくらいの音量がちょうどいいですか?普段何をしながら聴いているか教えてください。",
}


def build_description(preset: str, minutes: float) -> str:
    """Composes the full YouTube description: a keyword-rich hook (the first
    ~150 chars are what shows before "Show more" and in search results),
    an expanded blurb, a use-case list, an AI/royalty-free disclosure, a
    cross-promotion link to the note.com essays (the only channel with a
    working, review-free monetization path right now), an engagement
    question (2026-08-25 addition, see ENGAGEMENT_QUESTION above), and a
    hashtag block (YouTube surfaces the first 3 above the title).

    2026-08-25: previously the hook/about (Japanese) were followed by
    boilerplate lines written in English (duration explainer, use-case
    header, AI disclosure, subscribe CTA) — inconsistent for a channel
    that's deliberately JP-first (docs/projects/bgm-pipeline branding
    decisions). Rewrote the whole thing in Japanese so nothing switches
    language mid-description.
    """
    meta = PRESET_METADATA[preset]
    hours = minutes / 60
    if minutes >= 60:
        duration_txt = f"{hours:g}時間"
    else:
        duration_txt = f"{minutes:g}分"
    use_cases = "\n".join(f"- {u}" for u in meta["use_cases"])
    hashtags = " ".join(f"#{h}" for h in meta["hashtags"])
    question = ENGAGEMENT_QUESTION.get(meta["icon_category"], ENGAGEMENT_QUESTION["sleep"])

    return (
        f"{meta['hook']}\n\n"
        f"{meta['about']}\n\n"
        f"この動画は{duration_txt}ノンストップで再生されます。ループ再生や、"
        "一晩流しっぱなし、他のアプリのBGM代わりとしてもお使いいただけます。\n\n"
        f"こんな時におすすめ:\n{use_cases}\n\n"
        "100% AI生成のロイヤリティフリー音源です。既存の楽曲・音源のサンプリングは"
        "一切使用していないため、配信・作業中のBGM・ご自身の制作物への利用も安心です。\n\n"
        f"睡眠・集中・この会社の運営についてのnoteはこちら: {NOTE_URL}\n\n"
        f"{question}\n\n"
        "新しい音源を定期的に公開しています。よければチャンネル登録もお願いします。\n\n"
        f"{hashtags}"
    )
