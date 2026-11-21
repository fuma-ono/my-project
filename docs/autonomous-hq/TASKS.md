# TASKS

## 完了
| ID | タスク | 担当 | 証拠 |
|---|---|---|---|
| T-01 | 現状調査(PROJECT_BASELINE) | HQ | docs/autonomous-hq/PROJECT_BASELINE.md |
| T-02 | HQ 基盤(CLAUDE.md・agents 10・skills 7・rules 5・hooks・状態ファイル) | HQ | フックの単体テスト 14/14 |
| T-03 | 製品パッケージ `vae`(media / proc / render / audio / transcribe / vad / fillers / subtitles / bgm / pipeline / jobs / plans / cli) | HQ(video / audio / subtitle の役割を兼務) | pytest 63 passed + slow 1 passed |
| T-04 | ローカル Web UI と API | ui-engineer(サブエージェント) | test_web 8 passed、ui_smoke PASS(HQ が再実行) |
| T-05 | UI 担当の指摘への対応(端末ごとの重複判定、起動時の復旧、begin_render) | HQ | tests/test_jobs.py 3件追加 |
| T-06 | 実動画3本の評価(製品エンジン、medium + VAD) | qa(HQ が実行) | QUALITY_GATES.md |
| T-07 | CI(パス限定) | release-manager の役割(HQ) | .github/workflows/video-auto-edit-ci.yml。run 44861310147 成功 |
| T-10 | 長尺の合成素材で全体の時間・メモリを計測(3分・5分) | HQ(performance の役割) | QUALITY_GATES の長尺の行 |

## 進行中
| ID | タスク | 担当 | 完了条件 |
|---|---|---|---|
| T-08 | 独立レビュー(製品パッケージ・HQ 基盤の差分) | independent-reviewer | blocker・major が0件、または修正済み |
| T-09 | CI の初回実行と修正 | release-manager | 現在の HEAD で CI 成功 |

## 未着手(優先順)
| ID | タスク | 担当 | 完了条件 |
|---|---|---|---|
| T-14 | 音声処理を区間ごとに分けてメモリを一定にする(長尺対応) | audio-engineer | 1時間相当の合成素材で Python のメモリが 1GB 未満 |
| T-15 | 音声処理の高速化(ラウドネス計測の回数を減らす、BGM の事前生成) | performance-reviewer | 5分で音声処理 60秒未満 |
| T-11 | 文字起こしの誤りへの対策(初期プロンプトによる語の登録を UI から指定) | audio-engineer | 実動画で誤り箇所が減ることを確認 |
| T-12 | PR #6 の統合(マージ条件を満たしたら) | release-manager | CI 成功 + 独立レビュー合格 + 品質ゲート |
| T-13 | オーナーの試聴結果の反映(BGM の大きさ等の既定値) | HQ | オーナーの評価シート |
