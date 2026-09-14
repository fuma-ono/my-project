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
別途Claude Code Remoteの定期Routine(「Threadsトークン 監視」)がこのファイルを
見て行う。そのRoutineは`"notified": true`が既に付いていれば再通知しない
(スパム防止)仕組みだが、**2026-09-14発覚**: このスクリプトが実行のたびに
ファイル全体を新規の辞書で上書きしていたため、前回付いた`"notified"`が
毎回消え、同じ障害が続いている間ずっと4時間おきに再通知され続けるバグが
あった。対策として、既存ファイルがまだ`ok: false`で`"notified": true`が
付いている場合は、新しい結果でも`ok: false`である限りそれを引き継ぐ
(=同じ継続中の障害として扱う)。`ok: true`に復帰したら通知フラグごと
リセットされる(Routine側が`ok: true`のとき`notified`を削除する設計)。
"""

import datetime
import json
import pathlib
import sys

from threads_client import api_get, load_token

HERE = pathlib.Path(__file__).parent
HEALTH_FILE = HERE / "token-health.json"


def _carry_over_notified(new_status: dict) -> dict:
    """新しい結果がok:falseの場合、既存ファイルのnotified:trueを引き継ぐ。

    同じ継続中の障害についてRoutineが何度も再通知しないようにするため
    (2026-09-14発覚のバグ対策、モジュールdocstring参照)。
    """
    if new_status.get("ok"):
        return new_status
    if not HEALTH_FILE.exists():
        return new_status
    try:
        old_status = json.loads(HEALTH_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return new_status
    if old_status.get("ok") is False and old_status.get("notified"):
        new_status["notified"] = True
    return new_status


def _write(status: dict) -> None:
    HEALTH_FILE.write_text(
        json.dumps(_carry_over_notified(status), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    checked_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        access_token, user_id = load_token()
    except SystemExit:
        # load_token()はトークン自体が見つからない場合sys.exit(1)する
        # (GitHub Actions環境ではSecrets未設定時のみ発生するはずだが、念のため捕捉する)
        _write({"ok": False, "checked_at": checked_at, "error": "アクセストークンが設定されていません"})
        print("異常: アクセストークンが設定されていません。")
        return

    try:
        result = api_get(str(user_id), {"access_token": access_token, "fields": "id,username"})
        if "id" not in result:
            raise RuntimeError(f"想定外のレスポンス: {result}")
        _write({"ok": True, "checked_at": checked_at, "username": result.get("username")})
        print(f"正常: トークンは生きています(username={result.get('username')})")
    except Exception as e:  # noqa: BLE001 — 異常の種類を問わずok:falseとして記録する
        _write({"ok": False, "checked_at": checked_at, "error": str(e)})
        print(f"異常: トークンの生存確認に失敗しました: {e}")


if __name__ == "__main__":
    main()
