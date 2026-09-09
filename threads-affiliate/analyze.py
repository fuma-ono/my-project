"""publish-log.jsonlを集計し、実績レポートを作る(売上最大化レビューP1-5/P1-6対応)。

## 方針(2026-09-09、オーナー指示)

「今は売れるデータを集める期間」なので、複雑な統計判定やAI予測は行わない。
単純な集計のみを行い、判断が必要な部分(「この投稿形式が勝ち」等)は
サンプル数が十分になるまで**「判断不能」と明示する**(推測しない)。

## できること・できないこと

- views/likes/replies/reposts/quotes/shares/clicks は Threads Insights API から
  取得済みの実データを集計する
- 「クリック率(CTR相当)」は clicks / views の単純比。ただし clicks は
  リンク・ハッシュタグ・メンション・メディアへのクリックの合算であり、
  アフィリエイトリンク単体のクリック数ではない点に注意(過大評価しうる)
- **「売上につながった投稿」は現状データが存在しないため常に「データなし」と表示する**
  (楽天・Amazon管理画面からの手動転記が必要。
  docs/marketing/2026-09-09-affiliate-conversion-tracking-design.md 参照)
- 推測・予測は一切行わない。実データが無い集計軸は「データなし」と表示する

## 使い方

```
python threads-affiliate/analyze.py
```

`threads-affiliate/performance-report.md` を生成する。
"""

import json
import pathlib
from collections import defaultdict

HERE = pathlib.Path(__file__).parent
LOG_FILE = HERE / "publish-log.jsonl"
REPORT_FILE = HERE / "performance-report.md"

METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares", "clicks"]

# この件数に満たない集計軸は「判断不能」として明示する(2026-09-09、
# オーナー指示: 十分なデータが集まるまでは判断不能を許容する)。
MIN_SAMPLE_FOR_JUDGEMENT = 10


def load_entries() -> list[dict]:
    if not LOG_FILE.exists():
        return []
    entries = []
    for line in LOG_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        entries.append(json.loads(line))
    return entries


def sum_metrics(entries: list[dict]) -> dict:
    totals = {m: 0 for m in METRICS}
    unmeasured = 0
    for e in entries:
        if e.get("last_metrics_at") is None:
            unmeasured += 1
            continue
        for m in METRICS:
            totals[m] += e.get(m) or 0
    return totals, unmeasured


def ctr_like(totals: dict) -> str:
    """clicks/viewsの単純比。views=0の場合は算出不能として明示する。"""
    if totals["views"] == 0:
        return "算出不能(views=0)"
    return f"{totals['clicks'] / totals['views'] * 100:.2f}%(参考値、clicksはリンク以外も含む合算)"


def group_by(entries: list[dict], key: str) -> dict[str, list[dict]]:
    groups = defaultdict(list)
    for e in entries:
        groups[e.get(key) or "(未設定)"].append(e)
    return groups


def format_group_table(groups: dict[str, list[dict]], label: str) -> list[str]:
    lines = [
        f"### {label}別",
        "",
        f"| {label} | 投稿数 | views合計 | likes合計 | clicks合計 | CTR相当 |",
        "|---|---|---|---|---|---|",
    ]
    for key, group_entries in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        totals, unmeasured = sum_metrics(group_entries)
        n = len(group_entries)
        note = f"(うち{unmeasured}件は実績未取得)" if unmeasured else ""
        lines.append(
            f"| {key} | {n}{note} | {totals['views']} | {totals['likes']} | "
            f"{totals['clicks']} | {ctr_like(totals)} |"
        )
        if n < MIN_SAMPLE_FOR_JUDGEMENT:
            lines.append(f"| | *サンプル{n}件 < {MIN_SAMPLE_FOR_JUDGEMENT}件のため、この{label}が良いかは判断不能* | | | | |")
    lines.append("")
    return lines


def top_n(entries: list[dict], sort_key: str, n: int = 5) -> list[dict]:
    measured = [e for e in entries if e.get("last_metrics_at") is not None]
    return sorted(measured, key=lambda e: e.get(sort_key) or 0, reverse=True)[:n]


def format_post_row(e: dict) -> str:
    text_preview = (e.get("text") or "").split("\n")[0][:30]
    return (
        f"| {e.get('post_id')} | {e.get('published_date', '?')} | {text_preview}... | "
        f"{e.get('product_name', '?')} | {e.get('views', 0)} | {e.get('likes', 0)} | "
        f"{e.get('clicks', 0)} |"
    )


def main() -> None:
    entries = load_entries()
    lines = [
        "# Threadsアフィリエイト 実績レポート",
        "",
        f"`publish-log.jsonl`の集計結果(自動生成、`analyze.py`)。総投稿数: {len(entries)}件。",
        "",
        "**注意**: 推測・予測は一切含まない。実データが無い項目は「データなし」と明示する。",
        f"集計軸ごとにサンプル数が{MIN_SAMPLE_FOR_JUDGEMENT}件未満の場合は「判断不能」と表示する"
        "(オーナー方針: 検証期間中は十分なデータが集まるまで判断しない)。",
        "",
    ]

    if not entries:
        lines.append("投稿履歴がありません。")
        REPORT_FILE.write_text("\n".join(lines), encoding="utf-8")
        print("投稿履歴が無いため、空のレポートを出力しました。")
        return

    totals, unmeasured = sum_metrics(entries)
    lines += [
        "## 全体サマリー",
        "",
        f"- 投稿数: {len(entries)}件(うち実績未取得: {unmeasured}件)",
        f"- views合計: {totals['views']}",
        f"- likes合計: {totals['likes']}",
        f"- replies合計: {totals['replies']}",
        f"- reposts合計: {totals['reposts']}",
        f"- quotes合計: {totals['quotes']}",
        f"- shares合計: {totals['shares']}",
        f"- clicks合計: {totals['clicks']}",
        f"- CTR相当: {ctr_like(totals)}",
        "",
        "## 売上につながった投稿",
        "",
        "**データなし。** 楽天・Amazonの成果(クリック数・注文数・報酬額)は自動取得できないため、"
        "現時点では「どの投稿が売上につながったか」を判定できない。"
        "`docs/marketing/2026-09-09-affiliate-conversion-tracking-design.md`の手順で"
        "月次に手動突合を行い、判明次第この節に追記する。",
        "",
        "## 伸びた投稿(views上位)",
        "",
        "| post_id | 投稿日 | 本文冒頭 | 商品 | views | likes | clicks |",
        "|---|---|---|---|---|---|---|",
    ]
    for e in top_n(entries, "views"):
        lines.append(format_post_row(e))
    if not any(e.get("last_metrics_at") for e in entries):
        lines.append("| (実績取得済みの投稿がありません) | | | | | | |")
    lines.append("")

    lines += [
        "## クリックされた投稿(clicks上位)",
        "",
        "| post_id | 投稿日 | 本文冒頭 | 商品 | views | likes | clicks |",
        "|---|---|---|---|---|---|---|",
    ]
    for e in top_n(entries, "clicks"):
        lines.append(format_post_row(e))
    if not any(e.get("last_metrics_at") for e in entries):
        lines.append("| (実績取得済みの投稿がありません) | | | | | | |")
    lines.append("")

    lines += format_group_table(group_by(entries, "post_type"), "投稿パターン")
    lines += format_group_table(group_by(entries, "category"), "カテゴリ")
    lines += format_group_table(group_by(entries, "product_name"), "商品")
    lines += format_group_table(group_by(entries, "affiliate_platform"), "アフィリエイトプラットフォーム")

    REPORT_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(entries)}件の投稿を集計し、{REPORT_FILE} に書き出しました。")


if __name__ == "__main__":
    main()
