"""AI 編集の品質評価ライブラリ。

エンジン(planner)自身の評価値ではなく、完成した動画と元素材の物理的な測定値(明るさ・鮮明さ・動き・音量・時刻)から、
独立した物差しで測る。測れないもの(好み・聴感・満足度・音楽の相性)は、測ったふりをせず「人の評価が必要」とする。
書き出しの成功(integrity)は品質ではなく、前提条件(gate)として分けて扱う。

軸ごとの自動指標は 0〜5 点で表す。点数の規則は RUBRIC(docs/autonomous-hq/QUALITY_EVAL.md に同じ表)。
閾値は暫定で、Owner の承認で確定する。
"""
import math
import re

import numpy as np

from . import proc

FPS = 2.0                       # 解析(vae.highlight.analyze.FPS)と同じ: 元素材のフレーム番号 → 秒
AXES = ["understanding", "best_scene", "story", "cut_tempo", "effects", "audio", "subtitles", "finish", "overall"]
AXIS_JA = {"understanding": "映像・内容の理解", "best_scene": "ベストシーンの選択", "story": "ストーリー構成",
           "cut_tempo": "カット・テンポ", "effects": "演出・トランジション", "audio": "音楽・音声との調和",
           "subtitles": "字幕・テロップ", "finish": "映像の仕上がり", "overall": "完成動画としての総合品質"}
HUMAN_ONLY = {"understanding": "映像の内容を正しく理解して選んでいるか", "best_scene": "本当に見どころを選んでいるか",
              "story": "流れが自然で、見たくなる構成か", "cut_tempo": "カットの切れ目・テンポが気持ちよいか",
              "effects": "演出・つなぎが映像を引き立てているか", "audio": "BGM の相性・声の聞き取りやすさ(聴感)",
              "subtitles": "字幕の内容の正しさ・見た目・タイミング", "finish": "色・明るさ・画面の見栄え",
              "overall": "見て驚き・満足を感じるか(プロの編集者が作ったと言えるか)"}

# 演出の機能一覧(実装されていれば True)。機能を足したら、ここも更新する。
EFFECT_CAPABILITIES = {
    "ハードカット": True, "拍に合わせたカット": True, "冒頭のフェードイン": True, "終わりのフェードアウト": True,
    "BGM のダッキング(会話のとき下げる)": True, "縦横のちがいをぼかした背景で埋める": True,
    "クロスフェード・ディゾルブ": False, "J カット・L カット(音を先行・遅延)": False, "ズーム・パン(Ken Burns)": False,
    "スロー・速度変化": False, "タイトル・テロップ(字幕以外)": False, "色の統一(カラーマッチ)": False,
    "手ブレ補正": False, "拍に乗せた場面転換の演出(フラッシュ等)": False,
}


def lin(x, bad, good):
    """x が bad のとき 0 点、good のとき 5 点(線形、範囲外は丸める)。bad > good でもよい(小さいほど良い指標)"""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return round(5.0 * min(1.0, max(0.0, (x - bad) / (good - bad))), 2)


def ind(name, value, score, rule, unit=""):
    return {"name": name, "value": value, "score": score, "rule": rule, "unit": unit}


def axis_score(inds):
    s = [i["score"] for i in inds if i["score"] is not None]
    return {"score": round(float(np.mean(s)), 2) if s else None, "n": len(s), "indicators": inds}


# ───────────────────────── 書き出しの前提(gate): 品質ではない ─────────────────────────
def integrity(path, verify_fn):
    """全フレームが復号でき、映像と音声の長さが合い、True Peak が上限内か。通っても、品質が良いとは限らない"""
    try:
        proc.run_stderr(["ffmpeg", "-v", "error", "-nostats", "-i", path, "-f", "null", "-"], timeout=1800)
        decode_ok = True
    except Exception:
        decode_ok = False
    v = verify_fn(path)
    return {"decode_ok": decode_ok, "verify_ok": bool(v.get("ok")), "checks": v.get("checks"),
            "width": v.get("width"), "height": v.get("height"), "fps": v.get("fps"), "video_sec": v.get("video_sec"),
            "audio_sec": v.get("audio_sec"), "av_diff_sec": v.get("av_diff_sec"), "ok": decode_ok and bool(v.get("ok"))}


# ───────────────────────── 出力動画の測定 ─────────────────────────
def read_gray(path, fps, size=(160, 90), timeout=900):
    w, h = size
    raw = proc.run_bytes(["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={fps},scale={w}:{h}:flags=area", "-an",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"], timeout=timeout)
    n = len(raw) // (w * h)
    return np.frombuffer(raw[:n * w * h], np.uint8).reshape(n, h, w).astype(np.float32)


def black_freeze(path):
    """出力の黒フレーム・静止(同じ画が続く)の合計秒"""
    err = proc.run_stderr(["ffmpeg", "-nostats", "-i", path, "-an", "-vf", "blackdetect=d=0.3:pix_th=0.10,freezedetect=n=-60dB:d=1.0",
                           "-f", "null", "-"], timeout=1800)
    black = sum(float(x) for x in re.findall(r"black_duration:([\d.]+)", err))
    freeze = sum(float(x) for x in re.findall(r"lavfi\.freezedetect\.freeze_duration:\s*([\d.]+)", err))
    return {"black_sec": round(black, 2), "freeze_sec": round(freeze, 2)}


def repeated_footage(gray2fps, min_gap_sec=3.0, corr=0.985, min_std=8.0):
    """出力の中で、離れた時刻に、ほぼ同じ画が出ている秒数(同じ映像の繰り返し)。平らな画(黒など)は数えない"""
    n = len(gray2fps)
    if n < 2:
        return {"repeat_sec": 0.0, "pairs": []}
    f = gray2fps.reshape(n, -1)
    keep = f.std(axis=1) >= min_std
    z = (f - f.mean(axis=1, keepdims=True)) / (f.std(axis=1, keepdims=True) + 1e-6)
    c = (z @ z.T) / f.shape[1]
    gap = int(round(min_gap_sec * 2))
    flagged, pairs = set(), []
    for i in range(n):
        if not keep[i]:
            continue
        for j in range(i + gap, n):
            if keep[j] and c[i, j] > corr:
                flagged.update((i, j))
                pairs.append((round(i / 2, 1), round(j / 2, 1)))
    return {"repeat_sec": len(flagged) / 2.0, "pairs": pairs[:10]}


def luma_jumps(gray10fps, cut_times, fps=10, win=0.3, thr=40.0):
    """カットの前後 win 秒の平均の明るさの差。差が大きい = 場面ごとの明るさが不揃い"""
    luma = gray10fps.mean(axis=(1, 2))
    k = max(1, int(win * fps))
    out = []
    for t in cut_times:
        i = int(round(t * fps))
        if i - k < 0 or i + k > len(luma):
            continue
        out.append(abs(float(luma[i:i + k].mean() - luma[i - k:i].mean())))
    return {"jumps": [round(x, 1) for x in out], "share_over_thr": round(sum(1 for x in out if x > thr) / len(out), 3) if out else None}


def loudness(path):
    """ebur128: 統合音量・ラウドネスレンジ・True Peak と、400ms ごとの音量(M)の時系列"""
    e = proc.run_stderr(["ffmpeg", "-v", "verbose", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], timeout=1800)
    m = [(float(t), float(v)) for t, v in re.findall(r"t:\s*([\d.]+)\s.*?\sM:\s*(-?[\d.]+)", e)]       # 400ms ごと(verbose でのみ出る。TARGET: が間に入る)
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", e)
    lra = re.findall(r"LRA:\s+([\d.]+) LU", e)
    p = re.findall(r"Peak:\s+(-?(?:inf|[\d.]+)) dBFS", e)
    return {"integrated_lufs": float(i[-1]) if i else None, "lra": float(lra[-1]) if lra else None,
            "true_peak_dbtp": float(p[-1]) if p and "inf" not in p[-1] else None, "m_series": m}


def speech_prominence(m_series, timeline):
    """会話の区間と、それ以外の区間の、音量(M)の中央値の差(LU)。正なら会話が前に出ている。timeline: [(開始, 終了, 会話?)]"""
    sp, ot = [], []
    for t, v in m_series:
        if v < -70:
            continue
        seg = next((s for s in timeline if s[0] + 0.4 <= t < s[1]), None)
        if seg is not None:
            (sp if seg[2] else ot).append(v)
    if len(sp) < 5 or len(ot) < 5:
        return None
    return round(float(np.median(sp) - np.median(ot)), 1)


# ───────────────────────── 構成(EDL)と元素材の測定 ─────────────────────────
def timeline_of(edl):
    t, out = 0.0, []
    for s in edl["segments"]:
        out.append((round(t, 3), round(t + s["dur"], 3), bool(s.get("speech"))))
        t += s["dur"]
    return out


def cut_stats(edl, beat=None):
    d = [s["dur"] for s in edl["segments"]]
    cuts = [e for _, e, _ in timeline_of(edl)][:-1]
    beat_err = None
    if beat and cuts:
        beat_err = round(float(np.mean([abs(t / beat - round(t / beat)) for t in cuts])), 3)    # 拍からのずれ(拍の何割か)
    return {"n_segments": len(d), "n_cuts": len(cuts), "median_sec": round(float(np.median(d)), 2) if d else None,
            "mean_sec": round(float(np.mean(d)), 2) if d else None, "min_sec": round(min(d), 2) if d else None,
            "short_share": round(sum(1 for x in d if x < 2.0) / len(d), 3) if d else None, "beat_error": beat_err,
            "cut_times": cuts}


def same_clip_overlap(edl):
    """同じ動画の同じ時間帯を、2回以上使っている秒数"""
    segs = sorted(edl["segments"], key=lambda s: (s["clip"], s["start"]))
    tot = 0.0
    for a, b in zip(segs, segs[1:]):
        if a["clip"] == b["clip"]:
            tot += max(0.0, a["end"] - b["start"])
    return round(tot, 3)


def straddled_source_cuts(clips, edl, margin=0.1):
    """区間の内側に、元動画の切り替わり(ハードカット)が入っている数"""
    by = {c["idx"]: c for c in clips}
    return sum(1 for s in edl["segments"] for t in by[s["clip"]].get("cuts", []) if s["start"] + margin < t < s["end"] - margin)


def speech_cuts(clips, edl, margin=0.2):
    """文字起こしの文の途中で、区間の始まり・終わりが切れている数(エンジンの VAD とは別の、ASR の文の区切りで測る)"""
    by = {c["idx"]: c for c in clips}
    n = 0
    for s in edl["segments"]:
        for sg in by[s["clip"]].get("tsegments") or []:
            if sg["e"] - sg["s"] < 0.5:
                continue
            for edge in (s["start"], s["end"]):
                if sg["s"] + margin < edge < sg["e"] - margin and sg["s"] < s["end"] and sg["e"] > s["start"]:
                    n += 1
    return n


def moment_quality(f):
    """瞬間の映像の質(0〜1)。エンジンの採点式とは別の重みで、明るさ・鮮明さ・安定・顔から作る独立した物差し"""
    expo = 1 - min(1.0, abs(f["bright"] - 118.0) / 118.0)
    sharp = min(1.0, math.log1p(max(f["sharp"], 0.0)) / math.log1p(300.0))
    steady = 1 - min(1.0, f["motion"] / 40.0)
    face = 1.0 if f.get("faces", 0) > 0 else 0.0
    return 0.35 * sharp + 0.30 * expo + 0.20 * steady + 0.15 * face


def is_unusable(f):
    return f["bright"] < 30 or f["bright"] > 235 or f["sharp"] < 8 or f["motion"] > 40


def _frames_of(c, start, end):
    ia, ib = int(start * FPS), max(int(start * FPS) + 1, int(math.ceil(end * FPS)))
    return c["frames"][ia:ib] or c["frames"][-1:]


def selection_stats(clips, edl):
    by = {c["idx"]: c for c in clips}
    pool = [moment_quality(f) for c in clips for f in c["frames"]]
    pool_sorted = np.sort(pool)
    sel_q, sel_bad, n_sel = [], 0, 0
    for s in edl["segments"]:
        for f in _frames_of(by[s["clip"]], s["start"], s["end"]):
            sel_q.append(moment_quality(f))
            sel_bad += is_unusable(f)
            n_sel += 1
    pct = [100.0 * np.searchsorted(pool_sorted, q) / len(pool_sorted) for q in sel_q] if pool else []
    pool_bad = sum(is_unusable(f) for c in clips for f in c["frames"])
    allf = [(f.get("score"), moment_quality(f)) for c in clips for f in c["frames"] if f.get("score") is not None]
    rho = None
    if len(allf) > 5:
        a = np.argsort(np.argsort([x for x, _ in allf]))
        b = np.argsort(np.argsort([y for _, y in allf]))
        rho = round(float(np.corrcoef(a, b)[0, 1]), 3)
    return {"selected_frames": n_sel, "unusable_selected_share": round(sel_bad / max(1, n_sel), 3),
            "pool_unusable_share": round(pool_bad / max(1, sum(len(c["frames"]) for c in clips)), 3),
            "lift_percentile": round(float(np.mean(pct)), 1) if pct else None, "scorer_agreement_spearman": rho}


def clip_usability(clips, usable_share=0.3):
    """元の動画ごとの『映像として使える』判定(使える秒の割合)。独立した物差し(is_unusable)"""
    out = {}
    for c in clips:
        fr = c["frames"]
        share = 1 - sum(is_unusable(f) for f in fr) / max(1, len(fr))
        out[c["idx"]] = {"name": c["name"], "usable_share": round(share, 3), "usable": share >= usable_share}
    return out


def story_stats(clips, edl, usability):
    used = {s["clip"] for s in edl["segments"]}
    usable = {k for k, v in usability.items() if v["usable"]}
    by = {c["idx"]: c for c in clips}
    meta = all(by[k].get("created_source") == "metadata" for k in used) and len(used) > 1
    order = [s["clip"] for s in edl["segments"]]
    chrono = None
    if meta:
        pairs = [(a, b) for a, b in zip(order, order[1:]) if a != b]
        chrono = round(sum(1 for a, b in pairs if by[a]["created"] <= by[b]["created"]) / len(pairs), 3) if pairs else None
    ratio = edl["total_sec"] / edl["target_sec"] if edl.get("target_sec") else None
    cats = [s.get("cat") for s in edl["segments"]]
    return {"usable_clips": len(usable), "usable_clips_used": len(usable & used), "unusable_clips_used": len(used - usable),
            "coverage_usable": round(len(usable & used) / len(usable), 3) if usable else None,
            "chronology_adjacent_ok": chrono, "chronology_note": None if meta else "撮影日時が使えない(1 本・擬似・更新日時のみ)ため未測定",
            "length_ratio_to_target": round(ratio, 3) if ratio else None, "categories_used": len(set(cats)),
            "orientation_mixed": len({(by[s["clip"]]["height"] > by[s["clip"]]["width"]) for s in edl["segments"]}) > 1}


def subtitle_stats(events, timeline, size_h=None):
    """events: [(開始, 終了, '行1/行2')]。会話の秒数(出力)に対する、字幕で覆えた割合と、規則違反"""
    sp_sec = sum(e - s for s, e, sp in timeline if sp)
    n = len(events)
    short = sum(1 for s, e, _ in events[:-1] if e - s < 0.8)
    overlap = sum(1 for (s1, e1, _), (s2, e2, _) in zip(events, events[1:]) if e1 > s2 + 1e-6)
    cps = [len(t.replace("/", "")) / max(1e-3, e - s) for s, e, t in events]
    cov = sum(e - s for s, e, _ in events) / sp_sec if sp_sec else None
    return {"n_events": n, "speech_sec": round(sp_sec, 2), "covered_share": round(cov, 3) if cov is not None else None,
            "too_short": short, "overlaps": overlap, "max_chars_per_sec": round(max(cps), 1) if cps else None}


def cer(ref, hyp):
    """文字誤り率(空白・句読点を除いて比較)。台本(正解)がある場合だけ使う"""
    norm = lambda s: re.sub(r"[\s、。,.，．!?！？「」『』]", "", s)
    r, h = norm(ref), norm(hyp)
    if not r:
        return None
    d = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        prev, d[0] = d[0], i
        for j, hc in enumerate(h, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (rc != hc))
            prev, d[j] = d[j], cur
    return round(d[len(h)] / len(r), 3)


def cer_events(ref, texts):
    """出した字幕それぞれを、台本の『一部』と照合した文字誤り率(誤り文字数 ÷ 字幕の文字数)。
    編集で台本の一部を使わなかった場合に、使わなかった部分を誤りとして数えない(使わなかった割合は別の指標で見る)"""
    norm = lambda s: re.sub(r"[\s、。,.，．!?！？「」『』/]", "", s)
    r = norm(ref)
    edits = total = 0
    for t in texts:
        h = norm(t)
        if not h or not r:
            continue
        d = [0] * (len(r) + 1)                                    # 台本の途中から始めてよい(最初の行は 0)
        for i, hc in enumerate(h, 1):
            prev, d[0] = d[0], i
            for j, rc in enumerate(r, 1):
                cur = min(d[j] + 1, d[j - 1] + 1, prev + (hc != rc))
                prev, d[j] = d[j], cur
        edits += min(d)                                           # 台本の途中で終わってよい(最小の列)
        total += len(h)
    return round(edits / total, 3) if total else None


# ───────────────────────── 軸ごとの採点(RUBRIC) ─────────────────────────
def score_axes(m, labels=None):
    """m: 測定値の dict。戻り値: 軸ごとの {score(自動指標の平均), n, indicators}。人の評価が必要な軸は human_needed を付ける"""
    ax = {}
    # 1) 映像・内容の理解: 正解ラベルがあるときだけ測る(使える/使えない動画の見分け)
    inds = []
    if labels and m.get("clip_usability") is not None:
        exp = labels.get("clips", {})
        hit = tot = 0
        for k, v in m["clip_usability"].items():
            e = exp.get(v["name"])
            if e is None:
                continue
            tot += 1
            hit += (v["usable"] == (e["expected_video"] == "usable"))
        if tot:
            inds.append(ind("使える動画・使えない動画の見分けの一致率(ラベルとの比較)", round(hit / tot, 3), lin(hit / tot, 0.5, 1.0),
                            "ラベルと一致 100% で 5 点、50% 以下で 0 点", "割合"))
    ax["understanding"] = axis_score(inds)
    # 2) ベストシーンの選択
    s = m["selection"]
    ax["best_scene"] = axis_score([
        ind("使えない映像(黒・白飛び・ぼけ・大きなブレ)の混入率", s["unusable_selected_share"], lin(s["unusable_selected_share"], 0.2, 0.0), "0% で 5 点、20% 以上で 0 点", "割合"),
        ind("選んだ場面の質の順位(独立した物差し、素材全体の中での平均パーセンタイル)", s["lift_percentile"], lin(s["lift_percentile"], 50, 75), "75 以上で 5 点、50(平均)以下で 0 点", "%"),
    ])
    # 3) ストーリー構成
    st = m["story"]
    inds = [ind("同じ映像の繰り返し(出力内の離れた時刻の同じ画)", m["repeat"]["repeat_sec"], lin(m["repeat"]["repeat_sec"], 4.0, 0.0), "0 秒で 5 点、4 秒以上で 0 点", "秒"),
            ind("同じ動画の同じ時間帯を2回使った秒数", m["same_clip_overlap"], lin(m["same_clip_overlap"], 1.0, 0.0), "0 秒で 5 点", "秒"),
            ind("使えない動画を採用した数", st["unusable_clips_used"], lin(st["unusable_clips_used"], 2, 0), "0 本で 5 点、2 本以上で 0 点", "本")]
    if st["coverage_usable"] is not None:
        inds.append(ind("使える動画の採用率", st["coverage_usable"], lin(st["coverage_usable"], 0.4, 1.0), "100% で 5 点、40% 以下で 0 点", "割合"))
    if st["length_ratio_to_target"]:
        dev = abs(st["length_ratio_to_target"] - 1)
        inds.append(ind("完成の長さと目標の長さの差", round(dev, 3), lin(dev, 0.6, 0.15), "差 15% 以内で 5 点、60% 以上で 0 点", "割合"))
    if st["chronology_adjacent_ok"] is not None:
        inds.append(ind("撮影順どおりの並び(隣り合う動画のつなぎ)", st["chronology_adjacent_ok"], lin(st["chronology_adjacent_ok"], 0.5, 1.0), "100% で 5 点", "割合"))
    ax["story"] = axis_score(inds)
    # 4) カット・テンポ
    c = m["cuts"]
    med = c["median_sec"]
    med_score = 5.0 if med is not None and 2.5 <= med <= 6.0 else (lin(med, 1.0, 2.5) if med is not None and med < 2.5 else lin(med, 12.0, 6.0))
    inds = [ind("1 区間の長さの中央値", med, med_score, "2.5〜6 秒で 5 点、1 秒以下・12 秒以上で 0 点", "秒"),
            ind("2 秒未満の区間の割合", c["short_share"], lin(c["short_share"], 0.5, 0.0), "0% で 5 点、50% 以上で 0 点", "割合"),
            ind("元動画の切り替わりをまたぐ区間", m["straddle"], 5.0 if m["straddle"] == 0 else 0.0, "0 で 5 点、1 つでも 0 点", "個"),
            ind("文の途中で切れている数(ASR の文の区切り)", m["speech_cuts"], lin(m["speech_cuts"], 3, 0), "0 で 5 点、3 以上で 0 点", "個")]
    if c["beat_error"] is not None and c["n_cuts"]:
        inds.append(ind("カットの位置の、拍からのずれ", c["beat_error"], lin(c["beat_error"], 0.25, 0.05), "ずれ 0.05 拍以内で 5 点、0.25 拍以上で 0 点", "拍"))
    ax["cut_tempo"] = axis_score(inds)
    # 5) 演出・トランジション(機能の有無)
    impl = sum(EFFECT_CAPABILITIES.values())
    ax["effects"] = axis_score([ind("演出の機能の実装率(機能の一覧との比較)", f"{impl}/{len(EFFECT_CAPABILITIES)}", round(5.0 * impl / len(EFFECT_CAPABILITIES), 2),
                                    "実装数 ÷ 一覧の数 × 5", "機能")])
    # 6) 音楽・音声
    a = m["audio"]
    inds = [ind("True Peak", a["true_peak_dbtp"], lin(a["true_peak_dbtp"], 0.0, -1.0), "-1 dBTP 以下で 5 点、0 以上で 0 点", "dBTP"),
            ind("統合音量と目標(-16 LUFS)の差", None if a["integrated_lufs"] is None else round(abs(a["integrated_lufs"] + 16), 1),
                lin(None if a["integrated_lufs"] is None else abs(a["integrated_lufs"] + 16), 6, 2), "差 2 LU 以内で 5 点、6 LU 以上で 0 点", "LU"),
            ind("ラウドネスレンジ", a["lra"], lin(a["lra"], 14, 7), "7 LU 以下で 5 点、14 LU 以上で 0 点", "LU")]
    if a.get("speech_prominence") is not None:
        inds.append(ind("会話の区間とそれ以外の音量差", a["speech_prominence"], lin(a["speech_prominence"], 0, 6), "6 LU 以上で 5 点、0 以下で 0 点", "LU"))
    ax["audio"] = axis_score(inds)
    # 7) 字幕
    sb = m.get("subtitles")
    inds = []
    if sb and sb["speech_sec"] > 0:
        inds += [ind("字幕の規則違反(0.8 秒未満の表示・重なり)", sb["too_short"] + sb["overlaps"], lin(sb["too_short"] + sb["overlaps"], 3, 0), "0 で 5 点", "件"),
                 ind("会話の秒数のうち、字幕で覆えた割合", sb["covered_share"], lin(sb["covered_share"], 0.2, 0.7), "70% 以上で 5 点、20% 以下で 0 点", "割合")]
        if sb["max_chars_per_sec"] is not None:
            inds.append(ind("読む速さの最大(1 秒あたりの文字数)", sb["max_chars_per_sec"], lin(sb["max_chars_per_sec"], 12, 8), "8 字/秒以下で 5 点、12 以上で 0 点", "字/秒"))
        if m.get("cer") is not None:
            inds.append(ind("文字誤り率(台本との比較)", m["cer"], lin(m["cer"], 0.3, 0.05), "5% 以下で 5 点、30% 以上で 0 点", "割合"))
    ax["subtitles"] = axis_score(inds)
    # 8) 映像の仕上がり
    f = m["finish"]
    inds = [ind("黒フレームの合計", f["black_sec"], lin(f["black_sec"], 2.0, 0.0), "0 秒で 5 点、2 秒以上で 0 点", "秒"),
            ind("静止(同じ画が続く)の合計", f["freeze_sec"], lin(f["freeze_sec"], 2.0, 0.0), "0 秒で 5 点", "秒"),
            ind("暗すぎる時間の割合(平均の明るさ 35 未満)", f["dark_share"], lin(f["dark_share"], 0.5, 0.1), "10% 以下で 5 点、50% 以上で 0 点", "割合"),
            ind("カットでの明るさの段差(40 超)の割合", f["luma_jump_share"], lin(f["luma_jump_share"], 0.5, 0.0), "0% で 5 点、50% 以上で 0 点", "割合"),
            ind("出力の短辺の画素数", f["short_side"], lin(f["short_side"], 360, 1080), "1080 以上で 5 点、360 以下で 0 点", "px")]
    ax["finish"] = axis_score(inds)
    ax["overall"] = {"score": None, "n": 0, "indicators": []}
    for k in ax:
        ax[k]["human_needed"] = HUMAN_ONLY[k]
    return ax


def composite(axes):
    s = [v["score"] for k, v in axes.items() if k != "overall" and v["score"] is not None]
    return round(float(np.mean(s)), 2) if s else None
