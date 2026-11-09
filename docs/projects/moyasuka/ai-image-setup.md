# AI画像生成の導入検討(2026-08-18)

オーナー質問(2026-08-18):「AI画像を差し込みたいんだけど、君は作れないんだよね?
自動化するためどうすればいい?」

## 現状: このセッションに画像生成ツールはない

Claude Code(このセッション)には、ナレーション(Cloud TTS)のような形で
呼び出せる画像生成ツールが標準搭載されていない。既存の画像関連コードは
すべて以下のどちらかで、実写・イラスト調の「AI画像」ではない:

- `moyasuka/channel_art.py` / `moyasuka/background_gen.py`: PIL(Python
  Imaging Library)による幾何学図形・グラデーション・テキストの自前描画
  (アイコン・バナー・背景のKen Burnsパン)。写真的な絵は描けない
- `[image:数字...]`記法(`line_chat.py`): 証拠として見せる棒グラフを同じく
  PILで自動生成(台本01の「掃除=613,洗濯=890...」のグラフ)
- `[photo:ファイル名]`記法: オーナーが実際にアップロードした本物の写真
  (台本01の`01-confrontation.jpg`)をそのまま表示するだけ

「熱がある人物のイラスト/写真」のような生成画像は、これらのどれにも
当てはまらず、現状は作れない。

## 自動化するには: Google Vertex AI(Imagen)が最有力

**このサンドボックスからの疎通を実際にテストした**(2026-08-18):

| 宛先 | 結果 |
|---|---|
| `texttospeech.googleapis.com` | 到達可(Cloud TTSで実運用中) |
| `aiplatform.googleapis.com`(Vertex AI) | **到達可**(HTTP到達は確認できた) |
| `api.openai.com`(DALL-E) | **到達不可**(接続タイムアウト、youtube.com等と同じブロック) |

Google系のAPIだけ許可される、というこれまでの傾向([note.com/YouTube/
TikTok/X向けは軒並みブロック]と対照的に`texttospeech.googleapis.com`だけ
通っていた経緯)がVertex AIにも当てはまる。OpenAIのAPIキーを別途取得しても
このサンドボックスからは呼べないため、**Google Cloud (Vertex AI Imagen)一択**
になる。

**実際にImagenのpredictエンドポイントへ認証付きリクエストを送って検証**
(`moyasuka/credentials/gcp_tts_service_account.json`、Cloud TTSと同じ
サービスアカウント・同じ`cloud-platform`スコープを流用):

```
POST https://us-central1-aiplatform.googleapis.com/v1/projects/focus-sleep-sounds/locations/us-central1/publishers/google/models/imagen-3.0-generate-002:predict
-> 403 PERMISSION_DENIED / SERVICE_DISABLED
   "Agent Platform API has not been used in project focus-sleep-sounds
   before or it is disabled."
```

つまり:
- 認証(トークン)は通っている — 既存のサービスアカウントがそのまま使える
- 唯一の障害は**Vertex AI APIが同じGCPプロジェクトで無効化されているだけ**
  (Cloud TTSを有効化した時と同じ、1クリックで済む作業)

## オーナー対応(1回だけ)

1. 以下のURLを開き、「有効にする」を押す(Cloud TTSのセットアップと同じ
   `focus-sleep-sounds`プロジェクト):
   https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=focus-sleep-sounds
2. 数分待ってから、こちらで再テストする(有効化直後は反映に時間がかかる
   場合がある、とAPI自体のエラーメッセージに明記あり)
3. サービスアカウントの権限が"Cloud Text-to-Speech User"に限定されていた
   場合、Vertex AI呼び出しには追加で"Vertex AI User"ロールの付与が必要に
   なる可能性がある(有効化後の再テストで403が続く場合はこちらを疑う)

## 2026-08-18追記: API有効化後も、もう1段階ブロッカーが残っている

オーナーがVertex AI APIを有効化(上記URL)。再テストの結果:

- **SERVICE_DISABLED(API未有効化)のエラーは解消**——API有効化は成功している
- しかし**Imagen(`imagen-3.0-generate-002`ほか試した7種のモデルID全て)への
  リクエストが軒並り404 "Publisher model ... was not found or your project
  does not have access to it"** になる
- 同じ404が、Imagenだけでなく**Gemini(`gemini-2.0-flash-001`)への
  generateContent呼び出しでも発生**することを確認——Imagen固有の問題では
  なく、**このプロジェクトからGoogleの生成AIモデル(Model Garden配下)自体に
  まだアクセスできていない**、より根本的な状態と判断した

考えられる原因(2つとも、コンソールでの操作が必要でAI側からは解決不可):
1. **請求先アカウント(Billing)がこのプロジェクトに紐付いていない**——生成AI
   系のAPIは無料枠だけでは動かないことが多く、Cloud TTSは動いていても
   Imagen/Geminiは別途課金設定が必要な場合がある
2. **Vertex AI Studio側で生成AIモデルの利用規約に未同意**——初回はコンソール
   のVertex AI Studio画面を一度開いて同意する操作が必要なことがある

**オーナーへのお願い**: Google Cloud Console → 該当プロジェクト
(`focus-sleep-sounds`)→ 「お支払い」でBillingアカウントが紐付いているか
確認、なければ設定。あわせて一度Vertex AI Studio
(https://console.cloud.google.com/vertex-ai/studio) を開いて、生成AI利用の
同意画面が出ないか確認していただけますか。どちらもAPI経由では確認・
突破できない、コンソールでの人の操作が必要な部分でした。

モデルID自体(`imagen-3.0-generate-002`等)が古い可能性も残っているが、
上記のアクセス問題が解決してから、コンソールのVertex AI Studioに実際に
表示される最新の正しいモデルIDを確認する方が早い(このAI側で当てずっぽうに
7種類試して全滅した後だったため)。

## 有効化できたら実装すること

- `moyasuka/ai_image_gen.py`(新規)を`gcp_tts_narrate.py`と同じ認証パターンで実装
- 台本に新しい記法(例: `[ai-image: 高熱で寝込んでいる女性のイラスト]`)を追加、
  `line_chat.py`が検出したら生成済み画像をキャッシュして挿入
  (毎回同じプロンプトで再生成しないよう、プロンプト文字列のハッシュを
  ファイル名にしてキャッシュする設計を想定)
- 生成した画像のスタイル(実写調/イラスト調)や解像度・アスペクト比は
  実際に生成できるようになってから、オーナーに見本を見せて決める
- 台本06の「熱がある画像を最初に差し込みたい」は、有効化・実装後に
  最初の実例として作る
