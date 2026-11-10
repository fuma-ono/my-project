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

1. `claim_due_push_notifications(limit, lease)` で、送る時刻を過ぎた `PENDING`(と、持ち時間を過ぎた `SENDING`)を `SENDING` にして取り出す
   (`for update skip locked`。同時に動いた送信のジョブが同じ行を取らない)。
2. **送る直前の確かめ**(今のイベントと今の設定で): 中止 → `CANCELLED TARGET_CANCELLED`、時刻が変わった → `CANCELLED RESCHEDULED`、
   もう発表済み → `ALREADY_RELEASED`、暫定に戻った → `PROVISIONAL`、設定を変えた(OFF・重要度・通貨・お気に入り)→ `SETTINGS_CHANGED`、
   期限切れ(発表前の通知は発表の2分後、公表の通知は6時間後)→ `SKIPPED EXPIRED`、今が通知しない時間帯 → `SKIPPED QUIET_HOURS`。
3. 有効な端末ごとに APNs に送り、`push_delivery_attempts` に試行を記録する(結果・HTTP の状態・apns-id・理由)。
4. 1台でも届いたら `SENT`。APNs が無効と返した端末(410・BadDeviceToken・DeviceTokenNotForTopic)は外す。
5. **再試行**: 429・5xx・通信の失敗・403(認証)は、1分・2分・5分・10分の後に再試行(最大5回、期限まで)。超えたら `FAILED`。
6. APNs の認証情報が無ければ、何も取り出さずに `APNS_NOT_CONFIGURED` を出して終わる(行は `PENDING` のまま、期限で `SKIPPED`)。

## 6. DB(migration `20261110000005_push_notifications.sql`)

`push_devices`・`push_favorite_currencies`・`push_notifications`・`push_delivery_attempts`、関数 `claim_due_push_notifications`。
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
