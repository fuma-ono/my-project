# CLAUDE.md(リポジトリ共通)

このリポジトリには複数の事業(FX Event Analyzer、kashikari、threads、note、moyasuka、BGM など)が同居している。
各事業のルールは、それぞれのディレクトリや文書に従うこと。この文書は、動画自動編集AI(VAE)の HQ 基盤を追加したときに作成した。

## 動画自動編集AI(VAE)の作業をするとき

- 製品コード: `personal-side-projects/video-auto-edit/`(詳細はそのディレクトリの CLAUDE.md)
- HQ の状態: `docs/autonomous-hq/`。**作業を始めたら最初に `docs/autonomous-hq/HANDOVER.md` を読む**
- 開発は HQ(`.claude/agents/hq.md`)の進め方に従い、専門エージェント(`.claude/agents/`)とスキル(`.claude/skills/`)を使う
- 規則: `.claude/rules/`(development / testing / security / media-quality / cost-control)

### 自律開発の範囲
調査・設計・実装・テスト・レビュー・CI・PR・安全条件を満たすマージ・DEV(ローカル起動)での確認は、人間に聞かずに進める。
**人間の承認が必要なのは次の3つだけ**。実行の直前に停止し、費用・影響・必要性・無料の代替案を報告する。
1. 本番環境への公開・本番リリース
2. 課金が発生する操作
3. 有料サービスの契約・有料 API の導入

### 重要な禁止事項(VAE)
- VAE 以外の事業のファイルを変更しない(bgm-pipeline は読み取り専用で呼ぶだけ)
- ユーザーの動画素材を削除しない。動画・音声ファイルや秘密情報を Git にコミットしない
- 実行していないテストを成功と報告しない。聴いていない音声を「聴感上問題なし」と報告しない

### 機械的に確認していること(`.claude/hooks/vae_hooks.py`)
VAE に関係する操作のときだけ働く。他事業の操作は止めない(誤検知はフックのテストで確認している)。
- 動画素材・確認用出力の削除や移動(rm / mv / find -delete / rsync --delete / python -c の削除 / `git clean -x`)、
  main・master への強制 push、VAE の本番公開を止める
- VAE のファイルのコミット前に、動画ファイルの混入・秘密情報・構文・速いテストを確認する
- VAE の作業ブランチで、VAE の未コミット変更を残したままの終了を止める

**限界**: これは安全網であり、すべての形を止められるわけではない(例: ヒアドキュメントで渡したスクリプトの中の削除、
変数に入れたパス)。規則(`.claude/rules/`)を守ることが前提。
