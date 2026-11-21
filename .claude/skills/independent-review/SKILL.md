---
name: independent-review
description: 動画自動編集AI(VAE)専用。実装者とは別のコンテキスト(vae-independent-reviewer)で差分をレビューさせ、結果を記録する。VAE の重要な変更をマージする前に必ず使う。
---

# independent-review(VAE)

1. レビュー対象を決める: `git diff <base>...HEAD -- personal-side-projects/video-auto-edit .github/workflows/video-auto-edit-ci.yml`
2. Agent ツールでレビュー担当を起動する。`subagent_type` に `vae-independent-reviewer` が使えない環境では `general-purpose` を使い、プロンプトの先頭に `.claude/agents/independent-reviewer.md` の内容を含める
3. プロンプトには、差分の範囲、受け入れ条件、実行済みテストの結果だけを渡す(実装者の意図の説明は最小限にし、先入観を与えない)
4. 結果を docs/autonomous-hq/AGENT_LOG.md に記録する(指摘・重大度・対応)
5. blocker・major がある場合はマージしない。担当に差し戻し、修正後に同じ手順で再レビューする
