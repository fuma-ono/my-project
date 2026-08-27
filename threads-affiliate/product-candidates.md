# 商品候補リスト(楽天API自動調査、最終更新は products.json のタイムスタンプ参照)

`research.py` の自動スコアリング結果。需要(レビュー件数)・満足度(レビュー平均)・
価格帯のバランスで暫定スコアを付けている。実データが貯まったら重み付けを見直すこと。

## 上位候補

Amazonリンクが `amazon-links.md` に登録済みの商品は、Amazon側の実績作りを優先して
Amazonリンクを使う(推奨プラットフォーム欄が `amazon`)。未登録の商品は楽天(完全自動)。

| 商品名 | 価格 | レビュー数 | 評価 | スコア | 推奨 | リンク |
|---|---|---|---|---|---|---|
| 【工学博士×脳の専門医が開発】 アイマスク 《遮光率99.99%／3Dフェイスマ | ¥2,480 | 949 | 4.69 | 97.5 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00uks4o.3agd0a0f.g00uks4o.3agd146d/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fhibiwa%2Fsuyamee-000%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fhibiwa%2Fi%2F10000001%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【15%OFFクーポン配布中】 アイマスク 安眠 睡眠用 快眠 グッズ 遮光率9 | ¥1,980 | 804 | 4.66 | 97.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00t59ko.3agd0556.g00t59ko.3agd1c1c/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fgift-bmcjapan%2Fo20211222%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fgift-bmcjapan%2Fi%2F10000150%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【評価4.68★1年間保証】 アイマスク シルク 100% 遮光 睡眠用 プレゼ | ¥1,980 | 668 | 4.66 | 97.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tjb1o.3agd0865.g00tjb1o.3agd14bf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyukinosizuku%2Fn-eyemask-1%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyukinosizuku%2Fi%2F10010750%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【楽天1位 3冠】【睡眠栄養指導士 監修】遮光率99,99％ アイマスク 安眠  | ¥1,380 | 1642 | 4.62 | 97.0 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tmtxo.3agd06ba.g00tmtxo.3agd15ab/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fvalue-create%2F3d-eyemask%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fvalue-create%2Fi%2F10000001%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 8/27(木) 23:59まで『期間限定価格』COCOBEAU アイマスク シル | ¥1,428 | 1008 | 4.6 | 96.8 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00r8tbo.3agd0bb2.g00r8tbo.3agd1287/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcocobeau%2Fs-em-5%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fcocobeau%2Fi%2F10003304%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| ＼ランキング1位／アイマスク 充電式 ホットアイマスク 繰り返し使える アイピロ | ¥4,280 | 2712 | 4.54 | 96.3 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00u312o.3agd0b09.g00u312o.3agd1fa3/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fsalua-eyemaskstore%2F10000000%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fsalua-eyemaskstore%2Fi%2F10000000%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【4個セット★現医師監修★1年返品金保証★楽天1位】 耳栓 睡眠 遮音 最強 痛 | ¥1,280 | 2794 | 4.53 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tjb1o.3agd0865.g00tjb1o.3agd14bf/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fyukinosizuku%2Fn-mimisen-1%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fyukinosizuku%2Fi%2F10010503%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【出産祝いに選ばれてます】 ラルミー ベビー用品 出産祝い 男の子 女の子 ギフ | ¥5,980 | 1428 | 4.53 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00trwwo.3agd00f6.g00trwwo.3agd1c34/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fjustrich%2Flullme%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fjustrich%2Fi%2F10001494%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ポイント5倍】ベネクス アイマスク リカバリーウェア アクセサリー 睡眠 快眠 | ¥3,190 | 2505 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tp1do.3agd0d09.g00tp1do.3agd1e8e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fvenex-j%2F6106%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fvenex-j%2Fi%2F10000051%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |
| 【ポイント5倍】ベネクス アイマスク リカバリーウェア アクセサリー 睡眠 快眠 | ¥3,190 | 2505 | 4.52 | 96.2 | rakuten | [リンク](https://hb.afl.rakuten.co.jp/hgc/g00tp1do.3agd0d09.g00tp1do.3agd1e8e/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fvenex-j%2F6106%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fvenex-j%2Fi%2F10000051%2F&rafcid=wsc_i_is_2a84f5dd-1de6-473f-8afa-bfaf2d63eea1) |

## 運用ルール

- 1商品につき週1回までの紹介に留める(同じ商品を毎日連投しない)
- 実際にクリック・購入があった商品は下部の「実績」に記録する
- Amazon側で3件の成果が貯まったら、`amazon-links.md` の運用をPA-API自動化に切り替える

## 実績

(まだデータなし。`publish-log.jsonl` と楽天管理画面の実績を突き合わせて、ここに月次でまとめる)
