---
name: feature-development
description: 動画自動編集AI(VAE)専用の開発手順。TASKS.md のタスクを受け入れ条件付きで実装し、テスト・独立レビュー・回帰テストまで進める。VAE の機能追加・修正のときに使う。
---

# feature-development(VAE)

1. TASKS.md でタスクを「進行中」にし、担当エージェントと受け入れ条件(AC 番号)を書く
2. 受け入れ条件を満たすテストを先に書く(`tests/`。速いテストは合成素材と偽の文字起こしで)
3. 実装する。担当ファイル以外は変更しない。FFmpeg は `vae.proc.run` 経由
4. `pytest -m "not slow" -q` を実行。失敗したら原因を直す(同じ原因は最大3回。だめなら HQ に戻す)
5. independent-review スキルで、別コンテキストのレビューを受ける。blocker・major は修正して再レビュー
6. 必要に応じて video-quality-check / performance-test
7. AGENT_LOG.md に実行記録、TASKS.md を更新し、コミットする(フックがテストと秘密情報を確認する)
