"""BGM の用意。

1. リポジトリの bgm-pipeline(自前生成、権利問題なし)を読み取り専用で呼ぶ。
   既知の不具合(長さによって core.widen が失敗)を避けるため、長さは30秒単位に切り上げる
2. bgm-pipeline が無い・失敗した場合は、内蔵の簡易生成(和音のパッド)を使う
生成結果は長さ(30秒単位)ごとにキャッシュする(生成に 8〜15秒かかるため)
"""
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_BGM = os.path.abspath(os.path.join(HERE, "..", "..", "..", "bgm-pipeline"))


def _builtin(path, seconds, sr=48000, seed=1):
    """内蔵の簡易 BGM(Am - F - C - G の和音をゆっくり鳴らすパッド)"""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * sr)) / sr
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
    out = np.zeros_like(t)
    for k in range(int(math.ceil(seconds / 4))):
        a, b = k * 4.0, min(seconds, k * 4.0 + 4.0)
        m = (t >= a) & (t < b)
        env = np.sin(np.pi * (t[m] - a) / 4.0) ** 2
        for note in chords[k % 4]:
            f = 440 * 2 ** ((note - 69) / 12)
            out[m] += 0.08 * env * (np.sin(2 * np.pi * f * t[m]) + 0.3 * np.sin(4 * np.pi * f * t[m]))
    out += 0.002 * rng.standard_normal(len(t))
    import soundfile as sf
    sf.write(path, np.stack([out, out], axis=1).astype(np.float32), sr)
    return path


def prepare(seconds, cache_dir, preset="study_lofi_chill"):
    """seconds 以上の長さの BGM の wav パスを返す。戻り値: (パス, 生成元)"""
    os.makedirs(cache_dir, exist_ok=True)
    minutes = math.ceil((seconds + 1) / 30) / 2
    path = os.path.join(cache_dir, f"bgm_{preset}_{minutes:.1f}min.wav")
    if os.path.exists(path):
        return path, "cache"
    if os.path.isdir(os.path.join(REPO_BGM, "bgm_pipeline")):
        try:
            subprocess.run([sys.executable, "-m", "bgm_pipeline.generate", "--preset", preset, "--minutes", str(minutes),
                            "--out", path + ".tmp.wav", "--seed", "1"], check=True, capture_output=True, cwd=REPO_BGM,
                           env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"), timeout=600)
            os.replace(path + ".tmp.wav", path)
            return path, "bgm-pipeline"
        except (subprocess.SubprocessError, OSError):
            if os.path.exists(path + ".tmp.wav"):
                os.remove(path + ".tmp.wav")
    _builtin(path + ".tmp.wav", minutes * 60)
    os.replace(path + ".tmp.wav", path)
    return path, "builtin"
