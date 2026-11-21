---
name: release
description: 動画自動編集AI(VAE)専用。CI・独立レビュー・品質ゲートを確認して PR を統合し、DEV(ローカル起動)で動作を確認する。本番公開は行わない。
---

# release(VAE)

1. マージ条件(release-manager の定義)をすべて確認する: CI 成功(HEAD)、独立レビューで blocker・major なし、品質ゲートの証拠、他プロジェクトの変更なし
2. PR の説明に、変更理由・テスト結果・リスクを書く
3. 条件を満たしたら GitHub MCP でマージする(squash)。満たさなければマージしない
4. DEV: 現時点ではホスティングがないため、`python -m vae.web` をローカルで起動し、`tools/ui_smoke.py` で操作確認する
5. 本番公開・課金・有料サービスは実行しない。必要なら RELEASE_STATUS.md に「人間の承認待ち」と書いて停止する
