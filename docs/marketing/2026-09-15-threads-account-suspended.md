# Threadsアカウント停止 — インシデント記録

作成日: 2026-09-15
報告元: オーナー(「スレッズの[アカウント名]、見つけたアカウントが停止されてしまった。」)

## 概要

オーナーより、運用中のThreadsアカウントがMetaにより停止(BAN/一時停止)された旨の報告を受けた。このセッションからは`graph.threads.net`への接続がブロックされているため、アカウント状態を直接確認する手段がなく、この報告はオーナーの一次情報として受け取っている。

## これまでの調査との関係

2026-09-14未明から`token-health.json`が一貫して以下のエラーを記録し続けていた:

```
HTTP 400 Bad Request: {"error":{"message":"Error validating access token: Session key is malformed because of invalid user id.","type":"OAuthException","code":190,"error_subcode":0,...}}
```

当時はこれを「トークンの失効・再認可が必要」という通常の運用障害として扱い、`get_token.py`の再実行とGitHub Secrets更新を繰り返しオーナーに案内していた。

**今回の報告により、根本原因はトークンの単純な失効ではなく、アカウント自体の停止だった可能性が高いと判断する。** アカウントが停止されると、そのアカウントに紐づくuser idの参照自体が無効になるため、「invalid user id」というエラー文言と整合する。

ただし、この因果関係はこのセッションから直接検証できていない(Threads/Meta側の管理画面はオーナーのみアクセス可能)。**推測であり確定情報ではない**ことを明記する。

## 実施した対応(2026-09-15)

### 1. 自動化の緊急停止

`threads-affiliate/automation-status.json`を手動で`paused: true`に設定した:

```json
{
  "paused": true,
  "pause_reason": "2026-09-15、オーナー報告によりThreadsアカウントが停止(BANまたは一時停止)されたことが判明。手動で全自動化を停止した。9/14から続いていたOAuthException 190「invalid user id」はこのアカウント停止が原因だった可能性が高い。復帰にはMeta側でのアカウント停止理由の確認・異議申し立て、解除後にget_token.pyの再認可が必要。",
  ...
}
```

これにより、`publish.py`/`fetch_replies.py`/`send_replies.py`は`ensure_not_paused()`で即座に終了し、無駄なAPI呼び出し・失敗記録を行わなくなる。

### 2. Threads関連CCR Routine(9件)の無効化

停止中のアカウントに対して定期実行を続ける意味が無いため、以下すべてを`enabled: false`にした(削除ではなく無効化。再開は`enabled: true`に戻すだけでよい)。

| Routine名 | 元の頻度 |
|---|---|
| Threads返信送信 確実に起動 | 4時間おき |
| Threads返信取得 確実に起動 | 4時間おき |
| Threads返信 自動対応 | 4時間おき |
| Threadsトークン確認・監視(統合) | 8時間おき |
| Threadsアフィリエイト 投稿を確実に起動 | 毎日 |
| Threadsアフィリエイト 毎日投稿案生成 | 毎日 |
| Threads Insights取得 確実に起動 | 週次 |
| Threads商品リサーチ 確実に起動 | 週次 |
| Threadsトークン延長リマインド | 月次 |

これにより、直前まで行っていたAI利用量削減の取り組み(`docs/AI_USAGE_POLICY.md`10節)に加えて、Threads関連のClaude Codeセッション起動はほぼゼロになる(残る自動化は note-articles/love-note/BGM/週次経営レビューのみ、合計1日2回未満)。

**GitHub Actions側の`schedule:`トリガー自体は削除していない**(各`.yml`ファイルは変更なし)。ネイティブcronは動き続けるが、`automation_guard.ensure_not_paused()`によりスクリプト側で即座に終了するため、実害はない。

## 今後必要なアクション(オーナー側)

1. Meta Business Suite / Threadsアプリでアカウント停止の理由・通知内容を確認する
2. 停止が誤りだと考えられる場合、Metaの異議申し立て(アピール)手続きを行う
3. アカウントが復帰したら:
   - `get_token.py`を再実行してアクセストークンを再取得
   - GitHub Secrets(`THREADS_ACCESS_TOKEN`/`THREADS_USER_ID`)を更新
   - このセッションに「アカウント復帰した」と伝えれば、`automation-status.json`の`paused`解除と、無効化した9Routineの再有効化を行う

## 参考: 自動化がアカウント停止の一因になった可能性について

現時点でMetaからの具体的な停止理由は確認できていないため断定はできないが、念のため記録しておく。本アカウントは1日1投稿・返信は数時間おきの自動判断という、比較的抑制的な運用ではあった(`docs/marketing/2026-09-10-threads-auto-reply-guardrails.md`のガードレールにより、医療/法律/金融等の個別助言やセンシティブ内容は自動返信しない設計)。停止理由が判明次第、自動化ロジック(投稿頻度・返信内容・アフィリエイトリンクの扱い等)に問題がなかったかを再点検する。
