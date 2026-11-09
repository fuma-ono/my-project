"""Threadsの新着コメント(返信)を集め、未対応分をreplies-pending.jsonに書き出す。

## 完全自動返信の全体フロー(2026-09-10〜、オーナー指示)

1. **fetch_replies.py(このファイル)** — 新着コメントを集める。判断は一切しない
2. Claude Code Remoteの定期Routineが `replies-pending.json` を読み、
   `docs/marketing/2026-09-10-threads-auto-reply-guardrails.md` のガードレールに
   従って各コメントへの対応(reply/skip)を判断し、`reply-decisions.json` に書く
3. **send_replies.py** — `reply-decisions.json` を読み、実際にThreadsへ返信を
   投稿してログ(`replies-log.jsonl`)に記録する

対象は `publish-log.jsonl` に記録されている投稿(`post_id`があり、かつ
`deleted_at`が付いていない=削除されていないもの)のみ。既に対応済み
(`replies-log.jsonl`にcomment_idがある)コメントは対象から除外する(二重対応防止)。

## 実行方法

    python threads-affiliate/fetch_replies.py

★オーナーのPC/GitHub Actions等、graph.threads.netに到達できる環境で実行する
(publish.pyと同じ制約)。
"""

import json
import pathlib

import automation_guard
from threads_client import api_get, load_token

HERE = pathlib.Path(__file__).parent
LOG_FILE = HERE / "publish-log.jsonl"
REPLIES_LOG_FILE = HERE / "replies-log.jsonl"
PENDING_FILE = HERE / "replies-pending.json"

# Threads APIの返信オブジェクトから取得するフィールド。存在が確認できている
# ものだけに絞る(未確認のフィールド名を指定してAPIエラーになるのを避けるため)。
REPLY_FIELDS = "id,text,username,timestamp"


def load_published_posts() -> list[dict]:
    if not LOG_FILE.exists():
        return []
    posts = []
    for line in LOG_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        if not entry.get("post_id") or entry.get("deleted_at"):
            continue
        posts.append(entry)
    return posts


def load_handled_comment_ids() -> set[str]:
    """既にreplies-log.jsonlに記録済み(返信済みまたはスキップ済み)のcomment_id集合。

    二重返信・二重判断を防ぐため、一度でもログに載ったコメントは以後の
    fetchで対象から除外する。
    """
    if not REPLIES_LOG_FILE.exists():
        return set()
    ids = set()
    for line in REPLIES_LOG_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        if entry.get("comment_id"):
            ids.add(entry["comment_id"])
    return ids


def fetch_replies_for_post(post_id: str, access_token: str) -> list[dict]:
    result = api_get(f"{post_id}/replies", {
        "access_token": access_token,
        "fields": REPLY_FIELDS,
    })
    return result.get("data", [])


def main() -> None:
    # 2026-09-11、オーナー指示「完全自動運営の安全基盤」: 一時停止中は
    # 無駄なAPI呼び出しをしない(読み取り専用だが念のため)。
    automation_guard.ensure_not_paused("fetch_replies")

    access_token, _user_id = load_token()
    posts = load_published_posts()
    handled = load_handled_comment_ids()

    pending = []
    for post in posts:
        post_id = post["post_id"]
        try:
            replies = fetch_replies_for_post(post_id, access_token)
        except Exception as e:  # noqa: BLE001 — 1投稿分の取得失敗で全体を止めない
            print(f"警告: post_id={post_id} の返信取得に失敗しました: {e}")
            continue

        for reply in replies:
            comment_id = reply.get("id")
            if not comment_id or comment_id in handled:
                continue
            pending.append({
                "comment_id": comment_id,
                "post_id": post_id,
                # ガードレール判断・返信文生成に使う商品コンテキスト
                "product_name": post.get("product_name"),
                "category": post.get("category"),
                "affiliate_url": post.get("affiliate_url"),
                "affiliate_platform": post.get("affiliate_platform"),
                "original_post_text": post.get("text"),
                # コメント本体
                "from_username": reply.get("username"),
                "comment_text": reply.get("text"),
                "received_at_hint": reply.get("timestamp"),
            })

    PENDING_FILE.write_text(json.dumps(pending, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"新着の未対応コメント {len(pending)} 件を {PENDING_FILE} に書き出しました。")


if __name__ == "__main__":
    main()
