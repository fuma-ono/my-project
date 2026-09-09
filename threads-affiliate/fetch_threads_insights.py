"""publish-log.jsonlの各投稿について、Threads Insightsを取得して記録を更新する。

publish.pyとは別スクリプトとして分離している(投稿処理とインサイト取得の
責務を分けるため)。オーナーのPC/Codespacesで、投稿から数日おきに実行する
運用を想定(タスクスケジューラ登録も可)。

## 対応範囲(2026-09-09、check_insights.pyで実機確認済み)

Threads Media Insights APIが実際に受け付ける有効なmetricは
`clicks, likes, quotes, replies, reposts, shares, views` の7つのみ
(2026-09-09、`check_insights.py`が意図的に無効なmetric名でリクエストした際の
エラーメッセージで確定。以前の権限エラーはmetric名の問題ではなく、
トークンに`threads_manage_insights`スコープが無かったことが原因だった)。

`profile_visits`相当のmetricは**このリストに存在せず、投稿単位のInsightsでは
取得不可と判明した**。アカウント単位の指標として別途存在する可能性はあるが、
今回の用途(投稿ごとの効果測定)では使えないため対応しない。

`clicks`はリンク・ハッシュタグ・メンション・添付メディアへのクリックを
合算した値(Threads公式の説明ベース)で、アフィリエイトリンク単体のクリック数
ではない可能性がある点に注意。それでも「表示→クリック→購入」の大まかな
離脱率を見る目的には使える。

## 使い方

```
python threads-affiliate/fetch_threads_insights.py          # 全件更新
python threads-affiliate/fetch_threads_insights.py <post_id>  # 特定の1件だけ更新
```

更新後は `git add threads-affiliate/publish-log.jsonl && git commit && git push`
すること(クラウド側の週次Routineが実績を見て投稿を改善できるようにするため)。
"""

import datetime
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

# 2026-09-09、check_insights.pyで実機確認済みの全7metric。
CONFIRMED_METRICS = "views,likes,replies,reposts,quotes,shares,clicks"


def load_token() -> str:
    env_token = os.environ.get("THREADS_ACCESS_TOKEN")
    if env_token:
        return env_token
    if not TOKEN_FILE.exists():
        print("access-token.json が見つかりません。先に get_token.py を実行してください。")
        print("(または環境変数 THREADS_ACCESS_TOKEN を設定してください)")
        sys.exit(1)
    return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))["access_token"]


def fetch_insights(post_id: str, access_token: str) -> dict:
    url = f"{GRAPH_BASE}/{post_id}/insights?" + urllib.parse.urlencode({
        "metric": CONFIRMED_METRICS,
        "access_token": access_token,
    })
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def parse_metrics(data: dict) -> dict:
    """{"data": [{"name": "views", "values": [{"value": 123}]}, ...]} を
    {"views": 123, ...} に変換する。"""
    result = {}
    for item in data.get("data", []):
        name = item.get("name")
        values = item.get("values")
        if isinstance(values, list) and values:
            result[name] = values[0].get("value")
        elif "total_value" in item:
            result[name] = item["total_value"].get("value")
    return result


def main() -> None:
    if not LOG_FILE.exists():
        print("publish-log.jsonl がまだありません(投稿履歴なし)。publish.pyで先に投稿してください。")
        return

    target_post_id = sys.argv[1] if len(sys.argv) > 1 else None
    access_token = load_token()

    lines = [line for line in LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    updated_lines = []
    updated_count = 0

    for line in lines:
        entry = json.loads(line)
        post_id = entry.get("post_id")
        if target_post_id and post_id != target_post_id:
            updated_lines.append(line)
            continue
        try:
            raw = fetch_insights(post_id, access_token)
            metrics = parse_metrics(raw)
            for key in ("impressions", "likes", "replies", "reposts", "quotes", "shares", "clicks"):
                api_key = "views" if key == "impressions" else key
                if api_key in metrics:
                    entry[key] = metrics[api_key]
            entry["last_metrics_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            updated_count += 1
            print(f"post_id={post_id}: {metrics}")
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            print(f"post_id={post_id}: 取得失敗(HTTP {e.code}) {body}")
        except Exception as e:
            print(f"post_id={post_id}: 取得失敗 - {e}")
        updated_lines.append(json.dumps(entry, ensure_ascii=False))

    LOG_FILE.write_text("\n".join(updated_lines) + "\n", encoding="utf-8")
    print(f"\n{updated_count}件のインサイトを更新しました。")
    print("git add threads-affiliate/publish-log.jsonl && git commit && git push で記録してください。")


if __name__ == "__main__":
    main()
