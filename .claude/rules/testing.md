---
paths:
  - "personal-side-projects/video-auto-edit/**"
  - "docs/autonomous-hq/**"
  - "docs/projects/video-auto-edit/**"
  - ".github/workflows/video-auto-edit-ci.yml"
---

# テスト規則(VAE)

1. テストは `personal-side-projects/video-auto-edit/` で `pytest` を実行する
   - `pytest -m "not slow"`: 速いテスト(合成素材・偽の文字起こし)。コミット前フックで自動実行
   - `pytest -m slow`: 実モデル(Whisper)を使う統合テスト
2. 新しい機能には、受け入れ条件(PRODUCT_REQUIREMENTS の AC 番号)に対応するテストを付け、テスト名かコメントに AC 番号を書く
3. 実動画の評価は `tools/run_eval.py`、書き出し方式の比較は `tools/bench_render.py`
4. 実行していないテストを成功と書かない。失敗・スキップは件数と理由を書く
5. テスト用の動画・音声はテストの中で生成する(FFmpeg の lavfi、pyopenjtalk)。リポジトリに動画を入れない
