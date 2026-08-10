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
- `sfx.py` — 効果音。メッセージ到着ごとの通知ポップ音は自前合成。クライマックスの効果音は効果音ラボの「男衆「イヤッホー！」」(`assets/sfx/`、唯一の外部素材、ライセンスは`assets/sfx/NOTICE.md`参照)。2026-08-10追加: セリフに「ひどい言葉・衝撃的な言葉」(`line_chat.py`の`HARSH_TRIGGER_WORDS`)が含まれる行を自動検知し、驚き効果音(`surprise_hit`、上昇音+低音ヒット)を自動で重ねる。手動で置く`!sfx:`とは別枠で、台本を書くたびに毎回手で置かなくても内容に応じて自動で鳴る
- `bgm.py` — 動画全体に控えめな音量で流すBGMループの自前合成(128BPMのキック/スネア/ハイハット+シンコペーションのペンタトニックメロディ、ポップな曲調)
- `assemble_video.py` — 旧方式(地の文をそのまま字幕として焼き込む)。**2026-08-06のオーナー指示によりline_chat.pyに置き換え済み、現在は使用しない**(ファイル冒頭に理由を明記)
- `voicevox_narrate.py` — 実ナレーション音声の生成(VOICEVOXエンジン経由・PCが使える場合)。台本の各セリフをVOICEVOXの実音声で合成し、`line_chat.py`と全く同じ`estimate_arrivals()`で配置した1本の音声ファイル(`.wav`)と、各セリフの実尺リスト(`.durations.json`)を書き出す。VOICEVOXエンジン(`http://127.0.0.1:50021`)への到達が前提のため、このクラウド環境では未実行・未検証(コード自体は完成)。**オーナーがiPhoneのみでPCを持っていないと2026-08-07に判明したため、現状は下記の`manual_narration.py`が主に使う方式**
- `manual_narration.py` — **実ナレーション音声の生成(現在の主方式)**。オーナーの持つiPhoneアプリ「ずんだボイス『ずんだもん読み上げアプリ』」で1行ずつ手動生成した音声クリップを取り込み、`voicevox_narrate.py`と全く同じ出力形式(`.wav`+`.durations.json`)に組み立てる`assemble`は共通。`list`サブコマンドは`--format text`(人間向け収録チェックリスト、デフォルト)と`--format json`(2026-08-07追加。iPad Shortcutsから自動ループでWEB版VOICEVOX APIを叩くための機械可読形式、話者ID込み)の2形式に対応。実際に合成した無音クリップで動作確認済み(assembleと`line_chat.py --audio --durations`の通し実行を確認)。手順は`docs/projects/moyasuka/voicevox-setup.md`
- `publish.py` — **2026-08-10新規: 実際のYouTube公開自動化**。台本+ナレーション音声から動画をレンダリングし、`@moyasuka`チャンネルへアップロードするところまで一本化。`bgm_pipeline`のアップロード/処理確認コード(`youtube_upload.py`)をそのまま再利用し、認証だけ`youtube_auth.py`(下記)で`@moyasuka`専用に分離。**「毎日投稿」の実装として欠けていた最後のピース**——これまでは実音声入り動画(台本01)ができてもオーナーへ送付するだけで、YouTube APIを一度も呼んでいなかった
- `youtube_auth.py` — `@moyasuka`チャンネル専用のOAuth(bgm_pipelineとは別チャンネル・別Googleアカウントの想定なので、トークンも別管理)。`bgm_pipeline`の`YouTubeAuth`実装をそのまま再利用し、GCPのOAuthクライアント(`client_secret.json`)も使い回すが、トークン(`moyasuka/credentials/youtube_token.json`)は完全に別。**初回のみオーナー対応が必要**: `python3 -m moyasuka.youtube_auth login` を実行し、表示されるURL+コードで`@moyasuka`を管理しているGoogleアカウントで承認する
- `audio_mix.py` — `voicevox_narrate.py`と`manual_narration.py`が共用する、複数の音声クリップを指定時刻に配置してミックスする処理(重複コードを避けるため分離)
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

### 本番用(実ナレーション音声)

オーナーがiPhone/iPadのみでPCを持っていないため、手動アプリ経由(方式A)・iPad Shortcuts自動化(方式A')の2方式を用意。どちらも`manual_narration.py`の同じ`assemble`で組み立てる:

```bash
# 1. チェックリストを作る(--format jsonならShortcuts向け機械可読形式、省略時は人間向けテキスト)
python3 -m moyasuka.manual_narration list \
  --script moyasuka/scripts/01-sample.md --out /tmp/checklist.json --format json
# 2a. (オーナー)iPad ShortcutsでWEB版VOICEVOX APIを自動ループ呼び出し・保存 [方式A'・推奨]
#     または
# 2b. (オーナー)チェックリスト通りにiPhoneアプリで1行ずつ手動収録・アップロード [方式A]
# 3. アップロードされたクリップを組み立てる(2a/2bどちらでも同じ)
python3 -m moyasuka.manual_narration assemble \
  --script moyasuka/scripts/01-sample.md \
  --clips-dir /path/to/uploaded/clips \
  --out /tmp/moyasuka-01-narration
# 4. 実音声の尺に正確に同期させて最終レンダリング
python3 -m moyasuka.line_chat \
  --script moyasuka/scripts/01-sample.md \
  --audio /tmp/moyasuka-01-narration.wav \
  --durations /tmp/moyasuka-01-narration.durations.json \
  --out moyasuka-01-final.mp4
```

方式A'(Shortcuts自動化)は1行ずつのコピペ(1本あたり20〜30回)をなくす狙いで2026-08-07に追加。iPad上のShortcutsから直接WEB版VOICEVOX API(tts.quest/su-shiki.com、このクラウド環境からはブロックされ私からは呼べないがiPad自体は制約対象外)を叩く設計で、私たちはiOS実機を持っておらず未検証。手順・容量管理の運用ルールは`docs/projects/moyasuka/voicevox-setup.md`の方式A'。PCが使える環境になった場合は`voicevox_narrate.py`(VOICEVOXエンジン経由、1コマンドで全セリフ自動合成)に置き換え可能——出力形式は共通なので3.以降はそのまま。

`--audio`と`--durations`は必ずセットで渡す(`--durations`を省略すると文字数からの概算尺のままになり、実音声とズレる)。詳細手順は`docs/projects/moyasuka/voicevox-setup.md`。

## 現状

- 背景映像: v4まで反復済み、方向性確定
- チャンネルアイコン・バナー: 生成済み・チャンネルに反映済み(APIで確認済み)
- **動画合成パイプラインをLINEチャットUIに全面刷新**(`line_chat.py`)。オーナーからの実映像フィードバックを8ラウンド反映済み(①メッセージのコンパクト化・連投グループ化 ②内容強化・1分尺化・ナレーションカード廃止・チャットパネル縮小して上部配置 ③終わり方をスカッと感のある展開に ④画像・スタンプを角括弧テキストから実グラフィックに、終わり方をさらに強化 ⑤スカッとする瞬間に効果音 ⑥効果音を「デデデデデーン」に差し替え、控えめなBGMを追加 ⑦メッセージ到着ごとの通知音を追加 ⑧クライマックス効果音を効果音ラボの実素材に差し替え)。各バージョンを実レンダリングし、フレーム・音量を確認済み。残るは実際のナレーション音声の差し込みのみ
- 台本: 3本すべてLINEチャット形式(ナレーションなし、約53〜67秒)に書き直し済み(`scripts/01-sample.md`〜`03-coworker.md`)。証拠画像は自前生成の棒グラフ/リスト表示、対立相手の反応はスタンプで表現。主人公は相手を慰めず、複数の第三者が味方するスカッと重視の展開に統一。ネタ帳に残り7本(`docs/projects/moyasuka/content-backlog.md`)
- 音声合成: **2026-08-09、iPad Shortcuts自動化(方式A')の実機動作確認が完了し、初めての実音声入り動画(台本01、33秒)が完成した。** オーナーがiPhoneのみでPCを持っていないと2026-08-07に判明(VOICEVOXは公式iOS版なし)したため、`manual_narration.py list --format json`が出力するJSON配列をオーナーのiPad Shortcutsに直接テキストとして貼り付け、正しいAPI(`api.tts.quest/v3/voicevox/synthesis`、JSONでダウンロードURLを返す2段階方式)を自動ループ呼び出しする設計に落ち着いた。実際に組む過程で見つかった問題(iCloud経由のファイル参照が不安定/`/simple/`はボット判定される/連続呼び出しでレート制限/ゼロ埋めアクションが見当たらない)は全て解決済み——最後のゼロ埋め問題は`manual_narration.py`の`_find_clip`をゼロ埋みの有無を問わず一致するよう直すことで、iPad側の負担をなくす形で解消した。手順は`docs/projects/moyasuka/voicevox-setup.md`(方式A'、実機確認済みの正確なアクション名で記載)
- 新YouTubeチャンネル: **作成完了**(2026-08-06、オーナー対応)。[youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ](https://youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ)(`@moyasuka`)。APIで名称・ハンドル・概要欄・バナーが用意した内容と一致していることを確認済み
- チャンネル名・ハンドル: **「モヤスカ」・`@moyasuka`で確定・反映済み**(`docs/projects/moyasuka/naming.md`)

## 人間側でまだ必要な作業

- 送付済みの実音声入り動画(台本01)のクオリティ確認。問題なければ初回投稿が可能
- 台本02・03分のナレーションも、同じShortcutを使って(JSON部分だけ差し替えて)収録してほしい
