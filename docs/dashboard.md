# 経営ダッシュボード

最新版(常にこのURLを更新して再公開する): https://claude.ai/code/artifact/63b530f4-9d42-411d-aa8a-d013d4283c32

3事業(BGM動画/アプリ/note記事)の体制図・パイプライン進捗・オーナーへの依頼事項・経営ログをまとめたもの。定例レビュー(週次)のたびに内容を更新して同じURLに再公開する。

## 更新方法

1. `docs/dashboard/template.html` を編集する(フォントはプレースホルダー `__FONTNAME__` のまま)
2. `python3 docs/dashboard/build.py` で `docs/dashboard/dashboard.html`(フォント埋め込み済み)を生成する
3. Artifactツールで `docs/dashboard/dashboard.html` を上記URL宛に再公開する

最終更新: 2026-08-01
