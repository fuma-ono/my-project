# Threadsアフィリエイト自動化(threads-affiliate/)

`docs/marketing/2026-08-18-ai-affiliate-feasibility.md` の実装。note.comの自動化(`love-note/`)と違い、Threadsには**Meta公式のAPI**があるため、ブラウザ自動操作やreCAPTCHA回避が不要。初回のトークン取得だけ済ませれば、以降は正規のAPI呼び出しだけで完結する。

## なぜ「完全自動化」できるのか

- ログインをスクレイピングするのではなく、Meta公式のOAuth認可フロー(オーナーが1回「許可する」を押すだけ)でアクセストークンを取得する
- 以降の投稿はすべてHTTPSでのAPI呼び出し(`graph.threads.net`)。ブラウザもログイン画面も経由しないので、reCAPTCHAのような詰まりが原理的に起きない
- トークンは60日ごとの延長が必要だが、これも`refresh_token.py`をタスクスケジューラに登録しておけば自動化できる

## なぜクラウドではなくオーナーのPCで実行するのか

このリポジトリが動くクラウド環境は `graph.threads.net` への接続がネットワークポリシーでブロックされていることを確認済み(実測: `CONNECT tunnel failed, response 403`)。そのためAPI呼び出し自体はオーナーのPC(制限なし)で実行する。**タスクスケジューラ/cronに登録すれば、オーナーが毎回手を動かす必要はなくなる**(これが目指す「完全自動化」の実際の形)。

## セットアップ手順(オーナー作業、初回のみ)

1. Threadsアプリで、アカウントを「プロフェッショナル」に切り替える(設定 → アカウントの種類を切り替える)
2. [developers.facebook.com](https://developers.facebook.com/) でMeta開発者アプリを新規作成し、製品として「Threads API」を追加
3. アプリ設定の「有効なOAuthリダイレクトURI」に `http://localhost:8910/callback` を追加
4. アプリの「App ID」「App Secret」を控える
5. パソコンで以下を実行:
   ```
   git pull
   python threads-affiliate/get_token.py
   ```
   App ID・App Secretの入力を求められるので入力。ブラウザが開くので、Threadsアカウントで「許可する」を押す
6. 投稿を確認したいだけなら:
   ```
   python threads-affiliate/publish.py --dry-run
   ```
7. 実際に投稿:
   ```
   python threads-affiliate/publish.py
   ```

## 完全に無人化する(タスクスケジューラ登録)

Windowsの場合、タスクスケジューラで以下を週2〜3回のトリガーで登録する:
- プログラム: `python`
- 引数: `threads-affiliate/publish.py`
- 開始(作業)フォルダ: このリポジトリのフォルダ

トークン延長用に、`threads-affiliate/refresh_token.py` も月1回のトリガーで登録しておく。

## 商品調査(楽天API、Phase 1〜2)

こちらもクラウドからは `webservice.rakuten.co.jp` への接続がブロックされているため、オーナーのPCで実行する。

1. [webservice.rakuten.co.jp](https://webservice.rakuten.co.jp/) でアプリIDを発行(即時・無料)
2. 楽天アフィリエイトの管理画面でアフィリエイトIDを確認
3. 実行:
   ```
   python threads-affiliate/research.py
   ```
   初回はアプリID・アフィリエイトIDの入力を求められる(以降は保存された設定を使う)
4. `product-candidates.md` が最新の候補で更新されるので、`git add / commit / push`

週1回程度、`research.py` → `git push` をタスクスケジューラに登録しておけば、商品調査も無人化できる(`publish.py`と同様の仕組み)。

## 投稿の中身

`threads-affiliate/pending/*.json` に `{"text": "...", "affiliate_link": "..."}` の形式で置かれた下書きを、古いものから1件ずつ投稿する。下書きは週次のRoutine(クラウド側)が自動生成し、コミット・pushする。オーナーは `git pull` するだけで最新の下書きを受け取れる。

## 運用ルール

- 本文には必ずPR表記(`#PR` など)を含める(景品表示法対応)
- 使ったことのない商品について断定的な体験談は書かない(`docs/marketing/2026-08-18-ai-affiliate-feasibility.md` セクション15参照)
- 最初のうちは`pending/`に追加された下書きに一度目を通してから`publish.py`を実行することを推奨(無人化は、内容に問題が無いと確認できてから)

## セキュリティ

- `access-token.json`(App Secret・アクセストークンを含む)は `.gitignore` 済み。絶対に他人に渡さない・commitしない
- トークンが流出した場合は、Meta開発者アプリの設定画面からトークンを無効化できる
