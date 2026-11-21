"""言い淀みの検出 v2(P13。検証用)

方針: 文字列が一致しただけでは削除しない。
1. 表記ゆれの正規化: カタカナ→ひらがな、小書き文字→通常の文字、長音記号・波線・促音・伸ばした母音を除く
   (例: まぁ / まー / まあ → 「ま」、えーっと / ええと / えっと → 「えと」、うーん / うん → 「うん」)
2. 種類ごとの条件
   - 常に言い淀みになりやすい語(えー、えーと、あー、うーん、んー、まあ など):
     単独で使われている(後ろが句読点・間・別の言い淀み・文の終わり)なら削除
   - 文脈で意味が変わる語(あの、その、なんか、うん):
     後ろに句読点がある / 後ろに 0.25秒以上の間がある / 0.35秒以上伸ばしている / 次も言い淀み
     のどれかを満たすときだけ削除。満たさなければ「あの動画」のような指示語として残す
3. すべての候補について、判定と理由を記録する(評価シート用)
"""
import re

FILLER_CONTEXT = {"あの", "その", "なんか", "うん"}
PUNCT = "、。,.!?！？…"
_SMALL = str.maketrans("ぁぃぅぇぉっゃゅょゎ", "あいうえおつやゆよわ")
_VOWEL = {}
for row in ["あかさたなはまやらわがざだばぱ", "いきしちにひみりぎじぢびぴ", "うくすつぬふむゆるぐずづぶぷ",
            "えけせてねへめれげぜでべぺ", "おこそとのほもよろをごぞどぼぽ"]:
    for ch in row:
        _VOWEL[ch] = row[0]


def to_hira(t):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in t)


def canon(text):
    """表記ゆれを吸収したキー。長音・波線・促音・小書きを除き、直前と同じ母音の連続を1つにする"""
    t = to_hira(re.sub(f"[{re.escape(PUNCT)}\\s]", "", text))
    raw_long = bool(re.search(r"[ー〜～]", t)) or len(t) >= 3 and t[:2] in ("うう", "んん")
    t = t.replace("っ", "").translate(_SMALL)
    t = re.sub(r"[ー〜～]", "", t)
    out = ""
    for c in t:
        if out and c in "あいうえお" and _VOWEL.get(out[-1]) == c:
            continue                                 # まあ→ま、ええと→えと、ああ→あ
        out += c
    return out, raw_long


def classify(key, long_):
    if key == "うん" and long_:
        return "always"                              # うーん(考え中)
    if key in FILLER_CONTEXT:
        return "context"
    if key in {"え", "えと", "あ", "ん", "ま", "う"}:
        return "always"
    return None


def detect(words, pause_after=0.25, long_dur=0.35, max_tokens=3):
    """words: dict(s,e,w)。戻り値: (削除する語の番号の集合, 候補のリスト)"""
    drop, cands, i, n = set(), [], 0, len(words)
    while i < n:
        hit = None
        for j in range(min(n, i + max_tokens) - 1, i - 1, -1):     # 長い一致を優先
            text = "".join(w["w"] for w in words[i:j + 1])
            key, long_ = canon(text)
            kind = classify(key, long_)
            # 語の中に言い淀み以外の文字が混ざっていないか(例「あの動画」は key が一致しない)
            if kind and key:
                hit = (j, text, key, kind, long_)
                break
        if not hit:
            i += 1
            continue
        j, text, key, kind, long_ = hit
        nxt = words[j + 1] if j + 1 < n else None
        gap = (nxt["s"] - words[j]["e"]) if nxt else None
        dur = words[j]["e"] - words[i]["s"]
        punct = text.strip()[-1:] in PUNCT
        nxt_filler = False
        if nxt:
            k2, l2 = canon(nxt["w"])
            nxt_filler = classify(k2, l2) is not None and k2 not in FILLER_CONTEXT
        reasons = []
        if punct: reasons.append("後ろに句読点")
        if gap is None: reasons.append("文の終わり")
        elif gap >= pause_after: reasons.append(f"後ろに{gap:.2f}秒の間")
        if long_ or dur >= long_dur: reasons.append(f"伸ばし({dur:.2f}秒)")
        if nxt_filler: reasons.append("次も言い淀み")
        if kind == "always" and len(key) == 1:
            # 1文字(え・あ・う・ま・ん)は単語の一部のこともある(例「う」「ま」「く」=うまく)。
            # 後ろに句読点・間・伸ばしがある場合だけ削除し、「次も言い淀み」は理由に使わない
            ok = punct or gap is None or (gap is not None and gap >= 0.1) or long_ or dur >= long_dur
            if nxt_filler and not ok:
                reasons.remove("次も言い淀み")
        elif kind == "always":
            # 単独で使われているか。内容語の一部なら後ろに直接続くので残る
            ok = punct or gap is None or (gap is not None and gap >= 0.1) or nxt_filler or long_
        else:
            ok = bool(reasons)
        decision = "削除" if ok else "残す"
        why = "、".join(reasons) if reasons else ("後ろに内容語が直接続く(指示語・内容語と判断)" if kind == "context" else "単独ではない")
        cands.append(dict(i0=i, i1=j, s=words[i]["s"], e=words[j]["e"], text=text, key=key, kind=kind,
                          decision=decision, reason=why))
        if ok:
            drop.update(range(i, j + 1))
        i = j + 1
    return drop, cands
