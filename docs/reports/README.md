# 週次活動報告(スライド)

オーナーの依頼(2026-08-04)により、週次経営レビューのタイミングで、経営ダッシュボードとは別に**スライド形式**の活動報告を作成する。

- ダッシュボード(`docs/dashboard.md`)は常に最新状態を反映する「今の状態」の可視化
- こちらは「その週に何をしたか」を区切って報告するアーカイブ。過去分は残し続ける

## 運用方法

1. `docs/reports/weekly/` に `YYYY-MM-DD.js`(その週の月曜等、区切りの日付)という新しいpptxgenjsスクリプトを作る。前週のスクリプトをコピーして中身を差し替えるのが早い
2. 初回のみ依存パッケージを入れる: `cd docs/reports/weekly && npm install`
3. `node YYYY-MM-DD.js` でその場所に `.pptx` を生成(gitignore対象、コミットしない)
4. 生成物をPPTXスキルのvalidate.py・markitdownで検証してからオーナーに送付する
5. アイコン(`docs/reports/weekly/icons/`)は使い回せるので、新しいアイコンが必要な時だけ `make_icons.js` を編集して再生成する

## 既知の制約

このクラウドセッションではLibreOffice(soffice)によるPDF変換が機能しない(このリポジトリのファイルに限らず、どんなファイルを渡しても `source file could not be loaded` で失敗することを確認済み)。そのため**スライドの見た目(テキストのはみ出し・重なり等)を画像で目視確認する工程が実行できていない**。構造検証(`validate.py`)とテキスト抽出(`markitdown`)は毎回通しているが、レイアウト崩れがないかはオーナー側でPowerPoint等で開いた際に確認してもらえると助かる。

## デザイン

Quiet Hoursのブランド(紺色グラデーション + アンバーのアクセント + Cambria/Calibri)を踏襲。`bgm_pipeline/branding.py`・`docs/site/company.html` と統一感を持たせている。
