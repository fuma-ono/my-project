# note事業(有料記事)

`docs/marketing/2026-08-market-research.md` の調査(C)、`docs/marketing/2026-08-content-topics.md` のネタ調査、および `docs/marketing/2026-08-note-content-pillars.md` の2本柱化方針に基づく。

**投稿キュー(コピペ用ページ)**: https://claude.ai/code/artifact/4463f3ba-3008-4e37-bbff-c9b338cbcb87
下書きが増えたら `note-articles/queue-page/template.html` に追記して `python3 note-articles/queue-page/build.py` → Artifact再公開。

## 方針

1. **フォロワー0の間は無料記事+サポート機能のみ。** 単発有料記事はいきなり売れない。
2. 週1回更新を目標に、**柱A(睡眠・集中・作業用サウンド)** と **柱B(個人開発・AI経営の裏側)** の2本柱で書く。柱Aは3事業のファンが重なるように、柱Bは個人開発/AI活用に関心がある層を新規に獲得するために書く。
3. ある程度スキ/閲覧が集まった段階(目安: 記事平均スキ数が二桁に乗る、フォロワーが増え始める)で、月額300〜500円の定期購読マガジンへ移行する。
4. 記事内でBGM動画・アプリへの導線を張り、3事業を回遊させる。
5. トピックは「ノウハウの羅列」より「〇〇してみた失敗談・気づき型」を優先する(`docs/marketing/2026-08-content-topics.md` の調査結果より、この型が最も読まれる)。
6. Amazon/楽天アフィリエイトを、文脈が自然な場合のみ導入する(`docs/marketing/2026-08-note-content-pillars.md`)。

## 進捗

- [x] 01 - 眠れない夜、AIに「無限に続く雨音」を作ってもらった話(**公開済み・柱A**)
- [x] 03 - なぜ雨の音を聞くと眠くなるのか、1/fゆらぎの話(**公開済み・柱A**)
- [x] 02 - 集中できない日のための、作業用BGMの選び方(**公開済み・柱A**)
- [x] 04 - 「集中できない」がただの気合い不足じゃなかった話(**公開済み・柱A**)
- [ ] 05 - AIに会社の実務を任せてみたら、想像と違う大変さがあった話(下書き済み・**柱B第1弾**)
- [ ] 06 - AIで作った音楽に著作権はあるのか、個人開発者が実際に調べてみた話(下書き済み・柱A、`docs/marketing/2026-08-content-topics.md` バックログ#6)
- [ ] 07 - みんなが本当に困っている「作業用BGM選び」の悩みを50件くらい読んでみた(下書き済み・柱A、バックログ#13。YouTubeチャンネルへの導線を追加済み)
- 次のネタ候補は `docs/marketing/2026-08-content-topics.md`(柱A)のバックログを参照。柱Bは今後ネタ帳を別途作る
- **2026-08-03: 収益化プッシュ中。** 05・06・07が投稿待ち。オーナーに「1週間以内に投稿キューを消化してほしい」と依頼済み

## このディレクトリの中身

- `drafts/` — 下書き記事(Markdown)。
- `queue-page/` — コピペ投稿用ページのソース(手動投稿する場合はこちら)。
- `note_publish/` — Playwrightによる自動投稿ツール(下記参照)。

## 自動投稿(note_publish/)

note.comには公式APIも投稿用のOAuthも存在しないため(2026-08時点で再確認済み)、`bgm_pipeline`のYouTube/Instagram連携とは違う方式を取っている。ブラウザ自動操作(Playwright)でnote.comに実際にログインし、エディタに直接入力する。**「パスワードを一切預からない」という他の連携の原則からは外れる**ため、詳細は`docs/security/checklist.md`のnote.comセクションに記録している。

### 一度だけ必要なセットアップ(オーナー自身のPCで実行)

Claude Codeのクラウドセッションでは実行できない(ブラウザを見せる画面がない上、このコンテナのネットワークポリシーがnote.comへの直接接続自体をブロックしている)。**必ずオーナー自身の手元のPC**で:

```bash
cd note-articles/note_publish
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
.venv/bin/python note_auth.py login
```

ブラウザが開いてnote.comのログイン画面が表示されるので、普段通りログインする(パスワードはこのスクリプトには渡らず、note.com自身のページに直接入力する)。ログイン後、ターミナルに戻ってEnterを押すとセッションが`credentials/note_state.json`(gitignore対象)に保存される。以後はこのファイルが再利用される。

### 投稿

```bash
.venv/bin/python publish.py            # 下書きをエディタに入力するだけ(note側で自動下書き保存・未公開)
.venv/bin/python publish.py --publish  # 実際に公開する
.venv/bin/python publish.py --debug    # ブラウザを表示して動作確認
```

**未検証の注意**: このクラウドセッションはnote.comに接続できないため、`publish.py`内のセレクタ(ボタン名やフィールドの識別方法)は実際のログイン画面・エディタでは検証できていない。オーナーが初回実行時、`--debug`で挙動を確認し、必要ならセレクタを調整してほしい。

## 人間側でまだ必要な作業

- `note_publish/`の初回ログイン(オーナー自身のPCで、上記手順)
- マガジン設定・サポート機能・決済設定の有効化
