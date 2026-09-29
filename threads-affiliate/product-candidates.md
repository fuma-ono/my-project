# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)

`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・
価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。
ジャンルは限定しない方針(`docs/marketing/2026-09-09-threads-account-repositioning.md`)。

## 上位候補

Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して
Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。

| 商品名 | ジャンル | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |
|---|---|---|---|---|---|---|---|
| 【タイガー魔法瓶 楽天市場店】 CB柄：予約受付中 タイガー 電気ケトル わく子 | キッチン用品 | ¥4,980 | 606 | 4.71 | 97.7 | amazon | [リンク](https://link.amazon/B0bwBlftG) |
| 【楽天1位】ドライヤー 速乾 早く乾く 大風量 大風圧 強力 時短 軽い 軽量  | 美容・身だしなみ用品 | ¥4,480 | 2450 | 4.67 | 97.4 | amazon | [リンク](https://link.amazon/B062JpFBZ) |
| サーフィン バケツ TOOLS ウォーターボックス ツールス WATER BOX | 車用品 | ¥4,880 | 1207 | 4.66 | 97.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00pvoyo.3agd0021.g00pvoyo.3agd1a3d/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmaniac%2Fsf-etc-tools-waterbox%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmaniac%2Fi%2F10005228%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| クーポンで3,980円～「楽天1位」【AI自動温度調節×炭素繊維ヒーター】 ふわ | 季節商品 | ¥7,480 | 1815 | 4.56 | 96.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u552o.3agd0515.g00u552o.3agd1af7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkatariyashop%2Fflrmt%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkatariyashop%2Fi%2F10000441%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| お得な3・4点セット 圧縮収納ポーチ 旅行用圧縮袋 YKK トラベルポーチ 圧縮 | 旅行用品 | ¥4,480 | 1326 | 4.55 | 96.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnk058set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000136%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【応援価格・12,980円→7,480円】日本正規品★雑誌GOODA掲載★楽天1 | 美容・身だしなみ用品 | ¥7,480 | 1325 | 4.55 | 96.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00trm8o.3agd0c0d.g00trm8o.3agd13ab/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Faooka%2Fns-hd23%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Faooka%2Fi%2F10000827%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼楽天ランキング1位／ハンディクリーナー 掃除機 コードレス 軽量 540g コ | 掃除用品 | ¥5,480 | 1208 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rgoio.3agd037d.g00rgoio.3agd18e5/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fhg-store%2Fhv-22%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fhg-store%2Fi%2F10000214%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| Anker Power Bank (10000mAh, 22.5W) (モバイル | モバイル機器 | ¥3,490 | 2245 | 4.53 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rr09o.3agd07a8.g00rr09o.3agd1025/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fanker%2Fa1257%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fanker%2Fi%2F10001908%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 電気毛布 敷き 掛け敷き 電気敷き毛布 電気掛け敷き毛布 掛け敷き兼用 日本製  | 季節商品 | ¥3,390 | 2276 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00t1dwo.3agd0d7f.g00t1dwo.3agd1805/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Flifejoy-shop%2Fjbs401%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Flifejoy-shop%2Fi%2F10000044%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【在庫一掃・クーポンで5899円！】掃除機 コードレス 軽量 強力吸引 サイクロ | 掃除用品 | ¥5,999 | 1434 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tonko.3agd02a5.g00tonko.3agd1261/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fheimvision%2Fe20%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fheimvision%2Fi%2F10000060%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 収納ボックス ふた付き かご バスケット 収納バスケット 3個セット L M S | 生活便利グッズ | ¥7,860 | 667 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qp0oo.3agd061a.g00qp0oo.3agd1e6f/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmercadomercado%2Fqn006%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmercadomercado%2Fi%2F10000151%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【COUPONで3,570円〜・SNS超人気】 電気毛布 掛け敷き 楽天1位 U | 季節商品 | ¥7,760 | 2622 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ubfso.3agd089c.g00ubfso.3agd1dcf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fennshopstore%2Fbx88pj%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fennshopstore%2Fi%2F10000061%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【今すぐ使える！店内全品45％OFFクーポン】《35％OFFクーポン》【楽天デイ | 生活便利グッズ | ¥3,080 | 18226 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u575o.3agd04f3.g00u575o.3agd1b3e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fchakasho-dina%2F383yimiaorisan%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fchakasho-dina%2Fi%2F10000637%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【楽天ランキング1位】総合1位 収納ボックス キャスター付き 5面開閉 折りたた | 生活便利グッズ | ¥4,280 | 5493 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uaejo.3agd04fe.g00uaejo.3agd1eb6/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fexception5251%2Ff-00003%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fexception5251%2Fi%2F10000379%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 2点セット 旅行用圧縮袋 トラベルポーチ YKK 圧縮バッグ 圧縮ポーチ 圧縮  | 旅行用品 | ¥3,490 | 3363 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000075%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| クーポンで最安3,980円~「楽天1位」【国内品質検査クリア】【AI自動温度調節 | 季節商品 | ¥7,480 | 1652 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u4xuo.3agd0294.g00u4xuo.3agd14e7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaieitenfashionnigou%2Fxt061%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaieitenfashionnigou%2Fi%2F10000205%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 3点セット 旅行用圧縮袋 トラベルポーチ YKK 圧縮バッグ 圧縮ポーチ 圧縮  | 旅行用品 | ¥4,490 | 1700 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000105%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| コイズミ マイナスイオンドライヤー KHD-1285/W - KHD1285W  | 美容・身だしなみ用品 | ¥3,000 | 1514 | 4.48 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rdq6o.3agd00a2.g00rdq6o.3agd131b/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcoconial%2Fkhd1280%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fcoconial%2Fi%2F10005056%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 連続2年受賞！【COUPONで1,890円・超お得SALE】 モバイルバッテリー | 防災用品 | ¥3,990 | 15303 | 4.45 | 95.6 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tdsyo.3agd0bd1.g00tdsyo.3agd18da/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyumenomori%2Fp1dx14600%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyumenomori%2Fi%2F10000194%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【楽天1位】＼限定クーポンで2,580円！／ドライヤー 大風量 1400W 速乾 | 美容・身だしなみ用品 | ¥4,980 | 2581 | 4.44 | 95.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uqt6o.3agd0c5b.g00uqt6o.3agd1ec4/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Ffelice1009%2Ffelice-y2%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Ffelice1009%2Fi%2F10000006%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |

## 運用ルール

- 毎日1投稿ペースなので、同じ商品を30日以内に再度取り上げない(楽天のクッキー期間(最大約30日)より長く空けることで、成果発生日から投稿を一意に特定できるようにするため。2026-09-09、7日から変更)
- 実際にクリック・購入があった商品は下部の「実績」に記録する
- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える

## 実績

(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)
