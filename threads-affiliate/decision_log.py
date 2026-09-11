"""AIの戦略判断を記録するための構造(将来の「AI CEO」運営に備える)。

## 位置づけ(2026-09-11、オーナー指示「次フェーズ実装指示」)

**現時点では戦略の自動変更そのものは実装しない。** このモジュールは
「将来、投稿数が30件を超えてPhase 2(分析→仮説→戦略変更)に進む際に、
判断の経緯を記録できる構造」を今のうちに用意するだけのもの。
`threads-affiliate/decision-log.jsonl` に1行1判断で追記していく。

呼び出す主体は将来的にはClaude Code Remoteの週次Routine(戦略変更ループ)を
想定しているが、現状はどこからも自動的には呼ばれない(呼び出しコードは
まだ書かれていない、フィールド定義とヘルパー関数のみ用意する)。

## スキーマ

- decision_id: 一意なID(自動採番、`d` + 連番4桁)
- decision_at: 判断した日付(YYYY-MM-DD)
- analysis_period: 分析対象期間(例: "2026-09-01〜2026-09-30")
- observed_data: 観測した事実(例: "キッチンカテゴリのCTRが全体平均より高い")
- hypothesis: 立てた仮説(例: "キッチン×1,000〜3,000円の商品はクリック意欲が高い")
- decision: 実際に行った変更内容(例: "翌週のキッチン商品の比率を20%→35%に変更")
- reason: その判断の根拠
- expected_result: 期待する結果
- actual_result: 実際の結果(判断時点ではnull、後日`update_actual_result()`で埋める)
- status: "pending"(結果待ち) | "success"(狙い通り) | "failure"(狙い外れ) | "inconclusive"(判断不能)

## 使い方(将来、Phase 2開始後)

```python
from decision_log import record_decision, update_actual_result

decision_id = record_decision(
    analysis_period="2026-09-01〜2026-09-30",
    observed_data="キッチンカテゴリのCTRが全体平均より高い",
    hypothesis="キッチン×1,000〜3,000円の商品はクリック意欲が高い",
    decision="翌週のキッチン商品の比率を20%→35%に変更",
    reason="過去投稿データでクリック率・成果が高かったため",
    expected_result="クリック率と成果件数の向上",
)

# 翌週、結果が出たら:
update_actual_result(decision_id, actual_result="クリック率+15%", status="success")
```
"""

import datetime
import json
import pathlib

HERE = pathlib.Path(__file__).parent
LOG_FILE = HERE / "decision-log.jsonl"

VALID_STATUSES = {"pending", "success", "failure", "inconclusive"}

REQUIRED_FIELDS = [
    "analysis_period",
    "observed_data",
    "hypothesis",
    "decision",
    "reason",
    "expected_result",
]


def _load_all() -> list[dict]:
    if not LOG_FILE.exists():
        return []
    return [
        json.loads(line)
        for line in LOG_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _next_decision_id(entries: list[dict]) -> str:
    max_n = 0
    for e in entries:
        did = e.get("decision_id", "")
        if did.startswith("d") and did[1:].isdigit():
            max_n = max(max_n, int(did[1:]))
    return f"d{max_n + 1:04d}"


def record_decision(
    *,
    analysis_period: str,
    observed_data: str,
    hypothesis: str,
    decision: str,
    reason: str,
    expected_result: str,
    decision_at: str | None = None,
) -> str:
    """新しい意思決定を1件記録し、decision_idを返す。actual_result/statusはpending初期化。"""
    entries = _load_all()
    decision_id = _next_decision_id(entries)
    entry = {
        "decision_id": decision_id,
        "decision_at": decision_at or datetime.date.today().isoformat(),
        "analysis_period": analysis_period,
        "observed_data": observed_data,
        "hypothesis": hypothesis,
        "decision": decision,
        "reason": reason,
        "expected_result": expected_result,
        "actual_result": None,
        "status": "pending",
    }
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return decision_id


def update_actual_result(decision_id: str, actual_result: str, status: str) -> None:
    """後日、結果が判明した時点でactual_result/statusを埋める(全件書き直し)。"""
    if status not in VALID_STATUSES:
        raise ValueError(f"statusは{VALID_STATUSES}のいずれかである必要があります: {status}")
    entries = _load_all()
    found = False
    for e in entries:
        if e.get("decision_id") == decision_id:
            e["actual_result"] = actual_result
            e["status"] = status
            found = True
            break
    if not found:
        raise ValueError(f"decision_id={decision_id} が見つかりません")
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    print(f"記録済みの意思決定: {len(_load_all())}件")
    print(f"ログファイル: {LOG_FILE}")
