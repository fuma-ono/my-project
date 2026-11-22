"""ハイライト PoC: 複数の動画から、AI が最高の1本を自動で作る(品質検証用)

  python tools/highlight_poc.py <動画フォルダ または 動画ファイル...> -o <出力フォルダ> [--target 秒] [--mood bright|calm|emotional]
                                [--no-transcribe] [--model small]

出力フォルダ:
  highlight.mp4      完成動画
  edl.json           編集決定リスト(採用した区間・順番・理由、採用しなかった候補と理由)
  report.md          人が評価するためのシート(採用・不採用の一覧、処理時間、原価、評価の記入欄)
  contact_sheet.jpg  採用した区間の代表フレーム一覧
外部 API は使わない(費用0円)。CPU のみ。
"""
import argparse
import glob
import json
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vae import proc  # noqa: E402
from vae.highlight import analyze as an  # noqa: E402
from vae.highlight import music, planner  # noqa: E402
from vae.highlight import render as hr  # noqa: E402
from vae.highlight.models import dump  # noqa: E402

VIDEO_EXT = (".mp4", ".mov", ".m4v", ".mkv", ".webm")


def cpu():
    a, b = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    return a.ru_utime + a.ru_stime + b.ru_utime + b.ru_stime


def contact_sheet(clips, segs, out, work):
    by = {c["idx"]: c for c in clips}
    os.makedirs(work, exist_ok=True)
    thumbs = []
    for i, s in enumerate(segs):
        p = os.path.join(work, f"thumb{i:03d}.jpg")
        mid = s["start"] + s["dur"] / 2
        proc.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{mid:.2f}", "-i", by[s["clip"]]["path"], "-frames:v", "1",
                  "-vf", "scale=240:240:force_original_aspect_ratio=decrease,pad=240:240:(ow-iw)/2:(oh-ih)/2,"
                  f"drawtext=text='{i + 1}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6", p], timeout=60)
        thumbs.append(p)
    if not thumbs:
        return None
    cols = min(6, len(thumbs))
    rows = (len(thumbs) + cols - 1) // cols
    lst = os.path.join(work, "thumbs.txt")
    with open(lst, "w") as f:
        f.write("\n".join(f"file '{t}'" for t in thumbs) + "\n")
    proc.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", f"tile={cols}x{rows}",
              "-frames:v", "1", out], timeout=120)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--target", type=float)
    ap.add_argument("--mood", choices=list(music.MOODS))
    ap.add_argument("--no-transcribe", action="store_true")
    ap.add_argument("--model", default="medium")           # small は雑音のある会話で崩れた(2026-11-22)。既定は medium
    ap.add_argument("--short", type=int, default=1080)
    ap.add_argument("--subtitle-style", default="clean", help="字幕の見た目: none(字幕なし)/clean(標準)/pop(ポップ)/box(帯)/all(3つとも作って見比べる)")
    ap.add_argument("--manifest", help="stock_dataset.py の台帳(manifest.json)。ストック動画には撮影日時が無いので、台帳の順を"
                                       "擬似の撮影順(15分おき)として使う。擬似であることを Sonnet にも伝え、評価シートにも書く")
    ap.add_argument("--llm", choices=["off", "dry", "run"], default="off",
                    help="Sonnet 5.5 による構成判断との比較。dry は送らずに見積もりだけ、run は1回だけ実際に送る(予算 500 円の上限つき。"
                         "API キーは環境変数 ANTHROPIC_API_KEY)")
    a = ap.parse_args(argv)
    files = []
    for x in a.inputs:
        files += sorted(p for p in glob.glob(os.path.join(x, "*")) if p.lower().endswith(VIDEO_EXT)) if os.path.isdir(x) else [x]
    if not files:
        sys.exit("動画がありません")
    os.makedirs(a.out, exist_ok=True)
    work = tempfile.mkdtemp(prefix="vae_hl_")
    t = {}
    t0, c0 = time.time(), cpu()
    try:
        from vae import vad
        tr = None
        if not a.no_transcribe:
            from vae.transcribe import WhisperTranscriber
            tr = WhisperTranscriber(a.model, deterministic=True)
        analyzer = an.Analyzer(transcriber=tr, vad_fn=lambda x: vad.speech_vad(x, 0.5, 0.4))
        t["model_load"] = time.time() - t0
        clips = []
        for i, f in enumerate(files):
            print(f"[{i + 1}/{len(files)}] 解析: {os.path.basename(f)}", file=sys.stderr, flush=True)
            clips.append(analyzer.clip_file(f, i))
        if a.manifest:
            with open(a.manifest, encoding="utf-8") as mf:
                order = {os.path.basename(it["file"]): k for k, it in enumerate(json.load(mf)["items"])}
            for c in clips:
                c["created"] = 1_700_000_000 + order.get(c["name"], len(order)) * 900.0
                c["created_source"] = "simulated(台帳の順)"
        t["analyze"] = time.time() - t0 - t["model_load"]
        t1 = time.time()
        first = planner.plan(clips, target=a.target, mood=a.mood)
        mood = a.mood or first["mood"]
        track, beats, downbeats, bpm = music.generate(first["target_sec"] * 1.5 + 10, mood)
        edl = planner.plan(clips, target=first["target_sec"], mood=mood, beat=60.0 / bpm)
        edl["bpm"] = bpm
        t["plan"] = time.time() - t1
        t2 = time.time()
        out = os.path.join(a.out, "highlight.mp4")
        main_style = "clean" if a.subtitle_style == "all" else a.subtitle_style
        info = hr.render(clips, edl, out, os.path.join(work, "render"), music_track=track, short=a.short,
                         subtitle_style=None if main_style == "none" else main_style, subtitles_on=main_style != "none")
        if a.subtitle_style == "all":                        # 字幕の見た目の比較用(同じ編集で、字幕だけ変える)
            from vae.highlight.render import subtitles as _subs
            for name in _subs.STYLES:
                vp = os.path.join(a.out, f"highlight_style_{name}.mp4")
                hr.render(clips, edl, vp, os.path.join(work, f"render_{name}"), music_track=track, short=a.short, subtitle_style=name)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{info['duration'] * 0.8:.2f}", "-i", vp, "-frames:v", "1",
                                "-vf", "scale=720:-2", os.path.join(a.out, f"style_{name}.png")], check=False)
        t["render"] = time.time() - t2
        contact_sheet(clips, edl["segments"], os.path.join(a.out, "contact_sheet.jpg"), work)
        llm_edl, llm_info = None, None
        if a.llm != "off":
            from vae.highlight import planner_llm
            cands = planner.candidates(clips)
            llm_edl, llm_info = planner_llm.plan_with_llm(clips, cands, run=(a.llm == "run"), beat=60.0 / bpm,
                                                          purpose="compare_free_vs_sonnet")
            if llm_edl:
                t3 = time.time()
                hr.render(clips, dict(llm_edl, mood=mood), os.path.join(a.out, "highlight_sonnet.mp4"),
                          os.path.join(work, "render_llm"), music_track=track, short=a.short,
                          subtitle_style=None if main_style == "none" else main_style, subtitles_on=main_style != "none")
                t["render_sonnet"] = time.time() - t3
                contact_sheet(clips, llm_edl["segments"], os.path.join(a.out, "contact_sheet_sonnet.jpg"), work + "/s")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    total, cpu_s = time.time() - t0, cpu() - c0
    src_total = sum(c["duration"] for c in clips)
    edl["metrics"] = planner.metrics(clips, edl, 60.0 / bpm)
    if llm_edl:
        llm_edl["metrics"] = planner.metrics(clips, llm_edl, 60.0 / bpm)
    edl.update(render=info, timings_sec={k: round(v, 1) for k, v in t.items()}, total_sec=round(total, 1),
               cpu_sec=round(cpu_s, 1), source_total_sec=round(src_total, 1), n_clips=len(clips), external_cost_jpy=0,
               python_peak_mb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
    dump(edl, os.path.join(a.out, "edl.json"))
    write_report(clips, edl, os.path.join(a.out, "report.md"))
    if llm_info is not None:
        dump({"info": llm_info, "edl": llm_edl}, os.path.join(a.out, "edl_sonnet.json"))
        write_compare(clips, edl, llm_edl, llm_info, os.path.join(a.out, "compare.md"))
        print(json.dumps({"llm": {k: llm_info.get(k) for k in ("sent", "estimate", "spent_jpy", "cap_jpy", "problems")}}, ensure_ascii=False))
    print(json.dumps({k: edl[k] for k in ("n_clips", "source_total_sec", "total_sec", "cpu_sec", "target_sec", "mood", "bpm")}
                     | {"output_sec": info["duration"], "segments": info["segments"]}, ensure_ascii=False))


def write_compare(clips, free, llm, info, path):
    L = ["# 無料版(規則)と Sonnet 5.5 の比較", ""]
    u = info.get("usage")
    L += [f"- API 費用の予算: 累計 {info['spent_jpy']} 円 / 上限 {info['cap_jpy']:.0f} 円",
          f"- 見積もり(最悪): {info['estimate']['jpy_worst']} 円(入力 約{info['estimate']['input_tokens_est']}トークン、画像 {info['estimate']['images']} 枚、出力の上限 "
          f"{info['estimate']['output_tokens_max']}トークン)"]
    if not info.get("sent"):
        L += ["", "**送信していません(dry-run)。** 実行するには `--llm run`(1回だけ送ります)。"]
    elif u:
        L += [f"- 実際の使用量: 入力 {u.get('input_tokens')}・出力 {u.get('output_tokens')} トークン、"
              f"推定費用 {u.get('usd')} ドル = 約 {u.get('jpy')} 円、所要 {u.get('seconds')} 秒、状態 {u.get('status')}"]
    if llm:
        L += ["", f"## Sonnet の構成の考え方", "", llm.get("story", ""), "",
              "| # | 動画 | 元の時刻 | 長さ | 場面 | 役割 | 理由 |", "|---|---|---|---|---|---|---|"]
        for i, s in enumerate(llm["segments"]):
            L.append(f"| {i + 1} | {s['name']} | {s['start']:.1f}〜{s['end']:.1f} | {s['dur']:.1f} | {s['cat_ja']} | {s.get('role', '')} | {s['reason']} |")
        fk = {(s["clip"], round(s["start"])) for s in free["segments"]}
        lk = {(s["clip"], round(s["start"])) for s in llm["segments"]}
        L += ["", "## 違い", "",
              f"- 無料版: {len(free['segments'])} 区間 / {free['total_sec']} 秒。Sonnet: {len(llm['segments'])} 区間 / {llm['total_sec']} 秒",
              f"- 両方が選んだ区間: {len(fk & lk)}、無料版だけ: {len(fk - lk)}、Sonnet だけ: {len(lk - fk)}",
              f"- 使った動画の数: 無料版 {len({s['clip'] for s in free['segments']})} / Sonnet {len({s['clip'] for s in llm['segments']})}"]
        if llm.get("problems"):
            L += ["- Sonnet の出力で捨てたもの: " + "; ".join(llm["problems"])]
    elif info.get("problems"):
        L += ["", "Sonnet の出力は使えませんでした: " + "; ".join(info["problems"])]
    mf, ml = free.get("metrics"), (llm or {}).get("metrics")
    if mf:
        def row(label, key, fmt="{}"):
            return f"| {label} | {fmt.format(mf.get(key))} | {fmt.format(ml.get(key)) if ml else '-'} |"
        L += ["", "## 客観指標(同じ物差しで測った値。好み・聴感・満足度は測れません)", "", "| 指標 | 無料版 | Sonnet 版 |", "|---|---|---|",
              row("区間の数", "segments"), row("完成の長さ(秒)", "total_sec"),
              row("使った動画の数", "clips_used"), row("機械評価の平均(全体の平均 " + str(mf.get("pool_mean_score")) + ")", "mean_score"),
              row("欠陥のある区間(暗い・ぶれ・白飛び)", "defect_segments"), row("ほぼ同じ場面の組", "near_duplicate_pairs"),
              row("会話が途中で切れた区間", "speech_cut_segments"), row("場面の種類の数", "categories_used"),
              row("拍とのずれ(拍の何倍か、0 が理想)", "beat_error"), row("冒頭の区間の評価順位(1 が最高)", "opens_with_score_rank"),
              row("景色で締めているか", "ends_with_scenery")]
    L += ["", "## 6項目の評価(根拠の種類を分けて記入)", "",
          "| 項目 | 無料版 | Sonnet 版 | 根拠 |", "|---|---|---|---|",
          "| 見どころの選択 | | | 客観指標(機械評価)+ 完成動画・コンタクトシートの目視 |",
          "| 不要シーンの除外 | | | 客観指標(欠陥・重複)+ 目視 |",
          "| ストーリーの自然さ | | | 目視と構成の説明(撮影順は擬似の場合あり) |",
          "| カットのタイミング | | | 客観指標(拍とのずれ・会話の切断)。動きとして自然かは視聴が必要 |",
          "| BGM との相性 | | | **聴感は未確認**(拍の同期は指標のみ) |",
          "| 完成動画の満足度 | | | **視聴者の判断が必要**(ストック動画は実動画の品質と同一視しない) |", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def write_report(clips, edl, path):
    L = ["# ハイライト PoC 評価シート", "",
         f"- 素材: {edl['n_clips']} 本、合計 {edl['source_total_sec']:.1f} 秒 → 完成 {edl['render']['duration']:.1f} 秒"
         f"({edl['render']['segments']} 区間、{edl['render']['size'][0]}x{edl['render']['size'][1]})",
         f"- 雰囲気: {edl['mood']}(BGM {edl['bpm']} BPM、PoC 用の自動生成の音楽)",
         f"- 処理時間: 全体 {edl['total_sec']} 秒(CPU {edl['cpu_sec']} 秒)。内訳 {edl['timings_sec']}",
         f"- 外部費用: 0円(すべてローカル処理)",
         *(["- **撮影順は擬似**(ストック動画に撮影日時が無いため、台帳の順を15分おきの時刻として使用)"]
           if any(str(c["created_source"]).startswith("simulated") for c in clips) else []), "",
         "## 採用した区間(完成動画の順)", "", "| # | 動画 | 元の時刻 | 長さ | 場面 | 顔 | 会話 | 評価 | 理由 |", "|---|---|---|---|---|---|---|---|---|"]
    for i, s in enumerate(edl["segments"]):
        L.append(f"| {i + 1} | {s['name']} | {s['start']:.1f}〜{s['end']:.1f} | {s['dur']:.1f} | {s['cat_ja']} | {s['faces']} | "
                 f"{'あり' if s['speech'] else ''} | {s['score']:.2f} | {s['reason']} |")
    L += ["", "## 使わなかった候補", "", "| 動画 | 元の時刻 | 場面 | 評価 | 理由 |", "|---|---|---|---|---|"]
    for s in sorted(edl["rejected"], key=lambda s: (s["clip"], s["start"])):
        L.append(f"| {s['name']} | {s['start']:.1f}〜{s['end']:.1f} | {s['cat_ja']} | {s['score']:.2f} | {s['reason']} |")
    used = {s["clip"] for s in edl["segments"]}
    L += ["", f"## 素材の使用状況: {len(used)} / {len(clips)} 本を使用", ""]
    for c in clips:
        L.append(f"- {c['name']}: {c['duration']:.1f}秒、撮影日時の出典 {c['created_source']}、"
                 f"{'使用' if c['idx'] in used else '未使用'}、解析 {c['analyze_sec']} 秒")
    L += ["", "## 人による評価(記入欄)", "",
          "| 項目 | 評価(1〜5) | メモ |", "|---|---|---|",
          "| 映像の内容を正しく理解しているか | | |", "| 本当に良い場面を選んでいるか | | |",
          "| 不要な部分を削れているか | | |", "| 自然な流れ(ストーリー)になっているか | | |",
          "| BGM と映像のタイミングが合っているか | | |", "| 見て驚き・満足を感じるか | | |", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


if __name__ == "__main__":
    main()
