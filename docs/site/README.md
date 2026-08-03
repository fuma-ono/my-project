# 会社サイト(Quiet Hours)

3事業(BGM動画/アプリ/note記事)を1つのブランドとしてまとめた対外向けサイト。TikTokビジネス認証の「企業のWebサイト」欄などで使う、外部向けURLが必要になったのがきっかけで作成。

**公開URL**: https://claude.ai/code/artifact/3ace0d1f-bbd2-4522-bb2e-b9b0b834d5b4

ブランド名は「Quiet Hours」。既存のBGM/アプリのビジュアル(`bgm_pipeline/branding.py` の配色・三日月モチーフ、Gloock+Work Sansの組み合わせ)をそのまま踏襲している。

## 更新方法

`docs/site/company.html` は単一ファイル(テンプレート分離なし、フォントはbase64で埋め込み済み)。編集後はArtifactツールで同じファイルパスを再公開すればURLは変わらない。フォントを差し替える場合のみ、`/mnt/skills/examples/canvas-design/canvas-fonts/` から再エンコードする。

最終更新: 2026-08-03
