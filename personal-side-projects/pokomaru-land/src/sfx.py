"""効果音を numpy でコード合成し、ナレーションと混ぜて mix.wav を作る。
素材のダウンロードはしない(権利問題を避けるため、全部自前合成)。
使い方: python3 -I src/sfx.py <timing.json> <workdir> [duration_sec]
"""
import json, sys, wave, os
import numpy as np

SR = 48000


def env_decay(n, k):
    return np.exp(-k * np.arange(n) / SR)


def pop(dur=0.14, f0=320, f1=980):
    n = int(SR * dur)
    f = np.linspace(f0, f1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env_decay(n, 22) * np.minimum(1, np.arange(n) / (SR * 0.004))


def chime(notes=(1046.5, 1318.5, 1568.0), gap=0.09, dur=0.5):
    out = np.zeros(int(SR * (gap * len(notes) + dur)))
    for i, fr in enumerate(notes):
        n = int(SR * dur)
        t = np.arange(n) / SR
        tone = (np.sin(2 * np.pi * fr * t) + 0.3 * np.sin(2 * np.pi * fr * 2 * t)) * env_decay(n, 7)
        i0 = int(SR * gap * i)
        out[i0:i0 + n] += tone
    return out


def boing(dur=0.28):
    n = int(SR * dur)
    f = 260 + 520 * np.sin(np.linspace(0, np.pi * 0.9, n))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env_decay(n, 7)


def place(buf, x, t, gain):
    i0 = int(t * SR)
    x = x[: max(0, len(buf) - i0)]
    buf[i0:i0 + len(x)] += x * gain


def rw(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def main(timing_path, workdir, dur=8.0):
    T = json.load(open(timing_path, encoding="utf-8"))
    ev = T["events"]
    sfx = np.zeros(int(SR * dur), np.float32)
    for k, t in ev["enter_times"].items():
        place(sfx, pop(f0=300 + 120 * list(ev["enter_times"]).index(k)), t, 0.45)
    place(sfx, chime(), ev["flower_pop"], 0.40)
    place(sfx, boing(), ev["cheer_start"], 0.40)
    place(sfx, boing(), ev["cheer_start"] + 0.42, 0.35)
    nar = rw(os.path.join(workdir, "narration.wav"))
    nar = np.pad(nar, (0, max(0, len(sfx) - len(nar))))[: len(sfx)]
    mix = nar * 1.0 + sfx * 0.6
    pk = np.abs(mix).max()
    mix = mix * (0.708 / pk)  # ピークを約 -3 dBFS に
    for name, x in (("sfx.wav", sfx), ("mix.wav", mix)):
        with wave.open(os.path.join(workdir, name), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    print("sfx/mix written; mix peak before norm:", round(float(pk), 3))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 8.0)
