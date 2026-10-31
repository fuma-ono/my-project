"""実動画の品質評価ランナー(検証用。本実装ではない)

使い方:
    python run_eval.py <動画を入れたディレクトリ> <出力ディレクトリ> [モデル ...]
    例: python run_eval.py /mnt/user-data/uploads /tmp/vedit-eval small medium

各動画 x 各モデルで poc_pipeline.py を実行し、次を出力する。
    <出力>/<動画名>/out_<モデル>.mp4   ... オーナー確認用の編集済み動画
    <出力>/<動画名>/review.md          ... 自動チェック結果 + オーナー記入欄
    <出力>/summary.md                   ... 全動画の処理時間・自動チェック件数の一覧

自動チェックは「候補」を挙げるだけで、正誤の最終判断は人が動画を見て行う。
"""
import json, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
FILLERS = {"えーと", "えっと", "えー", "あのー", "あの", "ええと", "うーん", "まあ", "えーっと", "あのお", "そのー", "なんか"}
MIN_SUB_SEC = 0.8      # これより短い表示は読めない可能性
MAX_CPS = 8.0          # 1秒あたりの文字数がこれを超えると速すぎる可能性(目安)


def sh(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe(path):
    j = json.loads(sh(["ffprobe", "-v", "error", "-show_entries",
                       "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate",
                       "-of", "json", path]).stdout)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), {})
    return dict(duration=round(float(j["format"]["duration"]), 2), video=f'{v.get("codec_name")} {v.get("width")}x{v.get("height")} {v.get("r_frame_rate")}',
                audio=f'{a.get("codec_name")} {a.get("sample_rate")}Hz {a.get("channels")}ch' if a else "なし")


def loudness(path):
    err = subprocess.run(["ffmpeg", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    p = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)
    return (float(i[-1]) if i else None, float(p[-1]) if p else None)


def norm(t):
    return re.sub(r"[、。,.!?！？ー\s]", "", t)


def cer(ref, hyp):
    """文字誤り率(句読点・空白・長音記号を除いて比較)。編集距離 / 正解の文字数"""
    r, h = norm(ref), norm(hyp)
    prev = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        cur = [i]
        for j, hc in enumerate(h, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc)))
        prev = cur
    return prev[-1] / max(len(r), 1)


def ts(x):
    return f"{int(x // 60)}:{x % 60:05.2f}"


def parse_ass(path):
    ev = []
    for line in open(path, encoding="utf-8"):
        if line.startswith("Dialogue:"):
            p = line.rstrip("\n").split(",", 9)
            to = lambda t: (lambda h, m, s: int(h) * 3600 + int(m) * 60 + float(s))(*t.split(":"))
            ev.append(dict(s=to(p[1]), e=to(p[2]), text=p[9]))
    return ev


def checks(work, report):
    words = json.load(open(f"{work}/words.json", encoding="utf-8"))
    keep = report["keep"]
    removed, cur = [], 0.0
    for a, b in keep:
        if a > cur:
            removed.append((cur, a))
        cur = b
    if cur < report["src_duration"]:
        removed.append((cur, report["src_duration"]))

    def overlap(s, e, a, b):
        return max(0.0, min(e, b) - max(s, a))

    cuts = json.load(open(f"{work}/cuts.json"))
    risky = cuts["filler"] + cuts["dropped_short"]   # 単語の時刻や短区間の破棄で消した部分(発話を巻き込む恐れ)
    miscut, quiet, edge, fillers = [], [], [], []
    for w in words:
        d = max(w["e"] - w["s"], 1e-6)
        if w.get("filler"):
            fillers.append(dict(w, removed=True))
            continue
        if norm(w["w"]) in {norm(f) for f in FILLERS}:
            fillers.append(dict(w, removed=False))   # 言い淀み辞書の語だが、文中の語として残したもの
        r_risky = sum(overlap(w["s"], w["e"], a, b) for a, b in risky) / d
        r_sil = sum(overlap(w["s"], w["e"], a, b) for a, b in cuts["silence"]) / d
        if r_risky > 0.2:
            miscut.append(dict(w, ratio=round(r_risky, 2)))
        elif r_sil > 0.3:
            quiet.append(dict(w, ratio=round(r_sil, 2)))
        elif any(w["s"] < a < w["e"] - 0.02 or w["s"] + 0.02 < b < w["e"] for a, b in keep):
            edge.append(w)
    subs = parse_ass(f"{work}/subs.ass")
    maxc = report.get("max_chars_per_line", 18)
    sub_issues = []
    for i, ev in enumerate(subs):
        lines = ev["text"].split("\\N")
        n = sum(len(x) for x in lines)
        dur = ev["e"] - ev["s"]
        why = []
        if dur < MIN_SUB_SEC:
            why.append(f"表示{dur:.2f}秒(短い)")
        if dur > 0 and n / dur > MAX_CPS:
            why.append(f"{n / dur:.1f}字/秒(速い)")
        if any(len(x) > maxc for x in lines):
            why.append(f"1行{max(len(x) for x in lines)}字>上限{maxc}")
        if len(lines) > 2:
            why.append("3行以上")
        ev.update(i=i + 1, dur=dur, chars=n, why=why)
        if why:
            sub_issues.append(ev)
    return dict(removed=removed, quiet=quiet, miscut=miscut, edge=edge, fillers=fillers, subs=subs, sub_issues=sub_issues)


def main():
    src_dir, out_dir = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    models = sys.argv[3:] or ["small", "medium"]
    py = sys.executable
    videos = sorted(f for f in os.listdir(src_dir) if os.path.splitext(f)[1].lower() in VIDEO_EXT)
    if not videos:
        sys.exit(f"動画がありません: {src_dir}")
    os.makedirs(out_dir, exist_ok=True)
    summary = ["# 評価サマリー(自動集計)", "", f"- 実行日時: {time.strftime('%Y-%m-%d %H:%M:%S')}",
               f"- 設定: 無音しきい値 {os.environ.get('VEDIT_NOISE_DB', '-35')}dB / 最短無音 {os.environ.get('VEDIT_MIN_SIL', '0.5')}秒 / 余白 {os.environ.get('VEDIT_PAD', '0.12')}秒",
               "- 外部API・有料サービスの呼び出し: なし(すべてローカル処理)", "",
               "| 動画 | 元の長さ | モデル | 出力の長さ | 全体の処理時間 | 文字起こし時間 | 文字誤り率 | 誤カット候補(高/低) | 語頭/語尾切れ候補 | 言い淀み(認識/除去) | テロップ要確認 | ラウドネス |",
               "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for v in videos:
        stem = os.path.splitext(v)[0]
        vdir = os.path.join(out_dir, stem)
        os.makedirs(vdir, exist_ok=True)
        info = probe(os.path.join(src_dir, v))
        md = [f"# 評価シート: {v}", "", f"- 長さ {info['duration']}秒 / 映像 {info['video']} / 音声 {info['audio']}", "",
              "## 撮影条件(オーナー記入)", "", "- 話者の人数:", "- 収録場所・環境音:", "- BGMの有無:", "- 言い淀み・言い直しの有無:", ""]
        for m in models:
            work = os.path.join(vdir, f"work_{m}")
            out = os.path.join(vdir, f"out_{m}.mp4")
            t = time.time()
            r = subprocess.run([py, os.path.join(HERE, "poc_pipeline.py"), os.path.join(src_dir, v), out, m],
                               capture_output=True, text=True, env=dict(os.environ, VEDIT_WORK=work))
            wall = time.time() - t
            if r.returncode != 0:
                md += [f"## モデル {m}: 失敗", "", "```", r.stderr[-3000:], "```", ""]
                summary.append(f"| {v} | {info['duration']} | {m} | 失敗 | {wall:.1f}秒 | - | - | - | - | - | - | - |")
                continue
            rep = json.load(open(f"{work}/report_{m}.json", encoding="utf-8"))
            c = checks(work, rep)
            lufs, peak = loudness(out)
            shutil.copy(f"{work}/subs.ass", os.path.join(vdir, f"subs_{m}.ass"))
            ref_path = os.path.join(src_dir, stem + ".txt")   # 台本(正解テキスト)があれば文字誤り率を計算
            cer_v = round(cer(open(ref_path, encoding="utf-8").read(), "".join(rep["transcript"])) * 100, 1) if os.path.exists(ref_path) else None
            f_rec = len(c["fillers"]); f_rm = sum(f["removed"] for f in c["fillers"])
            summary.append(f"| {v} | {info['duration']}秒 | {m} | {rep['out_duration']}秒 | {wall:.1f}秒 | {rep['timings_sec']['transcribe']}秒 | {'-' if cer_v is None else f'{cer_v}%'} | "
                           f"{len(c['miscut'])}/{len(c['quiet'])} | {len(c['edge'])} | {f_rec}/{f_rm} | {len(c['sub_issues'])} | {lufs} LUFS |")
            md += [f"## モデル {m}", "",
                   f"- 出力: `out_{m}.mp4`({rep['out_duration']}秒、元の {rep['out_duration'] / info['duration'] * 100:.0f}%)",
                   f"- 処理時間: 全体 {wall:.1f}秒(うち 文字起こし {rep['timings_sec']['transcribe']}秒 / モデル読込 {rep['timings_sec']['model_load']}秒 / BGM生成 {rep['timings_sec']['bgm_generate']}秒 / 書き出し {rep['timings_sec']['render']}秒)",
                   f"- ラウドネス: {lufs} LUFS(目標 -14)/ ピーク {peak} dBFS",
                   f"- 文字誤り率: {'台本なしのため未計算' if cer_v is None else f'{cer_v}%(台本 {stem}.txt と比較。台本に書かれていない言い淀みを Whisper が文字にした場合も誤りとして数えられる)'}", "",
                   "### 文字起こし(モデル出力そのまま)", ""] + [f"> {t}" for t in rep["transcript"]] + ["",
                   "### 削除した区間", "", "| 元動画の区間 | 長さ |", "|---|---|"] + \
                  [f"| {ts(a)}〜{ts(b)} | {b - a:.2f}秒 |" for a, b in c["removed"]] + ["",
                   f"### 誤カット候補・高(言い淀み除去や短区間の破棄に巻き込まれた単語): {len(c['miscut'])}件", ""] + \
                  [f"- {ts(w['s'])} 「{w['w']}」 削除率{w['ratio']:.0%}" for w in c["miscut"]] + ["",
                   f"### 誤カット候補・低(無音判定の区間に3割以上かかった単語): {len(c['quiet'])}件", "",
                   "無音判定は音量で行うので、ここは多くが Whisper の単語時刻のずれ(実際は無音)。ただし小さい声の語尾が削られている場合があるので、該当箇所を聞いて確認する。", ""] + \
                  [f"- {ts(w['s'])} 「{w['w']}」 削除率{w['ratio']:.0%}" for w in c["quiet"]] + ["",
                   f"### 語頭・語尾切れ候補(残す区間の境界が単語の途中にあるもの): {len(c['edge'])}件", ""] + \
                  [f"- {ts(w['s'])}〜{ts(w['e'])} 「{w['w']}」" for w in c["edge"]] + ["",
                   f"### 認識された言い淀み: {len(c['fillers'])}件", "",
                   "注意: Whisper は言い淀みを文字にしないことが多い。ここに出ない言い淀みは「検出漏れ」の可能性があるので、動画を聞いて確認する。", ""] + \
                  [f"- {ts(f['s'])} 「{f['w']}」 → {'言い淀みとして除去' if f['removed'] else '**残した**(文中の語と判定。言い淀みなら検出漏れ)'}" for f in c["fillers"]] + ["",
                   f"### テロップ一覧(要確認 {len(c['sub_issues'])}件。上限 {rep.get('max_chars_per_line')}字/行)", "",
                   "| # | 開始 | 表示秒 | 字数 | テキスト | 自動チェック |", "|---|---|---|---|---|---|"] + \
                  [f"| {e['i']} | {ts(e['s'])} | {e['dur']:.2f} | {e['chars']} | {e['text'].replace(chr(92) + 'N', ' / ')} | {'、'.join(e['why'])} |" for e in c["subs"]] + [""]
        md += ["## オーナー評価(動画を見て記入)", "",
               "各項目: ○ 問題なし / △ 気になる / × 使えない。総合は「そのまま使える / 手直しが必要 / 使えない」のどれか。", "",
               "| 項目 | " + " | ".join(models) + " | メモ |", "|---|" + "---|" * len(models) + "---|"] + \
              [f"| {k} | " + " | ".join("" for _ in models) + " | |" for k in
               ["1 文字起こしの誤り", "2 語頭・語尾の欠け", "3 言い淀みの残り", "4 必要な発言の誤カット", "5 テロップのタイミング",
                "6 不自然な改行", "7 BGMと声のバランス", "**総合評価**"]] + [""]
        open(os.path.join(vdir, "review.md"), "w", encoding="utf-8").write("\n".join(md))
        print(f"done: {v}", flush=True)
    open(os.path.join(out_dir, "summary.md"), "w", encoding="utf-8").write("\n".join(summary) + "\n")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
