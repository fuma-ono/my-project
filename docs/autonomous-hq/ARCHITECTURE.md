# ARCHITECTURE — 動画自動編集AI(VAE)

## 全体構成

```
入力動画 ─▶ [解析 analyze]                 ─▶ [編集計画 EditPlan(JSON)] ─▶ [書き出し render] ─▶ 出力 MP4
            ├ media.probe   解像度・回転・fps・音声       ├ 残す区間(フレーム番号)       ├ 映像: select 方式(メモリ一定)
            ├ transcribe    Whisper(単語時刻・確信度)     ├ 字幕(文言・時刻・行)          ├ 字幕: ASS を libass で焼き込み
            ├ vad           Silero VAD(発話区間)          ├ 削除理由(無音・言い淀み)      └ 音声: 声を基準にミックス
            └ fillers       言い淀みの候補と判定             └ 音声設定(目標 LUFS 等)
                                    ▲
                                    └── UI(字幕の修正など)は EditPlan を書き換えて、書き出しだけをやり直す
```

- **EditPlan が中心**: UI・CLI・将来の iOS は EditPlan を通してエンジンを使う。iOS では書き出し(AVFoundation)と文字起こし(端末内認識)を作り直すが、EditPlan の形式・判断ロジック・評価データは流用できる
- **解析と書き出しの分離**: 字幕の修正では重い文字起こしをやり直さない

## ディレクトリと担当

| パス | 内容 | 担当エージェント |
|---|---|---|
| `personal-side-projects/video-auto-edit/vae/media.py` | probe・入力検証 | video-engineer |
| `vae/proc.py` | 外部プロセスの実行(タイムアウト・メモリ見張り・stderr 保存) | video-engineer |
| `vae/render.py` | 区間のフレーム化、select 方式の書き出し、検証 | video-engineer |
| `vae/transcribe.py` | faster-whisper の呼び出し(モデルのキャッシュ、差し替え可能) | audio-engineer |
| `vae/vad.py` | Silero VAD | audio-engineer |
| `vae/fillers.py` | 言い淀みの判定 | audio-engineer |
| `vae/audio.py` | 音声のカット、声基準のミックス、計測 | audio-engineer |
| `vae/bgm.py` | BGM の用意(bgm-pipeline を読み取り専用で呼ぶ。使えないときは内蔵の簡易生成) | audio-engineer |
| `vae/subtitles.py` | 字幕の分割・改行・時刻・ASS | subtitle-engineer |
| `vae/plan.py` | EditPlan の作成・保存・読み込み | architect |
| `vae/pipeline.py` | 解析 → 計画 → 書き出しの流れ、進捗、作業フォルダの後始末 | architect |
| `vae/jobs.py` | ジョブの保存・状態・期限切れの削除 | ui-engineer |
| `vae/plans.py` | 料金プラン(無料30秒)と重複検出 | ui-engineer |
| `vae/web/` | ローカル Web UI と API | ui-engineer |
| `vae/cli.py` | コマンドライン(run / verify / web) | release-manager |
| `tests/` | pytest | 各担当 + qa-engineer |
| `tools/` | 実動画の評価・ベンチマーク・UI 操作テスト | qa-engineer / performance-reviewer |

## 技術選定(すべて無料・ローカル)

| 用途 | 採用 | 理由 / 代替 |
|---|---|---|
| 文字起こし | faster-whisper medium(int8、CPU) | 実動画3本で small より誤りが少ない。tiny/small は速度優先の選択肢 |
| 発話検出 | Silero VAD(faster-whisper 同梱) | 背景音があっても動く。音量方式は比較用に残す |
| 改行 | BudouX + 数字・日付の保護範囲 | 文節単位。日本語の改行規則 |
| 書き出し | FFmpeg select 方式 | メモリが動画長に依存しない(5分 1080x1920 で 408MB) |
| BGM | bgm-pipeline の自前生成曲 | 権利問題なし |
| Web | Python 標準ライブラリの HTTP サーバー + 素の HTML/JS | 依存を増やさない。ローカル専用(127.0.0.1) |

## ジョブと作業フォルダ

```
data/jobs/<job_id>/
  input.<ext>        アップロードされた元動画(読み取り専用として扱う)
  job.json           状態(queued / analyzing / rendering / done / error)、進捗、プラン、エラー
  plan.json          EditPlan
  work/              一時ファイル(完了・失敗後に削除)
  output.mp4         書き出し結果
```
- `data/` は `.gitignore` 対象。期限(既定24時間)を過ぎたジョブは削除できる(`vae.jobs.cleanup_expired`)
- ディスク残量が 2GB 未満のときは新しいジョブを受け付けない

## 料金プランの拡張点(課金処理は未実装)

```python
PLANS = {"free": Plan(max_seconds=30, model="medium", max_concurrent=1), ...}
```
- 無料枠の悪用防止(設計): 入力動画の内容ハッシュで同一動画の再処理を検出、端末ごとの1日あたりの回数上限、30秒を超える動画の部分処理はしない(先頭30秒だけを無料で処理する案は、有料への誘導として HQ 判断待ち)
- 課金・決済・アカウントは人間の承認が必要(有料サービスの契約に当たる可能性がある)

## 本番化で必要になるもの(未着手・承認待ち)
- ホスティング(サーバー処理)または端末内処理(iOS)。いずれも費用またはアカウントが必要
- 認証・決済
