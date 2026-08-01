# 事業概要(社長 → オーナー 報告)

ゼロ予算・ゼロアカウントの状態から、2本の収益事業の「仕組み」をこのリポジトリに構築しました。
どちらも外部の有料AI APIを使わず、コードだけでコンテンツ/プロダクトを生成できる状態にしてあります。

## 事業1: AI BGM動画事業(`bgm-pipeline/`)

- 完全アルゴリズム生成(numpy/scipy)でBGM(睡眠用ドローン、雨音、Lo-Fi、バイノーラルビート)を作曲
- ffmpegでループ映像(アニメーショングラデーション)と合成し、YouTube横長(16:9)・TikTok/Reels/Shorts縦長(9:16)のMP4をそのまま書き出し
- 1本あたりの限界コストはほぼゼロ(サーバー代/電気代のみ)
- 収益モデル: YouTube広告収益(YouTubeパートナープログラム)、TikTok Creator Rewards等
- 動作確認済み(`bgm-pipeline/output/`にサンプル生成、コミット対象外)

詳細・使い方は `bgm-pipeline/README.md` を参照。

## 事業2: アプリ事業(`app/`)

- Expo(React Native)製「Focus & Sleep Sounds」アプリの雛形
- 事業1で生成したBGMをそのままアプリの音源として活用(コンテンツの使い回しでシナジー)
- フリーミアムモデル: 一部トラック無料、Lo-Fi/バイノーラルなどはPremium(モック課金画面あり、実課金は未接続)
- TypeScript型チェック・Metroバンドル確認済み

詳細・使い方は `app/README.md` を参照。

## 今後、人間側(オーナー)の判断・作業が必要な項目

どちらの事業も「投稿ボタン/申請ボタンを押す」部分は代行できません(アカウント認証情報が必要なため)。

1. **YouTube/Instagram/TikTokアカウントの用意**とチャンネルブランディング(名前、アイコン、概要欄)
2. 生成した動画の**実際のアップロード**(手動、または将来的にYouTube Data APIで自動化も可能)
3. **Apple Developer Program**($99/年)・**Google Play Console**($25)アカウント取得
4. アプリの実課金連携(RevenueCat / expo-in-app-purchases)と広告SDK(AdMob等)の選定
5. 予算が付いた場合: Suno等の高品質AI音楽生成APIやAI動画生成への切り替え検討(現状は無料の自前アルゴリズムのみ)

## 次の一手の提案

- BGM動画: どのプリセット(睡眠/作業用)から先に投稿するか、チャンネル名を決めていただければ、投稿本数分をまとめて生成します
- アプリ: 実際にExpo Goで動作確認したい場合はQRコードでの起動をサポートします。App Store/Google Playアカウントが用意でき次第、申請用ビルド(EAS Build)を進めます

## リポジトリ構成

```
bgm-pipeline/   # AI BGM生成 + 動画書き出しパイプライン(Python)
app/            # Focus & Sleep Sounds アプリ(Expo/React Native)
```
