# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)

`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・
価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。

## 上位候補

Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して
Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。

| 商品名 | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |
|---|---|---|---|---|---|---|
| 【テレビで紹介】充電式カイロ 最高55℃ 10000mah バッテリー 3段階温 | ¥5,680 | 1403 | 4.57 | 96.6 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00trzxo.3agd0a80.g00trzxo.3agd1a00/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fhagoogi%2Fot-96h-01%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fhagoogi%2Fi%2F10000129%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【35%OFF・クーポンで2,404円】【新色発売！ 】KONCIWA 8～12 | ¥3,699 | 1784 | 4.55 | 96.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ul29o.3agd0cd1.g00ul29o.3agd1b8e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkawapettii%2Fbt-yzd2024hs001-ss%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkawapettii%2Fi%2F10000076%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ［10％OFFクーポン★スーパーSALE］電気毛布 敷き 日本製 小さめ シング | ¥3,390 | 2274 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00t1dwo.3agd0d7f.g00t1dwo.3agd1805/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Flifejoy-shop%2Fjbs401%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Flifejoy-shop%2Fi%2F10000044%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【80%OFF♪SS限定・SNS超人気】 電気毛布 掛け敷き 楽天1位 USB/ | ¥3,380 | 2601 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ubfso.3agd089c.g00ubfso.3agd1dcf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fennshopstore%2Fbx88pj%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fennshopstore%2Fi%2F10000061%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼期間限定★クーポンで最安4,480円／【楽天1位】電気毛布 掛け敷き 兼用 ふ | ¥7,780 | 1643 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u4xuo.3agd0294.g00u4xuo.3agd14e7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaieitenfashionnigou%2Fxt061%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaieitenfashionnigou%2Fi%2F10000205%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【店内最大50%OFF！11日01:59まで！】【モットル公式店】 充電式カイロ | ¥3,708 | 1186 | 4.42 | 95.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tc8do.3agd07ab.g00tc8do.3agd1c0e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmottole-shop%2Fmtl-e029%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmottole-shop%2Fi%2F10000179%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 日本製 電気敷毛布 電気毛布 洗える ダニ退治 シングル【RCP】 電気毛布(し | ¥3,480 | 1503 | 4.42 | 95.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qegto.3agd0f49.g00qegto.3agd1680/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Ftownland%2Fr-1805050630001%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Ftownland%2Fi%2F10000033%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 楽天1位【クーポンで2,160円！SS限定】 折りたたみ傘 日傘 12本骨 折り | ¥3,180 | 2060 | 4.24 | 93.9 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tyy9o.3agd0163.g00tyy9o.3agd1cdd/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fazusa%2Fb1aq10%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fazusa%2Fi%2F10000096%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【期間限定★最安クーポンで2,980円 】電気毛布 5WAY 9枚炭素繊維ヒータ | ¥4,480 | 1051 | 4.05 | 92.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u552o.3agd0515.g00u552o.3agd1af7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkatariyashop%2Fdrmt002%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkatariyashop%2Fi%2F10000242%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| SS半額限定4599円から！★クーポンあり★PSE認証済み★ふわふわ電気毛布 電 | ¥9,799 | 1131 | 4.66 | 87.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u5pko.3agd08fa.g00u5pko.3agd1295/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkatushop%2Fdrt06%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkatushop%2Fi%2F10000129%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |

## 運用ルール

- 1商品につき週1回までの紹介に留める(同じ商品を毎日連投しない)
- 実際にクリック・購入があった商品は下部の「実績」に記録する
- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える

## 実績

(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)
