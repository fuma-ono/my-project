"""複数動画の解析: 画質・動き・顔・意味(CLIP)・音声・撮影日時から、使える区間(セグメント)の候補を作る

1本ごとに 2fps で縮小フレームを取り出し、フレームごとの特徴を求める。
フレームの意味の変化(CLIP の埋め込みの距離)と画の変化でショットを分け、長いショットは数秒の候補区間に分ける。
"""
import json
import os
import subprocess
import time

import numpy as np

from .. import media, proc

FPS = 2.0                 # 解析に使うフレームの間隔(1秒あたり)
SHORT = 360               # 解析用の縮小(短辺の画素数。縦動画でも顔が小さくなりすぎないように短辺で決める)

# CLIP のゼロショット分類に使う場面の種類(英語の方が精度が高い)。日本語名は表示用
CATEGORIES = {
    "scenery": ("景色", ["a beautiful scenic landscape", "a wide view of mountains, sea or sky", "a sunset over the horizon"]),
    "food": ("食事", ["a close-up photo of delicious food", "a meal on a table at a restaurant", "a drink or dessert"]),
    "people": ("人物", ["people smiling and having fun", "a group of friends together", "a person talking to the camera"]),
    "city": ("街", ["a busy city street", "buildings and shops in a town", "a famous landmark building"]),
    "night": ("夜景", ["a city at night with lights", "night illuminations", "fireworks in the night sky"]),
    "nature": ("自然", ["trees, flowers and nature", "a forest path", "a river or waterfall"]),
    "water": ("海・水辺", ["a beach with waves", "a boat on the water", "a swimming pool"]),
    "transport": ("移動", ["a view from a train or car window", "an airport or station", "walking on a road"]),
    "indoor": ("室内", ["inside a room or hotel", "inside a shop or museum", "an indoor event"]),
    "animal": ("動物", ["a cute animal", "a dog or cat", "birds or fish"]),
}
NEGATIVE = ["a blurry photo", "a dark underexposed photo", "a photo of the ground or floor", "a shaky out of focus image"]
APPEAL = ["a beautiful high quality photo", "an impressive memorable moment", "a happy emotional moment"]


def creation_time(path):
    """撮影日時(UTC 秒)。メタデータが無ければファイルの更新日時"""
    try:
        out = proc.run_text(["ffprobe", "-v", "error", "-show_entries", "format_tags=creation_time:stream_tags=creation_time",
                             "-of", "json", path])
        j = json.loads(out)
        tags = [j.get("format", {}).get("tags", {})] + [s.get("tags", {}) for s in j.get("streams", [])]
        for t in tags:
            v = t.get("creation_time")
            if v:
                import calendar
                return float(calendar.timegm(time.strptime(v[:19], "%Y-%m-%dT%H:%M:%S"))), "metadata"
    except Exception:
        pass
    return os.path.getmtime(path), "mtime"


def read_frames(path, info):
    """解析用の縮小フレーム(RGB)を FPS 枚/秒で読む"""
    r = SHORT / min(info.width, info.height)
    w, h = int(round(info.width * r / 2)) * 2, int(round(info.height * r / 2)) * 2
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = proc.run_bytes(cmd, timeout=proc.timeout_for(info.duration, factor=3.0))
    n = len(raw) // (w * h * 3)
    return np.frombuffer(raw[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)


CUT_THRESHOLD = 0.1          # ffmpeg の場面変化の値(0〜1)。元動画の切り替わり(編集済み・複数の撮影)を見つける


def detect_cuts(path, duration):
    """元動画の中のハードカット(場面の切り替わり)の時刻(秒)。区間がまたがないようにするために使う"""
    err = proc.run_stderr(["ffmpeg", "-nostats", "-i", path, "-an", "-vf", f"scale=320:-2,select='gt(scene,{CUT_THRESHOLD})',showinfo",
                           "-f", "null", "-"], timeout=proc.timeout_for(duration, factor=6.0))
    import re
    return sorted({round(float(t), 3) for t in re.findall(r"pts_time:([0-9.]+)", err) if 0.2 < float(t) < duration - 0.2})


def read_audio16(path, duration):
    raw = proc.run_bytes(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         timeout=proc.timeout_for(duration, factor=2.0))
    return np.frombuffer(raw, np.float32)


def frame_stats(frames, faces_fn):
    import cv2
    out = []
    prev = None
    for f in frames:
        g = cv2.cvtColor(f, cv2.COLOR_RGB2GRAY)
        sharp = float(cv2.Laplacian(g, cv2.CV_64F).var())
        bright = float(g.mean())
        sat = float(cv2.cvtColor(f, cv2.COLOR_RGB2HSV)[..., 1].mean())
        motion = float(np.abs(g.astype(np.int16) - prev).mean()) if prev is not None else 0.0
        prev = g.astype(np.int16)
        fs = faces_fn(f)
        area = sum(fw * fh for _, _, fw, fh, _ in fs) / float(f.shape[0] * f.shape[1])
        out.append({"sharp": sharp, "bright": bright, "sat": sat, "motion": motion, "faces": len(fs), "face_area": area})
    return out


def audio_features(a16, n_frames):
    """フレームごと(0.5秒)の音の大きさ(dBFS)"""
    hop = int(16000 / FPS)
    out = []
    for i in range(n_frames):
        seg = a16[i * hop:(i + 1) * hop]
        rms = float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0.0
        out.append(20 * np.log10(max(rms, 1e-6)))
    return out


def shots_from_embeddings(emb, stats, thr=0.18):
    """意味の変化(1 - cos)と画の変化が大きいところで区切る。戻り値: [(開始フレーム, 終了フレーム)]"""
    cuts = [0]
    for i in range(1, len(emb)):
        d = 1.0 - float(emb[i] @ emb[i - 1])
        if d > thr or stats[i]["motion"] > 45:
            if i - cuts[-1] >= 2:                  # 1秒未満の細切れにしない
                cuts.append(i)
    cuts.append(len(emb))
    return [(a, b) for a, b in zip(cuts, cuts[1:]) if b > a]


class Analyzer:
    def __init__(self, transcriber=None, vad_fn=None):
        from .models import Clip, Faces
        self.clip = Clip()
        self.faces = Faces()
        self.transcriber = transcriber
        self.vad_fn = vad_fn
        labels, texts = [], []
        for key, (_, prompts) in CATEGORIES.items():
            for p in prompts:
                labels.append(key)
                texts.append(p)
        self.cat_keys = list(CATEGORIES)
        self.cat_labels = labels
        self.cat_emb = self.clip.texts(texts)
        self.neg_emb = self.clip.texts(NEGATIVE)
        self.app_emb = self.clip.texts(APPEAL)

    def categorize(self, emb):
        sims = emb @ self.cat_emb.T                       # (n, prompts)
        per_cat = np.stack([sims[:, [i for i, l in enumerate(self.cat_labels) if l == k]].max(axis=1) for k in self.cat_keys], 1)
        z = np.exp((per_cat - per_cat.max(axis=1, keepdims=True)) * 100.0)   # CLIP の logit_scale(100)で確率にする
        return z / z.sum(axis=1, keepdims=True)

    def clip_file(self, path, idx, progress=None):
        t0 = time.time()
        info = media.probe(path)
        when, when_src = creation_time(path)
        frames = read_frames(path, info)
        if not len(frames):
            raise ValueError(f"フレームを読めませんでした: {os.path.basename(path)}")
        stats = frame_stats(frames, self.faces)
        emb = self.clip.images(list(frames))
        probs = self.categorize(emb)
        appeal = (emb @ self.app_emb.T).max(axis=1) - (emb @ self.neg_emb.T).max(axis=1)
        speech, words, tsegs = [], [], []
        loud = [0.0] * len(frames)
        if info.acodec:
            a16 = read_audio16(path, info.duration)
            loud = audio_features(a16, len(frames))
            if self.vad_fn:
                speech = self.vad_fn(a16)
            if self.transcriber and speech:
                tr = self.transcriber(a16)
                words, tsegs = tr.words, tr.segments
        shots = shots_from_embeddings(emb, stats)
        cuts = detect_cuts(path, info.duration)
        return {"idx": idx, "path": path, "name": os.path.basename(path), "duration": info.duration,
                "width": info.width, "height": info.height, "fps": f"{info.fps_num}/{info.fps_den}",
                "has_audio": bool(info.acodec), "created": when, "created_source": when_src,
                "frames": [dict(s, t=i / FPS, appeal=float(appeal[i]), loud=loud[i],
                                cat={k: float(probs[i, j]) for j, k in enumerate(self.cat_keys)}) for i, s in enumerate(stats)],
                "emb": emb, "shots": shots, "speech": speech, "words": words, "tsegments": tsegs, "cuts": cuts,
                "analyze_sec": round(time.time() - t0, 2)}
