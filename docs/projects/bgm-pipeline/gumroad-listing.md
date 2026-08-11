# Gumroad出品手順(既存資産の収益チャネル実験)

`docs/company-os/experiments/existing-asset-revenue-channel-2026-08-11.md`の実行内容。商品パッケージ・文面は準備済み。オーナーが行うのは以下のみ(iPhoneのSafariから実施可能、所要15〜20分)。

## 準備済みのもの

- **商品ファイル**: `/tmp/bgm-pack/quiet-hours-bgm-pack-01.zip`(4曲・各15分、mp3、既存の自社生成BGM)
- **商品ページ文面**: 下記そのままコピペ

## 手順

1. https://gumroad.com/signup でアカウント作成(メールアドレスのみ、パスワードはGumroad自身のページに直接入力)
2. 「決済を受け取る」設定でStripe(またはPayPal)を接続(本人確認・銀行口座情報の登録が必要、Gumroad側の画面の指示に従う)
3. 「New Product」→ 種類は「Digital product」
4. 下記のタイトル・説明・価格を貼り付け、`quiet-hours-bgm-pack-01.zip`をアップロード
5. 公開(Publish)

## 商品ページ文面(コピペ用)

**タイトル**:
```
Quiet Hours BGM Pack Vol.1 — 睡眠・集中用アンビエントBGM 4曲セット(商用利用可)
```

**価格**: ¥500(初回。反応を見て調整)

**説明文**:
```
AIが作曲・生成した、歌詞なし・広告なしの睡眠用/作業用BGM 4曲セットです。

収録曲(各15分、ループ再生推奨):
1. Sleep Deep Drone — 深い眠りのためのドローン
2. Sleep Rain Focus — 雨音とやわらかなパッドで眠れる
3. Study Lofi Chill — カフェ気分のLo-Fiチルビート
4. Study Focus Binaural — アルファ波バイノーラルビートで集中

■ ライセンス
このパックは royalty-free です。購入後、以下の用途に自由にお使いいただけます:
- 個人利用(睡眠・作業・勉強のBGMとして)
- YouTube/TikTok/Instagram等の動画・配信のBGMとしての利用(商用可)
- ポッドキャスト・プレゼン等の背景音としての利用

再配布・単体での転売(このBGM単体を「BGM素材」として再販すること)は禁止します。

■ 制作について
本パックの楽曲はAIによって生成されています。作曲・生成プロセスの一部は
YouTubeチャンネル「Quiet Hours」で公開しています。
```

**タグ**: `bgm, ambient, lofi, sleep music, study music, royalty free, ai music`

## 公開後にやること(社長側で対応、オーナー作業不要)

公開されたGumroadのURLを教えてもらえれば、以下を自動で実施する:
- 既存YouTube動画(公開済み5本)の概要欄にリンクを追加(`youtube_upload.py`の`videos.update`相当)
- `docs/company-os/revenue/`で売上発生を監視(30日後に評価、`existing-asset-revenue-channel-2026-08-11.md`の撤退基準参照)
