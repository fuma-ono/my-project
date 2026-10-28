"""ECB の週間予定の公開ページを1回読み、予定の部分だけを保存して記録する(HQ指示 2026-10-28「ECB週間予定の
2週間観測を GitHub Actions へ移行」)。.github/workflows/fx-ecb-weekly-snapshot.yml から動かす。社内PCには置かない。

    python3 fx_ecb_weekly_snapshot.py <記録のブランチ ecb-weekly-snapshots を checkout したフォルダ>

- 公開のページを読むだけ。DB・API・キーは使わない
- リポジトリは公開なので、保存するのは予定の部分(<dt>/<dd>)だけ。連絡先(担当者・電話・メール)は消す。先頭に出典(ECB)
- 期間: 最初の実行から14日間(state.json の started_at / stop_after)。過ぎたら何も取得せず、GITHUB_OUTPUT に
  expired=true を書く(ワークフローが自分を無効にする)。state.json が無いのに保存ページがある(記録が壊れた)ときも、
  新しい期間を始めずに止める
- 保存: snapshots/YYYYMMDDTHHMMZ.html(取得した時刻、UTC)。HTTP 200 で項目が1件以上読めたときだけ保存する
  (失敗・項目0件のページは保存しない → 次の差分の基準は、最後に正しく読めたページのまま。誤った差分を作らない)
- 記録: log.jsonl に1行(JSON)、log.md に1行。取得日時・HTTP の結果・ページの更新日時(項目の Last modified の最大と
  HTTP の Last-Modified)・全項目数・役員項目数・前回との追加/削除・解析エラー・取得エラー
- 解析エラー: 項目0件、役員の項目の名前・日付・時刻(HH:MM CET)が読めない。backend の解析(ecbWeeklySchedule.ts)の
  「区別できない日」に当たる項目と同じ見方。正確な結果は backend の tests/ingestion/ecbWeeklyReplay.test.ts で再現する
"""
import datetime as dt
import glob
import html as htmllib
import json
import os
import re
import sys
import urllib.error
import urllib.request

URL = "https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html"
OBSERVATION_DAYS = 14
PAIR = re.compile(r"<dt>([\s\S]*?)</dt>\s*<dd>([\s\S]*?)</dd>", re.I)
DATE = re.compile(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})")
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], 1)}
CONTACT = re.compile(r"<strong>\s*Contact[^<]*</strong>[\s\S]*?(?=<strong>\s*Last modified|<small|$)", re.I)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"\+?\d[\d\s\-()/.]{7,}\d")


def text(fragment):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def field(dd, label):
    m = re.search(r"<strong>\s*" + label + r":\s*</strong>([\s\S]*?)(?:<br\s*/?>|<strong>|<small>|$)", dd, re.I)
    return text(m.group(1)) if m else None


def sanitize(dd):
    """連絡先を消す(担当者名・電話・メール)。予定の項目(役員・題名・時刻・会場・更新日時)は残す。"""
    dd = CONTACT.sub("", dd)
    dd = EMAIL.sub("[email removed]", dd)
    return PHONE.sub("[phone removed]", dd)


def parse(pairs):
    """(全項目のキー, 役員の項目のキー, 解析エラー, Last modified の最大)。キー = '日付 | 役員 | 時刻 | 題名'。"""
    items, board, errors, stamps = [], [], [], []
    if not pairs:
        errors.append("NO_ENTRIES(ページの形が変わった可能性)")
    for dt_html, dd in pairs:
        m = DATE.search(text(dt_html))
        day = (f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
               if m and m.group(2).lower() in MONTHS else None)
        name = field(dd, "Board member")
        event = (field(dd, "Event") or "")[:120]
        time = re.split(r"\s*Last modified", field(dd, "Time") or "")[0][:40]
        stamps += [s.strip() for s in re.findall(r"Last modified:\s*([^<]+?)(?:<|$)", dd)]
        key = f"{day or '?'} | {name or '-'} | {time} | {event}"
        items.append(key)
        if name or re.search(r"Board\s*member", text(dd), re.I):
            board.append(key)
            if not name:
                errors.append(f"BOARD_MEMBER_UNREADABLE: {key}")
            if not day:
                errors.append(f"DATE_UNPARSEABLE: {key}")
            if not re.match(r"^\d{1,2}[:.]\d{2}\s*CET\b", time):
                errors.append(f"TIME_NOT_CET: {key}")
    parsed = []
    for s in stamps:
        try:
            parsed.append((dt.datetime.strptime(re.sub(r"\s*CES?T$", "", s), "%d %B %Y, %H:%M"), s))
        except ValueError:
            pass
    return items, board, errors, (max(parsed)[1] if parsed else None)


def write_output(key, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")


def log(out, record):
    with open(os.path.join(out, "log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    md = os.path.join(out, "log.md")
    if not os.path.exists(md):
        with open(md, "w", encoding="utf-8") as f:
            f.write("# ECB 週間予定の観測の記録\n\n出典: 欧州中央銀行（ECB） " + URL + "(予定の部分だけ。連絡先は削除)\n\n"
                    "| 取得日時(UTC) | HTTP | ページの更新日時 | 全項目 | 役員項目 | 前回との差分 | 解析エラー | 取得エラー |\n"
                    "|---|---|---|---|---|---|---|---|\n")
    diff = "—" if "added" not in record else f"+{len(record['added'])} / −{len(record['removed'])}"
    with open(md, "a", encoding="utf-8") as f:
        f.write(f"| {record['fetched_at']} | {record.get('http_status')} | {record.get('page_last_modified') or '-'} | "
                f"{record.get('entries', '-')} | {record.get('board_items', '-')} | {diff} | "
                f"{len(record.get('parse_errors', []))} | {record.get('error') or ''} |\n")


def observation_window(out, now):
    """(続けるか, state)。最初の実行で14日間を決めて state.json に書く。"""
    state_path = os.path.join(out, "state.json")
    if os.path.exists(state_path):
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        return now < dt.datetime.fromisoformat(state["stop_after"]), state
    if glob.glob(os.path.join(out, "snapshots", "*.html")) or os.path.exists(os.path.join(out, "log.jsonl")):
        # 記録はあるのに期間の記録が無い = 記録が壊れた。新しい14日を始めない(自動で続けない)
        return False, {"error": "state.json が無いのに記録がある。新しい期間は始めない"}
    state = {
        "started_at": now.isoformat(timespec="seconds"),
        "stop_after": (now + dt.timedelta(days=OBSERVATION_DAYS)).isoformat(timespec="seconds"),
        "observation_days": OBSERVATION_DAYS,
        "source": URL,
    }
    os.makedirs(out, exist_ok=True)
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    return True, state


def main(out):
    now = dt.datetime.now(dt.timezone.utc)
    active, state = observation_window(out, now)
    if not active:
        print(f"観測の期間外。何も取得しない: {json.dumps(state, ensure_ascii=False)}")
        write_output("expired", "true")
        return
    write_output("expired", "false")
    os.makedirs(os.path.join(out, "snapshots"), exist_ok=True)
    record = {"fetched_at": now.isoformat(timespec="seconds"), "url": URL}
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; fx-ecb-weekly-snapshot)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            record["http_status"] = res.status
            record["http_last_modified"] = res.headers.get("Last-Modified")
            body = res.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        record.update({"http_status": e.code, "error": f"HTTPError {e.code}"})
        log(out, record)
        print(json.dumps(record, ensure_ascii=False))
        return
    except Exception as e:  # noqa: BLE001 — 通信の失敗も記録して終える(保存も差分も作らない)
        record.update({"http_status": None, "error": f"{type(e).__name__}: {e}"[:300]})
        log(out, record)
        print(json.dumps(record, ensure_ascii=False))
        return

    pairs = [(d, sanitize(dd)) for d, dd in PAIR.findall(body)]
    items, board, errors, latest = parse(pairs)
    record.update({"page_last_modified": latest, "entries": len(items), "board_items": len(board),
                   "parse_errors": errors})
    if not pairs:
        # 項目が1件も読めないページは保存しない(次の差分が「全部追加」にならないように)
        record["error"] = "NO_ENTRIES: 保存せず、差分も作らない"
        log(out, record)
        print(json.dumps(record, ensure_ascii=False))
        return

    previous = sorted(glob.glob(os.path.join(out, "snapshots", "*Z.html")))
    name = now.strftime("%Y%m%dT%H%MZ") + ".html"
    with open(os.path.join(out, "snapshots", name), "w", encoding="utf-8") as f:
        f.write(f"<!-- Source: European Central Bank (ECB), {URL} — fetched {record['fetched_at']}. "
                "Schedule entries only; contact details removed. -->\n<dl>\n")
        for d, dd in pairs:
            f.write(f"<dt>{d}</dt>\n<dd>{dd}</dd>\n")
        f.write("</dl>\n")
    record["snapshot"] = name
    if previous:
        with open(previous[-1], encoding="utf-8") as f:
            prev_items = set(parse(PAIR.findall(f.read()))[0])
        record["previous"] = os.path.basename(previous[-1])
        record["added"] = sorted(set(items) - prev_items)
        record["removed"] = sorted(prev_items - set(items))
    log(out, record)
    print(json.dumps({k: v for k, v in record.items() if k not in ("added", "removed")}, ensure_ascii=False))
    print(f"added {len(record.get('added', []))}, removed {len(record.get('removed', []))}")


if __name__ == "__main__":
    main(sys.argv[1])
