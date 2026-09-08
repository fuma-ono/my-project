"""Threadsアフィリエイト投稿の自動公開スクリプト(Meta公式 Threads API 使用)。

note.comの自動化(love-note/)と違い、これはブラウザ自動操作ではなく
Meta社の公式APIを直接HTTPSで呼ぶだけなので、ログイン画面・reCAPTCHAは
一切経由しない。ログイン自体は初回のOAuth認可(オーナーが自分のブラウザで
「許可する」を押すだけ)のみで、以降はアクセストークンでAPI呼び出しする。

★このクラウド環境からは graph.threads.net への接続がブロックされているため、
このスクリプトは note.com の publish.py と同様、オーナーのPC上で実行する。
(オーナーの回線には制限が無いので、そちらでは問題なく動く)

## 事前準備(初回のみ、詳細は README.md)

1. Threadsアカウントを「プロフェッショナル」に切り替える
2. developers.facebook.com でMeta開発者アプリを作成し、Threads APIを有効化
3. `python threads-affiliate/get_token.py` でアクセストークンを取得・保存

## 定期実行

Windowsのタスクスケジューラ、Macのcronに登録すれば、以降は完全に無人で
「下書きを読む→投稿する」を繰り返せる。
"""

import argparse
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
PENDING_DIR = HERE / "pending"
PUBLISHED_DIR = HERE / "published"
LOG_FILE = HERE / "publish-log.jsonl"

GRAPH_BASE = "https://graph.threads.net/v1.0"


def load_token() -> tuple[str, str]:
    # GitHub Actions等、無人実行の環境ではJSONファイルではなく環境変数
    # (リポジトリのSecrets)からトークンを渡す想定。ローカル/Codespacesでは
    # 従来通りaccess-token.jsonを使う。
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


def api_post(path: str, params: dict) -> dict:
    url = f"{GRAPH_BASE}/{path}"
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def load_next_pending():
    files = sorted(PENDING_DIR.glob("*.json"))
    if not files:
        return None
    with open(files[0], encoding="utf-8") as f:
        data = json.load(f)
    return files[0], data


def log_result(entry: dict) -> None:
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def publish(dry_run: bool) -> None:
    access_token, user_id = load_token()

    pending = load_next_pending()
    if pending is None:
        print("公開待ちの下書きがありません(threads-affiliate/pending/ が空です)。")
        return

    path, post = pending
    text = post["text"]  # PR表記込みの本文(500文字以内、Threadsの制限に注意)
    link = post.get("affiliate_link")  # 任意: 商品リンク

    # Threadsの投稿は本文中のURLを自動的にリンク化するため、実際に投稿する
    # 本文にリンクを含める(以前はここでリンクを本文に混ぜていなかったため、
    # 投稿にリンクが一切表示されないバグがあった)。
    full_text = f"{text}\n\n{link}" if link else text
    if len(full_text) > 500:
        print(f"警告: リンクを含めると{len(full_text)}文字になり、Threadsの500文字制限を超えます。")
        sys.exit(1)

    if dry_run:
        print("--- DRY RUN(実際には投稿しません、実際に投稿される本文そのもの) ---")
        print(full_text)
        return

    # Step 1: メディアコンテナを作成
    container_params = {"media_type": "TEXT", "text": full_text, "access_token": access_token}
    container = api_post(f"{user_id}/threads", container_params)
    if "id" not in container:
        print("コンテナ作成に失敗しました:", container)
        sys.exit(1)
    creation_id = container["id"]

    time.sleep(3)  # Meta推奨: 公開前に数秒待つ

    # Step 2: 実際に公開
    publish_params = {"creation_id": creation_id, "access_token": access_token}
    result = api_post(f"{user_id}/threads_publish", publish_params)
    if "id" not in result:
        print("公開に失敗しました:", result)
        sys.exit(1)

    PUBLISHED_DIR.mkdir(exist_ok=True)
    path.rename(PUBLISHED_DIR / path.name)
    log_result({
        # --- 公開時に確定する情報 ---
        "post_id": result["id"],
        "published_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "text": full_text,  # 実際に投稿された本文(リンク込み)
        "affiliate_url": link,
        "product_name": post.get("product_name"),
        "category": post.get("pattern"),  # 共感投稿/発見投稿/比較投稿/商品紹介/まとめ投稿
        "source_file": path.name,
        # --- 後からfetch_threads_insights.pyが埋める項目 ---
        # views/likes/replies/reposts/quotesはThreads Media Insights APIで
        # 取得可能なことを確認済み(2026-09-08、developers.facebook.com一次情報)。
        "impressions": None,
        "likes": None,
        "replies": None,
        "reposts": None,
        "quotes": None,
        # profile_visits・link_clicksはThreads APIで取得可能か未確認
        # (2026-09-08時点。check_insights.pyで実際に確認してから対応する)。
        "profile_visits": None,
        "link_clicks": None,
        "last_metrics_at": None,
    })
    print(f"公開しました。投稿ID: {result['id']}")
    print("Threadsアプリ/サイトで実際に表示されているか、目視で確認してください。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="実際には投稿せず、内容だけ確認する")
    args = parser.parse_args()
    publish(dry_run=args.dry_run)
