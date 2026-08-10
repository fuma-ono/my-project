# 経営ダッシュボード

最新版(常にこのURLを更新して再公開する): https://claude.ai/code/artifact/63b530f4-9d42-411d-aa8a-d013d4283c32

アカウント作成の手順書(オーナー向け): https://claude.ai/code/artifact/94fb9449-78d7-409e-a9cc-588a66198bf4

会社サイト(3事業をまとめた対外向けページ、`docs/site/`): https://claude.ai/code/artifact/3ace0d1f-bbd2-4522-bb2e-b9b0b834d5b4

週次活動報告(スライド、`docs/reports/`): オーナーへSendUserFileで毎週送付。生成スクリプトは`docs/reports/weekly/`にコミットするが、`.pptx`本体はgitignore対象

第4事業「モヤスカ」(`moyasuka/`): LINEドラマ×AI音声合成のYouTube Shortsチャンネル。新チャンネル開設済み([@moyasuka](https://youtube.com/channel/UCrbgwaQhPlDOcQGfUF29VFQ)、2026-08-06)、名称・概要欄・バナーが用意した内容と一致していることをAPIで確認済み。Shorts中心・完全日本語・毎日20:00 JST固定投稿の方針決定済み(`docs/projects/moyasuka/posting-policy.md`)。2026-08-09、iPad Shortcuts自動化(方式A')の実機動作確認が完了し、初めての実音声入り動画(台本01)が完成・オーナーへ送付済み。台本02・03のナレーション収録が進行中。進捗は`docs/projects/moyasuka/team.md`

3事業(BGM動画/アプリ/note記事)+新規1事業(モヤスカ)の体制図・パイプライン進捗・オーナーへの依頼事項・経営ログをまとめたもの。定例レビュー(週次)のたびに内容を更新して同じURLに再公開する。

## 更新方法

1. `docs/dashboard/template.html` を編集する(フォントはプレースホルダー `__FONTNAME__` のまま)
2. `python3 docs/dashboard/build.py` で `docs/dashboard/dashboard.html`(フォント埋め込み済み)を生成する
3. Artifactツールで `docs/dashboard/dashboard.html` を上記URL宛に再公開する

最終更新: 2026-08-09
