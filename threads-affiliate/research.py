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
import pathlib
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

# Focus & Sleep事業と親和性の高いジャンルの検索キーワード。増減はここを編集するだけでよい。
KEYWORDS = [
    "耳栓 睡眠",
    "ホワイトノイズマシン",
    "アイマスク 遮光",
    "睡眠用 イヤホン",
    "快眠グッズ",
]

MAX_PRICE = 15000  # これを超える価格帯は購入ハードルが高いとみなし除外(暫定の目安)


def load_config() -> dict:
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
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
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

    # 価格帯: 1,000円〜8,000円あたりを最も買われやすい帯とみなす(暫定の仮説)
    if 1000 <= price <= 8000:
        price_score = 20
    elif price < 1000:
        price_score = 10  # 安すぎると報酬額も小さい
    elif price <= MAX_PRICE:
        price_score = 10
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

    all_candidates = []
    for keyword in KEYWORDS:
        try:
            items = search_items(keyword, app_id, access_key, affiliate_id)
        except Exception as e:
            print(f"'{keyword}' の検索に失敗しました: {e}")
            continue
        for item in items:
            d = item["Item"]
            if d.get("itemPrice", 0) > MAX_PRICE:
                continue
            name = d.get("itemName")
            amazon_url = match_amazon_link(name, amazon_links)
            all_candidates.append({
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
                "score": score_item(item),
            })

    all_candidates.sort(key=lambda c: c["score"], reverse=True)

    PRODUCTS_FILE.write_text(
        json.dumps(all_candidates, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    top = all_candidates[:10]
    lines = [
        "# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)",
        "",
        "`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・",
        "価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。",
        "",
        "## 上位候補",
        "",
        "Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して",
        "Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。",
        "",
        "| 商品名 | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in top:
        name = c["name"][:40].replace("|", "-")
        link = c["amazon_affiliate_url"] if c["preferred_platform"] == "amazon" else c["affiliate_url"]
        lines.append(
            f"| {name} | ¥{c['price']:,} | {c['review_count']} | {c['review_average']} | "
            f"{c['score']} | {c['preferred_platform']} | [リンク]({link}) |"
        )
    lines += [
        "",
        "## 運用ルール",
        "",
        "- 1商品につき週1回までの紹介に留める(同じ商品を毎日連投しない)",
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
