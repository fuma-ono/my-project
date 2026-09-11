"""Threadsアクセストークンの生存確認だけを行う(投稿・返信とは無関係)。

## 背景(2026-09-11)

2026-09-09に取得したトークンが、2026-09-10の投稿時になって初めて
「API access blocked」で無効と判明した。21:05 JSTの投稿直前まで異常に
気づけない状態だったため、**もっと早く・頻繁に気づける仕組み**として
このスクリプトを作った。

投稿(`publish.py`)や返信(`fetch_replies.py`/`send_replies.py`)とは
完全に独立した、副作用の無い読み取り専用リクエスト
(`GET /{user_id}?fields=id,username`)だけを行う。これ自体が投稿や
返信を生成・消費することは無い。

## 実行方法

    python threads-affiliate/check_token_health.py

`threads-affiliate/token-health.json`に結果を書き出す:

    {"ok": true, "checked_at": "...", "username": "..."}
    {"ok": false, "checked_at": "...", "error": "..."}

`ok: false`になった場合の通知は、このスクリプト自身ではなく
(このスクリプトが動くGitHub Actions環境にはプッシュ通知の手段が無いため)、
別途Claude Code Remoteの定期Routineがこのファイルを見て行う。
"""

import datetime
import json
import pathlib
import sys

from threads_client import api_get, load_token

HERE = pathlib.Path(__file__).parent
HEALTH_FILE = HERE / "token-health.json"


def main() -> None:
    checked_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        access_token, user_id = load_token()
    except SystemExit:
        # load_token()はトークン自体が見つからない場合sys.exit(1)する
        # (GitHub Actions環境ではSecrets未設定時のみ発生するはずだが、念のため捕捉する)
        HEALTH_FILE.write_text(
            json.dumps({"ok": False, "checked_at": checked_at, "error": "アクセストークンが設定されていません"}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("異常: アクセストークンが設定されていません。")
        return

    try:
        result = api_get(str(user_id), {"access_token": access_token, "fields": "id,username"})
        if "id" not in result:
            raise RuntimeError(f"想定外のレスポンス: {result}")
        HEALTH_FILE.write_text(
            json.dumps({"ok": True, "checked_at": checked_at, "username": result.get("username")}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"正常: トークンは生きています(username={result.get('username')})")
    except Exception as e:  # noqa: BLE001 — 異常の種類を問わずok:falseとして記録する
        HEALTH_FILE.write_text(
            json.dumps({"ok": False, "checked_at": checked_at, "error": str(e)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"異常: トークンの生存確認に失敗しました: {e}")


if __name__ == "__main__":
    main()
