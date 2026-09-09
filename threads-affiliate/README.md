# Threadsアフィリエイト自動化(threads-affiliate/)

`docs/marketing/2026-08-18-ai-affiliate-feasibility.md` の実装。note.comの自動化(`love-note/`)と違い、Threadsには**Meta公式のAPI**があるため、ブラウザ自動操作やreCAPTCHA回避が不要。初回のトークン取得だけ済ませれば、以降は正規のAPI呼び出しだけで完結する。

## なぜ「完全自動化」できるのか

- ログインをスクレイピングするのではなく、Meta公式のOAuth認可フロー(オーナーが1回「許可する」を押すだけ)でアクセストークンを取得する
- 以降の投稿はすべてHTTPSでのAPI呼び出し(`graph.threads.net`)。ブラウザもログイン画面も経由しないので、reCAPTCHAのような詰まりが原理的に起きない
- トークンは60日ごとの延長が必要だが、これも`refresh_token.py`をタスクスケジューラに登録しておけば自動化できる

## どこで実行するか

Claude Codeが動くこのクラウド環境(セッションの中でコードを書いている環境)は `graph.threads.net` への接続がネットワークポリシーでブロックされていることを確認済み(実測: `CONNECT tunnel failed, response 403`)。**ただしGitHub Codespacesは別のネットワークなのでブロックされない**(実際に楽天API・Threads APIともCodespacesからの疎通を確認済み)。そのため:

- `get_token.py`(初回のみ、認可コードの手動コピペが必要): Codespaces・PCどちらでも可
- `publish.py` / `research.py` / `refresh_token.py` / `fetch_threads_insights.py`(通常運用): **2026-09-08〜、GitHub Actionsで完全無人実行できるようにした**(下記「完全に無人化する」参照)。PC・iPad・Codespacesを開かなくても、スケジュール通りに動く

## セットアップ手順(オーナー作業、初回のみ)

1. Threadsアプリで、アカウントを「プロフェッショナル」に切り替える(Instagram側が既にプロフェッショナルなら自動で反映されていることもある)
2. [developers.facebook.com](https://developers.facebook.com/) でMeta開発者アプリを新規作成し、ユースケースとして「Threads APIにアクセス」を追加
3. 作成直後は「ビジネスポートフォリオのリンク」を聞かれるが、個人利用なら「現時点ではリンクしない」を選択
4. Threads APIの「設定」で、アプリ設定の「有効なOAuthリダイレクトURI」に `https://example.com/oauth-callback` を追加
   - ★`example.com`はIANAが管理する常時アクセス可能なダミードメイン。`get_token.py`が「認可コードを自動受信するローカルサーバー」を使わず、**リダイレクト後のURLを手動でコピペする方式**にしたため、実在してさえいれば中身は何でもよい
   - 2026年時点のThreads APIは全リダイレクトURIにHTTPS必須(`http://`は`すべてのリダイレクトURLでHTTPSが必要です`エラーになる)。`https://example.com/...`ならこの条件も満たす
   - 「コールバックURLをアンインストール」「コールバックURLを削除」も未入力だと保存できない場合がある。その場合は`https://example.com/uninstall`のようなダミーのHTTPS URLで埋めてよい(個人利用でこれらのWebhookは使わないため)
5. 「Threadsテスターを追加または削除」から、投稿に使うThreadsアカウントをテスターとして追加する(アプリがMeta審査未通過の間、認証できるのはテスターだけ)
6. アプリの「App ID」(数字だけの値)と「App Secret」を控える(developers.facebookのログイン用メールアドレス・パスワードとは別物なので注意)
7. **Codespacesでも、PCでもどちらでも実行可能**(iPadしか無くても、ブラウザさえあればOK):
   ```
   git pull
   python3 threads-affiliate/get_token.py
   ```
   - App ID・App Secretを入力すると、認可用のURLが表示される
   - そのURLをコピーし、ブラウザ(Safari含む、どの端末でもよい)で開いて「許可する」を押す
   - `example.com`のページ(中身は簡素な英語ページで問題ない)にリダイレクトされるので、**そのページのアドレスバーのURLを丸ごとコピー**
   - ターミナルに戻り、貼り付けてEnter。これでトークンが保存される
8. 投稿を確認したいだけなら:
   ```
   python3 threads-affiliate/publish.py --dry-run
   ```
9. 実際に投稿:
   ```
   python3 threads-affiliate/publish.py
   ```

## 完全に無人化する(GitHub Actions、2026-09-08〜)

PC・iPad・Codespacesを一切開かなくても、GitHub Actionsのスケジュール実行で以下が自動で回る:

| ワークフロー | 頻度 | 内容 |
|---|---|---|
| `.github/workflows/threads-research.yml` | 火曜 06:00 JST | `research.py`で商品候補を更新 |
| `.github/workflows/threads-publish.yml` | **毎日21:00 JST** | `publish.py`で下書きを投稿。2026-09-09、Phase 2(完全自動投稿)へ移行済み |
| `.github/workflows/threads-insights.yml` | 土曜 06:00 JST | `fetch_threads_insights.py`で実績を取得 |

## 運用フェーズ(2026-09-09〜)

`docs/marketing/2026-09-09-threads-account-repositioning.md`の指示により、アカウントの位置づけを「特定ジャンルの商品を売るアカウント」から「暮らしの中の便利を発掘して紹介するアカウント」(ジャンル無制限)に変更した。投稿頻度も週次→毎日(目標21:00頃投稿)に変更している。

- ~~Phase 1: 20:00頃に投稿案を自動生成し、オーナーが確認してから手動投稿~~ → **2026-09-09、オーナー指示によりPhase 1を経ずPhase 2へ移行**
- **Phase 2(現在)**: 毎日20:00 JSTにRoutineが`pending/`へ投稿案を自動生成・commit・push、毎日21:00 JSTに`threads-publish.yml`が自動投稿する。人間のレビューは入らないため、`publish.py`の`validate_pr_disclosure()`(PR表記チェック)がコード側の最後の安全弁になる。投稿内容に問題が続くようなら、`threads-publish.yml`のscheduleをコメントアウトしてPhase 1に戻せる

### 事前準備(オーナー作業、初回のみ)

1. GitHubのリポジトリ画面 → 「Settings」→ 左メニュー「Secrets and variables」→「Actions」
2. 「New repository secret」から、以下を1つずつ登録する:
   - `RAKUTEN_APP_ID`(`rakuten-config.json`の`app_id`と同じ値)
   - `RAKUTEN_ACCESS_KEY`(同`access_key`)
   - `RAKUTEN_AFFILIATE_ID`(同`affiliate_id`)
   - `THREADS_ACCESS_TOKEN`(`access-token.json`の`access_token`)
   - `THREADS_USER_ID`(同`threads_user_id`)
3. `access-token.json`・`rakuten-config.json`の中身は、Codespaces/PCでこれまで作業してきたファイルをそのまま開いて値をコピーすればよい(`cat threads-affiliate/access-token.json`等で確認できる)

### ★重要な制約: スケジュール実行にはデフォルトブランチへの反映が必要

GitHub Actionsの`schedule`(cron)は、**リポジトリのデフォルトブランチ(通常`main`)に置かれたワークフローファイルでないと自動発火しない**仕様。今このコードがある`claude/note-issue-1pjubh`ブランチに置いただけでは、手動実行(Actionsタブの「Run workflow」ボタン)はできるが、**スケジュール通りの自動実行はまだ始まらない**。

自動実行を始めるには、このブランチ(少なくとも`.github/workflows/`と`threads-affiliate/`)をデフォルトブランチにマージする必要がある。

### トークンの延長(60日ごと)

`refresh_token.py`のGitHub Actions化(Secretsの自動更新)は、Secrets書き換え権限を持つ個人アクセストークンの追加設定が必要でやや複雑なため、今回は見送った。代わりに、このセッションから50日ごとにオーナーへリマインドを送るようにする(`get_token.py`を再実行し、`THREADS_ACCESS_TOKEN` Secretを手動更新するだけの簡単な作業)。完全自動化したい場合は追加設定するので伝えてください。

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

これは初回セットアップ用の手順。以降は`.github/workflows/threads-research.yml`が週1回自動実行する(前述「完全に無人化する」参照)。

### Amazonアフィリエイトとの併用

**2026-09-09、オーナーのAmazonアソシエイトアカウントが承認済み(いつでもリンク生成可能)であることを確認した。** ただし「紹介料のお支払いのための税務情報アンケート」が未回答の場合、実際に売上が発生しても支払いが止まるため、早めの回答を推奨(リンク生成自体はブロックされない)。

Amazon公式のPA-API(商品検索の自動化)は、**直近180日で3件以上の成果が無いとアクセスできない**ため、新規アカウントでは楽天と同じ形の完全自動化ができない。そのため当面は次の運用にしている:

1. Amazonアソシエイトに登録し、SiteStripeで商品ページごとに手動でアフィリエイトリンクを生成
2. `threads-affiliate/amazon-links.md` の表に「商品名キーワード → リンク」を追加(手動更新、`git push`)
3. `research.py` が楽天APIの候補と `amazon-links.md` を突き合わせ、一致した商品はAmazon側の実績作りを優先してAmazonリンクを使う(`product-candidates.md` の「推奨」欄が `amazon`)。一致しなければ楽天(完全自動)にフォールバックする

Amazon経由で3件の成果が貯まったらPA-APIへのアクセス申請ができるようになるので、その時点で楽天と同様の自動検索スクリプトに切り替える(詳細は `amazon-links.md` 参照)。

## 投稿の中身

`threads-affiliate/pending/*.json` に以下の形式で置かれた下書きを、古いものから1件ずつ投稿する(詳細フォーマットは`post-template.md`参照):

```json
{
  "text": "本文(アフィリエイトリンクを含む場合は【PR】等の表記を冒頭に)",
  "affiliate_link": "https://... または null",
  "affiliate_platform": "rakuten|amazon|null",
  "product_name": "商品名(社内管理用)",
  "category": "商品ジャンル(例: キッチン用品)",
  "post_type": "empathy|discovery|comparison|summary"
}
```

下書きは毎日20:00頃のRoutine(クラウド側)が自動生成し、コミット・pushする。オーナーは `git pull` するだけで最新の下書きを受け取れる。ジャンルはもう限定していない(`docs/marketing/2026-09-09-threads-account-repositioning.md`参照)。

## 実績計測(2026-09-08〜)

投稿を「いいね数」だけで評価しないため、以下の計測基盤を用意した。詳細方針は `docs/marketing/2026-09-08-threads-post-quality-guidelines.md` 参照。

1. `publish.py`が投稿の度に `publish-log.jsonl` に記録(post_id・投稿日時・本文・リンク・アフィリエイトプラットフォーム・商品名・ジャンル・post_type)
2. `check_insights.py <post_id>` — Threads Insights APIで実際に取得可能なmetricを確認する診断スクリプト。**2026-09-09、実機確認完了**: 有効なmetricは`clicks, likes, quotes, replies, reposts, shares, views`の7つのみ。`profile_visits`相当は投稿単位のInsightsには存在しないと判明した(当初の権限エラーはmetric名の問題ではなく、トークンに`threads_manage_insights`スコープが無かったことが原因だった)
3. `fetch_threads_insights.py` — `publish-log.jsonl`の各投稿について実績(表示数・いいね・返信・リポスト・引用・共有・クリック)を取得して追記する。確認済みの7metric全てに対応(`views/likes/replies/reposts/quotes/shares/clicks`)

```
python threads-affiliate/check_insights.py          # 初回、取得可能metricの確認
python threads-affiliate/fetch_threads_insights.py  # 実績の取得・記録更新
```

楽天側のクリック・成果データとの突合は、投稿数がある程度貯まってから着手する(オーナー方針: 分析より先に正確なデータを貯めることを優先)。

## 運用ルール

- アフィリエイトリンクを含む投稿は、本文の**冒頭**に必ずPR表記(`【PR】`/`#PR`/`#広告`/`[PR]`)を入れる(末尾に小さく書くだけは不可、景品表示法対応)。`publish.py`が投稿時にこれを検証し、無い・末尾のみの場合は投稿を中断する(`validate_pr_disclosure()`)
- 使ったことのない商品について断定的な体験談は書かない(`docs/marketing/2026-08-18-ai-affiliate-feasibility.md` セクション15参照)
- Phase 2(現在)は投稿が完全自動化されているため、実際に公開された投稿は`publish-log.jsonl`または`threads.net/@benri_mitsuketa`で事後に確認する運用にする。内容に問題が続くようならPhase 1(手動レビュー)に戻す(上記「運用フェーズ」参照)

## セキュリティ

- `access-token.json`(App Secret・アクセストークンを含む)は `.gitignore` 済み。絶対に他人に渡さない・commitしない
- トークンが流出した場合は、Meta開発者アプリの設定画面からトークンを無効化できる
