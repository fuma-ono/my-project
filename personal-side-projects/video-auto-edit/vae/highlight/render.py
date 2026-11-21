"""EDL から1本の動画を書き出す: 区間の切り出し(大きさ・fps をそろえる。向きが違う素材はぼかした背景で埋める)
→ 拍に乗せたカットでつなぐ → BGM と元の音(会話は聞こえるように、それ以外は雰囲気として小さく)を混ぜる → 字幕"""
import os

import numpy as np

from .. import proc, subtitles
from . import music

FPS = 30
LUFS_MUSIC = -16.0


def canvas_for(clips, segments, short=1080):
    """書き出しの向き: 採用した区間の長さで多い向き。短辺 short"""
    by = {c["idx"]: c for c in clips}
    port = sum(s["dur"] for s in segments if by[s["clip"]]["height"] > by[s["clip"]]["width"])
    land = sum(s["dur"] for s in segments) - port
    return (short, short * 16 // 9) if port >= land else (short * 16 // 9, short)


def _segment(src, s, w, h, out, fade_in=0.0, fade_out=0.0):
    """1区間を切り出して、大きさ・fps・色をそろえた中間ファイル(映像のみ)を作る"""
    vf = (f"split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:2,eq=brightness=-0.08[bg];"
          f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,"
          f"fps={FPS},eq=saturation=1.08:contrast=1.03,format=yuv420p")
    if fade_in:
        vf += f",fade=t=in:st=0:d={fade_in}"
    if fade_out:
        vf += f",fade=t=out:st={max(0.0, s['dur'] - fade_out):.3f}:d={fade_out}"
    n = int(round(s["dur"] * FPS))
    proc.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s['start']:.3f}", "-i", src, "-t", f"{s['dur'] + 0.5:.3f}",
              "-filter_complex", vf, "-frames:v", str(n), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17",
              "-r", str(FPS), out], timeout=600, mem_limit_mb=3000)
    return n


def _audio(src, start, dur, sr=music.SR):
    raw = proc.run_bytes(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", src, "-t", f"{dur:.3f}", "-vn",
                          "-ac", "2", "-ar", str(sr), "-f", "f32le", "-"], timeout=300)
    a = np.frombuffer(raw, np.float32).reshape(-1, 2)
    n = int(round(dur * sr))
    if len(a) < n:
        a = np.vstack([a, np.zeros((n - len(a), 2), np.float32)])
    return a[:n]


def _rms_db(x):
    return 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0, 1e-6))


def _ramp(n, sr, a=0.02):
    k = min(n // 2, int(a * sr))
    g = np.ones(n)
    if k:
        g[:k] = np.linspace(0, 1, k)
        g[-k:] = np.linspace(1, 0, k)
    return g


def render(clips, edl, out, work, music_track=None, subtitles_on=True, short=1080):
    """戻り値: dict(書き出しの情報)"""
    os.makedirs(work, exist_ok=True)
    by = {c["idx"]: c for c in clips}
    segs = edl["segments"]
    w, h = canvas_for(clips, segs, short)
    parts, lst, t, timeline = [], [], 0.0, []
    for i, s in enumerate(segs):
        p = os.path.join(work, f"seg{i:03d}.mp4")
        _segment(by[s["clip"]]["path"], s, w, h, p, fade_in=0.6 if i == 0 else 0.0,
                 fade_out=1.2 if i == len(segs) - 1 else 0.0)
        lst.append(f"file '{os.path.abspath(p)}'")
        timeline.append((t, t + s["dur"]))
        t += s["dur"]
    total = t
    with open(os.path.join(work, "concat.txt"), "w") as f:
        f.write("\n".join(lst) + "\n")
    video = os.path.join(work, "video.mp4")
    proc.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(work, "concat.txt"),
              "-c", "copy", video], timeout=600)
    # 音: 元の音(会話は前に、その他は雰囲気として小さく)+ BGM(会話のときは下げる)
    sr = music.SR
    n = int(round(total * sr))
    orig = np.zeros((n, 2), np.float32)
    duck = np.ones(n)
    for (a, b), s in zip(timeline, segs):
        x = _audio(by[s["clip"]]["path"], s["start"], s["dur"]) if by[s["clip"]]["has_audio"] else np.zeros((int(round(s["dur"] * sr)), 2))
        i0 = int(round(a * sr))
        x = x[:max(0, min(len(x), n - i0))]
        level = _rms_db(x)
        target = -20.0 if s["speech"] else -34.0               # 会話ははっきり、環境音は小さく残す
        g = 10 ** ((target - level) / 20) if level > -70 else 0.0
        g = min(g, 10.0)
        orig[i0:i0 + len(x)] += (x * g * _ramp(len(x), sr)[:, None]).astype(np.float32)
        if s["speech"]:
            duck[i0:i0 + len(x)] = 10 ** (-12 / 20)            # 会話の間は BGM を 12dB 下げる
    k = int(0.3 * sr)                                          # 下げ・戻しを滑らかに
    duck = np.convolve(duck, np.ones(k) / k, mode="same")
    if music_track is None:
        music_track, _, _, _ = music.generate(total + 1, edl.get("mood", "bright"))
    m = music_track[:n]
    if len(m) < n:
        m = np.vstack([m, np.zeros((n - len(m), 2), np.float32)])
    m = m * (10 ** ((-22.0 - _rms_db(m)) / 20))                # BGM の基準の大きさ
    fo = int(min(2.0, total / 4) * sr)
    m[-fo:] *= np.linspace(1, 0, fo)[:, None]                  # 終わりはフェードアウト
    mix = m * duck[:, None] + orig
    wav = os.path.join(work, "mix.f32")
    mix.astype(np.float32).tofile(wav)
    # 字幕: 採用した区間の会話だけ(元の動画の時刻 → 完成動画の時刻)
    ass = None
    if subtitles_on:
        words = []
        for (a, b), s in zip(timeline, segs):
            for wd in by[s["clip"]].get("words") or []:
                if s["start"] <= wd["s"] and wd["e"] <= s["end"]:
                    words.append(dict(wd, s=wd["s"] - s["start"] + a, e=wd["e"] - s["start"] + a))
        if words:
            st_fs = max(36, int(min(w, h) * 0.05))
            evs = subtitles.build_events(words, lambda x: x, w, st_fs, 4, int(w * 0.06))
            if evs:
                ass = os.path.join(work, "subs.ass")
                with open(ass, "w", encoding="utf-8") as f:
                    f.write(subtitles.to_ass([dict(s=e["s"], e=e["e"], lines=e["lines"]) for e in evs], w, h, st_fs, 4,
                                             int(w * 0.06), int(h * 0.08)))
    vf = ["-vf", "ass=subs.ass"] if ass else []
    tmp = os.path.abspath(out) + ".part.mp4"
    proc.run(["ffmpeg", "-y", "-v", "error", "-i", os.path.abspath(video), "-f", "f32le", "-ar", str(sr), "-ac", "2",
              "-i", os.path.abspath(wav), *vf, "-af", "alimiter=limit=0.84:level=false",
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
              "-movflags", "+faststart", "-shortest", tmp], timeout=1200, mem_limit_mb=3000, cwd=work if ass else None)
    os.replace(tmp, out)
    return {"size": [w, h], "duration": round(total, 3), "segments": len(segs), "subtitles": bool(ass)}
