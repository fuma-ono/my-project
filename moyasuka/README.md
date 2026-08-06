# モヤスカ — 第4事業

LINE風の会話ドラマをAI音声合成(VOICEVOX/COEIROINK)でナレーションし、自前生成の背景映像とあわせてYouTube Shortsに投稿する新チャンネル。オーナー指示(2026-08-05)により着手。

- **チーム編成・進捗**: `docs/projects/moyasuka/team.md`
- **背景映像のデザイン決定の経緯**: `docs/projects/moyasuka/background.md`
- **LINEチャットUI化の経緯**: `docs/projects/moyasuka/line-chat-ui.md`
- **投稿方針(フォーマット・言語・頻度・時刻)**: `docs/projects/moyasuka/posting-policy.md`
- **チャンネル名・ハンドル名の決定**: `docs/projects/moyasuka/naming.md`(チャンネル名「モヤスカ」・ハンドル`@moyasuka`で確定)
- **チャンネル概要欄(コピペ用)**: `docs/projects/moyasuka/channel-description.md`

## 投稿方針(要点)

オーナー指示(2026-08-06)により決定: **Shorts中心・完全日本語・毎日20:00 JST固定投稿**。根拠と運用体制は`docs/projects/moyasuka/posting-policy.md`参照。

## このディレクトリの中身

- `background_gen.py` — 背景映像の自前生成(チャット吹き出し型のボールが円形アリーナ内で物理演算バウンド、数が増減する)。外部素材・実写映像は不使用
- `channel_art.py` — チャンネルアイコン(800x800)・バナー(2560x1440)の自前生成。`background_gen.py`と同じ吹き出しモチーフ、完全自前(PIL)で外部素材不使用
- `line_chat.py` — **現行の動画合成パイプライン**。台本(`scripts/*.md`)を実際のLINEチャット画面(緑/白の吹き出し、ヘッダーバー、スクロール)として描画し、背景映像・ナレーション音声と合成する。使い方は下記。詳細な経緯は`docs/projects/moyasuka/line-chat-ui.md`
- `assemble_video.py` — 旧方式(地の文をそのまま字幕として焼き込む)。**2026-08-06のオーナー指示によりline_chat.pyに置き換え済み、現在は使用しない**(ファイル冒頭に理由を明記)
- `scripts/` — スカッと系のストーリー台本。LINEのメッセージのやり取りとして書く(フォーマットは`line-chat-ui.md`参照)

## 動画を組み立てる

```bash
python3 -m moyasuka.line_chat \
  --script moyasuka/scripts/01-sample.md \
  --seed 4 \
  --audio /tmp/narration.wav \
  --out /tmp/moyasuka-01.mp4
```

`--audio`を省略すると無音のプレースホルダー音声(台本の文字数から尺を概算)で合成される。VOICEVOXセットアップ前でもパイプラインの動作確認ができる。背景映像のボール物理演算は台本の尺に合わせて自動生成されるので、別途`background_gen.py`を実行する必要はない。

## 現状

- 背景映像: v4まで反復済み、方向性確定
- チャンネルアイコン・バナー: 生成済み・チャンネルに反映済み(APIで確認済み)
- **動画合成パイプラインをLINEチャットUIに全面刷新**(`line_chat.py`)。台本01で実レンダリング済み(2分7秒、1381フレーム)、複数時点のフレームを目視確認済み。残るは実際のナレーション音声の差し込みのみ
- 台本: 3本すべてLINEチャット形式に書き直し済み(`scripts/01-sample.md`〜`03-coworker.md`)、ネタ帳に残り7本(`docs/projects/moyasuka/content-backlog.md`)
- 音声合成(VOICEVOX): エンジン本体がこのクラウド環境でダウンロードできないため未着手。note.com/Xの自動投稿と同じ理由で、**オーナー自身のPCでのセットアップが必要な見込み**
- 新YouTubeチャンネル: **作成完了**(2026-08-06、オーナー対応)。[youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ](https://youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ)(`@moyasuka`)。APIで名称・ハンドル・概要欄・バナーが用意した内容と一致していることを確認済み
- チャンネル名・ハンドル: **「モヤスカ」・`@moyasuka`で確定・反映済み**(`docs/projects/moyasuka/naming.md`)

## 人間側でまだ必要な作業

- VOICEVOXエンジンのセットアップ(手元PC)
