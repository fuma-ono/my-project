# PROJECT_STATE

最終確認: 2026-11-21(UTC)

## 現在の状態
- **製品**: `personal-side-projects/video-auto-edit/` に、エンジン・CLI・ローカル Web UI・テスト・評価ツールがそろった(v0.1.0)
- **品質**: 自動で判定できる品質ゲートは、実動画3本・合成素材・テストで合格(QUALITY_GATES.md)。**聴感はオーナーの試聴待ち**
- **HQ 基盤**: CLAUDE.md、agents 10、skills 7、rules 5、hooks(実際に発動することを確認)、状態ファイル
- **統合**: PR #6(下書き)に追加する。CI の初回実行と独立レビューはこの後

## テスト
| 種類 | 結果 | 日時 |
|---|---|---|
| `pytest -m "not slow"` | 63 passed | 2026-11-21 |
| `pytest -m slow`(Whisper small + Silero VAD、合成音声) | 1 passed(53秒) | 2026-11-21 |
| フックの単体テスト | 14/14 | 2026-11-21 |
| UI 操作テスト(ui_smoke.mjs、実ブラウザ) | PASS(スクリーンショット10枚) | 2026-11-21 |
| CI | 未実行(このコミットで初回) | — |

## 実行環境の注意
- ディスクはセッションごとの割り当て。2026-11-21 に中断した `git fetch` の一時ファイルで満杯になった(BLOCKERS B-5)
- 検証用の Python 環境は `/tmp/vedit-poc/.venv`(コンテナが変わると消える。`make setup` で作り直す)
