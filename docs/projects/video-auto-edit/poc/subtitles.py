"""テロップ生成 v2(P8〜P10 の改善。検証用)

1. 文の区切り: 「。」「？」「！」と半角「?」「!」で必ず区切る(P10)
2. 1回に表示する量: 最大2行。入りきらない文は意味の切れ目で複数回の表示に分ける(P9)
3. 改行位置: BudouX の文節境界を候補にし、読点の直後を優先。
   数字・年月日・時刻・英単語の内側では区切らない(P8)
4. はみ出し: IPAゴシック(太字・縁取り込み)の実寸で1行の幅を測り、画面幅から左右余白を引いた幅に収める
5. 表示時間: 0.8秒未満の表示は隣とまとめるか、前後の空き時間に延ばす。次の表示と重ねない。
   短い空白(0.3秒未満)で表示が途切れてちらつかないよう、次の表示まで延ばす
"""
import re

import budoux

BUDOUX = budoux.load_default_japanese_parser()
FONT_PATH = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"
SENT_END = ("。", "？", "！", "?", "!")
# 区切ってはいけない範囲: 数字(+単位)の連続、時刻・日付、英数字の語
PROTECT = re.compile(
    r"(?:[0-9０-９]+(?:[.,．][0-9０-９]+)?(?:年|月|日|時|分|秒|%|％|円|歳|個|回|人|倍|件|本|台|割|万|億)?)"
    r"(?:[0-9０-９]+(?:[.,．][0-9０-９]+)?(?:年|月|日|時|分|秒|半|%|％|円|歳|個|回|人|倍|件|本|台|割|万|億))*半?"
    r"|[A-Za-zＡ-Ｚａ-ｚ][A-Za-zＡ-Ｚａ-ｚ0-9０-９\-'’]*")


class Measurer:
    def __init__(self, font_size, outline):
        self.font = None
        try:
            from PIL import ImageFont
            self.font = ImageFont.truetype(FONT_PATH, font_size)
        except Exception:  # Pillow が無い環境では字数で概算
            pass
        self.fs, self.outline = font_size, outline

    def width(self, text):
        if self.font:
            w = self.font.getlength(text)
        else:
            w = sum(self.fs * (0.55 if ord(c) < 0x2000 else 1.0) for c in text)
        return w * 1.04 + 2 * self.outline        # 太字表示の分の余裕 + 縁取り


def protected_spans(text):
    return [(m.start(), m.end()) for m in PROTECT.finditer(text) if m.end() - m.start() > 1]


def allowed_breaks(text):
    """改行・分割してよい位置(文字の間の位置)と、読点直後かどうか"""
    spans = protected_spans(text)
    inside = lambda p: any(a < p < b for a, b in spans)
    pos, out = 0, []
    for ph in BUDOUX.parse(text)[:-1]:
        pos += len(ph)
        if not inside(pos):
            out.append((pos, text[pos - 1] in "、,，"))
    if not out:  # 文節境界が無い長い語などは、保護範囲の外の任意の位置
        out = [(p, False) for p in range(1, len(text)) if not inside(p)]
    return out


def split_lines(text, fits):
    """1回の表示を最大2行に。1行に収まればそのまま。戻り値: 行のリスト(収まらなければ None)"""
    if fits(text):
        return [text]
    best = None
    for p, comma in allowed_breaks(text):
        a, b = text[:p], text[p:]
        if fits(a) and fits(b):
            score = (0 if comma else 1, abs(len(a) - len(b)))
            if best is None or score < best[0]:
                best = (score, [a, b])
    return best[1] if best else None


def split_units(text, fits2):
    """文を、2行に収まる表示単位に分ける(動的計画法)。
    優先順位: 表示回数が少ない > 読点直後で分ける > 長さが均等"""
    if fits2(text):
        return [text]
    n = len(text)
    br = {p: c for p, c in allowed_breaks(text)}
    pts = sorted(br) + [n]
    best = {n: (0, 0, 0, [])}                      # 位置 -> (表示回数, 読点以外で分けた回数, 最大長, 分割)
    for i in reversed([0] + sorted(br)):
        for j in pts:
            if j <= i or j not in best or not fits2(text[i:j]):
                continue
            c, nc, mx, rest = best[j]
            cand = (c + 1, nc + (0 if j == n or br.get(j) else 1), max(mx, j - i), [text[i:j]] + rest)
            if i not in best or cand[:3] < best[i][:3]:
                best[i] = cand
    return best[0][3] if 0 in best else [text]   # 収まらない場合はそのまま(overflow として記録される)


def build_events(words, remap_snap, vw, font_size, outline, margin_lr, min_dur=0.8, gap=0.02, hold=0.3):
    """words: dict(s,e,w, drop) のリスト(drop=True の語は表示しない)。
    戻り値: dict(s, e, lines, src_s, src_e, overflow) のリスト(出力の時刻)"""
    meas = Measurer(font_size, outline)
    maxw = vw - 2 * margin_lr
    fits = lambda t: meas.width(t) <= maxw
    fits2 = lambda t: split_lines(t, fits) is not None
    # 1) 文に分ける(言い淀みとして削除した語は除く)
    # 1つの語の途中に文末記号がある場合(例「か?以上」)は、文字数の比で時刻を配分して2語に分ける
    toks = []
    for w in words:
        if w.get("drop"):
            continue
        t = re.sub(r"\s", "", w["w"])
        parts = [p for p in re.split(r"(?<=[。？！?!])", t) if p]
        if len(parts) > 1:
            n, acc = len(t), 0
            for p in parts:
                s = w["s"] + (w["e"] - w["s"]) * acc / n
                acc += len(p)
                toks.append(dict(w, w=p, s=s, e=w["s"] + (w["e"] - w["s"]) * acc / n))
        elif t:
            toks.append(dict(w, w=t))
    sents, cur = [], []
    for w in toks:
        t = w["w"]
        cur.append(dict(w, w=t))
        if t.endswith(SENT_END):
            sents.append(cur); cur = []
    if cur:
        sents.append(cur)
    events = []
    for sent in sents:
        text = "".join(w["w"] for w in sent)
        # 文字位置 -> 語 の対応(表示単位の開始・終了時刻を語の時刻から決める)
        owner = []
        for i, w in enumerate(sent):
            owner += [i] * len(w["w"])
        pos = 0
        for unit in split_units(text, fits2):
            i0, i1 = owner[pos], owner[pos + len(unit) - 1]
            pos += len(unit)
            shown = unit.rstrip("、。,，")
            lines = split_lines(shown, fits) or [shown]
            events.append(dict(s=remap_snap(sent[i0]["s"]), e=remap_snap(sent[i1]["e"]), lines=lines,
                               src_s=sent[i0]["s"], src_e=sent[i1]["e"], sentence_end=pos == len(text),
                               overflow=not all(fits(l) for l in lines)))
    # 2) 短すぎる表示を、同じ文の隣とまとめる(2行に収まる場合)
    merged = []
    for ev in events:
        if merged and (ev["e"] - ev["s"] < min_dur or merged[-1]["e"] - merged[-1]["s"] < min_dur) \
                and not merged[-1]["sentence_end"]:
            txt = "".join(merged[-1]["lines"]) + "".join(ev["lines"])
            lines = split_lines(txt, fits)
            if lines:
                merged[-1].update(e=ev["e"], lines=lines, src_e=ev["src_e"], sentence_end=ev["sentence_end"])
                continue
        merged.append(ev)
    # 3) 時刻の調整: 重なりを無くし、短い表示は空き時間に延ばし、短い空白は次まで延ばす
    for k, ev in enumerate(merged):
        nxt = merged[k + 1]["s"] if k + 1 < len(merged) else None
        prv = merged[k - 1]["e"] if k > 0 else 0.0
        ev["e"] = max(ev["e"] + 0.15, ev["s"] + 0.3)              # 語の終わりから少し残す
        if nxt is not None:
            if nxt - ev["e"] < hold:
                ev["e"] = nxt - gap
            ev["e"] = min(ev["e"], nxt - gap)
        if ev["e"] - ev["s"] < min_dur:                          # まだ短い: 後ろ → 前の順で空きを使う
            room_after = (nxt - gap if nxt is not None else ev["s"] + min_dur) - ev["e"]
            ev["e"] += max(0.0, min(room_after, min_dur - (ev["e"] - ev["s"])))
            if ev["e"] - ev["s"] < min_dur:
                ev["s"] = max(prv + gap, ev["e"] - min_dur)
        ev["short"] = ev["e"] - ev["s"] < min_dur - 1e-6
    return merged


def to_ass(events, vw, vh, font_size, outline, margin_lr, margin_v):
    def ts(x):
        x = max(0.0, x)
        return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"
    head = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {vw}", f"PlayResY: {vh}", "WrapStyle: 2", "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,IPAGothic,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,{outline},1,2,{margin_lr},{margin_lr},{margin_v},1",
            "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    body = [f"Dialogue: 0,{ts(e['s'])},{ts(e['e'])},Default,,0,0,0,," + "\\N".join(e["lines"]) for e in events]
    return "\n".join(head + body) + "\n"
