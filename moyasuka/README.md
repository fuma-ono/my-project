# モヤスカ — 第4事業

LINE風の会話ドラマをAI音声合成(VOICEVOX/COEIROINK)でナレーションし、自前生成の背景映像とあわせてYouTube Shortsに投稿する新チャンネル。オーナー指示(2026-08-05)により着手。

- **チーム編成・進捗**: `docs/projects/moyasuka/team.md`
- **背景映像のデザイン決定の経緯**: `docs/projects/moyasuka/background.md`
- **投稿方針(フォーマット・言語・頻度・時刻)**: `docs/projects/moyasuka/posting-policy.md`
- **チャンネル名・ハンドル名の決定**: `docs/projects/moyasuka/naming.md`(チャンネル名「モヤスカ」・ハンドル`@moyasuka`で確定)
- **チャンネル概要欄(コピペ用)**: `docs/projects/moyasuka/channel-description.md`

## 投稿方針(要点)

オーナー指示(2026-08-06)により決定: **Shorts中心・完全日本語・毎日20:00 JST固定投稿**。根拠と運用体制は`docs/projects/moyasuka/posting-policy.md`参照。

## このディレクトリの中身

- `background_gen.py` — 背景映像の自前生成(チャット吹き出し型のボールが円形アリーナ内で物理演算バウンド、数が増減する)。外部素材・実写映像は不使用
- `channel_art.py` — チャンネルアイコン(800x800)・バナー(2560x1440)の自前生成。`background_gen.py`と同じ吹き出しモチーフ、完全自前(PIL)で外部素材不使用。`python3 moyasuka/channel_art.py --outdir <出力先>`で生成
- `scripts/` — スカッと系/ほんわか系のストーリー台本

## 現状

- 背景映像: v4まで反復済み、方向性確定
- チャンネルアイコン・バナー: 生成済み(オーナーへ送付、チャンネル作成時にアップロード)
- 台本: サンプル1本(`scripts/01-sample.md`)
- 音声合成(VOICEVOX): エンジン本体がこのクラウド環境でダウンロードできないため未着手。note.com/Xの自動投稿と同じ理由で、**オーナー自身のPCでのセットアップが必要な見込み**
- 新YouTubeチャンネル: 未作成(オーナー対応)
- チャンネル名・ハンドル: **「モヤスカ」・`@moyasuka`で確定**(`docs/projects/moyasuka/naming.md`)

## 人間側でまだ必要な作業

- 新YouTubeチャンネルを「モヤスカ」名義・`@moyasuka`ハンドルで作成
- VOICEVOXエンジンのセットアップ(手元PC)
