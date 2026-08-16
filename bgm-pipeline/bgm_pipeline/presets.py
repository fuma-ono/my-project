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


PRESETS = {
    "sleep_deep_drone": sleep_deep_drone,
    "sleep_rain_focus": sleep_rain_focus,
    "study_lofi_chill": study_lofi_chill,
    "study_focus_binaural": study_focus_binaural,
    "sleep_insomnia_pulse": sleep_insomnia_pulse,
    "baby_sleep_noise": baby_sleep_noise,
    "breath_guide_coherent": breath_guide_coherent,
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
    },
    "study_lofi_chill": {
        "title": "ローファイの音だけの1時間｜集中がはかどる作業用タイム",  # retitled 2026-08-16 (was "【作業用BGM】カフェ気分で集中できる1時間BGM ｜勉強・作業用"), same direction as breath_guide_coherent's retitle
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
        "thumbnail_source": "assets/thumbnails/study_lofi_chill_source.jpeg",
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
        "thumbnail_source": "assets/thumbnails/baby_sleep_noise_source.jpeg",
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
        "thumbnail_source": "assets/thumbnails/breath_guide_coherent_source.png",
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
}


def duration_label(minutes: float) -> str:
    if minutes >= 60:
        hours = minutes / 60
        return f"{hours:g} Hour" + ("s" if hours != 1 else "")
    return f"{minutes:g} Min"


NOTE_URL = "https://note.com/unique_condor276"


def build_description(preset: str, minutes: float) -> str:
    """Composes the full YouTube description: a keyword-rich hook (the first
    ~150 chars are what shows before "Show more" and in search results),
    an expanded blurb, a use-case list, an AI/royalty-free disclosure, a
    cross-promotion link to the note.com essays (the only channel with a
    working, review-free monetization path right now), and a hashtag
    block (YouTube surfaces the first 3 above the title).
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
        f"More writing on sleep, focus, and building this project: {NOTE_URL}\n\n"
        "New tracks posted regularly — subscribe if this helped you relax, focus, or sleep.\n\n"
        f"{hashtags}"
    )
