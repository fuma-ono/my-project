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
