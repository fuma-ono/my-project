# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)

`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・
価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。
ジャンルは限定しない方針(`docs/marketing/2026-09-09-threads-account-repositioning.md`)。

## 上位候補

Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して
Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。

| 商品名 | ジャンル | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |
|---|---|---|---|---|---|---|---|
| 【エントリーで店内全品P10倍★ 9/11 1:59迄】タイガー魔法瓶 タイガー | キッチン用品 | ¥4,980 | 589 | 4.7 | 97.6 | amazon | [リンク](https://link.amazon/B0bwBlftG) |
| 【20%ポイント還元 】 【楽天1位】ドライヤー 速乾 早く乾く 大風量 大風圧 | 美容・身だしなみ用品 | ¥4,480 | 2379 | 4.67 | 97.4 | amazon | [リンク](https://link.amazon/B062JpFBZ) |
| サーフィン バケツ TOOLS ウォーターボックス ツールス WATER BOX | 車用品 | ¥4,880 | 1205 | 4.66 | 97.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00pvoyo.3agd0021.g00pvoyo.3agd1a3d/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmaniac%2Fsf-etc-tools-waterbox%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmaniac%2Fi%2F10005228%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【9月限定★冬支度応援クーポン】【楽天1位】電気毛布 掛け敷き兼用 大判190× | 季節商品 | ¥5,380 | 1812 | 4.57 | 96.6 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u552o.3agd0515.g00u552o.3agd1af7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkatariyashop%2Fflrmt%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkatariyashop%2Fi%2F10000441%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【スーパーSALE限定！最大1,000円OFFクーポン】 お得な3・4点セット  | 旅行用品 | ¥4,480 | 1326 | 4.55 | 96.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnk058set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000136%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【特別価格★500円OFF】ハンディクリーナー 掃除機 コードレス 軽量 540 | 掃除用品 | ¥4,480 | 1199 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rgoio.3agd037d.g00rgoio.3agd18e5/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fhg-store%2Fhv-22%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fhg-store%2Fi%2F10000214%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ［10％OFFクーポン★スーパーSALE］電気毛布 敷き 掛け敷き 電気敷き毛布 | 季節商品 | ¥3,390 | 2274 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00t1dwo.3agd0d7f.g00t1dwo.3agd1805/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Flifejoy-shop%2Fjbs401%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Flifejoy-shop%2Fi%2F10000044%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【在庫一掃・SS限定クーポンで5899円！】掃除機 コードレス 軽量 強力吸引  | 掃除用品 | ¥5,999 | 1434 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tonko.3agd02a5.g00tonko.3agd1261/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fheimvision%2Fe20%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fheimvision%2Fi%2F10000060%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 収納ボックス ふた付き かご バスケット 収納バスケット 3個セット L M S | 生活便利グッズ | ¥6,288 | 667 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qp0oo.3agd061a.g00qp0oo.3agd1e6f/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmercadomercado%2Fqn006%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmercadomercado%2Fi%2F10000151%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【80%OFF♪SS限定・SNS超人気】 電気毛布 掛け敷き 楽天1位 USB/ | 季節商品 | ¥3,380 | 2604 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ubfso.3agd089c.g00ubfso.3agd1dcf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fennshopstore%2Fbx88pj%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fennshopstore%2Fi%2F10000061%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【先着様限定】39％OFF 9/11 23:59迄【楽天デイリー総合1位】 日傘 | 生活便利グッズ | ¥3,080 | 17533 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u575o.3agd04f3.g00u575o.3agd1b3e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fchakasho-dina%2F383yimiaorisan%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fchakasho-dina%2Fi%2F10000637%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【楽天ランキング1位】総合1位 収納ボックス キャスター付き 5面開閉 折りたた | 生活便利グッズ | ¥4,280 | 5308 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uaejo.3agd04fe.g00uaejo.3agd1eb6/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fexception5251%2Ff-00003%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fexception5251%2Fi%2F10000379%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【スーパーSALE限定！最大1,000円OFFクーポン】 2点セット 旅行用圧縮 | 旅行用品 | ¥3,490 | 3346 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000075%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼期間限定★クーポンで最安4,480円／【楽天1位】電気毛布 掛け敷き 兼用 ふ | 季節商品 | ¥7,780 | 1643 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u4xuo.3agd0294.g00u4xuo.3agd14e7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaieitenfashionnigou%2Fxt061%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaieitenfashionnigou%2Fi%2F10000205%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【スーパーSALE限定！最大1,000円OFFクーポン】 3点セット 旅行用圧縮 | 旅行用品 | ¥4,490 | 1691 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000105%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ラスト5時間・50％OFF】【美人百花ドライヤー部門NO1】【楽天ランキング1 | 美容・身だしなみ用品 | ¥6,400 | 1739 | 4.48 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tm3yo.3agd02cb.g00tm3yo.3agd13dc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaselab%2F05-acfj31-04j%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaselab%2Fi%2F10000361%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| コイズミ マイナスイオンドライヤー KHD-1285/W - KHD1285W  | 美容・身だしなみ用品 | ¥3,000 | 1509 | 4.48 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rdq6o.3agd00a2.g00rdq6o.3agd131b/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcoconial%2Fkhd1280%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fcoconial%2Fi%2F10005056%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 連続2年受賞！【COUPONで1,890円・SS限定】 モバイルバッテリー 軽量 | 防災用品 | ¥3,190 | 15172 | 4.44 | 95.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tdsyo.3agd0bd1.g00tdsyo.3agd18da/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyumenomori%2Fp1dx14600%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyumenomori%2Fi%2F10000194%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼スーパーセール限定★クーポンで2,580円！／ドライヤー 大風量 1400W  | 美容・身だしなみ用品 | ¥3,580 | 2367 | 4.44 | 95.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uqt6o.3agd0c5b.g00uqt6o.3agd1ec4/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Ffelice1009%2Ffelice-y2%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Ffelice1009%2Fi%2F10000006%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 日本製 電気敷毛布 電気毛布 洗える ダニ退治 シングル【RCP】 電気毛布(し | 季節商品 | ¥3,480 | 1503 | 4.42 | 95.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qegto.3agd0f49.g00qegto.3agd1680/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Ftownland%2Fr-1805050630001%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Ftownland%2Fi%2F10000033%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |

## 運用ルール

- 毎日1投稿ペースなので、同じ商品を7日以内に再度取り上げない
- 実際にクリック・購入があった商品は下部の「実績」に記録する
- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える

## 実績

(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)
