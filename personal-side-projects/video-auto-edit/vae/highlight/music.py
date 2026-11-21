"""ハイライト用の BGM(PoC 用の自動生成)。拍の位置が分かっているので、カットを拍に合わせられる

注意: 品質は「検証用」。製品の音楽は、利用許諾のある音源ライブラリかオーナーが用意する音源に差し替える前提
(素材の選定はオーナーの判断事項)。
"""
import numpy as np

SR = 48000
PROGRESSIONS = {
    "bright": [(0, "maj"), (7, "maj"), (9, "min"), (5, "maj")],      # I - V - vi - IV
    "calm": [(0, "maj"), (9, "min"), (5, "maj"), (7, "maj")],        # I - vi - IV - V
    "emotional": [(9, "min"), (5, "maj"), (0, "maj"), (7, "maj")],   # vi - IV - I - V
}
MOODS = {"bright": dict(bpm=118, root=60, drive=1.0), "calm": dict(bpm=92, root=57, drive=0.55),
         "emotional": dict(bpm=84, root=55, drive=0.7)}


def _midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def _env(n, a, d, sr=SR):
    t = np.arange(n) / sr
    return np.minimum(1.0, t / max(a, 1e-4)) * np.exp(-t / max(d, 1e-4))


def _tone(freq, n, kind="saw", sr=SR):
    t = np.arange(n) / sr
    if kind == "sine":
        return np.sin(2 * np.pi * freq * t)
    x = np.zeros(n)
    for k in range(1, 9):                       # 帯域を制限したのこぎり波(耳に痛くない)
        x += np.sin(2 * np.pi * freq * k * t) / k
    return x * 0.6


def generate(seconds, mood="bright", seed=1):
    """戻り値: (ステレオ float32 [n, 2], 拍の時刻[秒], 小節の先頭の時刻[秒], bpm)"""
    rng = np.random.default_rng(seed)
    m = MOODS[mood]
    bpm, root, drive = m["bpm"], m["root"], m["drive"]
    beat = 60.0 / bpm
    bars = int(np.ceil(seconds / (4 * beat))) + 1
    n = int((bars * 4 * beat + 2) * SR)
    out = np.zeros((n, 2))
    prog = PROGRESSIONS[mood]
    kick = np.sin(2 * np.pi * np.cumsum(np.linspace(110, 45, int(0.18 * SR))) / SR) * _env(int(0.18 * SR), 0.002, 0.09)
    snare = rng.normal(0, 1, int(0.16 * SR)) * _env(int(0.16 * SR), 0.001, 0.05)
    hat = rng.normal(0, 1, int(0.05 * SR)) * _env(int(0.05 * SR), 0.0005, 0.012)
    hat = np.diff(hat, prepend=0)                # 高域だけ残す

    def add(sig, t, gain, pan=0.0):
        i = int(t * SR)
        j = min(n, i + len(sig))
        if j > i:
            out[i:j, 0] += sig[:j - i] * gain * (1 - pan)
            out[i:j, 1] += sig[:j - i] * gain * (1 + pan)

    for b in range(bars):
        deg, q = prog[b % len(prog)]
        chord = [root + deg, root + deg + (4 if q == "maj" else 3), root + deg + 7]
        t0 = b * 4 * beat
        intro = b < 2 or b >= bars - 2              # 最初と最後の2小節は静かに(入りと終わり)
        # パッド(和音): 小節いっぱい
        ln = int(4 * beat * SR)
        pad = sum(_tone(_midi(x), ln, "saw") for x in chord) / 3 * _env(ln, 0.25, 6.0)
        add(pad, t0, 0.10, -0.2)
        add(pad, t0, 0.10, 0.2)
        # ベース: 8分音符
        for k in range(8):
            if intro and k % 2:
                continue
            bl = int(beat / 2 * SR)
            add(_tone(_midi(root + deg - 24), bl, "sine") * _env(bl, 0.005, 0.18), t0 + k * beat / 2, 0.35 * drive)
        # アルペジオ(きらきらした高音)
        for k in range(8):
            al = int(beat / 2 * SR)
            note = chord[k % 3] + 12 + (12 if k % 4 == 3 else 0)
            add(_tone(_midi(note), al, "sine") * _env(al, 0.003, 0.25), t0 + k * beat / 2, 0.09, 0.4 if k % 2 else -0.4)
        if intro:
            continue
        for k in range(4):
            add(kick, t0 + k * beat, 0.9 * drive)
            if k in (1, 3):
                add(snare, t0 + k * beat, 0.25 * drive)
            add(hat, t0 + k * beat + beat / 2, 0.12 * drive, 0.3)
    out = np.tanh(out * 1.2) / np.tanh(1.2)
    out /= max(1e-6, np.abs(out).max()) / 0.8
    beats = [i * beat for i in range(bars * 4)]
    downbeats = [i * 4 * beat for i in range(bars)]
    return out.astype(np.float32), beats, downbeats, bpm
