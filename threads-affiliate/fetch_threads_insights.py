"""publish-log.jsonlの各投稿について、Threads Insightsを取得して記録を更新する。

publish.pyとは別スクリプトとして分離している(投稿処理とインサイト取得の
責務を分けるため)。オーナーのPC/Codespacesで、投稿から数日おきに実行する
運用を想定(タスクスケジューラ登録も可)。

## 現状の対応範囲(2026-09-08時点)

`views` / `likes` / `replies` / `reposts` / `quotes` の5metricのみ取得する。
これらは一次情報(developers.facebook.com検索結果)と一致度が高いが、
`check_insights.py`での実機確認はまだ完了していない。

`profile_visits` / `link_clicks` 相当のmetricは、実際にThreads APIで
取得可能か2026-09-08時点で確認できていないため、**このスクリプトでは
問い合わせない**(推測で存在しないmetric名をリクエストしてエラーに
するくらいなら、確認済みの範囲だけ実装する、というオーナー方針に従う)。
`check_insights.py`の実行結果を見て、取得可能と判明次第この一覧に追加する。

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
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
LOG_FILE = HERE / "publish-log.jsonl"
GRAPH_BASE = "https://graph.threads.net/v1.0"

# 2026-09-08時点で取得可能と考えられる(要: check_insights.pyでの実機確認)metricのみ。
# profile_visits / link_clicks 相当は未確認のためリクエストしない。
CONFIRMED_METRICS = "views,likes,replies,reposts,quotes"


def load_token() -> str:
    if not TOKEN_FILE.exists():
        print("access-token.json が見つかりません。先に get_token.py を実行してください。")
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
            for key in ("impressions", "likes", "replies", "reposts", "quotes"):
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
