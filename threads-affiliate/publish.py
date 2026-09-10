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

## 定期実行(Phase 2: 完全自動投稿、2026-09-09〜)

`.github/workflows/threads-publish.yml`が毎日21:00 JSTにこのスクリプトを
無人実行する(20:00 JSTの投稿案生成Routineの1時間後)。人間のレビューは
入らないため、`validate_pr_disclosure()`(PR表記の有無・位置チェック)が
コード側の最後の安全弁になる。詳細: `docs/marketing/2026-09-09-threads-account-repositioning.md`。

オーナー自身のPCから手動実行することも引き続き可能(`--dry-run`で内容確認、
引数無しで即投稿)。
"""

import argparse
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
PENDING_DIR = HERE / "pending"
PUBLISHED_DIR = HERE / "published"
LOG_FILE = HERE / "publish-log.jsonl"

GRAPH_BASE = "https://graph.threads.net/v1.0"

# 2026-09-09、オーナー指示によりPR表記は「冒頭に配置」が必須になった
# (末尾に小さく書くだけの設計は禁止。docs/marketing/2026-09-09-threads-account-repositioning.md)。
# 表記漏れ・末尾のみの表記をこの一覧で検知する。
PR_MARKERS = ["【PR】", "#PR", "#広告", "[PR]"]
PR_MARKER_MAX_OFFSET = 10  # 本文の最初の何文字以内に現れれば「冒頭」とみなすか(絵文字等の遊びを許容)

# 旧pending JSON(`pattern`フィールドのみ、5パターン制)からの後方互換用マッピング。
# 新規に生成する下書きは`post_type`を直接指定する(post-template.md参照)。
LEGACY_PATTERN_TO_POST_TYPE = {
    "共感投稿": "empathy",
    "発見投稿": "discovery",
    "比較投稿": "comparison",
    "まとめ投稿": "summary",
    "商品紹介": "discovery",  # 独立パターンを廃止したため、暫定でdiscoveryに寄せる
}


def validate_pr_disclosure(text: str, has_link: bool) -> None:
    """アフィリエイトリンクを含む投稿の本文が、冒頭でPR表記を行っているか検証する。

    景品表示法のステマ規制対応。表記が無い、または末尾など冒頭以外にしか
    無い場合は例外を投げて投稿を中断する(オーナー指示で必須のバリデーション)。
    """
    if not has_link:
        return
    head = text[:PR_MARKER_MAX_OFFSET]
    if any(marker in head for marker in PR_MARKERS):
        return
    if any(marker in text for marker in PR_MARKERS):
        raise ValueError(
            "PR表記が本文中に見つかりましたが、冒頭ではありません。"
            "アフィリエイトリンクを含む投稿は【PR】等を本文の先頭に配置してください"
            "(末尾に小さく書くだけの設計は禁止)。"
        )
    raise ValueError(
        "アフィリエイトリンクを含む投稿にPR表記(【PR】/#PR/#広告のいずれか)がありません。"
        "本文の冒頭に追加してください。"
    )


def infer_affiliate_platform(post: dict) -> str | None:
    explicit = post.get("affiliate_platform")
    if explicit:
        return explicit
    link = post.get("affiliate_link") or ""
    if "amazon" in link or "amzn" in link:
        return "amazon"
    if "rakuten" in link:
        return "rakuten"
    return None


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
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        # 2026-09-10、topic_tag追加時にHTTP 400が本文無しで報告され原因究明が
        # 難航した反省から、エラー本文(Metaの実際のエラーメッセージ)を読んで
        # 例外メッセージに含める。
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code} {e.reason}: {detail}") from e


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

    try:
        validate_pr_disclosure(text, has_link=bool(link))
    except ValueError as e:
        print(f"投稿を中断しました({path.name}): {e}")
        sys.exit(1)

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
    # トピックタグ(2026-09-10追加): 興味のある人に見つけてもらいやすくする
    # ためのMeta公式機能。1投稿につき1個、1〜50文字、"."と"&"は使用不可という
    # API側の制約があるため、category(商品ジャンル)をそのまま流用する
    # (すでに生成時に決まっている値を再利用するだけで、新たな判断ロジックは
    # 増やさない)。制約を満たさない場合は黙って付与をスキップする(投稿自体は
    # 継続、トピックタグは無くても投稿は成立するため)。
    category = post.get("category")
    if category and 1 <= len(category) <= 50 and "." not in category and "&" not in category:
        container_params["topic_tag"] = category

    # 2026-09-10: topic_tag付きのリクエストがHTTP 400で拒否される事象が発生
    # (原因未特定、日本語が非対応の可能性がある)。トピックタグは「無くても
    # 投稿自体は成立する」付加機能なので、失敗したらtopic_tagを外して
    # 1回だけ再試行し、本来の投稿(こちらが本質)を優先して確実に通す。
    try:
        container = api_post(f"{user_id}/threads", container_params)
    except RuntimeError as e:
        if "topic_tag" in container_params:
            print(f"警告: topic_tag付きでコンテナ作成に失敗したため、topic_tag無しで再試行します: {e}")
            container_params.pop("topic_tag")
            container = api_post(f"{user_id}/threads", container_params)
        else:
            raise
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
    # post_type: 新スキーマでは pending JSON が直接 post_type を指定する
    # (empathy/discovery/comparison/summary)。旧`pattern`フィールドしか無い
    # 下書きは後方互換マッピングで変換する。
    post_type = post.get("post_type") or LEGACY_PATTERN_TO_POST_TYPE.get(post.get("pattern"))
    published_at_dt = datetime.datetime.now(datetime.timezone.utc)
    log_result({
        # --- 公開時に確定する情報 ---
        "post_id": result["id"],
        "published_at": published_at_dt.isoformat(),
        # 楽天/Amazonの成果画面は「注文日」単位でしか出ないため、日付だけを
        # 取り出したこのフィールドで月次の手動突合をしやすくする(2026-09-09、
        # ログ設計の一環。post単位の自動紐付けIDは現状存在しない、後述)。
        "published_date": published_at_dt.date().isoformat(),
        "text": full_text,  # 実際に投稿された本文(リンク込み)
        "affiliate_url": link,
        "affiliate_platform": infer_affiliate_platform(post),
        "product_name": post.get("product_name"),
        "category": post.get("category"),  # 商品ジャンル(例: キッチン用品)
        # 2026-09-10、Phase 2(投稿30件超後)の価格帯分析に備えたデータ収集のみ。
        # 分析ロジック自体はまだ追加しない(docs/marketing/2026-09-10-ai-autonomous-operation-design.md参照)。
        "price": post.get("price"),
        "post_type": post_type,  # empathy/discovery/comparison/summary
        "topic_tag": container_params.get("topic_tag"),  # 実際に付与できた場合のみ値が入る
        "source_file": path.name,
        # --- 後からfetch_threads_insights.pyが埋める項目 ---
        # 2026-09-09、check_insights.pyの実機確認により、Threads Media Insights APIで
        # 有効なmetricはこの7つ(views/likes/replies/reposts/quotes/shares/clicks)の
        # みと確定した(無効なmetric名を指定した際のエラーメッセージで確認)。
        # フィールド名はAPIのmetric名そのまま(views)に統一する(旧impressionsから改称)。
        "views": None,
        "likes": None,
        "replies": None,
        "reposts": None,
        "quotes": None,
        "shares": None,
        # clicksはリンク・ハッシュタグ・メンション・メディアへのクリックを合算した値
        # (アフィリエイトリンク単体のクリック数ではない可能性がある)。
        "clicks": None,
        # profile_visits相当のmetricは投稿単位のInsightsには存在しないと確認済み
        # (2026-09-09)。フィールド自体を廃止した。
        "last_metrics_at": None,
    })
    print(f"公開しました。投稿ID: {result['id']}")
    print("Threadsアプリ/サイトで実際に表示されているか、目視で確認してください。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="実際には投稿せず、内容だけ確認する")
    args = parser.parse_args()
    publish(dry_run=args.dry_run)
