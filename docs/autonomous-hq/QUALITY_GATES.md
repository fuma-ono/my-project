# QUALITY_GATES — 証拠の記録

判定: ✅ 証拠あり(合格) / ⚠️ 一部のみ / ❌ 不合格 / ⏳ 未実施 / 👂 人間の確認が必要(自動判定しない)
最終更新: 2026-11-21(UTC)

| 項目 | 判定 | 証拠 |
|---|---|---|
| 動画処理(実動画) | ✅ | `tools/run_eval.py`(medium + VAD、製品エンジン)で実動画3本すべて検証合格。31.9→25.7秒 / 39.4→22.5秒 / 31.1→26.7秒。出力: `video-eval-output/hq_2026-11-21/`(git 対象外) |
| 対応形式(AC-V1) | ✅ | `tests/test_media.py` で MP4(H.264/AAC)・MOV・M4V・MKV(HEVC/Opus)・WEBM(VP9/Opus)を処理 |
| 解像度・fps・回転(AC-V2) | ✅ | `tests/test_render.py`、`tests/test_media.py::test_ac_v2_rotation...`、実動画3本(720x1280 / 1080x1920 / 1280x720、30fps)で一致 |
| フレームの欠落・重複(AC-V3) | ✅ | `tests/test_render.py`(select / legacy / segments すべて番号一致)、`tools/bench_render.py`(30秒 1080x1920: 欠落0・重複0) |
| メモリ(AC-V4) | ✅ | 書き出しの FFmpeg: 実動画 236〜421MB。合成 1080x1920 で 30秒〜5分 約405〜408MB(第2フェーズ)、製品版で 30秒 405MB を再確認 |
| 元動画の保護(AC-V5) | ✅ | `tests/test_pipeline.py::test_ac_v5_source_unchanged`(SHA-256 一致)、`tests/test_render.py::test_ac_v5_failed_render_keeps_existing_output` |
| 異常入力(AC-V6) | ✅ | `tests/test_media.py`(未対応形式・壊れたファイル・空・音声なし・短すぎ)、`tests/test_jobs.py`(声なし → no_speech)、`tests/test_web.py`、UI のエラー画面 |
| 音声認識(AC-A1) | ⚠️ | 実モデル統合テスト(`tests/test_integration_whisper.py`、small、合成音声)合格。実動画の誤認識(年号など)は第2フェーズの記録のとおり残る。台本との文字誤り率は未計測 |
| VAD のカット(AC-A2) | ✅ | 背景音のある実動画3で 31.1→26.7秒(音量方式ではカット0だった) |
| 言い淀み(AC-A3, A4) | ✅ | `tests/test_fillers.py`(表記ゆれ「まぁ」、指示語「あの動画」を残す、確信度、削除範囲の切り詰め、「うまく」を残す)。実動画2: 候補6件中6件削除、動画1・3: 削除0(誤削除なし) |
| カット境界(AC-A5) | ✅ | `tests/test_audio.py::test_ac_a5...`(境界の段差 < 0.01)、実動画の `boundary_step_max` |
| 声の音量・ピーク(AC-A6) | ✅ | 実動画3本とも -16.0 LUFS、True Peak -1.4〜-1.5 dBTP |
| BGM(AC-A7) | ✅ | 実動画の「声−BGM」発話中: 中央値 19.5 / 18.5 / 18.8 LU、下位5% 12.9 / 10.4 / 14.0 LU、BGM が声を上回る窓 0、揺れ 0.24 / 0.25 / 0.01 dB |
| 字幕(AC-S1〜S5) | ✅ | `tests/test_subtitles.py`。実動画3本で自動チェックの要確認0件(数字の途中の改行・短い表示・はみ出し・区切り漏れ) |
| 字幕の修正(AC-S6) | ✅ | `tests/test_pipeline.py::test_ac_s6...`、`tests/test_web.py`、UI 操作テスト(修正が書き出しに反映) |
| 書き出しの検証(AC-E1, E2) | ✅ | `vae.render.verify`: 実動画3本でフレーム数と音声長の一致・解像度・fps・True Peak すべて合格 |
| 一時ファイル(AC-E3) | ✅ | `tests/test_pipeline.py::test_ac_e3...`、`tests/test_jobs.py::test_ac_e3...`(期限切れの削除) |
| 安全フック | ✅ | `.claude/hooks/test_vae_hooks.py` 80/80(HOME=/root と /home/runner、PR #16)。find の削除は、-o で分けた削除の枝ごとに「否定されていない、すべてに一致しない名前の条件」があるかを見る。**限界**: 変数に入れたパス、`$(...)`、ヒアドキュメント、find の -regex 以外の複雑な式(例: -newer だけで絞った削除を名前なしとして止める側の誤り)。CLAUDE.md の「限界」と同じ扱い |
| UI(AC-U1〜U5) | ✅ | `tests/test_web.py` 8件、`tools/ui_smoke.mjs`(実ブラウザ、HQ が再実行して PASS、スクリーンショット12枚(書き出し失敗の表示を含む、PR #16)。10枚版: `video-eval-output/hq_2026-11-21/ui_screenshots/`) |
| 無料枠・プラン(AC-B1〜B4) | ✅ | `tests/test_jobs.py`(30秒超は受付前に拒否、プラン設定、端末ごとの重複検出、1日の回数上限)、UI でも 31秒は over_plan_limit |
| コスト(AC-B3) | ✅ | 外部 API 0円(ジョブ結果に `external_cost_jpy: 0`)。処理時間: 実動画で 35〜71秒(medium、4 vCPU) |
| 回帰 | ✅ | `pytest -m "not slow"`: 82 passed(main f497d68、2026-11-21)。`pytest -m slow`: 1 passed(dcdbc17 時点)。実動画3本の再評価(3f3459b)で指標は前回と同一 |
| CI | ✅ | f50bb54(マージ直前の HEAD)で push・pull_request の2 runs 成功(run 44884775216 / 44884779383)。3f3459b で HOME の違いによる失敗 → 5ef88ba で修正 |
| 独立レビュー | ✅ | vae-independent-reviewer で4回 + 追加確認。最終: マージ可(blocker 0 / major 0)。残りの minor は T-16・T-17 |
| 聴感(カットの自然さ・BGM の好み・字幕と声のタイミング) | 👂 | 自動判定しない。オーナーの試聴が必要(BLOCKERS B-1) |
| 長尺(合成素材、解析→書き出しの全体) | ✅ | 1080x1920 の合成素材(文字起こしは偽物で差し替え): 3分 → 全体106.5秒(音声64.6・書き出し39.2)、書き出し412MB、Python 398MB。5分 → 全体160.1秒(音声96.3・書き出し59.6)、書き出し414MB、Python 715MB。検証は両方合格 |
| 長尺(実動画、3分以上) | ⏳ | 未実施(BLOCKERS B-6)。Whisper medium の時間は実動画で約0.5〜0.65倍速(30秒前後の動画の実測から推定。長尺は未計測) |
| 音声処理のメモリ | ⚠️ | 長さに比例(5分で 715MB)。1時間で約8.6GB の見込み(推定)。10分までのプランなら範囲内。長尺対応には分割処理が必要(TASKS T-14) |
