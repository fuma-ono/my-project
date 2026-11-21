---
name: project-audit
description: 動画自動編集AI(VAE)専用。Git・CI・コード・過去の報告を照合して現状を把握し、docs/autonomous-hq/PROJECT_BASELINE.md と PROJECT_STATE.md を更新する。VAE の作業を始めるとき、または状態が古いときに使う。
---

# project-audit(VAE)

1. `git status -sb`、`git log --oneline -5`、`git fetch origin main` 後の `git log origin/main -3` を記録する。
   **`git fetch origin`(全ブランチ)は使わない**。2026-11-21 に全ブランチの fetch が中断し、`.git` に約25GB の一時ファイルが残ってディスクが一杯になった。必要なブランチだけを fetch し、`timeout 120` を付ける
2. 開いている VAE の PR(`claude/video-autoedit-*`)と CI の結果を GitHub MCP で確認する
3. `personal-side-projects/video-auto-edit/` で `pytest -m "not slow" -q` を実行し、件数と結果を記録する
4. ディスク残量(`df -h /`)、Whisper モデルの有無(`~/.cache/huggingface/hub`)を確認する
5. 過去の報告(docs/projects/video-auto-edit/)と現在のコードが矛盾する場合は、コードを正とし差分を PROJECT_BASELINE に書く
6. PROJECT_STATE.md の「最終確認日時」「HEAD」「テスト結果」を更新する
