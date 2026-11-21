# HANDOVER — 次のセッションはここから

最終更新: 2026-11-21(UTC)

## 1. 最初にやること
1. このファイルと `PROJECT_STATE.md`、`TASKS.md` を読む
2. `git status -sb` / `git log --oneline -5`(作業ブランチは PROJECT_STATE / RELEASE_STATUS を参照)。**`git fetch origin`(全ブランチ)は使わない**
3. Python 環境: `/tmp/vedit-poc/.venv/bin/python` が無ければ `cd personal-side-projects/video-auto-edit && make setup`
4. `make test` で速いテストが通ることを確認する
5. 新しいセッションでは、エージェントを名前で呼べるか試す(例: `subagent_type: vae-independent-reviewer`)。呼べなければ general-purpose に役割ファイルを読ませる

## 2. 次に行う作業(TASKS.md の進行中・未着手)
PR #6 は main に統合済み(f497d68)。作業ブランチは `claude/video-autoedit-followup-1`(main から作成、PR #16)。新しい作業は main から新しいブランチを作り、新しい PR にする。
T-16・T-17 は完了(統合後の2本目の PR)。
1. T-14 音声処理の分割(長尺のメモリ一定化)
2. T-15 音声処理の高速化
3. T-11 文字起こしの誤り対策

## 3. 人間の判断が必要なこと(これ以外は HQ が進める)
- 本番公開・ホスティング先(BLOCKERS B-2)
- 課金・決済サービス(B-3)
- オーナーの試聴(B-1): `video-eval-output/hq_2026-11-21/` の出力動画と評価シート

## 4. 重要な場所
- 製品: `personal-side-projects/video-auto-edit/`(CLAUDE.md・Makefile)
- 確認用の出力(git 対象外): `video-eval-output/`
- ユーザーの動画素材: `/root/.claude/uploads/27fb4a42-.../`(削除禁止。フックで保護)
