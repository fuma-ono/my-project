# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)

`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・
価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。
ジャンルは限定しない方針(`docs/marketing/2026-09-09-threads-account-repositioning.md`)。

## 上位候補

Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して
Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。

| 商品名 | ジャンル | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |
|---|---|---|---|---|---|---|---|
| 【店内全品ポイントUP★ 11/11 1:59迄】タイガー魔法瓶 タイガー 電気 | キッチン用品 | ¥4,980 | 631 | 4.7 | 97.6 | amazon | [リンク](https://link.amazon/B0bwBlftG) |
| 【神トク10％クーポン対象】ドライヤー 速乾 早く乾く 大風量 大風圧 強力 時 | 美容・身だしなみ用品 | ¥4,480 | 2565 | 4.68 | 97.4 | amazon | [リンク](https://link.amazon/B062JpFBZ) |
| サーフィン バケツ TOOLS ウォーターボックス ツールス WATER BOX | 車用品 | ¥4,880 | 1205 | 4.66 | 97.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00pvoyo.3agd0021.g00pvoyo.3agd1a3d/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmaniac%2Fsf-etc-tools-waterbox%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmaniac%2Fi%2F10005228%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| クーポンで3,980円～「楽天1位」【AI自動温度調節×炭素繊維ヒーター】 ふわ | 季節商品 | ¥7,480 | 1841 | 4.57 | 96.6 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u552o.3agd0515.g00u552o.3agd1af7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkatariyashop%2Fflrmt%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkatariyashop%2Fi%2F10000441%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼全品対象クーポンMAX65％OFF配布中／収納ボックス 折畳み キャスター付き | 生活便利グッズ | ¥3,800 | 536 | 4.56 | 96.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ukp7o.3agd096c.g00ukp7o.3agd19f2/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyukatheone%2Fyk-f-0003%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyukatheone%2Fi%2F10000193%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【お買い物マラソン限定最大1,000円OFFクーポン！】お得な3・4点セット 圧 | 旅行用品 | ¥3,990 | 1327 | 4.55 | 96.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnk058set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000136%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【25％OFFクーポン・11/10まで】KONCIWA 8～12本 骨折りたたみ | 生活便利グッズ | ¥3,699 | 2022 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ul29o.3agd0cd1.g00ul29o.3agd1b8e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkawapettii%2Fbt-yzd2024hs001-ss%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkawapettii%2Fi%2F10000076%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【限定セール300円OFFクーポン】ハンディクリーナー 掃除機 コードレス 軽量 | 掃除用品 | ¥5,480 | 1225 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rgoio.3agd037d.g00rgoio.3agd18e5/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fhg-store%2Fhv-22%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fhg-store%2Fi%2F10000214%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| Anker Power Bank (10000mAh, 22.5W) (モバイル | モバイル機器 | ¥3,490 | 2304 | 4.53 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rr09o.3agd07a8.g00rr09o.3agd1025/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fanker%2Fa1257%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fanker%2Fi%2F10001908%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【COUPONで3,492円〜・SNS超人気】 電気毛布 掛け敷き 65℃速暖  | 季節商品 | ¥7,760 | 2968 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ubfso.3agd089c.g00ubfso.3agd1dcf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fennshopstore%2Fbx88pj%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fennshopstore%2Fi%2F10000061%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ［早割10％OFFクーポン★マラソン限定］電気毛布 日本製 電気毛布 敷き 電気 | 季節商品 | ¥3,100 | 2307 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00t1dwo.3agd0d7f.g00t1dwo.3agd1805/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Flifejoy-shop%2Fjbs401%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Flifejoy-shop%2Fi%2F10000044%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【在庫一掃・マラソン限定クーポンで5899円！】掃除機 コードレス 軽量 強力吸 | 掃除用品 | ¥5,999 | 1437 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tonko.3agd02a5.g00tonko.3agd1261/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fheimvision%2Fe20%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fheimvision%2Fi%2F10000060%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【楽天総合ランキング1位】収納ボックス 木天板付き新発売 キャスター付き 5面開 | 生活便利グッズ | ¥4,280 | 5652 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uaejo.3agd04fe.g00uaejo.3agd1eb6/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fexception5251%2Ff-00003%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fexception5251%2Fi%2F10000379%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【お買い物マラソン限定最大1,000円OFFクーポン！】2点セット 旅行用圧縮袋 | 旅行用品 | ¥3,490 | 3377 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000075%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【0のつく日×40％OFFクーポン】【楽天デイリー総合1位】 日傘 日傘 超軽量 | 生活便利グッズ | ¥3,080 | 18621 | 4.49 | 95.9 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u575o.3agd04f3.g00u575o.3agd1b3e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fchakasho-dina%2F383yimiaorisan%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fchakasho-dina%2Fi%2F10000637%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼タイムセール限定6400円／【美人百花ドライヤー部門NO1】ドライヤー 大風量 | 美容・身だしなみ用品 | ¥6,400 | 1770 | 4.49 | 95.9 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tm3yo.3agd02cb.g00tm3yo.3agd13dc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaselab%2F05-acfj31-04j%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaselab%2Fi%2F10000361%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| クーポンで最安3,980円~「楽天1位」【返品&交換保証 送料無料】AI自動温度 | 季節商品 | ¥7,480 | 1753 | 4.48 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u4xuo.3agd0294.g00u4xuo.3agd14e7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaieitenfashionnigou%2Fxt061%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaieitenfashionnigou%2Fi%2F10000205%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【お買い物マラソン限定最大1,000円OFFクーポン！】3点セット 旅行用圧縮袋 | 旅行用品 | ¥4,490 | 1706 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000105%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| コイズミ マイナスイオンドライヤー KHD-1285/W - KHD1285W  | 美容・身だしなみ用品 | ¥3,300 | 1520 | 4.48 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rdq6o.3agd00a2.g00rdq6o.3agd131b/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcoconial%2Fkhd1280%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fcoconial%2Fi%2F10005056%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 連続2年受賞！【COUPONで1,890円・超お得SALE】 モバイルバッテリー | 防災用品 | ¥3,990 | 15445 | 4.45 | 95.6 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tdsyo.3agd0bd1.g00tdsyo.3agd18da/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyumenomori%2Fp1dx14600%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyumenomori%2Fi%2F10000194%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |

## 運用ルール

- 毎日1投稿ペースなので、同じ商品を30日以内に再度取り上げない(楽天のクッキー期間(最大約30日)より長く空けることで、成果発生日から投稿を一意に特定できるようにするため。2026-09-09、7日から変更)
- 実際にクリック・購入があった商品は下部の「実績」に記録する
- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える

## 実績

(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)
