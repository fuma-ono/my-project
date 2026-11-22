"""LLM(Claude Sonnet 5.5)による構成判断の限定検証(オーナー承認 2026-11-21)

承認の条件(コードで守る):
- 合計予算の上限は 500 円。累計は ~/.cache/vae/llm_ledger.json(Git の外)に記録し、
  これから送る分の見積もりを足して上限を超えるなら実行しない。上限を超える実行は事前承認が必要(上書きの手段は設けない)
- 既定は「送らない」(dry-run)。実際に送るのは run=True を明示したときだけ。1回の呼び出しで1リクエスト。
  SDK の自動再試行は切る(max_retries=0)。失敗しても自動で繰り返さない
- API キーは環境変数 ANTHROPIC_API_KEY だけから読む(ファイルやコードに書かない。ログにも出さない)
- 使用量(トークン)と実費の推定を、実行のたびに記録する
- この段階では Sonnet 5.5 だけを使う(Opus の検証・本採用はしない)
"""
import base64
import json
import os
import time

import numpy as np

from . import planner
from .analyze import CATEGORIES

MODEL = "claude-sonnet-5-5"
PRICE_USD_PER_MTOK = {"input": 2.0, "output": 10.0, "cache_read": 0.10, "cache_write": 2.5}
JPY_PER_USD = 155.0                       # 見積もり用の為替(実費の円換算は請求のレートによる)
BUDGET_JPY = 500.0
LEDGER = os.path.expanduser(os.environ.get("VAE_LLM_LEDGER", "~/.cache/vae/llm_ledger.json"))
MAX_OUTPUT_TOKENS = 12000
IMAGE_SHORT = 384                         # 送る画像の短辺(画素)
MAX_IMAGES = 160


class BudgetExceeded(Exception):
    pass


def usd_cost(usage):
    g = lambda k: float(getattr(usage, k, 0) or 0)
    return (g("input_tokens") * PRICE_USD_PER_MTOK["input"] + g("output_tokens") * PRICE_USD_PER_MTOK["output"] +
            g("cache_read_input_tokens") * PRICE_USD_PER_MTOK["cache_read"] +
            g("cache_creation_input_tokens") * PRICE_USD_PER_MTOK["cache_write"]) / 1e6


def load_ledger(path=None):
    try:
        with open(path or LEDGER, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"cap_jpy": BUDGET_JPY, "runs": []}


def spent_jpy(ledger):
    return sum(r["jpy"] for r in ledger["runs"])


def save_ledger(ledger, path=None):
    path = path or LEDGER
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=1)
    os.replace(path + ".tmp", path)


def estimate(content, max_output=MAX_OUTPUT_TOKENS, n_images=0, image_tokens=0):
    """送る前の最悪の見積もり(円)。入力は文字数と画像の大きさから多めに、出力は上限いっぱいを見込む"""
    chars = sum(len(b["text"]) for b in content if b.get("type") == "text")
    in_tok = int(chars / 1.5) + image_tokens + 500                     # 日本語は1文字が1トークン近いので多めに
    usd = (in_tok * PRICE_USD_PER_MTOK["input"] + max_output * PRICE_USD_PER_MTOK["output"]) / 1e6
    return {"input_tokens_est": in_tok, "output_tokens_max": max_output, "images": n_images,
            "usd_worst": round(usd, 4), "jpy_worst": round(usd * JPY_PER_USD, 1)}


def check_budget(est, ledger):
    total = spent_jpy(ledger) + est["jpy_worst"]
    if total > ledger.get("cap_jpy", BUDGET_JPY) + 1e-9:
        raise BudgetExceeded(f"累計の見込み {total:.0f} 円が上限 {ledger.get('cap_jpy', BUDGET_JPY):.0f} 円を超えます"
                             f"(使用済み {spent_jpy(ledger):.0f} 円 + この実行の最悪 {est['jpy_worst']:.0f} 円)。"
                             "上限を超える実行はオーナーの事前承認が必要です。")


SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "story": {"type": "string"},
        "mood": {"type": "string", "enum": ["bright", "calm", "emotional"]},
        "target_sec": {"type": "number"},
        "segments": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"id": {"type": "string"}, "trim_start": {"type": "number"}, "trim_end": {"type": "number"},
                           "role": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["id", "reason"]}},
        "excluded": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["id", "reason"]}},
    },
    "required": ["story", "mood", "target_sec", "segments"],
}

SYSTEM = (
    "あなたは、旅行やお出かけの動画を1本にまとめる、腕のよい動画編集者です。"
    "利用者は動画を選ぶだけで、編集の知識はありません。利用者が見て『こんなに簡単なのに、こんな動画ができた』と感じる、"
    "自然で魅力的な1本を作るのが仕事です。\n"
    "入力は、複数の動画から機械的に切り出した「候補区間」の一覧(画像・時刻・場面の種類・評価・会話の文字起こし)です。\n"
    "守ること:\n"
    "- 候補の id だけを使う。存在しない id や時刻を作らない。\n"
    "- 単に時系列でつなぐだけにしない。到着・見どころ・食事・楽しい場面・印象的な景色などの流れを考え、"
    "冒頭に掴み、最後に余韻のある締めを置く。\n"
    "- ほぼ同じ場面の重複や、暗い・ぶれた・意味の薄い場面は外す。ただし撮った素材を無意味に捨てない。"
    "どの動画も、使えるなら1区間は残す。使わないものは excluded に理由を書く。\n"
    "- カットが多すぎないようにする。1区間は原則 3 秒以上、完成動画の切れ目は少なめに。短い素材でも細切れにしない。\n"
    "- 話している区間(speech=true)は文の途中で切らない。trim は、候補の中をさらに絞るときだけ使う(秒、候補の先頭からの位置)。\n"
    "- 画像に写っていないことを断定しない。分からないことは分からないとして扱う。\n"
    "- reason は、なぜその区間を選んだか(外したか)を、利用者にも説明できる短い日本語で書く。"
)


def _jpeg(path, t, short=IMAGE_SHORT):
    from .. import proc
    raw = proc.run_bytes(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1",
                          "-vf", f"scale='if(gt(iw,ih),-2,{short})':'if(gt(iw,ih),{short},-2)'", "-q:v", "4", "-f", "image2pipe",
                          "-vcodec", "mjpeg", "-"], timeout=60)
    return raw


def build_request(clips, cands, with_images=True, max_images=MAX_IMAGES):
    """候補区間の一覧と画像から、送る内容(content ブロックの一覧)を作る。戻り値: (content, 画像の枚数, 画像のトークン見積もり)"""
    by = {c["idx"]: c for c in clips}
    total = sum(c["duration"] for c in clips)
    sim = any(str(c.get("created_source", "")).startswith("simulated") for c in clips)
    note = ("(この素材は別々の撮影者のストック動画で、撮影日時は実際のものではなく**擬似**です。時刻の順は物語の順の手がかりにしないでください)"
            if sim else "")
    head = (f"素材は {len(clips)} 本、合計 {total:.0f} 秒です。撮影日時の順に並べています。{note}"
            "完成動画の長さは素材の内容で決めてください(目安 15〜75 秒)。\n\n## 動画一覧\n")
    for c in sorted(clips, key=lambda c: c["created"]):
        head += (f"- 動画{c['idx']}: {c['name']} {c['duration']:.1f}秒 {c['width']}x{c['height']} "
                 f"撮影 {time.strftime('%m/%d %H:%M', time.gmtime(c['created']))}\n")
    content = [{"type": "text", "text": head + "\n## 候補区間(画像は各区間の代表フレーム)\n"}]
    n_img, img_tok = 0, 0
    for i, c in enumerate(sorted(cands, key=lambda c: (by[c["clip"]]["created"], c["clip"], c["start"]))):
        cid = f"c{i}"
        c["id"] = cid
        words = [w["w"] for w in by[c["clip"]].get("words") or [] if c["start"] <= w["s"] and w["e"] <= c["end"]]
        line = (f"[{cid}] 動画{c['clip']} {c['start']:.1f}〜{c['end']:.1f}秒(長さ {c['end'] - c['start']:.1f}秒) "
                f"場面={c['cat_ja']} 顔={c['faces']} 会話={'あり' if c['speech'] else 'なし'} 機械評価={c['score']:.2f}")
        if words:
            line += f"\n  会話: 「{''.join(words)[:80]}」"
        if with_images and n_img < max_images:
            mid = (c["start"] + c["end"]) / 2
            try:
                jpg = _jpeg(by[c["clip"]]["path"], mid)
                content.append({"type": "text", "text": line})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                            "data": base64.standard_b64encode(jpg).decode()}})
                n_img += 1
                w, h = by[c["clip"]]["width"], by[c["clip"]]["height"]
                s = IMAGE_SHORT / min(w, h)
                img_tok += int(w * s * h * s / 750)
                continue
            except Exception:
                pass
        content.append({"type": "text", "text": line})
    content.append({"type": "text", "text": "\n上の候補から、最高の1本の構成を決めてください。"})
    return content, n_img, img_tok


def validate(choice, cands, clips):
    """LLM の出力を検査し、使える区間(トリムを反映)の一覧にする。不正なものは捨てて理由を返す"""
    byid = {c["id"]: c for c in cands}
    out, problems, seen = [], [], set()
    for s in choice.get("segments", []):
        c = byid.get(s.get("id"))
        if c is None:
            problems.append(f"存在しない id: {s.get('id')}")
            continue
        if c["id"] in seen:
            problems.append(f"重複: {c['id']}")
            continue
        seen.add(c["id"])
        d = dict(c)
        d["start"] = round(c["start"] + max(0.0, float(s.get("trim_start") or 0.0)), 3)
        te = s.get("trim_end")
        d["end"] = round(c["start"] + float(te), 3) if te else c["end"]
        d["end"] = min(max(d["end"], d["start"] + 1.0), c["end"] + 2.0)
        if c["speech"]:                                              # 会話の区間は元の範囲を狭めない
            d["start"], d["end"] = c["start"], c["end"]
        d["reason"] = "Sonnet: " + (s.get("reason") or "")
        d["role"] = s.get("role", "")
        out.append(d)
    return out, problems


def plan_with_llm(clips, cands=None, client=None, run=False, ledger_path=None, beat=None, with_images=True, purpose="compare"):
    """戻り値: (EDL または None, 記録)。run=False のときは何も送らず、見積もりだけを返す"""
    planner.frame_scores(clips)
    cands = cands if cands is not None else planner.candidates(clips)
    content, n_img, img_tok = build_request(clips, cands, with_images)
    est = estimate(content, n_images=n_img, image_tokens=img_tok)
    ledger = load_ledger(ledger_path)
    info = {"model": MODEL, "estimate": est, "spent_jpy": round(spent_jpy(ledger), 1), "cap_jpy": ledger.get("cap_jpy", BUDGET_JPY),
            "sent": False, "candidates": len(cands)}
    if not run:
        return None, info                                          # 既定は送らない
    check_budget(est, ledger)
    if client is None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY が設定されていません(環境変数だけから読みます)")
        import anthropic
        client = anthropic.Anthropic(max_retries=0)                 # 自動で繰り返さない
    t0 = time.time()
    entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "model": MODEL, "purpose": purpose,
             "estimate_jpy_worst": est["jpy_worst"], "status": "started", "jpy": 0.0}
    ledger["runs"].append(entry)
    save_ledger(ledger, ledger_path)                              # 送る前に記録する(途中で止まっても見積もり分を計上し続ける)
    entry["jpy"] = est["jpy_worst"]
    try:
        with client.messages.stream(model=MODEL, max_tokens=MAX_OUTPUT_TOKENS, system=SYSTEM,
                                    thinking={"type": "adaptive"}, output_config={"effort": "medium",
                                                                                  "format": {"type": "json_schema", "schema": SCHEMA}},
                                    messages=[{"role": "user", "content": content}]) as stream:
            msg = stream.get_final_message()
    except Exception as e:
        entry.update(status="error", error=type(e).__name__)
        save_ledger(ledger, ledger_path)
        raise                                                       # 失敗しても自動で再実行しない
    u = msg.usage
    usd = usd_cost(u)
    entry.update(status="ok" if msg.stop_reason != "refusal" else "refusal", stop_reason=msg.stop_reason,
                 input_tokens=int(getattr(u, "input_tokens", 0) or 0), output_tokens=int(getattr(u, "output_tokens", 0) or 0),
                 cache_read=int(getattr(u, "cache_read_input_tokens", 0) or 0), usd=round(usd, 5), jpy=round(usd * JPY_PER_USD, 2),
                 seconds=round(time.time() - t0, 1), images=n_img, request_id=getattr(msg, "_request_id", None))
    save_ledger(ledger, ledger_path)
    info.update(sent=True, usage=entry, spent_jpy=round(spent_jpy(ledger), 1))
    if msg.stop_reason != "end_turn":                               # refusal・max_tokens など。自動で再実行しない
        info["problems"] = [f"stop_reason={msg.stop_reason}"]
        return None, info
    text = next((b.text for b in msg.content if b.type == "text"), "")
    choice = json.loads(text)
    chosen, problems = validate(choice, cands, clips)
    if not chosen:
        info["problems"] = problems or ["採用する区間がありません"]
        return None, info
    planner.snap_to_beats(chosen, clips, beat)
    mood = choice.get("mood", "bright")
    rejected = [dict({k: v for k, v in c.items() if k != "emb"}, reason="Sonnet: 不採用") for c in cands if c["id"] not in {d["id"] for d in chosen}]
    why = {e["id"]: e["reason"] for e in choice.get("excluded", [])}
    for r in rejected:
        if r["id"] in why:
            r["reason"] = "Sonnet: " + why[r["id"]]
    edl = {"target_sec": choice.get("target_sec"), "mood": mood, "story": choice.get("story", ""), "problems": problems,
           "total_sec": round(sum(c["dur"] for c in chosen), 2), "n_candidates": len(cands),
           "segments": [{k: v for k, v in c.items() if k != "emb"} for c in chosen], "rejected": rejected}
    return edl, info
