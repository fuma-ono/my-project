"""テスト・UI 操作確認用の部品(重いモデルを使わない)

- make_video(): 合成テスト動画。映像にフレーム番号を明るさで埋め込み、音声は「話し声の代わりの区間」と無音を交互に置く
- FakeTranscriber: 音声の大きい区間に、与えた台本の単語を順に割り当てる
- energy_vad(): 音量で発話区間を返す(Silero VAD の代わり)
"""
import json
import os
import subprocess

import numpy as np

from .transcribe import Transcript

BASE, STEP, OFF = 22, 10, 15


def make_video(path, segments, size=(640, 360), fps=30, codec="libx264", acodec="aac", ext_args=(), tone_hz=220):
    """segments: [(長さ秒, 声あり?)...]。声の区間は 220Hz 前後の和音+ノイズ(音量で検出できる)"""
    dur = sum(d for d, _ in segments)
    sr = 48000
    t = np.arange(int(dur * sr)) / sr
    a = np.zeros_like(t)
    pos = 0.0
    rng = np.random.default_rng(0)
    for d, voiced in segments:
        m = (t >= pos) & (t < pos + d)
        if voiced:
            tt = t[m] - pos
            env = np.minimum(1, np.minimum(tt, d - tt) / 0.03)
            a[m] = env * (0.25 * np.sin(2 * np.pi * tone_hz * tt) + 0.15 * np.sin(2 * np.pi * tone_hz * 1.5 * tt)
                          + 0.03 * rng.standard_normal(m.sum()))
        pos += d
    wav = path + ".src.wav"
    import soundfile as sf
    sf.write(wav, np.stack([a, a], 1).astype(np.float32), sr)
    w, h = size
    lum = (f"if(eq(X,0),mod(N,{BASE})*{STEP}+{OFF},if(eq(X,1),mod(floor(N/{BASE}),{BASE})*{STEP}+{OFF},"
           f"if(eq(X,2),floor(N/{BASE * BASE})*{STEP}+{OFF},if(eq(mod(N,{fps}),0),235,16))))")
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s=4x2:r={fps}:d={dur}", "-i", wav,
           "-vf", f"format=gray,geq=lum='{lum}',scale={w}:{h}:flags=neighbor,format=yuv420p",
           "-c:v", codec, "-c:a", acodec, *ext_args, "-shortest", path]
    if acodec is None:
        cmd = [c for c in cmd if c not in (wav,)]
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s=4x2:r={fps}:d={dur}",
               "-vf", f"format=gray,geq=lum='{lum}',scale={w}:{h}:flags=neighbor,format=yuv420p",
               "-c:v", codec, "-an", *ext_args, path]
    subprocess.run(cmd, check=True)
    os.remove(wav)
    return path


def decode_frame_indices(path):
    """出力の各フレームに埋め込まれた元のフレーム番号を読む(列の中央1/3を読む)"""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=12:2:flags=area,format=yuv420p",
                          "-f", "rawvideo", "-"], check=True, capture_output=True).stdout
    a = np.frombuffer(raw, np.uint8).reshape(-1, 36)[:, [1, 4, 7, 10]].astype(float)
    lum = (a - 16) * 255 / 219
    d = np.clip(np.round((lum[:, :3] - OFF) / STEP), 0, BASE - 1).astype(int)
    return d[:, 0] + d[:, 1] * BASE + d[:, 2] * BASE * BASE


def energy_vad(audio16k, threshold=0.5, min_silence_sec=0.5, frame=0.02, level=0.02):
    """音量で発話区間を返す(テスト用)。threshold は互換のため受け取るだけ"""
    n = int(frame * 16000)
    if len(audio16k) < n:
        return []
    k = len(audio16k) // n
    rms = np.sqrt(np.mean(audio16k[:k * n].reshape(k, n) ** 2, axis=1))
    on = rms > level
    segs, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        if not v and start is not None:
            segs.append([start * frame, i * frame])
            start = None
    if start is not None:
        segs.append([start * frame, k * frame])
    merged = []
    for s in segs:                                  # 短い無音はつなぐ
        if merged and s[0] - merged[-1][1] < min_silence_sec:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [(a, b) for a, b in merged if b - a >= 0.1]


class FakeTranscriber:
    """発話区間ごとに台本の文を1つずつ割り当て、文字数で単語の時刻を配る"""

    def __init__(self, sentences=None, words_per_sentence=None):
        self.sentences = sentences or ["こんにちは。", "今日は2026年11月21日です。", "えーと、", "テストの動画を編集します。",
                                       "ご視聴ありがとうございました。"]

    def __call__(self, audio16k):
        speech = energy_vad(audio16k)
        words, segs = [], []
        for (a, b), sent in zip(speech, self.sentences):
            toks = _tokens(sent)
            total = sum(len(x) for x in toks)
            t = a
            for x in toks:
                d = (b - a) * len(x) / total
                words.append(dict(s=round(t, 3), e=round(t + d, 3), w=x, p=0.9))
                t += d
            segs.append(dict(s=a, e=b, text=sent))
        return Transcript(words=words, segments=segs, language="ja")


def _tokens(sent):
    # 言い淀みは1語、それ以外はおおむね3文字ずつ(Whisper の単語の細かさに近い)
    if sent.rstrip("、。").replace("ー", "") in ("えと", "え", "あの", "まあ", "えっと"):
        return [sent]
    out, i = [], 0
    while i < len(sent):
        j = min(len(sent), i + 3)
        while j < len(sent) and sent[j] in "、。？！?!":
            j += 1
        out.append(sent[i:j])
        i = j
    return out


def fake_factory(model=None):
    return FakeTranscriber()


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1, default=str)
