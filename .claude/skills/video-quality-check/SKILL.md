---
name: video-quality-check
description: 動画自動編集AI(VAE)専用。出力動画の客観品質(同期・フレーム・解像度・字幕・音量・誤カット候補)を自動で確認し、QUALITY_GATES に証拠を記録する。
---

# video-quality-check(VAE)

1. 実動画: `python tools/run_eval.py <動画フォルダ> <出力フォルダ> medium`(カット方式は既定の vad)
2. 出力ごとに `python -m vae.cli verify <出力.mp4> --plan <plan.json>` で、フレーム数と音声長の一致・解像度・fps・ラウドネス・True Peak を確認
3. 字幕: 評価シートの自動チェック(数字の途中の改行、短い表示、はみ出し、区切り漏れ)が0件か
4. 音量: 発話中の「声−BGM」の下位5% と、BGM が声を上回る窓の割合
5. 結果を QUALITY_GATES.md に書く。聴感は「未確認(オーナー試聴待ち)」と書く
