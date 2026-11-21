"""実動画の評価(QA)。製品エンジン(vae.pipeline)で処理し、評価シートと集計を出す。

    python tools/run_eval.py <動画フォルダ> <出力フォルダ> [--model medium] [--cut-mode vad]

出力:
  <出力>/<動画名>/output.mp4, plan.json, result.json, review.md
  <出力>/summary.md, summary.json
聴感(BGM の好み・カットの自然さ)は自動では判定しない。review.md に「未確認(オーナー試聴待ち)」と書く。
"""
import argparse
import json
import os
import re
import resource
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from vae import errors, media, pipeline, subtitles  # noqa: E402

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}


def ts(x):
    return f"{int(x // 60)}:{x % 60:05.2f}"


def subtitle_checks(plan):
    st = plan["subtitle_style"]
    meas = subtitles.Measurer(st["font_size"], st["outline"])
    maxw = plan["source"]["width"] - 2 * st["margin_lr"]
    out, end = [], plan["out_duration"]
    for e in plan["subtitles"]:
        why, joined = [], "".join(e["lines"])
        if e["e"] - e["s"] < 0.8 and e["e"] < end - 0.05:
            why.append(f"表示{e['e'] - e['s']:.2f}秒(短い)")
        if len(e["lines"]) > 2:
            why.append("3行以上")
        if any(meas.width(l) > maxw for l in e["lines"]):
            why.append("はみ出し")
        pos = 0
        for l in e["lines"][:-1]:
            pos += len(l)
            if any(a < pos < b for a, b in subtitles.protected_spans(joined)):
                why.append("数字・語の途中で改行")
        if re.search(r"[。？！?!](?=.)", joined):
            why.append("文の区切り漏れ")
        out.append(dict(e, why=why))
    return out


def review_md(name, info, plan, res, subs):
    m = res.get("mix_metrics", {})
    v = res["verify"]
    lines = [f"# 評価シート: {name}", "",
             f"- 元: {info.width}x{info.height} {info.fps}fps {info.duration:.2f}秒 / 音声 {info.acodec}",
             f"- 出力: {v['width']}x{v['height']} {v['fps']}fps {plan['out_duration']:.2f}秒(元の {plan['out_duration'] / info.duration * 100:.0f}%)",
             f"- 検証: {'合格' if v['ok'] else '不合格'} {v['checks']}",
             f"- ラウドネス {v['integrated_lufs']} LUFS / True Peak {v['true_peak_dbtp']} dBTP",
             f"- 声−BGM(発話中): 中央値 {m.get('diff_median')} / 下位5% {m.get('diff_p5')} / 最小 {m.get('diff_min')} LU、"
             f"BGM が声より大きい窓 {m.get('windows_bgm_louder')} / {m.get('speech_windows')}、下げ幅の揺れ {m.get('duck_std')} dB",
             f"- 処理時間 {res.get('total_seconds')}秒 {res.get('timings_sec')} / 書き出しの ffmpeg {res['render']['ffmpeg_peak_mb']}MB",
             f"- カット境界の段差(最大) {res.get('boundary_step_max')}", "",
             "## 言い淀みの候補と判定", "", "| 元の時刻 | 語 | 種類 | 確信度 | 判定 | 理由 |", "|---|---|---|---|---|---|"]
    lines += [f"| {ts(c['s'])} | {c['text']} | {c['kind']} | {c.get('confidence')} | {c['decision']} | {c['reason']} |"
              for c in plan["filler_candidates"]]
    lines += ["", f"## 字幕(自動チェックの要確認 {sum(bool(e['why']) for e in subs)}件)", "",
              "| # | 開始 | 表示秒 | テキスト | 自動チェック |", "|---|---|---|---|---|"]
    lines += [f"| {e['id']} | {ts(e['s'])} | {e['e'] - e['s']:.2f} | {' / '.join(e['lines'])} | {'、'.join(e['why'])} |" for e in subs]
    lines += ["", "## 聴感・見た目(自動では判定しない)", "",
              "未確認(オーナー試聴待ち): BGM の大きさの好み / カットの自然さ・発音の欠落 / 字幕と声のタイミング / 言い淀みの残り", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--model", default="medium")
    ap.add_argument("--cut-mode", default="vad")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    s = pipeline.Settings(model=a.model, cut_mode=a.cut_mode)
    rows = []
    for name in sorted(os.listdir(a.src)):
        if os.path.splitext(name)[1].lower() not in VIDEO_EXT:
            continue
        d = os.path.join(a.out, os.path.splitext(name)[0])
        os.makedirs(d, exist_ok=True)
        src = os.path.join(a.src, name)
        row = {"video": name}
        try:
            info = media.validate(src)
            plan, res = pipeline.run(src, os.path.join(d, "output.mp4"), os.path.join(d, "work"), s,
                                     bgm_cache=os.path.join(a.out, "bgm_cache"))
            subs = subtitle_checks(plan)
            open(os.path.join(d, "review.md"), "w", encoding="utf-8").write(review_md(name, info, plan, res, subs))
            m = res.get("mix_metrics", {})
            row.update(status="ok", src_sec=round(info.duration, 2), out_sec=plan["out_duration"], verify_ok=res["verify"]["ok"],
                       total_sec=res["total_seconds"], transcribe_sec=res["timings_sec"].get("transcribe"),
                       render_peak_mb=res["render"]["ffmpeg_peak_mb"], fillers_removed=sum(c["decision"] == "削除" for c in plan["filler_candidates"]),
                       filler_candidates=len(plan["filler_candidates"]), subtitle_issues=sum(bool(e["why"]) for e in subs),
                       diff_median=m.get("diff_median"), diff_p5=m.get("diff_p5"), bgm_louder=m.get("windows_bgm_louder"),
                       duck_std=m.get("duck_std"), lufs=res["verify"]["integrated_lufs"], true_peak=res["verify"]["true_peak_dbtp"])
        except errors.VAEError as e:
            row.update(status="error", error=e.to_dict())
        except Exception as e:  # noqa: BLE001
            row.update(status="failed", error=repr(e)[-300:])
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    row_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
    json.dump({"rows": rows, "python_peak_mb": row_peak, "model": a.model, "cut_mode": a.cut_mode},
              open(os.path.join(a.out, "summary.json"), "w"), ensure_ascii=False, indent=1)
    hdr = "| 動画 | 状態 | 元→出力(秒) | 検証 | 全体秒 | 文字起こし秒 | 書き出しMB | 言い淀み(削除/候補) | 字幕要確認 | 声−BGM(中央値/下位5%) | BGM>声の窓 | 揺れdB | LUFS | TP |"
    lines = ["# 実動画評価サマリー", "", f"- モデル {a.model} / カット {a.cut_mode} / Python 最大メモリ {row_peak}MB / 外部費用 0円", "",
             hdr, "|" + "---|" * (hdr.count("|") - 1)]
    for r in rows:
        if r["status"] != "ok":
            lines.append(f"| {r['video']} | {r['status']} | | | | | | | | | | | | |")
            continue
        lines.append(f"| {r['video']} | ok | {r['src_sec']}→{r['out_sec']} | {'合格' if r['verify_ok'] else '不合格'} | {r['total_sec']} | "
                     f"{r['transcribe_sec']} | {r['render_peak_mb']} | {r['fillers_removed']}/{r['filler_candidates']} | {r['subtitle_issues']} | "
                     f"{r['diff_median']}/{r['diff_p5']} | {r['bgm_louder']} | {r['duck_std']} | {r['lufs']} | {r['true_peak']} |")
    open(os.path.join(a.out, "summary.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    shutil.rmtree(os.path.join(a.out, "bgm_cache"), ignore_errors=True)


if __name__ == "__main__":
    main()
