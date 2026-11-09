# Threads 完全自動返信 ガードレール

オーナー指示(2026-09-10、「モードA: 完全自動」採用)に基づく。この文書は
`threads-affiliate/fetch_replies.py`と`send_replies.py`の間で動く
**判断ステップ**(Claude Code Remoteの定期Routineが担当)の判断基準。

コード側(`send_replies.py`)が機械的に強制するガードレール(二重返信防止・
同一ユーザーへのレート制限・PR表記の補完・エラー時リトライ禁止)は
`send_replies.py`のdocstring参照。この文書は**内容面の判断**が対象。

## 全体フロー(2026-09-11修正: GitHub Actions 2本 + Routine 1本の3系統)

Claude Code Remoteのセッションから`graph.threads.net`へ接続できないため、
Threads APIへの接続が必要な処理はGitHub Actionsに分離している
(`threads-affiliate/README.md`「完全自動返信」節参照)。2時間おき、20分刻み:

1. **`threads-fetch-replies.yml`(毎時10分)** — `fetch_replies.py`を実行し、`replies-pending.json`をコミット
2. **このRoutine(毎時30分)** — `replies-pending.json`の各コメントについて、以下の基準で`action`(reply/skip)と`reply_text`または`skip_reason`を判断し、`reply-decisions.json`をコミット
3. **`threads-send-replies.yml`(毎時50分)** — `send_replies.py`を実行し、実際に投稿・`replies-log.jsonl`へのログ記録・コミットを行う

## reply-decisions.json フォーマット

`replies-pending.json`の各要素に`action`と`reply_text`(またはskip_reason)を
追加したものをそのまま使う(他のフィールドはログ用にそのまま転記して残す)。

```json
[
  {
    "comment_id": "...",
    "post_id": "...",
    "from_username": "...",
    "comment_text": "...",
    "received_at_hint": "...",
    "affiliate_url": "...",
    "action": "reply",
    "reply_text": "..."
  },
  {
    "comment_id": "...",
    "...": "...",
    "action": "skip",
    "skip_reason": "..."
  }
]
```

## 自動返信してよい(action: reply)

- 商品についての一般的な質問
- 商品の使い方
- 商品の特徴
- 購入先についての質問
- 投稿内容への感想
- 関連する便利グッズについての質問
- 軽い雑談・自然な会話
- 「これ使ってる」「気になる」などへの自然な返信

## 自動返信してはいけない(action: skip、必ずskip_reasonを記録)

- 医療・健康についての診断や治療判断
- 法律・税務についての断定的回答
- 金融・投資についての個別助言
- クレーム・返金・契約トラブル
- 個人情報に関する質問
- センシティブな内容
- 攻撃的・荒らし目的と思われるコメント
- 商品情報を確認できない質問
- 価格・在庫など、最新情報を確認できない内容
- 根拠がない内容を断定する必要がある質問
- 上記のどれにも当てはまるか迷う場合(判断に自信が持てない場合は安全側に倒してskipする)

## 商品情報についての制約(捏造禁止)

`replies-pending.json`の`product_name`/`category`/`original_post_text`と
`threads-affiliate/products.json`(商品名で該当エントリを探せる場合)以外の
情報を根拠にしない。特に以下は、上記データで確認できない限り断定しない:

- 価格・在庫・レビュー数・評価・商品仕様・販売状況・キャンペーン・割引

確認できない場合は「最新の価格・在庫は販売ページで確認してください」のような
安全な表現にとどめる。

## アフィリエイトリンクの扱い

- 毎回の返信にリンクを貼らない。ユーザーが購入先を聞いた場合など、**文脈上自然な場合のみ**`affiliate_url`を含める
- リンクを含めた場合、`send_replies.py`が自動でPR表記(`(PR)`)を補うので、判断ステップ側で明示的に付ける必要はない(付けても構わない)
- 返信を広告スパム化しない。売上目的を優先しすぎて不自然な宣伝返信にしない

## 返信の目的・トーン

売上目的の押し付けにならない範囲で、以下を意識する:

- 会話を継続する
- ユーザーの疑問を解決する
- 投稿へのエンゲージメントを高める
- プロフィール訪問につなげる
- 必要に応じて商品ページへの導線を作る(前述の通り、自然な場合のみ)

## Phase 2(戦略変更ループ)との関係

返信内容そのものの傾向分析(どんな質問が多いか等)はPhase 2の分析対象に
含めてよいが、**Phase 2の実装自体は投稿数30件超まで保留**(オーナー指示、
`docs/marketing/2026-09-10-ai-autonomous-operation-design.md`参照)。
現時点では返信ログを貯めるだけでよい。
