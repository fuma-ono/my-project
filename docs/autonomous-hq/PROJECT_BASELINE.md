# PROJECT_BASELINE — 動画自動編集AI(2026-11-21 時点の実測)

この文書は、記憶ではなく、現在のリポジトリと実行環境を確認した結果である。確認した日時: 2026-11-21(UTC)。

## A. Git・開発環境

| 項目 | 確認結果 |
|---|---|
| リポジトリ | `fuma-ono/my-project`(複数事業が同居するモノレポ) |
| 作業ブランチ | `claude/video-autoedit-tech-verification`(リモートと一致、未コミットなし) |
| HEAD | `eaa96bf`(第2フェーズの改善と前後比較) |
| main | `1947cea`(本ブランチの分岐元 `a13e3a4` より先。差分は FX 関連のワークフロー3ファイルのみで、動画編集とは衝突しない) |
| 動画編集の PR | #6(下書き・未マージ・CI なし・レビューコメントなし) |
| 他プロジェクトの PR | #1, #2, #3, #4, #5, #11, #14(FX・kashikari・threads など)。**対象外。変更しない** |
| CI | `.github/workflows/` に動画編集用のワークフローは**存在しない**(FX・threads・note・kashikari 用のみ) |
| テスト | 動画編集のテストコードは**存在しない**(PoC の評価スクリプトと合成ベンチマークのみ) |
| デプロイ構成 | **存在しない**。DEV 環境・ホスティングとも未作成 |
| `.claude/`・`CLAUDE.md` | リポジトリ(作業ブランチ・main とも)に**存在しない** |
| 実行環境 | クラウドの一時コンテナ。Ubuntu 24.04、4 vCPU、メモリ15GB、**GPU なし**、ディスク空き約5.5GB(使用率86%) |
| ツール | Python 3.13.18、FFmpeg 6.1.1(libass・x264 あり、GPL ビルド)、Node 22、Claude Code 2.1.330 |
| Python 依存(検証用 venv `/tmp/vedit-poc/.venv`、リポジトリ外) | faster-whisper 1.2.1、ctranslate2、budoux、soundfile、scipy、numpy、Pillow、pyopenjtalk-plus(テスト音声用) |
| Whisper モデル | `~/.cache/huggingface` に base / small / medium / large-v3-turbo(計3.6GB) |
| Agent Teams | 有効化の設定(環境変数)なし → **利用不可として扱う**。Subagents(Agent ツール)は利用可 |
| GitHub 操作 | GitHub MCP(PR 作成・マージ・Actions 参照)が利用可。`gh` CLI は使用しない方針 |

## B. 製品機能(現在のコード `docs/projects/video-auto-edit/poc/`)

| 機能 | 状態 | 根拠 |
|---|---|---|
| 動画アップロード | **未実装**(CLI にファイルパスを渡すだけ) | UI なし |
| 動画解析(解像度・回転・fps) | 実装済み(検証用) | `render.probe`、`poc_pipeline.display_size` |
| 文字起こし | 実装済み(faster-whisper、CPU、int8) | `poc_pipeline.py` |
| 無音区間検出 | 実装済み(音量方式 / Silero VAD 方式) | 同上 |
| フィラー検出 | 実装済み v2(表記ゆれ正規化・文脈判定) | `fillers.py` |
| 不要部分のカット | 実装済み(フレーム境界にそろえたカット) | `render.py` |
| 字幕生成・同期 | 実装済み v2(保護範囲・実寸のはみ出し判定・短表示の統合) | `subtitles.py` |
| BGM 選択 | 固定(既存 `bgm-pipeline` の `study_lofi_chill` を自前生成) | 選択 UI なし |
| BGM 音量・ミキシング | 実装済み(duck_vad / duck_sc / legacy) | `render.mix_audio` |
| 動画書き出し | 実装済み(select / segments / legacy) | `render.render_video` |
| エラー処理 | **最小限**(例外で停止。元動画は読むだけで変更しない) | — |
| UI・操作性 | **未実装** | — |
| 字幕の手動修正 | **未実装** | — |
| 進捗表示 | **未実装** | — |

## C. 品質・性能(過去の実測。詳細は docs/projects/video-auto-edit/ の各レポート)

| 項目 | 実測値 |
|---|---|
| 書き出しメモリ(P12) | 修正前: 1080x1920・16区間で 7,231MB → select 方式で 421MB。合成素材 30秒〜5分で約400MB一定、フレームの欠落・重複0、映像と音声のずれ0.2ms |
| BGM と声(P11) | 発話中の「声−BGM」: 修正前 -10.3 / -7.9 / +6.2 LU → duck_vad で +19.5 / +18.5 / +18.8 LU |
| 字幕(P8〜P10) | 自動チェックの要確認 4/2/1 → 0/0/1 |
| フィラー(P13) | 動画2で6件中6件削除、動画1・3で誤削除0(「うまく」の誤検出は防止済み) |
| 処理時間 | 30秒前後の動画1本で約37〜43秒(medium、4 vCPU)。うち文字起こし約15〜18秒 |
| 最大メモリ | Whisper medium 本体の約2.1〜2.2GB が支配的 |
| GPU | 利用なし |
| 長尺 | 書き出しは合成素材で5分まで確認。**実動画の長尺は未検証** |
| 一時ファイル | 作業フォルダに残る(自動削除なし) |
| 並列処理 | なし(1本ずつ) |
| 失敗時の復旧 | なし |
| 聴感・自然さ | **未評価**(開発者は音声を聞けない。オーナーの試聴待ち) |

## D. ビジネス・コスト

| 項目 | 状態 |
|---|---|
| 事業上の位置づけ | 2026-08-20 オーナー決定(PR #1 内の `docs/company-os/decisions/2026-08-20-style-video-editor-app.json`、**未マージ**): 会社の事業としては進めず、**個人の副業として別トラック**で進める。会社の経営報告には含めない |
| 無料プラン・30秒無料枠 | **未実装**。過去の提案では「無料3分 / 課金10分 / プロ1時間」の案があった。今回の指示は「30秒まで無料」 |
| 有料プラン | **未設計** |
| 処理コスト | ローカル CPU 処理のみ。外部 API 費用0円 |
| ストレージコスト | ローカルのみ。ホスティングなし |
| API 利用コスト | 0円(有料 API なし) |
| 法務 | 学習データを使わない方式(ルールと公開の無料モデルのみ)。提案書が指摘した「実在クリエイター動画の学習」リスクは本方式では発生しない。Whisper(MIT)、BudouX(Apache-2.0)、Silero VAD(MIT)、FFmpeg(GPL ビルド: 配布形態に注意) |

## 過去の報告と現在のコードの照合

| 報告の記述 | 現在のコード | 判定 |
|---|---|---|
| `poc/poc_pipeline.py` | `docs/projects/video-auto-edit/poc/poc_pipeline.py` に存在 | 一致(パスは docs 配下) |
| P12 select 方式 | `render.render_video(method="select")` が既定 | 一致 |
| P11 duck_vad | `VEDIT_MIX` の既定が duck_vad | 一致 |
| カット方式の既定 | `VEDIT_CUT_MODE` の既定は **volume** のまま(HQ 判断待ちだった) | 一致。製品化で vad を既定にする(DECISIONS 参照) |
| bgm-pipeline | 変更なし。`core.widen` の長さ不具合は30秒単位の切り上げで回避中 | 一致 |

## 製品化に向けた主な不足(→ TASKS.md)

1. 製品パッケージ(検証スクリプトではなく、再利用できるエンジン・CLI・ジョブ管理)
2. 自動テストと CI
3. UI(アップロード・設定・進捗・プレビュー・字幕修正・書き出し)
4. 30秒無料枠と将来の有料プランの拡張点、悪用防止
5. 一時ファイル管理・エラー処理・入力検証(壊れた動画、音声なし、極端に短い/長い)
6. 長尺の実動画での検証
7. DEV 環境(現在なし)
