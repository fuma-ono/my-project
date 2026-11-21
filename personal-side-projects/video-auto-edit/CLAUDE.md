# 動画自動編集AI(VAE)— 製品ディレクトリ

この製品は、2026-08-20 のオーナー決定により「会社の事業ではなく個人の副業トラック」として扱う。会社(AI Company OS)の経営報告には含めない。

## 最初に読むもの
1. `docs/autonomous-hq/HANDOVER.md`(次に行う作業)
2. `docs/autonomous-hq/PRODUCT_REQUIREMENTS.md`(受け入れ条件 AC)
3. `docs/autonomous-hq/ARCHITECTURE.md`(構成・担当ファイル)

## 開発コマンド
```bash
make setup        # .venv を作り依存を入れる(無料・ローカル)。既存の検証環境 /tmp/vedit-poc/.venv でも可
make test         # 速いテスト(偽の文字起こし・合成動画)。コミット前フックでも自動実行
make test-all     # 実モデル(Whisper)を使う統合テストを含む
make web          # ローカル Web UI(127.0.0.1:8765)
python -m vae run 入力.mp4 -o 出力.mp4     # CLI
python tools/run_eval.py <動画フォルダ> <出力フォルダ>   # 実動画の評価
python tools/bench_render.py <作業フォルダ> --durations 30,60,180,300 --methods select
```

## 守ること
- エンジンは「解析 → EditPlan → 書き出し」。UI・CLI は EditPlan を通して使う
- FFmpeg は `vae.proc.run` 経由(タイムアウト・メモリ上限・後始末)
- 元動画は読むだけ。一時ファイルはジョブの作業フォルダに置き、終わったら消す
- `data/` と動画・音声ファイルはコミットしない
- 聴感は自動判定しない(「未確認」と書く)
