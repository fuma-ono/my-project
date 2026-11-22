"""EDL から1本の動画を書き出す: 区間の切り出し(大きさ・fps をそろえる。向きが違う素材はぼかした背景で埋める)
→ 拍に乗せたカットでつなぐ → BGM と元の音(会話は聞こえるように、それ以外は雰囲気として小さく)を混ぜる → 字幕"""
import os

import numpy as np

from .. import proc, subtitles
from . import music

FPS = 30
LUFS_MUSIC = -16.0
SUB_MIN_CONF = 0.70          # 字幕にする文(Whisper の区切り)の、語の確信度の平均の下限。間違った字幕より、字幕なしを選ぶ
SUB_MIN_WORD = 0.10          # 1語でもこれを下回る文は出さない
SUB_MIN_SEC = 0.70           # これより短い文(相づち・単語の途中で切れた断片)は出さない
DEFAULT_SUB_STYLE = "clean"


def dedupe_repeats(words, min_chars=3):
    """直後に同じ言い回しが繰り返されるとき(「これは、これは何でしょう」)、後ろの繰り返しを取り除く。
    語(トークン)の境目が合うときだけ取り除く。読点・空白は無視して比べる"""
    import re
    out = list(words)
    for _ in range(4):
        text = "".join(w["w"] for w in out)
        starts, pos = [], 0
        for w in out:
            starts.append(pos)
            pos += len(w["w"])
        plain = [(i, ch) for i, ch in enumerate(text) if ch not in "、,，。 　"]
        s = "".join(ch for _, ch in plain)
        m = re.search(r"(.{%d,12}?)\1" % min_chars, s)
        if not m:
            break
        a, b = plain[m.start()][0], plain[m.start() + len(m.group(1)) - 1][0] + 1      # 取り除く範囲(最初のコピー。後ろに続く言葉を残す)
        drop = [i for i, w in enumerate(out) if starts[i] >= a and starts[i] + len(w["w"]) <= b + 1]      # 語の後ろの読点は一緒に外す
        covered = sum(len(out[i]["w"]) for i in drop)
        if not drop or covered < (b - a) - 3:                                          # 境目が合わない
            break
        out = [w for i, w in enumerate(out) if i not in drop]
    return out


def confident_words(clip, start, end, min_conf=SUB_MIN_CONF, min_word=SUB_MIN_WORD):
    """区間 [start, end] の中で、字幕にしてよい語を、文(Whisper の区切り)ごとのグループにして返す。確信度が高い文だけ。
    文の境目にある語は、重なりが最も大きい1つの文にだけ入れる(二重にならない)。戻り値: (グループのリスト, 出さなかった文の数)"""
    words = [w for w in (clip.get("words") or []) if start <= w["s"] and w["e"] <= end]
    sgs = [sg for sg in (clip.get("tsegments") or []) if sg["e"] > start and sg["s"] < end]
    groups = {i: [] for i in range(len(sgs))}
    for w in words:
        best, best_ov = None, 0.0
        for i, sg in enumerate(sgs):
            ov = min(w["e"], sg["e"]) - max(w["s"], sg["s"])
            if ov > best_ov:
                best, best_ov = i, ov
        if best is not None:
            groups[best].append(w)
    keep, dropped = [], 0
    for i in range(len(sgs)):
        ws = groups[i]
        if not ws:
            continue
        ps = [w["p"] for w in ws]
        if sum(ps) / len(ps) >= min_conf and min(ps) >= min_word and ws[-1]["e"] - ws[0]["s"] >= SUB_MIN_SEC:
            keep.append(ws)
        else:
            dropped += 1
    return keep, dropped


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


def render(clips, edl, out, work, music_track=None, subtitles_on=True, short=1080, subtitle_style=DEFAULT_SUB_STYLE):
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
    sub_dropped = 0
    if subtitles_on:
        evs = []
        st_fs = max(36, int(min(w, h) * 0.05))
        for (a, b), s in zip(timeline, segs):                  # 出力の区間ごとに作り、区間をまたいで字幕を出さない
            groups, dr = confident_words(by[s["clip"]], s["start"], s["end"])
            sub_dropped += dr
            fpath = subtitles.STYLES[subtitle_style]["font_path"] if subtitle_style else None
            for kept in groups:                                # 文ごとに別の字幕にする(複数の文を1つに詰め込まない)
                kept = dedupe_repeats(kept)
                words = [dict(wd, s=wd["s"] - s["start"] + a, e=min(wd["e"] - s["start"] + a, b)) for wd in kept]
                for e in subtitles.build_events(words, lambda x: x, w, st_fs, 4, int(w * 0.06), font_path=fpath) if words else []:
                    e["e"] = min(e["e"], b)
                    if e["e"] - e["s"] > 0.2:
                        evs.append(e)
        evs.sort(key=lambda e: e["s"])
        for e1, e2 in zip(evs, evs[1:]):                       # 字幕どうしを重ねない
            e1["e"] = min(e1["e"], e2["s"] - 0.02)
        evs = [e for e in evs if e["e"] - e["s"] > 0.2]
        if evs:
            ass = os.path.join(work, "subs.ass")
            with open(ass, "w", encoding="utf-8") as f:
                f.write(subtitles.to_ass([dict(s=e["s"], e=e["e"], lines=e["lines"]) for e in evs], w, h, st_fs, 4,
                                         int(w * 0.06), int(h * 0.08), style=subtitle_style))
    vf = ["-vf", "ass=subs.ass"] if ass else []
    tmp = os.path.abspath(out) + ".part.mp4"
    proc.run(["ffmpeg", "-y", "-v", "error", "-i", os.path.abspath(video), "-f", "f32le", "-ar", str(sr), "-ac", "2",
              "-i", os.path.abspath(wav), *vf, "-af", "alimiter=limit=0.84:level=false",
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
              "-movflags", "+faststart", "-shortest", tmp], timeout=1200, mem_limit_mb=3000, cwd=work if ass else None)
    os.replace(tmp, out)
    return {"size": [w, h], "duration": round(total, 3), "segments": len(segs), "subtitles": bool(ass),
            "subtitle_sentences_dropped_low_confidence": sub_dropped,
            "subtitle_events": [(round(e["s"], 2), round(e["e"], 2), "/".join(e["lines"])) for e in (evs if subtitles_on else [])]}
