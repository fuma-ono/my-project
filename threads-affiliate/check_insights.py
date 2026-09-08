"""Threads Insights APIで実際に取得できるmetricを確認する診断スクリプト。

推測でmetric名を決め打ちせず、わざと存在しないmetric名でリクエストする。
Graph API系のエンドポイントは、enumパラメータが不正な場合にエラー
メッセージ内へ「有効な値の一覧」を含めて返すことが多いため、これを使って
本当に取得可能なmetricを確認する(公式ドキュメントの記載だけを信用せず、
実機で確認するため)。

## 使い方

```
python threads-affiliate/check_insights.py [post_id]
```

post_id を省略すると `publish-log.jsonl` の最新エントリの投稿を使う。

## このスクリプトの目的

link_clicks・profile_visits相当のmetricが実際に存在するか、2026-09-08
時点で一次情報から確認できなかったため、公開済みの投稿1件に対して
実際にAPIへ問い合わせて確認する。ここで判明した結果を
`fetch_threads_insights.py` に反映する。
"""

import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
LOG_FILE = HERE / "publish-log.jsonl"
GRAPH_BASE = "https://graph.threads.net/v1.0"

# 実機確認前だが、一次情報(developers.facebook.com検索結果)と一致度の高い
# 5metric。ここは実在する可能性が高いので先に試す。
LIKELY_VALID_METRICS = "views,likes,replies,reposts,quotes"


def load_token() -> str:
    env_token = os.environ.get("THREADS_ACCESS_TOKEN")
    if env_token:
        return env_token
    if not TOKEN_FILE.exists():
        print("access-token.json が見つかりません。先に get_token.py を実行してください。")
        print("(または環境変数 THREADS_ACCESS_TOKEN を設定してください)")
        sys.exit(1)
    return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))["access_token"]


def latest_post_id() -> str | None:
    if not LOG_FILE.exists():
        return None
    lines = [line for line in LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        return None
    return json.loads(lines[-1]).get("post_id")


def call_insights(post_id: str, access_token: str, metric: str) -> tuple[int, dict]:
    url = f"{GRAPH_BASE}/{post_id}/insights?" + urllib.parse.urlencode({
        "metric": metric,
        "access_token": access_token,
    })
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return resp.getcode(), json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"raw_body": body}


def main() -> None:
    post_id = sys.argv[1] if len(sys.argv) > 1 else latest_post_id()
    if not post_id:
        print("post_idが指定されておらず、publish-log.jsonlにも投稿履歴がありません。")
        print("使い方: python threads-affiliate/check_insights.py <post_id>")
        return

    access_token = load_token()
    print(f"=== 対象post_id: {post_id} ===\n")

    print("--- 1. 確度の高い5metricをリクエスト ---")
    code, body = call_insights(post_id, access_token, LIKELY_VALID_METRICS)
    print(f"HTTP {code}")
    print(json.dumps(body, ensure_ascii=False, indent=2))

    print("\n--- 2. 存在しないmetric名でリクエストし、エラーから『有効な値の一覧』を確認 ---")
    code, body = call_insights(post_id, access_token, "__probe_invalid_metric__")
    print(f"HTTP {code}")
    print(json.dumps(body, ensure_ascii=False, indent=2))

    print(
        "\n上のエラーメッセージに「有効な値は〜」のような一覧が含まれていれば、"
        "それが実際にThreads APIで取得可能な全metricです。"
        "この出力をそのまま貼ってください。link_clicks・profile_visits相当の"
        "metricが含まれているかどうかで、fetch_threads_insights.pyの対応範囲を決めます。"
    )


if __name__ == "__main__":
    main()
