"""Threads APIの長期アクセストークン(60日)を延長するスクリプト。

長期トークンは発行から24時間以上経過していれば、有効期限内ならいつでも
この処理でさらに60日延長できる。タスクスケジューラ/cronで月1回程度
自動実行しておくと、トークン切れで自動投稿が止まる事故を防げる。
"""

import json
import os
import pathlib
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"


def main() -> None:
    # GitHub Actions等、access-token.jsonを持たない無人実行環境では
    # 環境変数(Secrets)からトークンを受け取る。この場合ファイルへの
    # 書き戻しができないため、新トークンをGITHUB_OUTPUTに出力し、
    # ワークフロー側で `gh secret set` によりSecretsを更新する想定。
    env_token = os.environ.get("THREADS_ACCESS_TOKEN")
    using_file = TOKEN_FILE.exists() and not env_token
    access_token = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))["access_token"] if using_file else env_token

    if not access_token:
        print("access-token.json も環境変数 THREADS_ACCESS_TOKEN も見つかりません。")
        print("先に get_token.py を実行してください。")
        return

    url = "https://graph.threads.net/refresh_access_token?" + urllib.parse.urlencode({
        "grant_type": "th_refresh_token",
        "access_token": access_token,
    })
    with urllib.request.urlopen(url, timeout=30) as resp:
        result = json.loads(resp.read().decode())

    if "access_token" not in result:
        print("延長に失敗しました:", result)
        print("get_token.py からやり直してください。")
        return

    new_token = result["access_token"]

    if using_file:
        data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        data["access_token"] = new_token
        TOKEN_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print("トークンを延長しました(あと60日有効)。access-token.jsonを更新しました。")
    else:
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"new_token={new_token}\n")
        print("トークンを延長しました(あと60日有効)。")
        print("環境変数経由のため、呼び出し元でSecretsの更新が必要です。")


if __name__ == "__main__":
    main()
