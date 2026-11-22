#!/usr/bin/env python
"""AI 編集の品質評価: 同じ素材・同じ条件で再実行できる評価手順(無料・ローカル。外部 API は一切使わない)。

  make-synthetic OUT                合成素材(動作確認用)を OUT に生成する
  run SET OUT [オプション]           素材セット(eval/sets.json)を編集し、完成動画を独立した物差しで測る
  sheet OUT                         人の評価シート(評価の記入欄・証拠の場所)を作る
  compare A B                       2 回の評価(results.json)の差分(改善後の再評価)

書き出しの成功は『前提(gate)』であり、品質ではない。合成素材は『動作確認』、実動画は『品質評価』として分けて出す。
"""
import argparse
import glob
import hashlib
import json
import os
import pickle
import platform
import subprocess
import sys
import tempfile
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vae import proc, quality as q  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SETS = os.path.join(ROOT, "eval", "sets.json")
TESTDATA = os.environ.get("VAE_TESTDATA", "/root/vae-testdata")
UPLOADS = os.environ.get("VAE_UPLOADS", "/root/.claude/uploads/*")
SENTENCES = ["今日は、天気がとても良いので、公園に出かけました。", "桜の花が咲いていて、たくさんの人が集まっていました。", "帰りに、おいしいお団子を食べました。"]


def sha256(path, limit=None):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        left = limit
        while True:
            b = f.read(1 << 20 if left is None else min(1 << 20, left))
            if not b:
                break
            h.update(b)
            if left is not None:
                left -= len(b)
                if left <= 0:
                    break
    return h.hexdigest()[:16]


def git_info():
    def g(*a):
        try:
            return subprocess.check_output(["git", *a], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        except Exception:
            return None
    return {"sha": g("rev-parse", "HEAD"), "branch": g("rev-parse", "--abbrev-ref", "HEAD"), "dirty": bool(g("status", "--porcelain", "--", "vae", "tools", "eval"))}


def versions():
    out = {"python": platform.python_version(), "ffmpeg": (proc.run_text(["ffmpeg", "-version"]).splitlines() or ["?"])[0][:60]}
    for m in ("numpy", "cv2", "faster_whisper"):
        try:
            out[m] = __import__(m).__version__
        except Exception:
            out[m] = None
    return out


# ───────────────────────── 合成素材 ─────────────────────────
def make_synthetic(out):
    import soundfile as sf
    import pyopenjtalk
    os.makedirs(out, exist_ok=True)
    sr = 48000
    chunks = [np.zeros(int(sr * 0.8))]
    for s in SENTENCES:
        x, r = pyopenjtalk.tts(s)
        chunks += [x / 32768 * 0.5, np.zeros(int(sr * 0.6))]
    speech = np.concatenate(chunks).astype(np.float32)
    sf.write(os.path.join(out, "_speech.wav"), speech, sr)
    sd = len(speech) / sr

    def vid(name, src, dur, w, h, audio=None):
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-t", str(dur), "-i", f"{src}=s={w}x{h}:r=30"]       # 長さは入力側の -t(mandelbrot は d= を持たない)
        cmd += ["-i", audio] if audio else ["-f", "lavfi", "-i", f"sine=f=330:d={dur}"]
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", os.path.join(out, name)]
        subprocess.run(cmd, check=True)

    vid("syn_talk.mp4", "testsrc2", round(sd, 2), 1280, 720, os.path.join(out, "_speech.wav"))
    vid("syn_scene.mp4", "mandelbrot", 8, 1280, 720)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=8", "-f", "lavfi", "-i", "anoisesrc=d=8:a=0.01",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", os.path.join(out, "syn_black.mp4")], check=True)       # 真っ黒(使えない素材)
    vid("syn_dup.mp4", "mandelbrot", 8, 1280, 720)                                    # 同じ場面の撮り直し(syn_scene と同じ絵)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=1280x720:r=30:d=6", "-f", "lavfi", "-t", "6", "-i", "mandelbrot=s=1280x720:r=30",
                    "-f", "lavfi", "-i", "sine=f=262:d=12", "-filter_complex", "[1]trim=duration=6,setpts=PTS-STARTPTS[b];[0][b]concat=n=2:v=1:a=0[v]",
                    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", os.path.join(out, "syn_cut.mp4")], check=True)
    vid("syn_portrait.mp4", "smptebars", 8, 720, 1280)
    for i, n in enumerate(["syn_talk.mp4", "syn_scene.mp4", "syn_black.mp4", "syn_dup.mp4", "syn_cut.mp4", "syn_portrait.mp4"]):
        t = 1_700_000_000 + i * 900
        os.utime(os.path.join(out, n), (t, t))                                        # 更新日時で擬似の撮影順(15 分おき)
    with open(os.path.join(out, "references.json"), "w", encoding="utf-8") as f:
        json.dump({"syn_talk.mp4": "".join(SENTENCES)}, f, ensure_ascii=False)
    print(f"合成素材を作りました: {out}")


# ───────────────────────── 素材セットの読み込み ─────────────────────────
def resolve(entry):
    p = entry.get("path") or sorted(glob.glob(entry["glob"].replace("${VAE_UPLOADS}", UPLOADS)))[0]
    return os.path.expandvars(p.replace("${VAE_TESTDATA}", TESTDATA))


def load_set(set_id, synth_dir=None):
    sets = json.load(open(SETS, encoding="utf-8"))["sets"]
    if set_id not in sets:
        sys.exit(f"素材セットがありません: {set_id}(候補: {', '.join(sets)})")
    s = sets[set_id]
    if s["kind"] == "synthetic":
        d = synth_dir or os.path.join(tempfile.gettempdir(), "vae_syn1")
        if not os.path.exists(os.path.join(d, "references.json")):
            make_synthetic(d)
        files = [(n, os.path.join(d, n)) for n in ("syn_talk.mp4", "syn_scene.mp4", "syn_black.mp4", "syn_dup.mp4", "syn_cut.mp4", "syn_portrait.mp4")]
        s = dict(s, references=json.load(open(os.path.join(d, "references.json"), encoding="utf-8")))
    else:
        files = [(e["name"], resolve(e)) for e in s["clips"]]
    for n, p in files:
        if not os.path.exists(p):
            sys.exit(f"素材がありません: {n} → {p}")
    labels = json.load(open(os.path.join(ROOT, s["labels"]), encoding="utf-8")) if s.get("labels") else None
    return s, files, labels


def analyze_all(files, model, cache):
    """素材ごとの解析(キャッシュあり)。キャッシュの鍵: パス・サイズ・更新日時・文字起こしのモデル"""
    from vae import vad
    from vae.highlight import analyze as an
    clips, analyzer, t_model = [], None, 0.0
    for i, (name, path) in enumerate(files):
        st = os.stat(path)
        key = hashlib.sha256(f"{path}|{st.st_size}|{st.st_mtime_ns}|{model}|v1".encode()).hexdigest()[:20]
        cp = os.path.join(cache, key + ".pkl") if cache else None
        if cp and os.path.exists(cp):
            c = pickle.load(open(cp, "rb"))
            c["cache_hit"] = True
        else:
            if analyzer is None:
                t0 = time.time()
                from vae.transcribe import WhisperTranscriber
                analyzer = an.Analyzer(transcriber=WhisperTranscriber(model, deterministic=True), vad_fn=lambda x: vad.speech_vad(x, 0.5, 0.4))
                t_model = time.time() - t0
            print(f"[{i + 1}/{len(files)}] 解析: {name}", file=sys.stderr, flush=True)
            c = analyzer.clip_file(path, i)
            c["cache_hit"] = False
            if cp:
                os.makedirs(cache, exist_ok=True)
                pickle.dump({k: v for k, v in c.items() if k != "cache_hit"}, open(cp, "wb"))
        c["idx"], c["name"] = i, name
        clips.append(c)
    return clips, t_model


# ───────────────────────── 評価の実行 ─────────────────────────
def thumbs(video, times, out_png, h=240):
    import cv2
    ims = []
    for t in times:
        p = out_png + f".{len(ims)}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", f"scale=-2:{h}", p], check=False)
        if os.path.exists(p):
            ims.append(cv2.imread(p))
            os.remove(p)
    if ims:
        w = max(i.shape[1] for i in ims)
        cv2.imwrite(out_png, np.hstack([cv2.copyMakeBorder(i, 0, 0, 0, w - i.shape[1], cv2.BORDER_CONSTANT) for i in ims]))
        return out_png


def run(a):
    from vae.highlight import music, planner, render as hr
    from vae.render import verify
    t_all, cpu0 = time.time(), time.process_time()
    s, files, labels = load_set(a.set, a.synth_dir)
    os.makedirs(a.out, exist_ok=True)
    ev = os.path.join(a.out, "evidence")
    os.makedirs(ev, exist_ok=True)
    cfg = {"set": a.set, "kind": s["kind"], "model": a.model, "subtitles": a.subtitles, "target_sec": a.target, "short": a.short, "mood": None,
           "music_seed": 1, "llm": "off(外部 API は使わない)", "git": git_info(), "versions": versions(), "external_send": s.get("external_send"),
           "files": [{"name": n, "bytes": os.path.getsize(p), "sha256_first64MB": sha256(p, 64 << 20)} for n, p in files]}
    t = {}
    t0 = time.time()
    clips, t["model_load"] = analyze_all(files, a.model, None if a.no_cache else a.cache)
    t["analyze"] = round(time.time() - t0 - t["model_load"], 1)
    t1 = time.time()
    first = planner.plan(clips, target=a.target)
    mood = first["mood"]
    track, _, _, bpm = music.generate(first["target_sec"] * 1.5 + 10, mood)
    beat = 60.0 / bpm
    edl = planner.plan(clips, target=first["target_sec"], mood=mood, beat=beat)
    edl["bpm"] = bpm
    edl2 = planner.plan(clips, target=first["target_sec"], mood=mood, beat=beat)
    plan_identical = json.dumps(edl["segments"], default=str, sort_keys=True) == json.dumps(edl2["segments"], default=str, sort_keys=True)
    t["plan"] = round(time.time() - t1, 1)
    t2 = time.time()
    out_mp4 = os.path.join(a.out, "highlight.mp4")
    work = tempfile.mkdtemp(prefix="vae_qe_")
    try:
        info = hr.render(clips, edl, out_mp4, work, music_track=track, short=a.short, subtitles_on=a.subtitles != "none",
                         subtitle_style=None if a.subtitles == "none" else a.subtitles)
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
    t["render"] = round(time.time() - t2, 1)
    t3 = time.time()
    # ── 測定
    gate = q.integrity(out_mp4, verify)
    g10, g2 = q.read_gray(out_mp4, 10), q.read_gray(out_mp4, 2)
    tl = q.timeline_of(edl)
    cs = q.cut_stats(edl, beat)
    bf = q.black_freeze(out_mp4)
    lj = q.luma_jumps(g10, cs["cut_times"])
    L = q.loudness(out_mp4)
    usability = q.clip_usability(clips)
    sub = q.subtitle_stats(info["subtitle_events"], tl) if info.get("subtitles") else None
    cer = None
    refs = s.get("references")
    if refs and info.get("subtitle_events"):
        k = next(iter(refs))
        used = any(sg["clip"] == next(c["idx"] for c in clips if c["name"] == k) for sg in edl["segments"])
        if used:
            cer = q.cer_events(refs[k], [e[2] for e in info["subtitle_events"]])
    m = {"selection": q.selection_stats(clips, edl), "story": q.story_stats(clips, edl, usability), "repeat": q.repeated_footage(g2),
         "same_clip_overlap": q.same_clip_overlap(edl), "cuts": cs, "straddle": q.straddled_source_cuts(clips, edl), "speech_cuts": q.speech_cuts(clips, edl),
         "audio": {k: L[k] for k in ("integrated_lufs", "lra", "true_peak_dbtp")} | {"speech_prominence": q.speech_prominence(L["m_series"], tl)},
         "subtitles": sub, "subtitle_sentences_dropped_low_confidence": info.get("subtitle_sentences_dropped_low_confidence"), "cer": cer,
         "clip_usability": usability, "clips_used": sorted({clips[sg["clip"]]["name"] for sg in edl["segments"]}),
         "finish": {**bf, "dark_share": round(float((g10.mean(axis=(1, 2)) < 35).mean()), 3), "luma_jump_share": lj["share_over_thr"] or 0.0,
                    "luma_jumps": lj["jumps"], "short_side": min(info["size"])}}
    axes = q.score_axes(m, labels)
    t["measure"] = round(time.time() - t3, 1)
    # ── 動作確認(合成のみ): 期待される振る舞い
    functional = None
    if s.get("expectations"):
        ex, used = s["expectations"], {clips[sg["clip"]]["name"] for sg in edl["segments"]}
        functional = [{"check": f"{n} を除外する", "ok": n not in used} for n in ex["must_exclude"]]
        functional += [{"check": f"{n} を使う", "ok": n in used} for n in ex["must_use"]]
        functional += [{"check": f"{x} と {y} の両方を使わない(同じ場面の撮り直し)", "ok": not (x in used and y in used)} for x, y in ex["not_both"]]
        if cer is not None:
            functional.append({"check": f"字幕の文字誤り率 ≤ {ex['max_cer']}(台本あり)", "ok": cer <= ex["max_cer"], "value": cer})
        functional.append({"check": "書き出しの前提(gate)", "ok": gate["ok"]})
        functional.append({"check": "計画(EDL)が2回の計算で同一", "ok": plan_identical})
    # ── 証拠
    seg_mid = [(a_ + b_) / 2 for a_, b_, _ in tl]
    thumbs(out_mp4, seg_mid, os.path.join(ev, "segments.png"))
    if cs["cut_times"]:
        thumbs(out_mp4, [x for c_ in cs["cut_times"][:4] for x in (max(0, c_ - 0.2), c_ + 0.2)], os.path.join(ev, "around_cuts.png"), h=200)
    subs = info.get("subtitle_events") or []
    if subs:
        thumbs(out_mp4, [(x[0] + x[1]) / 2 for x in subs[:6]], os.path.join(ev, "subtitles.png"), h=300)
    by = {c["idx"]: c for c in clips}
    segs_out = [{"clip": by[sg["clip"]]["name"], "start": round(sg["start"], 2), "end": round(sg["end"], 2), "dur": round(sg["dur"], 2), "speech": sg["speech"],
                 "cat": sg.get("cat_ja"), "faces": sg.get("faces"), "reason": sg.get("reason"),
                 "unusable_share": round(float(np.mean([q.is_unusable(f) for f in q._frames_of(by[sg["clip"]], sg["start"], sg["end"])])), 2)} for sg in edl["segments"]]
    t["total"] = round(time.time() - t_all, 1)
    res = {"config": cfg, "timing_sec": t | {"cpu": round(time.process_time() - cpu0, 1)}, "plan_identical_twice": plan_identical, "integrity_gate": gate,
           "functional": functional, "axes": {k: {kk: vv for kk, vv in v.items()} for k, v in axes.items()}, "composite_auto": q.composite(axes),
           "metrics": {k: v for k, v in m.items() if k != "clip_usability"}, "clip_usability": usability, "segments": segs_out,
           "rejected": [{"clip": by[r["clip"]]["name"], "start": r["start"], "end": r["end"], "reason": r["reason"]} for r in edl["rejected"]],
           "subtitle_events": subs, "bpm": bpm, "mood": mood, "target_sec": edl["target_sec"], "output_sec": edl["total_sec"],
           "external_cost_jpy": 0}
    with open(os.path.join(a.out, "results.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, default=str)
    with open(os.path.join(a.out, "edl.json"), "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in edl.items() if k != "rejected"}, f, ensure_ascii=False, indent=1, default=str)
    write_report(res, os.path.join(a.out, "report.md"))
    print(json.dumps({"set": a.set, "gate_ok": gate["ok"], "composite_auto": res["composite_auto"],
                      "axes": {k: v["score"] for k, v in axes.items()}, "timing": res["timing_sec"],
                      "functional_failed": [f["check"] for f in functional if not f["ok"]] if functional else None}, ensure_ascii=False))


# ───────────────────────── レポート・評価シート・比較 ─────────────────────────
def fmt(v):
    return "—" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))


def write_report(res, path):
    c = res["config"]
    kind = {"synthetic": "合成(動作確認。編集品質の評価ではない)", "real": "実動画(品質評価)", "real-proxy": "実動画の代用(品質評価の参考。本物の複数素材の代わりにはならない)"}[c["kind"]]
    L = [f"# 品質評価レポート — {c['set']}", "", f"- 区分: **{kind}**", f"- コミット: `{c['git']['sha']}`(ブランチ {c['git']['branch']}、未コミットの変更: {c['git']['dirty']})",
         f"- 設定: 文字起こし {c['model']} / 字幕 {c['subtitles']} / 目標の長さ {c['target_sec'] or '自動'} / 外部 API: 使わない(外部費用 0 円)",
         f"- 完成: {res['output_sec']} 秒({len(res['segments'])} 区間、{res['bpm']} BPM、雰囲気 {res['mood']})。処理時間 {res['timing_sec']['total']} 秒(CPU {res['timing_sec']['cpu']} 秒)", "",
         "## 書き出しの前提(gate)— 品質ではない", "",
         f"- 判定: **{'合格' if res['integrity_gate']['ok'] else '不合格'}**(全フレーム復号 {res['integrity_gate']['decode_ok']}、映像と音声の長さの差 {res['integrity_gate']['av_diff_sec']} 秒、{res['integrity_gate']['width']}x{res['integrity_gate']['height']} {res['integrity_gate']['fps']})",
         "- **通っても、編集が良いとは限らない。** 以下が品質の評価。", ""]
    if res["functional"]:
        L += ["## 動作確認(合成素材の期待される振る舞い)", ""] + [f"- {'✅' if f['ok'] else '❌'} {f['check']}" + (f"(値 {f['value']})" if "value" in f else "") for f in res["functional"]] + [""]
    L += ["## 軸ごとのスコア(自動指標の平均、0〜5)", "", "| 軸 | 自動スコア | 指標数 | 人の評価(1〜5) | 人の目・耳が必要な点 |", "|---|---|---|---|---|"]
    for k in q.AXES:
        v = res["axes"][k]
        L.append(f"| {q.AXIS_JA[k]} | {fmt(v['score']) if v['score'] is not None else '自動では測れない'} | {v['n']} | 未入力 | {v['human_needed']} |")
    L += ["", f"自動指標だけの平均: **{fmt(res['composite_auto'])}**(総合品質の代わりではない。人の評価と合わせて判断する)", "", "## 指標の内訳", "",
          "| 軸 | 指標 | 値 | 点 | 規則 |", "|---|---|---|---|---|"]
    for k in q.AXES:
        for i in res["axes"][k]["indicators"]:
            L.append(f"| {q.AXIS_JA[k]} | {i['name']} | {fmt(i['value'])}{i['unit']} | {fmt(i['score'])} | {i['rule']} |")
    L += ["", "## 採用した区間", "", "| # | 動画 | 元の時刻 | 長さ | 場面 | 会話 | 使えない映像の割合 | 理由 |", "|---|---|---|---|---|---|---|---|"]
    for i, s in enumerate(res["segments"], 1):
        L.append(f"| {i} | {s['clip']} | {s['start']}〜{s['end']} | {s['dur']} | {s['cat']} | {'あり' if s['speech'] else ''} | {s['unusable_share']} | {s['reason']} |")
    L += ["", "## 素材ごとの判定(独立した物差し)", "", "| 動画 | 映像として使える割合 | 判定 | 完成動画で使ったか |", "|---|---|---|---|"]
    used = {s["clip"] for s in res["segments"]}
    for v in res["clip_usability"].values():
        L.append(f"| {v['name']} | {v['usable_share']} | {'使える' if v['usable'] else '使えない'} | {'使った' if v['name'] in used else '使わなかった'} |")
    probs = auto_problems(res)
    L += ["", "## 自動で検出した具体的な問題点", ""] + (["- " + p for p in probs] if probs else ["- (自動指標では検出されなかった。人の確認が必要)"])
    L += ["", "## 再現性", "", f"- 計画(EDL)が2回の計算で同一: {res['plan_identical_twice']}", "- 素材: " + "、".join(f"{f['name']}({f['bytes']}B, {f['sha256_first64MB']})" for f in c["files"]),
          f"- 環境: {c['versions']}", "- 証拠の画像: evidence/segments.png(各区間の中央)、around_cuts.png(カットの前後)、subtitles.png(字幕の例)"]
    open(path, "w", encoding="utf-8").write("\n".join(L) + "\n")


def auto_problems(res):
    P = []
    for k in q.AXES:
        for i in res["axes"][k]["indicators"]:
            if i["score"] is not None and i["score"] < 3.0:
                P.append(f"【{q.AXIS_JA[k]}】{i['name']}: {fmt(i['value'])}{i['unit']}({fmt(i['score'])} 点。{i['rule']})")
    for s in res["segments"]:
        if s["unusable_share"] > 0.2:
            P.append(f"使えない映像を採用: {s['clip']} の {s['start']}〜{s['end']} 秒(使えない割合 {s['unusable_share']})")
    for a_, b_ in res["metrics"]["repeat"]["pairs"][:5]:
        P.append(f"出力 {a_} 秒と {b_} 秒の画がほぼ同じ(同じ映像の繰り返しの疑い)")
    for v in res["clip_usability"].values():
        if not v["usable"] and v["name"] in {s["clip"] for s in res["segments"]}:
            P.append(f"使えないと判定した動画 {v['name']} を採用している")
    return P


def sheet(a):
    res = json.load(open(os.path.join(a.out, "results.json"), encoding="utf-8"))
    L = [f"# 人の評価シート — {res['config']['set']}", "", "完成動画: `highlight.mp4`(同じ場所)。証拠: `evidence/`。**見て・聞いて**から、1〜5 で付ける。迷ったら、理由を書く。", "",
         "採点の基準(全軸共通): **5** = プロの編集者が作ったと言われても違和感がない / **4** = 公開できる(気になる点が 1〜2) / **3** = 使えるが素人っぽい / **2** = 明らかな欠点が複数 / **1** = 使えない", "",
         "| 軸 | 見る点 | 点(1〜5) | 具体的な問題点(時刻・理由) |", "|---|---|---|---|"]
    for k in q.AXES:
        L.append(f"| {q.AXIS_JA[k]} | {q.HUMAN_ONLY[k]} | | |")
    L += ["", "字幕の内容の正しさを数値にするには、正しい台本を `references.json` に書く(動画ごとの文)。`vae.quality.cer` で文字誤り率を出せる。"]
    open(os.path.join(a.out, "rating_sheet.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("評価シートを書きました:", os.path.join(a.out, "rating_sheet.md"))


def compare(a):
    A, B = (json.load(open(os.path.join(x, "results.json"), encoding="utf-8")) for x in (a.a, a.b))
    L = [f"# 再評価の比較: {a.a} → {a.b}", "", f"- コミット: `{A['config']['git']['sha'][:8]}` → `{B['config']['git']['sha'][:8]}`", "",
         "| 軸 | 前 | 後 | 差 |", "|---|---|---|---|"]
    for k in q.AXES:
        x, y = A["axes"][k]["score"], B["axes"][k]["score"]
        L.append(f"| {q.AXIS_JA[k]} | {fmt(x)} | {fmt(y)} | {fmt(None if x is None or y is None else round(y - x, 2))} |")
    L += ["", f"自動指標の平均: {fmt(A['composite_auto'])} → {fmt(B['composite_auto'])}", "", "## 指標の変化", "", "| 指標 | 前 | 後 |", "|---|---|---|"]
    ia = {(k, i["name"]): i for k in q.AXES for i in A["axes"][k]["indicators"]}
    for k in q.AXES:
        for i in B["axes"][k]["indicators"]:
            o = ia.get((k, i["name"]))
            if o and o["score"] != i["score"]:
                L.append(f"| {i['name']} | {fmt(o['value'])}({fmt(o['score'])}) | {fmt(i['value'])}({fmt(i['score'])}) |")
    worse = [k for k in q.AXES if A["axes"][k]["score"] is not None and B["axes"][k]["score"] is not None and B["axes"][k]["score"] < A["axes"][k]["score"] - 0.2]
    L += ["", "**回帰(0.2 点超の悪化)**: " + ("、".join(q.AXIS_JA[k] for k in worse) if worse else "なし")]
    print("\n".join(L))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    s1 = sp.add_parser("make-synthetic")
    s1.add_argument("out")
    s2 = sp.add_parser("run")
    s2.add_argument("set")
    s2.add_argument("out")
    s2.add_argument("--subtitles", default="clean", choices=["clean", "pop", "box", "none"])
    s2.add_argument("--model", default="medium")
    s2.add_argument("--target", type=float)
    s2.add_argument("--short", type=int, default=1080)
    s2.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "vae_eval_cache"))
    s2.add_argument("--no-cache", action="store_true", help="解析のキャッシュを使わない(解析の再現性を確かめるとき)")
    s2.add_argument("--synth-dir")
    s3 = sp.add_parser("sheet")
    s3.add_argument("out")
    s4 = sp.add_parser("compare")
    s4.add_argument("a")
    s4.add_argument("b")
    a = ap.parse_args(argv)
    {"make-synthetic": lambda: make_synthetic(a.out), "run": lambda: run(a), "sheet": lambda: sheet(a), "compare": lambda: compare(a)}[a.cmd]()


if __name__ == "__main__":
    main()
