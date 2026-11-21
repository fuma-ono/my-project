# HANDOVER — 次のセッションはここから

最終更新: 2026-11-21(UTC)

## 1. 最初にやること
1. このファイルと `PROJECT_STATE.md`、`TASKS.md` を読む
2. `git status -sb` / `git log --oneline -5`(作業ブランチ `claude/video-autoedit-tech-verification`)。**`git fetch origin`(全ブランチ)は使わない**
3. Python 環境: `/tmp/vedit-poc/.venv/bin/python` が無ければ `cd personal-side-projects/video-auto-edit && make setup`
4. `make test` で速いテストが通ることを確認する
5. 新しいセッションでは、エージェントを名前で呼べるか試す(例: `subagent_type: vae-independent-reviewer`)。呼べなければ general-purpose に役割ファイルを読ませる

## 2. 次に行う作業(TASKS.md の進行中・未着手)
1. T-08 独立レビューの指摘への対応(AGENT_LOG を確認)
2. T-09 CI の結果を確認し、失敗していれば直す
3. T-12 マージ条件(CI 成功・独立レビュー合格・品質ゲート)を満たしたら PR #6 を統合する
4. T-10 長尺の合成素材で全体の計測
5. T-11 文字起こしの誤り対策

## 3. 人間の判断が必要なこと(これ以外は HQ が進める)
- 本番公開・ホスティング先(BLOCKERS B-2)
- 課金・決済サービス(B-3)
- オーナーの試聴(B-1): `video-eval-output/hq_2026-11-21/` の出力動画と評価シート

## 4. 重要な場所
- 製品: `personal-side-projects/video-auto-edit/`(CLAUDE.md・Makefile)
- 確認用の出力(git 対象外): `video-eval-output/`
- ユーザーの動画素材: `/root/.claude/uploads/27fb4a42-.../`(削除禁止。フックで保護)
