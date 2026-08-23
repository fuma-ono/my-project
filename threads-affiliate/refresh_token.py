"""Threads APIの長期アクセストークン(60日)を延長するスクリプト。

長期トークンは発行から24時間以上経過していれば、有効期限内ならいつでも
この処理でさらに60日延長できる。タスクスケジューラ/cronで月1回程度
自動実行しておくと、トークン切れで自動投稿が止まる事故を防げる。
"""

import json
import pathlib
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"


def main() -> None:
    data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    url = "https://graph.threads.net/refresh_access_token?" + urllib.parse.urlencode({
        "grant_type": "th_refresh_token",
        "access_token": data["access_token"],
    })
    with urllib.request.urlopen(url, timeout=30) as resp:
        result = json.loads(resp.read().decode())

    if "access_token" not in result:
        print("延長に失敗しました:", result)
        print("get_token.py からやり直してください。")
        return

    data["access_token"] = result["access_token"]
    TOKEN_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("トークンを延長しました(あと60日有効)。")


if __name__ == "__main__":
    main()
