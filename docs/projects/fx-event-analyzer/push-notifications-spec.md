# プッシュ通知(サーバーからの送信)仕様

HQ指示 2026-11-10「プッシュ通知バックエンド実装」。担当: B(Backend)。iOS の接続: A。
ブランチ `claude/fx-push-notifications`(ベース: `claude/fx-settings-screens` 75594021)。**DEV 未適用**(migration・Render・main は承認待ち)。

## 1. 位置づけ

- これまで: iOS が `GET /notifications/upcoming` から**端末内のローカル通知**を予約する(HQ指示 2026-10-05)。サーバーは送らない。
- この仕様: サーバーから **APNs** で送る仕組みを足す。**通知の対象・条件は今と同じ判定**(`src/domain/notifications.ts`)を使う:
  通知の ON/OFF、経済指標・要人発言の別、重要度(HIGH/MEDIUM/LOW)、通貨ペア、通知のタイミング(0/5/10/15/30/60 分前)、
  通知しない時間帯(利用者の表示のタイムゾーン)、プランの上限(FREE は HIGH だけ・通貨ペア1つ)、暫定の予定と時刻の決まっていない
  発表・発言は通知しない。
- **二重の通知を避ける**: サーバーからの送信が使える(`GET /notifications/push/status` の `server_push_available: true`)間は、
  iOS はローカル通知の予約をやめる。`false` の間(APNs の認証情報が未設定の今)はローカル通知を続ける。**切り替えの条件は HQ の判断**(§7)。

## 2. 通知の種類

| push_type | 対象 | いつ | 文面(例、ja) |
|---|---|---|---|
| `PRE_RELEASE` | 経済指標(`SCHEDULED`・`EXACT`・暫定でない) | 発表の N 分前(N = 通知のタイミング。0 = 発表時) | 「消費者物価指数（CPI）(US)」「11/12 22:30 に発表予定です(5分前のお知らせ)」 |
| `PRE_RELEASE` | 要人発言(`SCHEDULED`・時刻が `EXACT`) | 発言の N 分前 | 「ジェローム・パウエル」「「経済見通しに関する講演」は 11/13 00:00 から」 |
| `RELEASED` | 経済指標が `RELEASED` になった | 予約のジョブが見つけたとき(発表から6時間以内だけ) | 「結果が発表されました。アプリで確認できます」(FOMC 議事要旨は「公表されました」) |
| `SPEECH_DELIVERED` | 要人発言が `DELIVERED` になった | 同上 | 「「…」が公開されました」 |

- 時刻は**利用者の表示のタイムゾーン**(`display.timezone`)で書く。英語(`display.language = en`)の文面もある。
- **値(実績・予想)は通知の文面に入れない**(アプリで公式の値を見てもらう。未確認の値を通知に出さない)。
- **お気に入り通貨**(`reason = FAVORITE_CURRENCY`): お気に入り通貨の**そのイベント自身の通貨**の **HIGH** のイベントは、通貨ペアの
  絞り込みに入っていなくても通知する。通知の ON/OFF・指標/発言の別・通知しない時間帯は利用者の設定のまま。設定で既に入るイベントには
  2通送らない。お気に入り通貨はサーバーに登録する(§3.4。端末内のお気に入りとは別)。プランの上限は `favorites_max`(FREE 3)。
- 結果の改定(改定値)の通知は**今回は作っていない**(必要なら `push_type` を足す)。

## 3. API(すべて認証が必要。自分の行だけ)

### 3.1 `POST /api/v1/notifications/push/devices` — 端末の登録

```json
{ "device_token": "<APNs のトークン、16進 64〜200 文字>", "environment": "SANDBOX" | "PRODUCTION", "app_version": "1.0 (20)" }
```

- 201(新規)/ 200(同じトークン・環境の登録があった)。応答は §3.2 の1件。
- 同じトークンを別の利用者が登録したら、その利用者の端末になる(同じ端末で別のアカウントにログインした場合)。
- `environment`: 開発用の署名のビルド = `SANDBOX`、TestFlight・App Store = `PRODUCTION`。
- 呼ぶとき: 通知の許可を得て `didRegisterForRemoteNotificationsWithDeviceToken` を受けたとき・トークンが変わったとき・ログインの後。
- 422: トークン・環境の形が違う。401: 未ログイン。

### 3.2 `GET /api/v1/notifications/push/devices`

```json
{ "items": [ { "id": "uuid", "platform": "IOS", "environment": "SANDBOX", "token_suffix": "abababab", "app_version": "1.0 (20)",
  "is_active": true, "last_registered_at": "2026-11-10T10:00:00.000Z", "disabled_reason": null } ] }
```

トークンの全体は返さない(末尾8文字だけ)。`disabled_reason`: `USER_UNREGISTERED` / `APNS_INVALID_TOKEN`。

### 3.3 `DELETE /api/v1/notifications/push/devices/{id}` — 端末を外す(ログアウトの前に呼ぶ)

200(§3.2 の1件、`is_active: false`)。他人の端末・無い id は 404。

### 3.4 `GET` / `PUT /api/v1/notifications/push/favorite-currencies`

```json
PUT { "currency_codes": ["JPY", "USD"] }
→   { "currency_codes": ["JPY", "USD"], "limit": 3 }   // limit = favorites_max(PRO は null)
```

置き換え(空の配列 = なし)。通貨は USD・EUR・JPY・GBP・AUD・NZD・CHF・CAD。上限を超えると 403 `PLAN_LIMIT_EXCEEDED`(`required_plan: PRO`)。
上限を超えて保存された分(PRO から FREE に戻ったなど)は、判定のときに先頭から上限の数だけを使う。

### 3.5 `GET /api/v1/notifications/push/history?limit=50`

直近7日の自分の通知の予定と結果(新しい順、最大100件)。`status`: `PENDING` / `SENDING` / `SENT` / `FAILED` / `CANCELLED` / `SKIPPED`、
`status_reason`(例 `RESCHEDULED`・`SETTINGS_CHANGED`・`EXPIRED`・`QUIET_HOURS`・`NO_DEVICE`)。確認・問い合わせの調査用。

### 3.6 `GET /api/v1/notifications/push/status`

`{ "server_push_available": false }` — APNs の認証情報がサーバーに設定されているか。§1 の切り替えに使う。

### 3.7 通知の本文(APNs の payload)

```json
{ "aps": { "alert": { "title": "…", "body": "…" }, "sound": "default" },
  "fx": { "notification_id": "uuid", "type": "PRE_RELEASE", "target_kind": "INDICATOR", "target_id": "<event id>",
          "scheduled_at": "2026-11-12T13:30:00Z", "reason": "SETTINGS" } }
```

タップしたら `fx.target_kind` / `fx.target_id` でイベントの詳細(`/events/{id}`)・要人発言の詳細(`/speeches/{id}`)を開く。

## 4. 予約(`npm run jobs:enqueue-push`)

- 対象の利用者: 有効な端末が1台以上 **かつ** `notify_push = true`。
- 候補: これから約25時間の `SCHEDULED` のイベント・発言(発表前の通知)と、直近6時間の `RELEASED` / `DELIVERED`(公表の通知)。
- 利用者ごとに §2 の判定をして `push_notifications` に `PENDING` の行を入れる。
- **重複防止**: `unique (user_id, push_type, target_kind, target_id, event_scheduled_at)`。何度動かしても同じ通知は1件。
  延期・前倒しで時刻が変わると別の行になる(古い行は送る前に取り消される、§5)。

## 5. 送信(`npm run jobs:send-push`)

HQ指示 2026-11-10「障害復旧・信頼性強化」で、途中で止まっても詰まらない形にした。

### 5.1 1回の実行の流れ

1. **期限切れの整理**: `expire_push_notifications()` — 期限を過ぎた `PENDING` を `SKIPPED EXPIRED` にする(APNs が未設定でも行う)。
2. APNs が未設定なら、ここで `APNS_NOT_CONFIGURED` を出して終わる(何も取り出さない・送らない。行は `PENDING` のまま期限で 1. に)。
3. **取り出し**: `claim_due_push_notifications(limit, lease, max_recoveries)` — `for update skip locked` で、
   - 送る時刻を過ぎ、期限前の `PENDING`
   - 持ち時間(`lease_until`)を過ぎた `SENDING`(前の送信が途中で止まった — **取り直し**。`recovery_count` を1増やし、その行の
     `IN_FLIGHT` の記録を `UNKNOWN` にする。取り直しが3回を超えたら取り出さずに `FAILED STUCK_IN_SENDING`)
   を `SENDING` にし、**新しい `claim_token`** を付ける。持ち時間の中の `SENDING`(正常に送信中)は取らない。同時に動いた別の送信の
   ジョブとは同じ行を取らない。
4. **送る直前の確かめ**(今のイベントと今の設定で): 中止 → `CANCELLED TARGET_CANCELLED`、時刻が変わった → `CANCELLED RESCHEDULED`、
   もう発表済み → `ALREADY_RELEASED`、暫定に戻った → `PROVISIONAL`、設定を変えた(OFF・重要度・通貨・お気に入り)→ `SETTINGS_CHANGED`、
   期限切れ(発表前の通知は発表の2分後、公表の通知は6時間後)→ `SKIPPED EXPIRED`、今が通知しない時間帯 → `SKIPPED QUIET_HOURS`。
5. 端末ごとに: **持ち時間の延長**(`renew_push_notification_lease`。印が合わなければ = 別のジョブが取り直した → この行には何も書かずに次へ)
   → **`IN_FLIGHT` の記録を作る** → APNs に送る → 記録に結果を入れる。
   - 取り直した行では、記録が `SUCCESS` の端末(既に届いた)と、`PERMANENT_ERROR`・`INVALID_TOKEN`(送ってもむだ)の端末には送らない。
     `UNKNOWN`・`RETRYABLE_ERROR` の端末には送り直す。
6. **行の状態を書く**(`claim_token` が一致する `SENDING` の行だけ): 1台でも届いた → `SENT`。再試行できる失敗だけ → `PENDING RETRY`
   (1分・2分・5分・10分の後、最大5回、期限まで)。上限 → `FAILED MAX_ATTEMPTS`。無効なトークンだけ → `FAILED ALL_TOKENS_INVALID`。
   端末が無い → `SKIPPED NO_DEVICE`。

### 5.2 保証の範囲 — **At Least Once(期限まで)**。Exactly Once ではない

| 止まった・失敗した時点 | 状態 | 次の実行 | 結果 |
|---|---|---|---|
| 取り出した直後(まだ送っていない) | `SENDING`、記録なし | 持ち時間の後に取り直す | 1回届く |
| `IN_FLIGHT` を作った後・APNs の応答の前(タイムアウトを含む) | 記録 `IN_FLIGHT` | 取り直しで `UNKNOWN` → 送り直す | **二重に届くことがある** |
| APNs が受け取った後・記録に結果を入れる前 | 記録 `IN_FLIGHT` | 同上 | **二重に届くことがある** |
| 記録に `SUCCESS` を入れた後・行を `SENT` にする前 | 記録 `SUCCESS`、行 `SENDING` | 取り直し → 送らずに `SENT` | 1回届く |
| 遅い worker が持ち時間を過ぎた(別の worker が取り直した) | 印が古い | 古い worker は延長・書き込みに失敗し、それ以上送らない | 送信中の1台だけ二重になりうる |

- 二重に届いても、`apns-collapse-id` = 通知の id なので、通知センターでは1件にまとまる(バナーはもう一度出る)。
- APNs に「同じ通知を二度送らない」の仕組みは無いので、これより強い保証(Exactly Once)はできない。結果の分からない送信は
  記録で `UNKNOWN` として区別できる。
- 取り逃しは、期限・試行の上限・取り直しの上限で止まったとき(`SKIPPED EXPIRED`・`FAILED …`)だけで、どれも記録に残る。

### 5.3 応答の分類

| APNs の応答 | 分類 | 扱い |
|---|---|---|
| 200 | `SUCCESS` | |
| 410・400 BadDeviceToken / DeviceTokenNotForTopic | `INVALID_TOKEN` | 端末を外す。再試行しない |
| 429(TooManyRequests ほか)・500・503・通信の失敗・タイムアウト(`TIMEOUT`) | `RETRYABLE_ERROR` | 待ってから再試行 |
| 403 ExpiredProviderToken | — | JWT を作り直して**その場で1回だけ**送り直す(2回目も 403 なら `CONFIG_ERROR`) |
| 403 のほか(InvalidProviderToken・MissingProviderToken・BadCertificate など) | `CONFIG_ERROR` | 鍵・設定の問題。**その回の送信をやめ**、取り出した行を `PENDING CONFIG_ERROR` に差し戻す(5分後、試行の回数は増やさない) |
| ほかの 4xx(BadPath・PayloadTooLarge・BadTopic など) | `PERMANENT_ERROR` | 再試行しない |

### 5.4 運用(`npm run jobs:push-maintenance`)

1. 期限切れの整理(5.1 の 1.)
2. 古い行を消す `cleanup_push_notifications(30, 90)`: `SENT`・`CANCELLED`・`SKIPPED` は30日、`FAILED` は90日残す(失敗の履歴は長め)。
   送信の記録は一緒に消える。`PENDING`・`SENDING` は消さない。
3. 集計 `push_queue_stats(since)`(直近24時間): `pending`・`pending_due`(送る時刻を過ぎて待っている = 滞留)・`pending_retrying`・
   `oldest_due_seconds`・`sending`・`sending_lease_expired`(止まった送信)・`by_status_since`・`attempts_since`(結果ごとの件数)・
   `retried_notifications_since`・`success_rate_since`。

### 5.5 API への影響

- **API の形は変わらない**(iOS の作業は要らない)。`GET /notifications/push/history` の `status_reason` に、`STUCK_IN_SENDING`・
  `MAX_ATTEMPTS`・`CONFIG_ERROR`・`RETRY` などが出ることがある(調査用の値)。
- 同じ通知が二重に届くことがある(5.2)。iOS は `fx.notification_id` が同じなら同じ通知として扱える。

## 6. DB(migration `20261110000005_push_notifications.sql`)

`push_devices`・`push_favorite_currencies`・`push_notifications`・`push_delivery_attempts`、関数 `claim_due_push_notifications`・
`renew_push_notification_lease`・`expire_push_notifications`・`cleanup_push_notifications`・`push_queue_stats`。
RLS: 利用者は自分の端末・お気に入り・通知の行を読むだけ(書き込みは Backend の service_role)。送信の記録と取り出しの関数はアプリから使えない。
戻す手順は migration の冒頭。

## 7. APNs で実際に送るのに必要なこと(未解決・HQ の判断)

1. **APNs の認証キー(.p8)**: Apple Developer で「Apple Push Notifications service (APNs)」のキーを作る(Key ID)。Team ID。
   Render の環境変数に `APNS_KEY_ID`・`APNS_TEAM_ID`・`APNS_PRIVATE_KEY`(.p8 の中身)・`APNS_BUNDLE_ID` を入れる。**B は入れない**。
2. **iOS**: Push Notifications の capability(entitlement `aps-environment`)、通知の許可、トークンの登録(§3.1)、ログアウトで §3.3。
3. **ローカル通知との切り替え**(§1): いつ・どの条件でローカル通知をやめるか。
4. **定期実行**: 予約は5分ごと、送信は1分ごとが目安。GitHub Actions の定期実行は最短5分で、遅れ・止まりがある(FX の定時起動が
   まだ動いていない)ため、送信の時刻の正確さに影響する。どこで動かすか(Render の Cron Job など)は承認が要る。
5. 改定値の通知を作るか。

## 8. DEV への反映の手順(承認の後)

1. `claude/fx-push-notifications` を settings に統合(api-design の版の衝突は無い — この仕様は別のファイル)。
2. migration `20261110000005_push_notifications.sql` を DEV に適用。確認: 4つの表と関数があること、RLS が有効なこと。
3. Render にデプロイ(`deploy/fx-api-dev` を更新、手動デプロイ)。この時点では APNs の環境変数が無いので、送信はされない。
4. A が §3.1〜§3.6 につなぐ(`server_push_available: false` の間はローカル通知のまま)。
5. APNs の認証情報を入れる(§7.1)→ `server_push_available: true` → 開発の端末で `SANDBOX` の送信を確かめる → 定期実行を決める。
