"""判断済みの返信案(reply-decisions.json)を実際にThreadsへ投稿し、ログに記録する。

完全自動返信フロー(fetch_replies.py参照)の最終ステップ。内容面の判断
(医療/法律等の高リスク領域を避ける、断定的な情報を書かない等)はこのスクリプトの
責務ではなく、reply-decisions.jsonを作る側(Claude)の責務。
詳細: docs/marketing/2026-09-10-threads-auto-reply-guardrails.md

## 入力フォーマット(reply-decisions.json、配列)

```json
[
  {
    "comment_id": "...",
    "post_id": "...",
    "from_username": "...",
    "comment_text": "...(ログ用、fetch_replies.pyの出力をそのまま転記)",
    "received_at_hint": "...(ログ用)",
    "affiliate_url": "...(ログ用、fetch_replies.pyの出力をそのまま転記)",
    "action": "reply" または "skip",
    "reply_text": "...(action=replyの場合必須)",
    "skip_reason": "...(action=skipの場合必須)"
  }
]
```

## このスクリプトがコード側で強制するガードレール

- **二重返信防止**: `replies-log.jsonl`に既にcomment_idがあれば何もしない
- **同一ユーザーへのレート制限**: 直近24時間に同じユーザーへ自動返信済みの件数が
  `RATE_LIMIT_PER_USER`件以上ならスキップし、理由をログに残す(スパム化防止)
- **PR表記の強制**: 返信文にアフィリエイトリンクが含まれるのにPR表記が
  無い場合、自動的に先頭へ「(PR)」を補う(publish.pyのPR表記検証と同じ
  景品表示法対応の考え方を、返信にも適用する)
- **エラー時は即座に諦める**: リトライを繰り返さず、エラー内容をログに記録して
  次の項目へ進む(スパム化・API制限への抵触を避ける)

## 実行方法

    python threads-affiliate/send_replies.py
"""

import datetime
import pathlib
import time
import json

from threads_client import api_post, load_token

HERE = pathlib.Path(__file__).parent
DECISIONS_FILE = HERE / "reply-decisions.json"
REPLIES_LOG_FILE = HERE / "replies-log.jsonl"

RATE_LIMIT_PER_USER = 3  # 同一ユーザーへの24時間以内の自動返信の上限(オーナー指示のスパム対策)

# publish.pyのPR_MARKERSと同じ考え方(景品表示法のステマ規制対応)。
# 返信は投稿と違って「先頭10文字以内」という位置の制約までは課さないが、
# アフィリエイトリンクを含む返信には必ずPR表記を含める。
PR_MARKERS = ["【PR】", "#PR", "#広告", "[PR]", "(PR)"]


def load_replies_log() -> list[dict]:
    if not REPLIES_LOG_FILE.exists():
        return []
    return [
        json.loads(line)
        for line in REPLIES_LOG_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def log_reply(entry: dict) -> None:
    with open(REPLIES_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def already_handled(log: list[dict], comment_id: str) -> bool:
    return any(e.get("comment_id") == comment_id for e in log)


def recent_reply_count_for_user(log: list[dict], username: str | None, now: datetime.datetime) -> int:
    if not username:
        return 0
    cutoff = now - datetime.timedelta(hours=24)
    count = 0
    for e in log:
        if e.get("user_id") != username or e.get("reply_status") != "replied":
            continue
        replied_at = e.get("replied_at")
        if not replied_at:
            continue
        try:
            ts = datetime.datetime.fromisoformat(replied_at)
        except ValueError:
            continue
        if ts >= cutoff:
            count += 1
    return count


def ensure_pr_disclosure(reply_text: str, affiliate_url: str | None) -> str:
    """返信文にアフィリエイトリンクが含まれるのにPR表記が無ければ補う。"""
    if not affiliate_url or affiliate_url not in reply_text:
        return reply_text
    if any(marker in reply_text for marker in PR_MARKERS):
        return reply_text
    return f"(PR) {reply_text}"


def main() -> None:
    if not DECISIONS_FILE.exists():
        print(f"{DECISIONS_FILE} が見つかりません。fetch_replies.py→判断の順で先に用意してください。")
        return

    decisions = json.loads(DECISIONS_FILE.read_text(encoding="utf-8"))
    if not decisions:
        print("対応対象の返信はありません。")
        return

    access_token, user_id = load_token()
    log = load_replies_log()
    now = datetime.datetime.now(datetime.timezone.utc)

    replied_count = 0
    skipped_count = 0
    error_count = 0

    for item in decisions:
        comment_id = item["comment_id"]
        if already_handled(log, comment_id):
            continue

        base_entry = {
            "reply_id": None,
            "post_id": item.get("post_id"),
            "comment_id": comment_id,
            # Threadsの公開ユーザー名(@handle)のみを保存する。氏名・連絡先等の
            # 個人情報は取得も保存もしない(オーナー指示)。
            "user_id": item.get("from_username"),
            "received_at": item.get("received_at_hint"),
            "comment_text": item.get("comment_text"),
            "generated_reply": None,
            "replied_at": None,
            "reply_status": None,
            "skip_reason": None,
            "affiliate_link_used": False,
        }

        if item.get("action") == "skip":
            base_entry["reply_status"] = "skipped"
            base_entry["skip_reason"] = item.get("skip_reason") or "(理由未指定)"
            log_reply(base_entry)
            log.append(base_entry)
            skipped_count += 1
            continue

        recent = recent_reply_count_for_user(log, item.get("from_username"), now)
        if recent >= RATE_LIMIT_PER_USER:
            base_entry["reply_status"] = "skipped"
            base_entry["skip_reason"] = (
                f"レート制限(同一ユーザーへの24時間以内の自動返信が{RATE_LIMIT_PER_USER}件以上)"
            )
            log_reply(base_entry)
            log.append(base_entry)
            skipped_count += 1
            continue

        reply_text = item.get("reply_text")
        if not reply_text:
            base_entry["reply_status"] = "error"
            base_entry["skip_reason"] = "action=replyだがreply_textが空"
            log_reply(base_entry)
            log.append(base_entry)
            error_count += 1
            continue

        reply_text = ensure_pr_disclosure(reply_text, item.get("affiliate_url"))
        base_entry["generated_reply"] = reply_text
        base_entry["affiliate_link_used"] = bool(
            item.get("affiliate_url") and item["affiliate_url"] in reply_text
        )

        try:
            container = api_post(f"{user_id}/threads", {
                "media_type": "TEXT",
                "text": reply_text,
                "reply_to_id": comment_id,
                "access_token": access_token,
            })
            if "id" not in container:
                raise RuntimeError(f"コンテナ作成に失敗: {container}")
            creation_id = container["id"]

            time.sleep(3)  # Meta推奨: 公開前に数秒待つ(publish.pyと同じ)

            result = api_post(f"{user_id}/threads_publish", {
                "creation_id": creation_id,
                "access_token": access_token,
            })
            if "id" not in result:
                raise RuntimeError(f"返信の公開に失敗: {result}")

            base_entry["reply_id"] = result["id"]
            base_entry["replied_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            base_entry["reply_status"] = "replied"
            replied_count += 1
        except Exception as e:  # noqa: BLE001 — リトライせず記録して次へ進む(オーナー指示)
            base_entry["reply_status"] = "error"
            base_entry["skip_reason"] = f"API呼び出しエラー: {e}"
            error_count += 1

        log_reply(base_entry)
        log.append(base_entry)

    print(f"返信: {replied_count}件 / スキップ: {skipped_count}件 / エラー: {error_count}件")


if __name__ == "__main__":
    main()
