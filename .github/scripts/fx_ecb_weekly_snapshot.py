"""ECB の週間予定のページを1回読み、予定の部分だけを保存して記録する(HQ判断 2026-10-28: 1日2回・2週間)。

GitHub Actions(.github/workflows/fx-ecb-weekly-snapshot.yml)から動かす。社内PCには置かない(大野さん指示 2026-10-28)。

    python3 fx_ecb_weekly_snapshot.py <記録のブランチを checkout したフォルダ>

- 公開のページを読むだけ(キー・ログイン不要)
- このリポジトリは公開なので、保存するのは予定の部分(<dt>/<dd>)だけ。連絡先(電話・メール・担当者)は消す。
  先頭に出典(ECB)を書く
- 保存: snapshots/YYYYMMDDTHHMMZ.html(取得した時刻、UTC。HTTP 200 のときだけ)
- 記録: log.jsonl に1行(JSON)、log.md に1行
  取得日時・HTTP の結果・ページの更新日時(Last modified の最大と HTTP の Last-Modified)・項目の件数(全項目・役員の項目)・
  前回の保存との差分(追加・削除)・解析エラー(項目0件、役員の項目の名前・日付・時刻が読めない)
- 期間(2026-11-11 24:00 JST まで)を過ぎたら何もしない
ジョブと同じ解析の結果は、backend の tests/ingestion/ecbWeeklyReplay.test.ts に保存したページを流して確かめる。
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
UNTIL = dt.datetime(2026, 11, 11, 15, 0, tzinfo=dt.timezone.utc)  # 2026-11-12 00:00 JST
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
    return PHONE.sub(lambda m: m.group(0) if re.fullmatch(r"\d{1,2}[:.]\d{2}", m.group(0)) else "[phone removed]", dd)


def parse(pairs):
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


def log(out, record):
    with open(os.path.join(out, "log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    md = os.path.join(out, "log.md")
    if not os.path.exists(md):
        with open(md, "w", encoding="utf-8") as f:
            f.write("# ECB 週間予定の取得の記録\n\n出典: 欧州中央銀行（ECB） " + URL + "(連絡先は削除)\n\n"
                    "| 取得日時(UTC) | HTTP | ページの更新日時 | 項目 | 役員の項目 | 前回との差分 | 解析エラー | 取得エラー |\n"
                    "|---|---|---|---|---|---|---|---|\n")
    with open(md, "a", encoding="utf-8") as f:
        f.write(f"| {record['fetched_at']} | {record.get('http_status')} | {record.get('page_last_modified') or '-'} | "
                f"{record.get('entries', '-')} | {record.get('board_items', '-')} | "
                f"+{len(record.get('added', []))} / −{len(record.get('removed', []))} | "
                f"{len(record.get('parse_errors', []))} | {record.get('error') or ''} |\n")


def main(out):
    now = dt.datetime.now(dt.timezone.utc)
    if now >= UNTIL:
        print(f"期間外({UNTIL.isoformat()} まで)。何もしない")
        return
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
    except Exception as e:  # noqa: BLE001 — 通信の失敗も記録して終える
        record.update({"http_status": None, "error": f"{type(e).__name__}: {e}"[:300]})
        log(out, record)
        print(json.dumps(record, ensure_ascii=False))
        return

    pairs = [(d, sanitize(dd)) for d, dd in PAIR.findall(body)]
    name = now.strftime("%Y%m%dT%H%MZ") + ".html"
    with open(os.path.join(out, "snapshots", name), "w", encoding="utf-8") as f:
        f.write(f"<!-- Source: European Central Bank (ECB), {URL} — fetched {record['fetched_at']}. "
                "Schedule entries only; contact details removed. -->\n<dl>\n")
        for d, dd in pairs:
            f.write(f"<dt>{d}</dt>\n<dd>{dd}</dd>\n")
        f.write("</dl>\n")
    items, board, errors, latest = parse(pairs)
    record.update({"snapshot": name, "page_last_modified": latest, "entries": len(items),
                   "board_items": len(board), "parse_errors": errors})
    previous = sorted(f for f in glob.glob(os.path.join(out, "snapshots", "*Z.html")) if not f.endswith(name))
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
