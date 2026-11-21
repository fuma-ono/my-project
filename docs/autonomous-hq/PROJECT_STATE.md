# PROJECT_STATE

最終確認: 2026-11-21(UTC)

## 現在の状態
- **製品**: `personal-side-projects/video-auto-edit/` に、エンジン・CLI・ローカル Web UI・テスト・評価ツールがそろった(v0.1.0)
- **品質**: 自動で判定できる品質ゲートは、実動画3本・合成素材・テストで合格(QUALITY_GATES.md)。**聴感はオーナーの試聴待ち**
- **HQ 基盤**: CLAUDE.md、agents 10、skills 7、rules 5、hooks(実際に発動することを確認)、状態ファイル
- **統合**: PR #6 を main に squash マージ済み(f497d68、2026-11-21)。CI 成功、独立レビュー合格(blocker・major 0)、main で DEV 確認済み。**本番は未公開**

## テスト
| 種類 | 結果 | 日時 |
|---|---|---|
| `pytest -m "not slow"` | 82 passed(main) | 2026-11-21 |
| `pytest -m slow`(Whisper small + Silero VAD、合成音声) | 1 passed(53秒) | 2026-11-21 |
| フックの単体テスト | 66/66(HOME 2通り) | 2026-11-21 |
| UI 操作テスト(ui_smoke.mjs、実ブラウザ) | PASS(スクリーンショット10枚) | 2026-11-21 |
| CI | 成功(f50bb54、2 runs) | 2026-11-21 |
| 実動画3本の再評価 | 3本とも検証合格、指標は前回と同一(3f3459b) | 2026-11-21 |
| main での CLI 実行(IMG_4217) | 検証合格(True Peak -1.4、映像と音声の長さ一致) | 2026-11-21 |

## 実行環境の注意
- ディスクはセッションごとの割り当て。2026-11-21 に中断した `git fetch` の一時ファイルで満杯になった(BLOCKERS B-5)
- 検証用の Python 環境は `/tmp/vedit-poc/.venv`(コンテナが変わると消える。`make setup` で作り直す)
