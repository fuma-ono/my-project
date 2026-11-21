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
| T-08 | 独立レビュー(4回 + 追加確認。1〜3回目はマージ不可 → 全対応、4回目・追加確認でマージ可、blocker・major 0) | vae-independent-reviewer | AGENT_LOG |
| T-09 | CI の失敗(HOME の違い)を修正し、HEAD で成功 | HQ(release の役割) | f50bb54 で 2 runs 成功 |
| T-12 | PR #6 を main に squash マージ(f497d68)、main で DEV 確認 | HQ(release の役割) | main で速いテスト 82 passed・フック 66/66・ui_smoke PASS・CLI で実動画1本の検証合格 |
| T-16 | UI の書き出し失敗表示の自動テスト(ui_smoke: 状態の応答を書き換えて #render-fail-5・#render-fail-3 の表示と文言、失敗なしで消えることを確認)と N3 の回帰テスト | HQ(qa の役割) | **完了条件を変更**: 元は「両テストが CI で成功」。ui_smoke は CI に入れていない(Node と実ブラウザが必要で重いため)ので、「ui_smoke はローカルで PASS(12枚)、test_t16_n3 は CI で成功」に変えた。N3 は修正前の server.py で失敗を確認 |
| T-17 | フックの見逃し r5-1(-not・!・-o・-name '*' の find 削除)と、PR #16 の独立レビューの m1(ルートでの名前で絞った -o・! の後片付けを止める誤検知)・m2(**・?*・[!.]*・./*・-execdir の見逃し) | HQ(qa の役割) | フックのテスト 85/85。修正前のフックで新しいケースが失敗することを確認。再確認の r6-1(括弧の中の -o・括弧ごとの否定)と -exec /bin/rm も対応 |

## 進行中
| ID | タスク | 担当 | 完了条件 |
|---|---|---|---|
| — | (なし。未着手の上から順に進める) | | |

## 未着手(優先順)
| ID | タスク | 担当 | 完了条件 |
|---|---|---|---|
| T-14 | 音声処理を区間ごとに分けてメモリを一定にする(長尺対応) | audio-engineer | 1時間相当の合成素材で Python のメモリが 1GB 未満 |
| T-15 | 音声処理の高速化(ラウドネス計測の回数を減らす、BGM の事前生成) | performance-reviewer | 5分で音声処理 60秒未満 |
| T-11 | 文字起こしの誤りへの対策(初期プロンプトによる語の登録を UI から指定) | audio-engineer | 実動画で誤り箇所が減ることを確認 |
| T-13 | オーナーの試聴結果の反映(BGM の大きさ等の既定値) | HQ | オーナーの評価シート |
