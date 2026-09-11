"""完全自動運営の暴走防止(サーキットブレーカー)。

## 目的(2026-09-11、オーナー指示「完全自動運営の安全基盤」)

投稿・返信が完全自動化されている以上、「エラーが起きているのに気づかず
延々と実行を繰り返す」状態が一番危険。このモジュールは、既存の
publish.py/send_replies.py/fetch_replies.pyのロジックを書き換えずに、
最小限のフック(実行前チェック・成功/失敗の記録)を追加するためのもの。

## 仕組み

`threads-affiliate/automation-status.json` に状態を保存する:

    {
      "paused": false,
      "pause_reason": null,
      "consecutive_publish_failures": 0,
      "consecutive_reply_failures": 0,
      "last_updated": "..."
    }

- 各スクリプトは実行の最初に `ensure_not_paused()` を呼ぶ。一時停止中なら
  即座に終了する(無人実行中に同じエラーで何度も再試行し続けるのを防ぐ)
- 成功したら `record_success(kind)` で連続失敗カウントをリセット
- 失敗したら `record_failure(kind, reason)` でカウントを増やし、
  `MAX_CONSECUTIVE_FAILURES` に達したら自動的に一時停止(`paused: true`)する
- 一時停止・復帰はどちらもこのファイルを直接編集すれば良い(新しいDBは作らない)。
  再開するには `"paused": false` に戻す(オーナーまたはRoutineが判断)

## 復帰方法

原因を解消した後、`threads-affiliate/automation-status.json` の
`"paused"` を `false` に戻し、`"consecutive_publish_failures"` /
`"consecutive_reply_failures"` を `0` に戻してコミットすれば再開する。
"""

import datetime
import json
import pathlib

HERE = pathlib.Path(__file__).parent
STATUS_FILE = HERE / "automation-status.json"

# この回数、連続で失敗したら自動的に一時停止する(オーナー指示:
# 「エラーが発生しているのに自動処理を延々と繰り返す」状態の防止)。
MAX_CONSECUTIVE_FAILURES = 3

# 短時間での異常な投稿・返信数を検知するしきい値。
MAX_POSTS_PER_24H = 3          # 通常運用は1日1投稿のため、3件で明らかに異常
MAX_REPLIES_PER_HOUR_GLOBAL = 20  # 全ユーザー合計で1時間にこの件数を超えたら異常


def _load() -> dict:
    if not STATUS_FILE.exists():
        return {
            "paused": False,
            "pause_reason": None,
            "consecutive_publish_failures": 0,
            "consecutive_reply_failures": 0,
            "last_updated": None,
        }
    return json.loads(STATUS_FILE.read_text(encoding="utf-8"))


def _save(status: dict) -> None:
    status["last_updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    STATUS_FILE.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def is_paused() -> tuple[bool, str | None]:
    status = _load()
    return status.get("paused", False), status.get("pause_reason")


def ensure_not_paused(kind: str) -> None:
    """一時停止中なら理由を表示してプロセスを終了する(sys.exit(1))。

    kind: "publish" | "fetch_replies" | "send_replies" (ログ表示用のラベル)
    """
    paused, reason = is_paused()
    if paused:
        print(
            f"[automation_guard] 自動運営は一時停止中のため{kind}を実行しません: {reason}\n"
            f"原因を確認・解消後、{STATUS_FILE.name} の paused を false に戻してください。"
        )
        raise SystemExit(1)


def record_success(kind: str) -> None:
    """kind: 'publish' または 'reply' の連続失敗カウントをリセットする。"""
    status = _load()
    key = f"consecutive_{kind}_failures"
    if status.get(key, 0) != 0:
        status[key] = 0
        _save(status)


def record_failure(kind: str, reason: str) -> None:
    """kind: 'publish' または 'reply'。連続失敗をカウントし、しきい値超えで一時停止する。"""
    status = _load()
    key = f"consecutive_{kind}_failures"
    status[key] = status.get(key, 0) + 1
    if status[key] >= MAX_CONSECUTIVE_FAILURES and not status.get("paused"):
        status["paused"] = True
        status["pause_reason"] = (
            f"{kind}が{status[key]}回連続で失敗したため自動停止しました。"
            f"直近のエラー: {reason}"
        )
    _save(status)


def count_recent_posts(publish_log_path: pathlib.Path, hours: int) -> int:
    """publish-log.jsonlのうち、直近hours時間以内に公開された件数を数える。"""
    if not publish_log_path.exists():
        return 0
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    count = 0
    for line in publish_log_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        published_at = entry.get("published_at")
        if not published_at or entry.get("deleted_at"):
            continue
        try:
            ts = datetime.datetime.fromisoformat(published_at)
        except ValueError:
            continue
        if ts >= cutoff:
            count += 1
    return count


def count_recent_replies(replies_log_path: pathlib.Path, hours: int) -> int:
    """replies-log.jsonlのうち、直近hours時間以内に返信成功した件数を数える(全ユーザー合計)。"""
    if not replies_log_path.exists():
        return 0
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    count = 0
    for line in replies_log_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        if entry.get("reply_status") != "replied":
            continue
        replied_at = entry.get("replied_at")
        if not replied_at:
            continue
        try:
            ts = datetime.datetime.fromisoformat(replied_at)
        except ValueError:
            continue
        if ts >= cutoff:
            count += 1
    return count
