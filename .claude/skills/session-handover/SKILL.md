---
name: session-handover
description: 動画自動編集AI(VAE)専用。セッションの開始時に docs/autonomous-hq/HANDOVER.md を読んで再開し、終了時に PROJECT_STATE / TASKS / HANDOVER / AGENT_LOG を更新する。
---

# session-handover(VAE)

## 開始時
1. `docs/autonomous-hq/HANDOVER.md` を読み、「次に行う作業」から再開する
2. `project-audit` で HEAD・テスト結果が HANDOVER の記載と一致するか確認する

## 終了時
1. PROJECT_STATE.md: 現在の状態、HEAD、テスト・CI の結果、品質ゲートの状況
2. TASKS.md: 完了・進行中・未着手
3. DECISIONS.md / BLOCKERS.md: 新しい判断と障害(日時・根拠・影響範囲)
4. HANDOVER.md: 次に行う作業を、次のセッションがこの文書だけで再開できる粒度で書く
5. AGENT_LOG.md: このセッションで動いたエージェントと結果
6. コミットしてプッシュする
