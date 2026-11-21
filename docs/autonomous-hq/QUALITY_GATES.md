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
| UI(AC-U1〜U5) | ✅ | `tests/test_web.py` 8件、`tools/ui_smoke.mjs`(実ブラウザ、HQ が再実行して PASS、スクリーンショット10枚: `video-eval-output/hq_2026-11-21/ui_screenshots/`) |
| 無料枠・プラン(AC-B1〜B4) | ✅ | `tests/test_jobs.py`(30秒超は受付前に拒否、プラン設定、端末ごとの重複検出、1日の回数上限)、UI でも 31秒は over_plan_limit |
| コスト(AC-B3) | ✅ | 外部 API 0円(ジョブ結果に `external_cost_jpy: 0`)。処理時間: 実動画で 35〜71秒(medium、4 vCPU) |
| 回帰 | ✅ | `pytest -m "not slow"`: 63 passed(2026-11-21)。`pytest -m slow`: 1 passed |
| CI | ⏳ | `video-auto-edit-ci` を追加。初回の実行結果は PROJECT_STATE に記録する |
| 独立レビュー | ⏳ | Phase 3 で実施(AGENT_LOG に記録) |
| 聴感(カットの自然さ・BGM の好み・字幕と声のタイミング) | 👂 | 自動判定しない。オーナーの試聴が必要(BLOCKERS B-1) |
| 実動画の長尺(3分以上) | ⏳ | 未実施(BLOCKERS B-6)。書き出しは合成素材で5分まで確認済み |
