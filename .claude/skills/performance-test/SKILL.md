---
name: performance-test
description: 動画自動編集AI(VAE)専用。書き出しのメモリ・処理時間を動画長ごと(30秒・60秒・3分・5分)に計測し、劣化がないかを判定する。
---

# performance-test(VAE)

1. `python tools/bench_render.py <作業フォルダ> --durations 30,60,180,300 --methods select`
2. 判定: 書き出しの FFmpeg 最大メモリが全長で 1GB 未満、フレームの欠落・重複0、同期ずれ ≤ 1フレーム
3. 1本の処理全体: `python -m vae.cli run` の結果 JSON の `timings_sec` と `peak_memory_mb`
4. 結果を QUALITY_GATES.md と PROJECT_STATE.md に記録する。ディスク残量も記録する
