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
- `line_chat.py` — **現行の動画合成パイプライン**。台本(`scripts/*.md`)を実際のLINEチャット画面(緑/白の吹き出し、ヘッダーバー、スクロール)として描画し、背景映像・ナレーション音声・効果音(`!sfx:`キュー)と合成する。使い方は下記。詳細な経緯は`docs/projects/moyasuka/line-chat-ui.md`
- `sfx.py` — 効果音。メッセージ到着ごとの通知ポップ音は自前合成。クライマックスの効果音は効果音ラボの「男衆「イヤッホー！」」(`assets/sfx/`、唯一の外部素材、ライセンスは`assets/sfx/NOTICE.md`参照)
- `bgm.py` — 動画全体に控えめな音量で流すBGMループの自前合成(ペンタトニックのプラック音フレーズ)
- `assemble_video.py` — 旧方式(地の文をそのまま字幕として焼き込む)。**2026-08-06のオーナー指示によりline_chat.pyに置き換え済み、現在は使用しない**(ファイル冒頭に理由を明記)
- `voicevox_narrate.py` — **実ナレーション音声の生成**。台本の各セリフをVOICEVOXの実音声で合成し、`line_chat.py`と全く同じ`estimate_arrivals()`で配置した1本の音声ファイル(`.wav`)と、各セリフの実尺リスト(`.durations.json`)を書き出す。VOICEVOXエンジン(手元PC、`http://127.0.0.1:50021`)への到達が前提のため、このクラウド環境では未実行・未検証(コード自体は完成)。セットアップ手順は`docs/projects/moyasuka/voicevox-setup.md`
- `scripts/` — スカッと系のストーリー台本。LINEのメッセージのやり取りとして書く(フォーマットは`line-chat-ui.md`参照)

## 動画を組み立てる

### 動作確認用(プレースホルダー音声・文字数から尺を概算)

```bash
python3 -m moyasuka.line_chat \
  --script moyasuka/scripts/01-sample.md \
  --seed 4 \
  --out /tmp/moyasuka-01.mp4
```

`--audio`を省略すると無音のプレースホルダー音声で合成される。VOICEVOXセットアップ前でもパイプラインの動作確認ができる。背景映像のボール物理演算は台本の尺に合わせて自動生成されるので、別途`background_gen.py`を実行する必要はない。

### 本番用(VOICEVOXの実ナレーション音声・手元PC)

```bash
# 1. 実音声を生成(VOICEVOXエンジンが起動している状態で)
python3 -m moyasuka.voicevox_narrate \
  --script moyasuka/scripts/01-sample.md \
  --out /tmp/moyasuka-01-narration

# 2. 実音声の尺に正確に同期させて最終レンダリング
python3 -m moyasuka.line_chat \
  --script moyasuka/scripts/01-sample.md \
  --audio /tmp/moyasuka-01-narration.wav \
  --durations /tmp/moyasuka-01-narration.durations.json \
  --out moyasuka-01-final.mp4
```

`--audio`と`--durations`は必ずセットで渡す(`--durations`を省略すると文字数からの概算尺のままになり、実音声とズレる)。セットアップの詳細手順は`docs/projects/moyasuka/voicevox-setup.md`。

## 現状

- 背景映像: v4まで反復済み、方向性確定
- チャンネルアイコン・バナー: 生成済み・チャンネルに反映済み(APIで確認済み)
- **動画合成パイプラインをLINEチャットUIに全面刷新**(`line_chat.py`)。オーナーからの実映像フィードバックを8ラウンド反映済み(①メッセージのコンパクト化・連投グループ化 ②内容強化・1分尺化・ナレーションカード廃止・チャットパネル縮小して上部配置 ③終わり方をスカッと感のある展開に ④画像・スタンプを角括弧テキストから実グラフィックに、終わり方をさらに強化 ⑤スカッとする瞬間に効果音 ⑥効果音を「デデデデデーン」に差し替え、控えめなBGMを追加 ⑦メッセージ到着ごとの通知音を追加 ⑧クライマックス効果音を効果音ラボの実素材に差し替え)。各バージョンを実レンダリングし、フレーム・音量を確認済み。残るは実際のナレーション音声の差し込みのみ
- 台本: 3本すべてLINEチャット形式(ナレーションなし、約53〜67秒)に書き直し済み(`scripts/01-sample.md`〜`03-coworker.md`)。証拠画像は自前生成の棒グラフ/リスト表示、対立相手の反応はスタンプで表現。主人公は相手を慰めず、複数の第三者が味方するスカッと重視の展開に統一。ネタ帳に残り7本(`docs/projects/moyasuka/content-backlog.md`)
- 音声合成(VOICEVOX): エンジン本体がこのクラウド環境でダウンロードできないため、**合成コード(`voicevox_narrate.py`)・タイミング同期(`line_chat.py --durations`)は実装完了**、エンジンが手元で立ち上がり次第すぐ使える状態。ただし実エンジンに繋いでのテストは未実施。note.com/Xの自動投稿と同じ理由で、エンジンの起動自体はオーナー自身のPCで行う必要がある。手順は`docs/projects/moyasuka/voicevox-setup.md`
- 新YouTubeチャンネル: **作成完了**(2026-08-06、オーナー対応)。[youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ](https://youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ)(`@moyasuka`)。APIで名称・ハンドル・概要欄・バナーが用意した内容と一致していることを確認済み
- チャンネル名・ハンドル: **「モヤスカ」・`@moyasuka`で確定・反映済み**(`docs/projects/moyasuka/naming.md`)

## 人間側でまだ必要な作業

- VOICEVOXエンジンのセットアップ(手元PC)。手順は`docs/projects/moyasuka/voicevox-setup.md`に用意済み — エンジン起動後、案内の2コマンドを打つだけで実ナレーション入りの動画が完成する
