# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)

`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・
価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。
ジャンルは限定しない方針(`docs/marketing/2026-09-09-threads-account-repositioning.md`)。

## 上位候補

Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して
Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。

| 商品名 | ジャンル | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |
|---|---|---|---|---|---|---|---|
| 【エントリーで店内全品P10倍★ 11/25 1:59迄】タイガー魔法瓶 タイガ | キッチン用品 | ¥4,980 | 642 | 4.7 | 97.6 | amazon | [リンク](https://link.amazon/B0bwBlftG) |
| 【P20倍 ブラックフライデー 限定】 ドライヤー 速乾 大風量 【 プロテクト | 美容・身だしなみ用品 | ¥4,480 | 2598 | 4.68 | 97.4 | amazon | [リンク](https://link.amazon/B062JpFBZ) |
| サーフィン バケツ TOOLS ウォーターボックス ツールス WATER BOX | 車用品 | ¥4,880 | 1205 | 4.66 | 97.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00pvoyo.3agd0021.g00pvoyo.3agd1a3d/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmaniac%2Fsf-etc-tools-waterbox%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmaniac%2Fi%2F10005228%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ブラックフライデー限定★クーポンで3,480円~】「楽天1位」【AI自動温度調 | 季節商品 | ¥6,980 | 1871 | 4.56 | 96.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u552o.3agd0515.g00u552o.3agd1af7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkatariyashop%2Fflrmt%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkatariyashop%2Fi%2F10000441%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ブラックフライデー限定最大1,000円OFFクーポン！】お得な3・4点セット  | 旅行用品 | ¥3,990 | 1328 | 4.55 | 96.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnk058set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000136%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【25%OFFクーポン│2人に1人最大100%ポイントバック★要エントリーン】K | 生活便利グッズ | ¥3,699 | 2056 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ul29o.3agd0cd1.g00ul29o.3agd1b8e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fkawapettii%2Fbt-yzd2024hs001-ss%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fkawapettii%2Fi%2F10000076%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【BF限定★300円クーポン】ハンディクリーナー 掃除機 コードレス 軽量 54 | 掃除用品 | ¥5,480 | 1228 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rgoio.3agd037d.g00rgoio.3agd18e5/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fhg-store%2Fhv-22%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fhg-store%2Fi%2F10000214%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| Anker Power Bank (10000mAh, 22.5W) (モバイル | モバイル機器 | ¥3,490 | 2334 | 4.53 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rr09o.3agd07a8.g00rr09o.3agd1025/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fanker%2Fa1257%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fanker%2Fi%2F10001908%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【在庫一掃・BF応援クーポンで5799円！】掃除機 コードレス 軽量 強力吸引  | 掃除用品 | ¥5,999 | 1437 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tonko.3agd02a5.g00tonko.3agd1261/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fheimvision%2Fe20%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fheimvision%2Fi%2F10000060%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 収納ボックス ふた付き かご バスケット 収納バスケット 3個セット L M S | 生活便利グッズ | ¥7,860 | 668 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qp0oo.3agd061a.g00qp0oo.3agd1e6f/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmercadomercado%2Fqn006%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmercadomercado%2Fi%2F10000151%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【COUPONで3,570円〜・BL限定】 電気毛布 敷き 掛け 65℃速暖 楽 | 季節商品 | ¥7,760 | 3298 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00ubfso.3agd089c.g00ubfso.3agd1dcf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fennshopstore%2Fbx88pj%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fennshopstore%2Fi%2F10000061%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| リニューアル ONE-BREATH ネックピロー【マーナ公式】 空気で膨らむ 飛 | 車用品 | ¥3,630 | 587 | 4.51 | 96.1 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qtg2o.3agd0299.g00qtg2o.3agd1df1/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshopmarna%2Fs490%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fshopmarna%2Fi%2F10006596%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【楽天総合ランキング1位】収納ボックス 木天板付き新発売 キャスター付き 5面開 | 生活便利グッズ | ¥4,280 | 5710 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uaejo.3agd04fe.g00uaejo.3agd1eb6/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fexception5251%2Ff-00003%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fexception5251%2Fi%2F10000379%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ブラックフライデー限定最大1,000円OFFクーポン！】2点セット 旅行用圧縮 | 旅行用品 | ¥3,490 | 3378 | 4.5 | 96.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000075%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【先着様限定全店対象！2点購入でまとめて50％OFF！】11/25 23:59迄 | 生活便利グッズ | ¥3,080 | 18704 | 4.49 | 95.9 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u575o.3agd04f3.g00u575o.3agd1b3e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fchakasho-dina%2F383yimiaorisan%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fchakasho-dina%2Fi%2F10000637%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ブラックフライデー限定最大1,000円OFFクーポン！】3点セット 旅行用圧縮 | 旅行用品 | ¥4,490 | 1706 | 4.47 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tkn8o.3agd0990.g00tkn8o.3agd19cb/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fichifujiec%2Fnsana018set3%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fichifujiec%2Fi%2F10000105%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| コイズミ マイナスイオンドライヤー KHD-1285/W - KHD1285W  | 美容・身だしなみ用品 | ¥3,300 | 1521 | 4.48 | 95.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00rdq6o.3agd00a2.g00rdq6o.3agd131b/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcoconial%2Fkhd1280%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fcoconial%2Fi%2F10005056%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ブラックフライデー 限定★クーポンで3,480円～】「楽天1位」【返品&交換保 | 季節商品 | ¥7,480 | 1858 | 4.46 | 95.7 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u4xuo.3agd0294.g00u4xuo.3agd14e7/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbaieitenfashionnigou%2Fxt061%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fbaieitenfashionnigou%2Fi%2F10000205%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 連続2年受賞！【COUPONで1,890円・BF SALE】 モバイルバッテリー | 防災用品 | ¥3,990 | 15515 | 4.45 | 95.6 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tdsyo.3agd0bd1.g00tdsyo.3agd18da/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyumenomori%2Fp1dx14600%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyumenomori%2Fi%2F10000194%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 日本製 電気敷毛布 電気毛布 洗える ダニ退治 シングル【RCP】 電気毛布(し | 季節商品 | ¥3,480 | 1504 | 4.42 | 95.4 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00qegto.3agd0f49.g00qegto.3agd1680/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Ftownland%2Fr-1805050630001%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Ftownland%2Fi%2F10000033%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |

## 運用ルール

- 毎日1投稿ペースなので、同じ商品を30日以内に再度取り上げない(楽天のクッキー期間(最大約30日)より長く空けることで、成果発生日から投稿を一意に特定できるようにするため。2026-09-09、7日から変更)
- 実際にクリック・購入があった商品は下部の「実績」に記録する
- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える

## 実績

(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)
