"""Threads Graph APIへの最小限のHTTPラッパー(fetch_replies.py / send_replies.py共通)。

publish.pyにも同様のヘルパー(load_token/api_post)があるが、既存の投稿処理
(publish.py)には手を入れず、返信機能側だけで完結させるためにここへ切り出した
(2026-09-10)。GETリクエスト(api_get)が新たに必要になった点のみpublish.pyとの
差分。
"""

import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
GRAPH_BASE = "https://graph.threads.net/v1.0"


def load_token() -> tuple[str, str]:
    env_token = os.environ.get("THREADS_ACCESS_TOKEN")
    env_user_id = os.environ.get("THREADS_USER_ID")
    if env_token and env_user_id:
        return env_token, env_user_id
    if not TOKEN_FILE.exists():
        print("access-token.json が見つかりません。先に get_token.py を実行してください。")
        print("(または環境変数 THREADS_ACCESS_TOKEN / THREADS_USER_ID を設定してください)")
        sys.exit(1)
    data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    return data["access_token"], data["threads_user_id"]


def api_get(path: str, params: dict) -> dict:
    url = f"{GRAPH_BASE}/{path}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def api_post(path: str, params: dict) -> dict:
    url = f"{GRAPH_BASE}/{path}"
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())
