"""楽天APIを使った商品調査・スコアリング(Phase 1〜2)。

★このクラウド環境からは webservice.rakuten.co.jp への接続がブロックされている
ため(実測確認済み)、note.com・Threadsの自動化と同様、オーナーのPCで実行する。

## 事前準備(初回のみ)

1. https://webservice.rakuten.co.jp/ でアプリケーションを作成すると、
   「アプリケーションID」(UUID形式)と「アクセスキー」(`pk_...`形式)が発行される。
   **この2つは別物で、APIを呼ぶには両方が必要**(2026年に楽天側の認証方式が
   刷新され、以前の「アプリID単体」方式では `specify valid applicationId` エラーに
   なることを実機で確認済み)
2. 楽天アフィリエイトの管理画面で「アフィリエイトID」を確認
3. `threads-affiliate/rakuten-config.json` を作成(このスクリプトを初回実行すると
   対話式で作成される。内容は
   `{"app_id": "...(UUID)", "access_key": "pk_...", "affiliate_id": "..."}`)

## 実行方法

```
python threads-affiliate/research.py
```

`threads-affiliate/products.json`(全候補の生データ+スコア)と
`threads-affiliate/product-candidates.md`(上位候補の一覧、人間が読む用)
を更新する。実行後、`git add / commit / push` してクラウド側のRoutineに
最新の候補を渡すこと(このスクリプト自体はgit操作を行わない)。

## スコアリングについて

需要(レビュー件数)・満足度(レビュー平均)・買われやすさ(価格帯)を
組み合わせた**暫定的なヒューリスティック**。実際のクリック・購入データが
貯まったら、`docs/marketing/2026-08-18-ai-affiliate-feasibility.md` の
方針通り、実データに基づいて重み付けを見直すこと。
"""

import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
CONFIG_FILE = HERE / "rakuten-config.json"
PRODUCTS_FILE = HERE / "products.json"
CANDIDATES_MD = HERE / "product-candidates.md"
AMAZON_LINKS_MD = HERE / "amazon-links.md"

# 2026年の楽天API刷新後の新エンドポイント。旧エンドポイント
# (app.rakuten.co.jp/services/api/.../20220601)はapplicationId単体では
# 認証エラーになることを実機確認したため、こちらに切り替えた。
SEARCH_API = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701"

# 2026-09-09、オーナー指示によりジャンル限定を撤廃した
# (docs/marketing/2026-09-09-threads-account-repositioning.md 参照。
# 旧・4ジャンル限定方針は docs/marketing/2026-09-08-genre-pivot.md に経緯を残すのみ)。
# 「誰かの困りごとを解決する便利なもの」を優先しつつ、生活便利グッズ・
# キッチン用品・家電・スマホ/PC周辺機器・旅行用品・車用品・防災用品・
# 季節商品・美容/身だしなみ用品・収納/掃除用品を幅広く調査する。
# AI/Webサービスは楽天・Amazonの商品検索APIでは扱えないため対象外
# (別途手動リサーチする運用。post-template.md参照)。
# カテゴリ名は`category`としてproducts.json/product-candidates.mdに残し、
# 商品選定・レポートで参照できるようにする。増減はこの辞書を編集するだけでよい。
KEYWORDS_BY_CATEGORY = {
    "モバイル機器": ["モバイルバッテリー 10000mAh", "スマホ 折りたたみスタンド"],
    "キッチン用品": ["電気ケトル おすすめ", "みじん切り 便利グッズ"],
    "生活便利グッズ": ["折りたたみ傘 自動開閉", "収納ボックス 便利"],
    "季節商品": ["電気毛布 洗える", "冷感タオル 便利"],
    "旅行用品": ["旅行 圧縮バッグ", "パッキングキューブ 便利"],
    "車用品": ["車 収納 便利グッズ", "車載 芳香剤 おすすめ"],
    "防災用品": ["防災グッズ セット 便利", "モバイルバッテリー 大容量 防災"],
    "美容・身だしなみ用品": ["ヘアドライヤー 速乾 おすすめ", "携帯用 毛玉取り"],
    "掃除用品": ["コードレス掃除機 コンパクト", "お風呂掃除 便利グッズ"],
}
# 後方互換のためフラットなリストも保持(既存コードからの参照用)
KEYWORDS = [kw for kws in KEYWORDS_BY_CATEGORY.values() for kw in kws]

MIN_PRICE = 3000   # これ未満は「安すぎて迷わず買う」価格帯とみなし除外
MAX_PRICE = 20000  # 家電など単価が上がるジャンルを含めたため、旧15,000円から引き上げ(暫定の目安)

# 楽天アプリ作成フォームで「アプリケーションURL」に登録した値そのもの。
# 「許可されたウェブサイト」欄のドメイン(note.com)に対する単純なRefererでは
# REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING が解消しなかったため、
# アプリケーションURLと完全一致させる形に変更した(公式APIドキュメントには
# この項目の記載が無く、WAF層での照合と見られるため未確定要素あり)。
REFERER = "https://note.com/unique_condor276"

REQUEST_INTERVAL_SEC = 2  # 連続リクエストで 429 Too Many Requests になったため、間隔を空ける


def load_config() -> dict:
    # GitHub Actions等の無人実行環境では、環境変数(Secrets)経由で
    # 設定を渡す(対話式inputができないため)。ローカル/Codespacesでは
    # 従来通りrakuten-config.jsonを使う。
    env_app_id = os.environ.get("RAKUTEN_APP_ID")
    env_access_key = os.environ.get("RAKUTEN_ACCESS_KEY")
    if env_app_id and env_access_key:
        return {
            "app_id": env_app_id,
            "access_key": env_access_key,
            "affiliate_id": os.environ.get("RAKUTEN_AFFILIATE_ID", ""),
        }
    if CONFIG_FILE.exists():
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if "access_key" in config:
            return config
        # 旧バージョン(access_keyを持たない設定)が残っている場合は再入力を促す
        print("設定ファイルが古い形式です(accessKeyが未保存)。再入力してください。")
    print("初回実行です。楽天のアプリケーションID・アクセスキー・アフィリエイトIDを入力してください。")
    print("(アプリケーションID=UUID形式、アクセスキー=pk_で始まる文字列。両方とも")
    print(" https://webservice.rakuten.co.jp/ のアプリ詳細ページで確認できます)")
    app_id = input("アプリケーションID: ").strip()
    access_key = input("アクセスキー: ").strip()
    affiliate_id = input("アフィリエイトID: ").strip()
    config = {"app_id": app_id, "access_key": access_key, "affiliate_id": affiliate_id}
    CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"保存しました: {CONFIG_FILE}(.gitignore済み、commitされません)")
    return config


def search_items(keyword: str, app_id: str, access_key: str, affiliate_id: str) -> list[dict]:
    params = {
        "applicationId": app_id,
        "accessKey": access_key,
        "affiliateId": affiliate_id,
        "keyword": keyword,
        "genreId": 0,  # 全ジャンル対象(APIテストフォームでの成功例に合わせた)
        "sort": "-reviewCount",
        "hits": 10,
        "format": "json",
    }
    url = f"{SEARCH_API}?{urllib.parse.urlencode(params)}"
    # Origin も併用: WAFがRefererではなくOriginを見ているケースへの保険
    # (OriginはRefererと違いパスを含まない、scheme://hostのみの形式)
    referer_parts = urllib.parse.urlsplit(REFERER)
    origin = f"{referer_parts.scheme}://{referer_parts.netloc}"
    request = urllib.request.Request(url, headers={"Referer": REFERER, "Origin": origin})
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        # 楽天APIはエラーの詳細(error_description等)をレスポンス本文に返すが、
        # urllibはデフォルトで本文を握りつぶすため、明示的に読んで再送出する。
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"{e.code} {e.reason}: {body}") from None
    return data.get("Items", [])


def score_item(item: dict) -> float:
    d = item["Item"]
    review_count = d.get("reviewCount", 0)
    review_avg = d.get("reviewAverage", 0)
    price = d.get("itemPrice", 0)

    # 需要(レビュー件数、対数的に頭打ちにする): 多すぎても際限なく高スコアにしない
    demand_score = min(review_count, 500) / 500 * 40

    # 満足度: 5点満点を40点満点に変換
    quality_score = (review_avg / 5) * 40

    # 価格帯: 3,000〜8,000円を「迷って調べるが決断しやすい」帯として最優先
    if 3000 <= price <= 8000:
        price_score = 20
    elif 8000 < price <= MAX_PRICE:
        price_score = 10  # 高めだが検討対象になりうる
    elif price < MIN_PRICE:
        price_score = 5  # 安すぎて比較検討されにくい(報酬額も小さい)
    else:
        price_score = 0

    return round(demand_score + quality_score + price_score, 1)


def load_amazon_links() -> dict[str, str]:
    """amazon-links.md の表を {商品名キーワード: URL} に読み込む(手動管理、API不要)。"""
    if not AMAZON_LINKS_MD.exists():
        return {}
    links = {}
    for line in AMAZON_LINKS_MD.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cols = [c.strip() for c in line.strip("|").split("|")]
        if len(cols) != 2 or cols[0] in ("商品名(researcher.pyの候補と対応させる)", "---"):
            continue
        name, url = cols
        if url.startswith("http"):
            links[name] = url
    return links


def match_amazon_link(product_name: str, amazon_links: dict[str, str]) -> str | None:
    for keyword, url in amazon_links.items():
        if keyword and keyword in product_name:
            return url
    return None


def main() -> None:
    config = load_config()
    app_id = config["app_id"]
    access_key = config["access_key"]
    affiliate_id = config["affiliate_id"]
    amazon_links = load_amazon_links()

    keyword_category = {
        kw: category for category, kws in KEYWORDS_BY_CATEGORY.items() for kw in kws
    }

    all_candidates = []
    for i, keyword in enumerate(KEYWORDS):
        if i > 0:
            time.sleep(REQUEST_INTERVAL_SEC)  # 連続リクエストでの429対策

        items = []
        for attempt in range(2):  # 429時に1回だけ長めに待って再試行する
            try:
                items = search_items(keyword, app_id, access_key, affiliate_id)
                break
            except Exception as e:
                is_rate_limited = "429" in str(e)
                if is_rate_limited and attempt == 0:
                    print(f"'{keyword}': レート制限のため5秒待って再試行します...")
                    time.sleep(5)
                    continue
                print(f"'{keyword}' の検索に失敗しました: {e}")
                break
        for item in items:
            d = item["Item"]
            if d.get("itemPrice", 0) > MAX_PRICE:
                continue
            name = d.get("itemName")
            amazon_url = match_amazon_link(name, amazon_links)
            all_candidates.append({
                "item_code": d.get("itemCode"),
                "name": name,
                "price": d.get("itemPrice"),
                "review_count": d.get("reviewCount", 0),
                "review_average": d.get("reviewAverage", 0),
                "affiliate_url": d.get("affiliateUrl") or d.get("itemUrl"),
                "amazon_affiliate_url": amazon_url,
                # Amazon側の実績(3件の成果)を作るまでは、手動リンクが登録済みの商品は
                # Amazon優先で紹介する。無ければ楽天(完全自動)を使う。
                "preferred_platform": "amazon" if amazon_url else "rakuten",
                "keyword": keyword,
                "category": keyword_category.get(keyword, ""),
                "score": score_item(item),
            })

    # 同じ商品が複数キーワードでヒットすることがあるため、itemCode基準で重複除去
    # (無ければ商品名で代用)。最初に見つかったキーワードの結果を残す。
    seen = set()
    deduped = []
    for c in all_candidates:
        dedup_key = c["item_code"] or c["name"]
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        deduped.append(c)
    all_candidates = deduped

    all_candidates.sort(key=lambda c: c["score"], reverse=True)

    PRODUCTS_FILE.write_text(
        json.dumps(all_candidates, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    top = all_candidates[:20]
    lines = [
        "# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)",
        "",
        "`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・",
        "価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。",
        "ジャンルは限定しない方針(`docs/marketing/2026-09-09-threads-account-repositioning.md`)。",
        "",
        "## 上位候補",
        "",
        "Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して",
        "Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。",
        "",
        "| 商品名 | ジャンル | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for c in top:
        name = c["name"][:40].replace("|", "-")
        link = c["amazon_affiliate_url"] if c["preferred_platform"] == "amazon" else c["affiliate_url"]
        lines.append(
            f"| {name} | {c.get('category', '')} | ¥{c['price']:,} | {c['review_count']} | {c['review_average']} | "
            f"{c['score']} | {c['preferred_platform']} | [リンク]({link}) |"
        )
    lines += [
        "",
        "## 運用ルール",
        "",
        "- 毎日1投稿ペースなので、同じ商品を7日以内に再度取り上げない",
        "- 実際にクリック・購入があった商品は下部の「実績」に記録する",
        "- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える",
        "",
        "## 実績",
        "",
        "(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)",
        "",
    ]
    CANDIDATES_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"{len(all_candidates)}件の候補を取得し、上位{len(top)}件を {CANDIDATES_MD} に書き出しました。")
    print("git add / commit / push すると、クラウド側の週次Routineがこの候補を使えるようになります。")


if __name__ == "__main__":
    main()
