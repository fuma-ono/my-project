# セキュリティチェックリスト

開発部・法務部の共同管轄。コード面は実施済み、アカウント運用面はオーナーの操作が必要。

## 実施済み(コード面のレビュー結果)

- **リポジトリ内のシークレット走査**: API キー・パスワード・トークンのハードコードなし(現時点で外部APIキーを一切使っていないため該当なし)
- **コマンドインジェクション**: `bgm-pipeline/bgm_pipeline/video.py` の ffmpeg 呼び出しは `subprocess.run` にリスト引数で渡しており `shell=True` は未使用。動画タイトル文字列は `_escape_drawtext()` でffmpegのdrawtextフィルタ構文をエスケープ済み
- **依存パッケージ監査**: `npm audit` で moderate 10件を確認。すべて `uuid` パッケージの脆弱性(バッファ境界チェック不備)がExpo CLIのビルドツールチェーン内部でのみ使われている間接依存で、アプリ本体には同梱されずビルド時のみ影響する。`npm audit fix --force` はExpoを46系(現行57系から大幅ダウングレード)にする破壊的変更のため見送り、実害の少ない既知リスクとして許容。次回定例レビューで再確認する
- **`.gitignore` に将来のシークレット用パターンを追加**: `.env`、`*credentials*.json`、`*.pem`、`*.p12`、`google-services.json` 等を事前にブロック(まだ使っていないが、YouTube Data API連携やEASビルド認証情報を追加する際に誤コミットを防ぐため)
- **アプリのデータ収集**: 現状ログイン機能・個人情報の収集は一切なし(ローカル再生のみ)。収集するデータが増えたら都度ここに追記する

## オーナー側で対応が必要(アカウント運用)

- [ ] 作成する6アカウント(Google/Apple/Instagram/TikTok/note)すべてで**二段階認証(2FA)を有効化**する
- [ ] 事業用アカウントは使い回しのパスワードを避け、パスワードマネージャーで生成した固有パスワードを使う
- [ ] 各アカウントの復旧用メール・電話番号を最新に保つ(乗っ取り対策)
- [ ] Apple Developer / Google Play Console はアカウント凍結が事業停止に直結するため、特に2FAと復旧設定を厳重にする
- [ ] 「Google/Appleを名乗るメール」「開発者アカウント停止」等のフィッシングメールに注意(公式コンソールに直接ログインして確認する習慣をつける)

## 今後、外部API連携を追加する際のルール

- APIキー・トークンは環境変数(`.env`、EAS Secrets等)で管理し、コードに直書きしない・コミットしない
- YouTube Data API等でOAuthを使う場合、必要最小限のスコープのみ要求する
- 発行したキーは用途ごとに分ける(BGM動画投稿用、アプリ分析用、などを一つのキーで使い回さない)

## 実施済み: YouTube Data API連携(2026-08-01)

- パスワードを一切預からない **Device Authorization flow** を採用(`bgm_pipeline/youtube_auth.py`)。ユーザーは自分のブラウザでコードを入力して許可するだけ
- スコープは `youtube.upload` と `yt-analytics.readonly` の2つのみに限定(動画削除・チャンネル設定変更などの権限は要求しない)
- 認証情報(`client_secret.json`、`youtube_token.json`)は `bgm-pipeline/credentials/` に保存し、`.gitignore` で確実にコミット対象外にしていることを確認済み
- アップロード後、ローカルの音声/動画ファイルは自動削除(`publish.py`)。長時間の生成物を無期限にディスクへ残さない運用に統一

## 実施済み: Instagram Graph API連携(2026-08-02)

- Meta側にDevice Flow相当の仕組みがないため、Graph API Explorer(Meta公式ツール)で発行した短期トークンを**1回だけ**受け取り、以降は長期トークンへの交換・自動更新で運用(`bgm_pipeline/instagram_auth.py`)。パスワードは一切扱わない
- 権限は `instagram_business_basic` / `instagram_business_content_publish` / `pages_show_list` の3つのみ
- 認証情報(`meta_app.json`、`meta_token.json`)は `bgm-pipeline/credentials/` に保存。このディレクトリ自体を `.gitignore` で丸ごとブロックする方式に強化(個別ファイル名パターンだと新しい認証情報ファイルを追加するたびに漏れるリスクがあったため)
- 投稿用に動画を一時的にGoogle Cloud Storageで公開ホスティングするが、公開後(Instagramが取得完了後)は即削除(`gcs_temp_host.py`)。同じGoogleアカウント/プロジェクトのOAuthトークンを再利用し、認証情報を増やさない設計

## 週次レビュー履歴

- **2026-08-03**: `app/` の `npm audit` を再実行。moderate 10件(`uuid`パッケージ、Expoビルドツールチェーン内部の間接依存)は前回(実施済みレビュー時点)から変化なし。新規の脆弱性なし。リポジトリ内のシークレットハードコードも引き続きなし(`bgm-pipeline/credentials/`は空・gitignore対象のまま)

## 次回レビュー予定

週次の定例レビューで `npm audit` / 依存パッケージの脆弱性を再確認し、ここに追記する。
