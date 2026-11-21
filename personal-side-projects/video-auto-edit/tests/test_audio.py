"""AC-A5(カット境界)、AC-A6(声の音量・ピーク)、AC-A7(BGM の下げ方)"""
from fractions import Fraction

import numpy as np

from vae import audio


def test_ac_a5_cut_has_fades_no_step():
    sr, fps = audio.SR, Fraction(30)
    t = np.arange(sr * 3) / sr
    a = (0.5 * np.sin(2 * np.pi * 300 * t)).astype(np.float32)[:, None].repeat(2, 1)
    frames = [(0, 30), (45, 75)]
    cut = audio.cut_audio(a, sr, frames, fps)
    assert len(cut) == round(Fraction(60) / fps * sr)
    steps = audio.boundary_steps(cut, sr, frames, fps)
    assert max(steps) < 0.01                       # 境界は両側ともフェードで0付近


def test_ac_a7_gain_curve_depth_and_recovery():
    sr = 1000
    g = audio.speech_gain_curve(10 * sr, sr, [(2.0, 4.0)], -6.0)
    db = 20 * np.log10(g)
    assert abs(db[3 * sr] + 6.0) < 1e-3            # 発話中は -6dB
    assert abs(db[8 * sr]) < 1e-3                  # 無音で 0dB に戻る
    assert np.max(np.abs(np.diff(db))) < 0.1       # 急な段差がない(ポンピング・クリックの防止)


def _tone(path, seconds, amp, sr=audio.SR, gaps=()):
    t = np.arange(int(seconds * sr)) / sr
    x = amp * np.sin(2 * np.pi * 220 * t) * (1 + 0.3 * np.sin(2 * np.pi * 3 * t))
    for a, b in gaps:
        x[int(a * sr):int(b * sr)] = 0
    audio.write_wav(path, np.stack([x, x], 1).astype(np.float32), sr)


def test_ac_a6_a7_quiet_voice_is_normalized_and_bgm_stays_below(tmp_path):
    # 小さい声(約 -40 LUFS)でも、声を -16 LUFS にそろえ、BGM は発話中に声を上回らない
    v, b = str(tmp_path / "v.wav"), str(tmp_path / "b.wav")
    _tone(v, 12, 0.01, gaps=[(4, 6)])
    t = np.arange(int(12 * audio.SR)) / audio.SR
    bg = 0.3 * np.sin(2 * np.pi * 440 * t)
    audio.write_wav(b, np.stack([bg, bg], 1).astype(np.float32))
    speech = [(0.0, 4.0), (6.0, 12.0)]
    info = audio.mix(v, b, str(tmp_path), speech)
    m = audio.mix_metrics(str(tmp_path), speech)
    assert abs(m["stem_voice_lufs"] - (-16.0)) <= 1.0, m
    assert m["mix_peak"] <= -1.0, m                 # True Peak
    assert m["diff_p5"] >= 9.0, m
    assert m["bgm_louder_ratio"] <= 0.01, m
    assert m["duck_std"] <= 1.0, m
    assert info["voice_gain_db"] > 15


def test_mix_without_bgm(tmp_path):
    v = str(tmp_path / "v.wav")
    _tone(v, 4, 0.1)
    info = audio.mix(v, None, str(tmp_path), [(0, 4)])
    assert info["bgm"] is False
    i, _ = audio.integrated_lufs(str(tmp_path / "mix.wav"))
    assert abs(i + 16) <= 1.0
