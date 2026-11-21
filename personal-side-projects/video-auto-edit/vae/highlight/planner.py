"""構成の決定(編集者の判断を規則で表したもの): 区間の評価 → 重複の整理 → 選択 → 順番と章 → 長さ → 拍への合わせ込み

出力は EDL(編集決定リスト)。各区間に「なぜ選んだか」を残し、評価の材料にする。
将来、構成判断を LLM(Claude など)に任せる場合も、同じ EDL の形で受け取る(planner_llm、承認待ち)。
"""
import numpy as np

from .analyze import CATEGORIES, FPS

CAT_WEIGHT = {"scenery": 1.0, "night": 1.0, "food": 0.9, "people": 0.9, "water": 0.9, "animal": 0.9,
              "nature": 0.8, "city": 0.75, "transport": 0.55, "indoor": 0.5}
ENDING_CATS = ("scenery", "night", "water", "nature")


def _z(x):
    x = np.asarray(x, float)
    return (x - x.mean()) / (x.std() + 1e-6) if len(x) > 1 else np.zeros_like(x)


def frame_scores(clips):
    """すべての動画のフレームを同じ基準で採点する(動画どうしを比べるため、全体で標準化)"""
    allf = [f for c in clips for f in c["frames"]]
    sharp = _z([np.log1p(f["sharp"]) for f in allf])
    appeal = _z([f["appeal"] for f in allf])
    k = 0
    for c in clips:
        med_loud = float(np.median([f["loud"] for f in c["frames"]])) if c["frames"] else -60
        for f in c["frames"]:
            q = 0.6 * sharp[k]
            if f["bright"] < 35 or f["bright"] > 230:
                q -= 1.5                                   # 暗すぎ・白飛び
            if f["motion"] > 28:
                q -= min(2.0, (f["motion"] - 28) / 10)     # 手ぶれ・激しい振り回し
            interest = 0.9 * appeal[k]
            top = max(f["cat"], key=f["cat"].get)
            interest += 0.6 * CAT_WEIGHT.get(top, 0.6)
            if f["faces"]:
                interest += 0.4 + min(0.6, f["face_area"] * 12)    # 人の表情は思い出の中心
            if f["loud"] - med_loud > 8:
                interest += 0.3                              # 歓声・笑い声などの盛り上がり(音の山)
            f["score"] = float(q + interest)
            f["top"] = top
            k += 1


def candidates(clips, min_len=1.5, max_len=5.0, speech_max=9.0):
    """ショットごとに、最も良い連続区間を候補にする。話している区間は文の切れ目まで含める"""
    out = []
    for c in clips:
        fr = c["frames"]
        for a, b in c["shots"]:
            seg = fr[a:b]
            if not seg:
                continue
            sc = np.array([f["score"] for f in seg])
            n_min = max(1, int(min_len * FPS))
            n_max = max(n_min, int(max_len * FPS))
            best, best_i, best_n = -1e9, 0, min(len(seg), n_max)
            for n in range(min(n_min, len(seg)), min(n_max, len(seg)) + 1):
                cs = np.convolve(sc, np.ones(n) / n, mode="valid")
                i = int(cs.argmax())
                val = cs[i] + 0.15 * n / FPS                 # 少し長い区間を好む(落ち着いて見られる)
                if val > best:
                    best, best_i, best_n = val, i, n
            s = (a + best_i) / FPS
            e = min(c["duration"], (a + best_i + best_n) / FPS)
            # 話の途中で切らない: 区間に掛かる発話を含める
            for sa, sb in c["speech"]:
                if sa < e and sb > s and (max(e, sb) - min(s, sa)) <= speech_max:
                    s, e = min(s, sa), max(e, sb)
            if e - s < min(min_len, c["duration"]) - 1e-3:
                continue
            ia, ib = int(s * FPS), max(int(s * FPS) + 1, int(e * FPS))
            emb = c["emb"][ia:ib].mean(axis=0)
            emb /= np.linalg.norm(emb) + 1e-6
            cats = {}
            for f in fr[ia:ib]:
                cats[f["top"]] = cats.get(f["top"], 0) + 1
            top = max(cats, key=cats.get)
            speech = any(sa < e and sb > s for sa, sb in c["speech"])
            out.append({"clip": c["idx"], "name": c["name"], "start": round(s, 3), "end": round(e, 3),
                        "score": float(np.mean([f["score"] for f in fr[ia:ib]])), "cat": top,
                        "cat_ja": CATEGORIES[top][0], "faces": int(max(f["faces"] for f in fr[ia:ib])),
                        "speech": speech, "created": c["created"], "emb": emb,
                        "sharp": float(np.mean([f["sharp"] for f in fr[ia:ib]])),
                        "motion": float(np.mean([f["motion"] for f in fr[ia:ib]]))})
    return out


def snap_to_beats(chosen, clips, beat):
    """拍への合わせ込み: 話していない区間は拍の倍数(2拍以上)の長さにして、カットを拍に乗せる。話は切らない。
    beat が無いときは長さだけを入れる。構成を決めた方法(規則・LLM)によらず同じ処理を使う"""
    if beat:
        for c in chosen:
            d = c["end"] - c["start"]
            if c["speech"]:
                n = int(np.ceil(d / beat))                     # 話は切らず、次の拍まで伸ばす
            else:
                n = max(2, int(round(d / beat / 2)) * 2)
            c["beats"] = n
            c["dur"] = n * beat
            clipdur = next(cl["duration"] for cl in clips if cl["idx"] == c["clip"])    # 元の動画の範囲に収める
            if c["start"] + c["dur"] > clipdur:
                c["start"] = max(0.0, clipdur - c["dur"])
            c["end"] = round(min(clipdur, c["start"] + c["dur"]), 3)
            c["dur"] = round(c["end"] - c["start"], 3)
    else:
        for c in chosen:
            c["dur"] = round(c["end"] - c["start"], 3)


def plan(clips, target=None, mood=None, beat=None, min_score=-0.8, dup_sim=0.93, mmr_lambda=0.75):
    """EDL を作る。target(秒)を省くと素材から決める。beat(秒)を渡すと区間の長さを拍の倍数にそろえる"""
    frame_scores(clips)
    cands = candidates(clips)
    reasons = {}
    # 1) 質の低い候補を外す(暗い・ぶれ・意味の薄い場面)。ただし各動画の最良の候補は、
    #    はっきりした欠陥(真っ暗・白飛び・大きなぶれ)が無ければ残す(撮った素材を無意味に捨てない)
    best_of = {}
    for c in cands:
        if c["clip"] not in best_of or c["score"] > best_of[c["clip"]]["score"]:
            best_of[c["clip"]] = c
    good = []
    for c in cands:
        defect = c["motion"] > 40 or c["sharp"] < 5
        if c["score"] < min_score and not (best_of[c["clip"]] is c and not defect):
            reasons[id(c)] = "除外: 画質または見どころの評価が低い"
        else:
            good.append(c)
    # 2) ほぼ同じ場面(連写・撮り直し)は評価の高い方だけ残す
    good.sort(key=lambda c: -c["score"])
    uniq = []
    for c in good:
        # 会話を含む区間どうしは、見た目が似ていても話の中身が違うので重複として扱わない
        dup = next((u for u in uniq if float(u["emb"] @ c["emb"]) > dup_sim and not (u["speech"] and c["speech"])), None)
        # 同じ動画の時間が重なる候補(発話に合わせて伸ばした区間など)は、同じ映像が2回出るので片方だけ
        over = next((u for u in uniq if u["clip"] == c["clip"] and
                     min(u["end"], c["end"]) - max(u["start"], c["start"]) > 0.3 * min(u["end"] - u["start"], c["end"] - c["start"])), None)
        if over is not None and dup is None:
            reasons[id(c)] = f"除外: {over['name']} の {over['start']:.1f}〜{over['end']:.1f}秒 と時間が重なる(評価の高い方を使用)"
            continue
        if dup is not None:
            reasons[id(c)] = f"除外: {dup['name']} の {dup['start']:.1f}秒 とほぼ同じ場面(評価の高い方を使用)"
        else:
            uniq.append(c)
    # 3) 長さの決定: 良い素材の量に応じて 15〜75 秒
    material = sum(c["end"] - c["start"] for c in uniq)
    if target is None:
        target = float(np.clip(10 + 0.3 * material, 15, 75))
    # 4) 選択: すべての動画から少なくとも1区間(撮った素材を無意味に捨てない)→ 残りを評価と多様性(MMR)で
    chosen = []
    by_clip = {}
    for c in uniq:
        by_clip.setdefault(c["clip"], []).append(c)
    for k, cs in by_clip.items():
        best = max(cs, key=lambda c: c["score"])
        chosen.append(best)
        reasons[id(best)] = f"採用: この動画で最も評価の高い場面({best['cat_ja']})"
    total = sum(c["end"] - c["start"] for c in chosen)
    rest = [c for c in uniq if c not in chosen]
    while rest and total < target:
        def mmr(c):
            sim = max(float(c["emb"] @ s["emb"]) for s in chosen) if chosen else 0
            return mmr_lambda * c["score"] - (1 - mmr_lambda) * 3 * sim
        nxt = max(rest, key=mmr)
        rest.remove(nxt)
        chosen.append(nxt)
        total += nxt["end"] - nxt["start"]
        reasons[id(nxt)] = f"採用: 評価が高く、他と違う場面({nxt['cat_ja']})"
    for c in rest:
        reasons.setdefault(id(c), "不採用: 長さの上限に収まらない(評価が下位)")
    # 長すぎるとき: 評価の低いものから落とす(各動画の代表は残す)
    reps = {max(cs, key=lambda c: c["score"])["clip"]: max(cs, key=lambda c: c["score"]) for cs in by_clip.values()}
    while total > target * 1.25 and len(chosen) > len(reps):
        worst = min((c for c in chosen if reps.get(c["clip"]) is not c), key=lambda c: c["score"])
        chosen.remove(worst)
        total -= worst["end"] - worst["start"]
        reasons[id(worst)] = "不採用: 全体の長さに収めるため(評価が下位)"
    # まだ長いとき: 会話の無い区間を中央に寄せて短くする(最短 2 秒)。会話は切らない
    if total > target * 1.1:
        quiet = [c for c in chosen if not c["speech"]]
        fixed = sum(c["end"] - c["start"] for c in chosen if c["speech"])
        room = max(0.0, target - fixed)
        qsum = sum(c["end"] - c["start"] for c in quiet)
        if quiet and qsum > room:
            r = max(room / qsum, 0.0)
            for c in quiet:
                d = c["end"] - c["start"]
                nd = max(2.0, d * r)
                if nd < d:
                    mid = (c["start"] + c["end"]) / 2
                    c["start"], c["end"] = round(mid - nd / 2, 3), round(mid + nd / 2, 3)
                    reasons[id(c)] = reasons.get(id(c), "") + "。全体の長さに合わせて短縮"
        total = sum(c["end"] - c["start"] for c in chosen)
    # 5) 順番: 撮影した順(時系列がいちばん自然な物語になる)。同じ動画の中は時刻順
    chosen.sort(key=lambda c: (c["created"], c["clip"], c["start"]))
    # 締め: 最後の章に景色・夜景があれば、それを最後に回して少し長めに
    tail = chosen[-max(1, len(chosen) // 4):]
    end_c = next((c for c in reversed(tail) if c["cat"] in ENDING_CATS), None)
    if end_c is not None and end_c is not chosen[-1]:
        chosen.remove(end_c)
        chosen.append(end_c)
        reasons[id(end_c)] += "。締めの場面として最後に配置"
    # 掴み: 冒頭は、最初の章で最も印象的な場面から始める
    head = chosen[:max(1, len(chosen) // 4)]
    hook = max(head, key=lambda c: c["score"])
    if hook is not chosen[0] and not hook["speech"]:
        chosen.remove(hook)
        chosen.insert(0, hook)
        reasons[id(hook)] += "。冒頭の掴みとして最初に配置"
    # 6) 章: 撮影時刻が20分以上空いたら章を分ける(つなぎ方を変える目安)
    chapter, prev_t = 0, None
    for c in chosen:
        if prev_t is not None and abs(c["created"] - prev_t) > 1200:
            chapter += 1
        c["chapter"] = chapter
        prev_t = c["created"]
    snap_to_beats(chosen, clips, beat)
    if mood is None:
        cats = [c["cat"] for c in chosen]
        lively = sum(1 for c in chosen if c["faces"] or c["motion"] > 8) / max(1, len(chosen))
        mood = "bright" if lively > 0.4 else ("emotional" if cats.count("scenery") + cats.count("night") > len(cats) / 2 else "calm")
    edl = [{k: v for k, v in c.items() if k != "emb"} | {"reason": reasons.get(id(c), "")} for c in chosen]
    rejected = [{k: v for k, v in c.items() if k != "emb"} | {"reason": reasons.get(id(c), "")}
                for c in cands if c not in chosen]
    return {"target_sec": round(target, 2), "material_good_sec": round(material, 2), "mood": mood,
            "total_sec": round(sum(c["dur"] for c in chosen), 2), "segments": edl, "rejected": rejected,
            "n_candidates": len(cands)}
