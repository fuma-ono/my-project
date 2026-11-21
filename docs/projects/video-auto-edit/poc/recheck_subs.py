"""保存済みの作業フォルダ(修正前・修正後)のテロップを、同じ自動チェックで数え直す(P8〜P10 の前後比較用)

使い方: python recheck_subs.py <ラベル>=<作業フォルダ> [...]
作業フォルダには subs.ass と report_<モデル>.json が必要。
"""
import glob, json, os, sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_eval  # noqa: E402

rows = []
for arg in sys.argv[1:]:
    label, work = arg.split("=", 1)
    rep = json.load(open(glob.glob(os.path.join(work, "report_*.json"))[0], encoding="utf-8"))
    c = run_eval.checks(work, rep)
    kinds = Counter()
    for e in c["sub_issues"]:
        for w in e["why"]:
            for key, name in (("短い", "表示0.8秒未満"), ("速い", "1秒8字超"), ("はみ出し", "はみ出し"),
                              ("途中で改行", "数字・語の途中で改行"), ("文末記号", "文の区切り漏れ"), ("3行", "3行以上")):
                if key in w:
                    kinds[name] += 1
    durs = [e["dur"] for e in c["subs"]]
    rows.append(dict(label=label, events=len(c["subs"]), issues=len(c["sub_issues"]), kinds=dict(kinds),
                     min_dur=round(min(durs), 2) if durs else None,
                     lines=[e["text"].replace("\\N", " / ") for e in c["subs"]]))
print(json.dumps(rows, ensure_ascii=False, indent=1))
