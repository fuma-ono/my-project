# X(旧Twitter)アカウント

`docs/marketing/2026-08-04-x-strategy.md`の決定に基づく新チャネル。「AI社長が実在の会社(Quiet Hours)を経営している」プロセスそのものを発信し、YouTube/note/アプリへの送客導線にする。

**アカウント**: [@QuietHoursceo](https://x.com/QuietHoursceo)(2026-08-04、オーナーが作成済み)

**2026-08-10追記**: モヤスカ用に別途新規アカウントを新設する方針が決まった(ブランドが違う——こちらは「AI社長の経営実況」、モヤスカは匿名投稿ドラマ——ため、`@QuietHoursceo`への相乗りをやめて分離。詳細は`docs/projects/moyasuka/channel-description.md`)。**Xまわりは当面(このアカウントもモヤスカ用アカウントも)すべて手動運用**——下記の自動投稿の仕組みはオーナー自身のPCが前提で作られており、オーナーがiPhone/iPadのみでPCを持っていないと判明したため、今のところ使える状態にない。

**2026-08-18追記**: モヤスカ用アカウントをオーナーが作成完了。ハンドルは`@moyasuka`ではなく[@moyasuka_ch](https://x.com/moyasuka_ch)で確定(第一候補`@moyasuka`は取得できなかった様子)。

## 自動投稿(x_publish/)

Xは2026-02に無料APIプランを廃止し、投稿(書き込み)には従量課金($0.015/投稿、URL付きはさらに$0.20)が必要になった。ほぼ全投稿がYouTube/noteへのリンク付き(=課金対象)になる見込みで、`docs/marketing/2026-08-04-x-strategy.md`で決めた「まずは無料で始める」方針と合わない。

そのため、note.comと同じ理由・同じ方式(公式の無料手段がないためブラウザ自動操作)を採用する。詳細は`x_publish/x_auth.py`のdocstring、セキュリティ上の扱いは`docs/security/checklist.md`参照。

### 一度だけ必要なセットアップ(オーナー自身のPCで実行)

Claude Codeのクラウドセッションでは実行できない(このコンテナのネットワークポリシーがx.com/twitter.comへの直接接続をブロックしていることを確認済み)。**必ずオーナー自身の手元のPC**で:

```bash
cd x-account/x_publish
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
.venv/bin/python x_auth.py login
```

ブラウザが開いてXのログイン画面が表示されるので、@QuietHoursceoで普段通りログインする(パスワードはこのスクリプトには渡らず、X自身のページに直接入力する)。ログイン後、ターミナルに戻ってEnterを押すとセッションが`credentials/x_state.json`(gitignore対象)に保存される。

### 投稿

```bash
.venv/bin/python publish.py --file 001-launch-thread.md                    # 中身を確認するだけ(実際には投稿しない)
.venv/bin/python publish.py --file 001-launch-thread.md --publish          # 実際にスレッドとして投稿
.venv/bin/python publish.py --file 001-launch-thread.md --publish --debug  # ブラウザを表示して動作確認
```

**未検証の注意**: このクラウドセッションはx.comに接続できないため、`publish.py`内のセレクタは実際のログイン画面・投稿画面では検証できていない。オーナーが初回実行時、`--debug`で挙動を確認し、必要ならセレクタを調整してほしい。

## 投稿ドラフト

`drafts/`に投稿予定のテキストを溜めていく。note-articles/と同じ運用: ネタが増えたら追記する。

最初の投稿群は `drafts/001-launch-thread.md`(7ポストのスレッド)。まずはこれをオーナーに手動で投稿してもらい、その後の投稿から自動化に移行する想定。

## プロフィール設定(まだの項目があれば)

- **表示名**: Quiet Hours 社長(Claude)
- **アイコン画像**: `docs/site/assets/tiktok-app-icon.png`(既存のQuiet Hoursブランドアイコン)
- **自己紹介文**:
  ```
  AIが実際に会社を経営しています。BGM動画・アプリ・note記事の3事業、口座もアカウントも本物。
  オーナーの指示のもと、コードを書き・動画を出し・記事を書き・時々失敗しながら運営中。
  その一部始終をここに記録します。
  ```
- **固定ポスト用リンク**: 会社サイト https://claude.ai/code/artifact/3ace0d1f-bbd2-4522-bb2e-b9b0b834d5b4
