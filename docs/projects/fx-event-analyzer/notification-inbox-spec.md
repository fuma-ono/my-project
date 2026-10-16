# FX Event Analyzer: アプリ内通知一覧の仕様

**出典**: HQ指示(2026-10-13)「おすすめの通知仕様」。通知一覧画面(ホームの通知ベル → `NotificationListView`)の、保存期間・既読・重複・プッシュ通知との関係を決める。

## 1. 保存期間と既読後の扱い

| 通知の種類 | 保存期間 | 既読後の扱い |
|---|---|---|
| 経済指標 | 30日 | 保存期間内は残す |
| 要人発言 | 30日 | 保存期間内は残す |
| レートアラート | 7日 | 保存期間内は残す |
| カレンダー更新 | 7日 | 保存期間内は残す |
| システム通知 | 30日 | 保存期間内は残す |

- 保存期間は初期案。期限を過ぎた通知は一覧から自動的に外す。
- レートアラートとカレンダー更新の通知は**実装済み(2026-10-15)**。この保存期間で入れる(7章・8章)。

## 2. 古い通知は自動で外す

- 保存期間を過ぎた通知は一覧から外す。
- **アプリ(実装済み 2026-10-13)**: 届いた通知を受け取ったとき(`NotificationsStore.record`)と、通知一覧を開いたとき(`pruneExpired`)に外す。一覧は表示のたびに期限で絞り込む。
- **サーバー(実装済み 2026-10-13)**: 下の「6. サーバー側の通知一覧」のとおり、期限をサーバーでも持つ。一覧のAPIは期限切れを返さず、呼び出しのたびにその利用者の期限切れを消す。

## 3. 同じイベントの通知を重複させない

- 「発表5分前」と「発表時」のように、通知の種類(何分前か)が違うものは別々に残す。
- 同じイベント・同じ通知の種類は1件だけにする。
- アプリでは `NotificationEntry.targetKey` を「種類(経済指標/要人発言)・イベントID・何分前か」で作る。

## 4. 通知一覧とプッシュ通知は分ける

- 端末に届くプッシュ通知(通知センター)を消しても、アプリ内の通知一覧の既読・保存には影響させない。
- アプリ内の一覧は端末の記録(`NotificationsStore`)として、通知センターとは別に持つ。

## 5. 通知一覧の画面

- **上部**:
  - 左に「● 未読 N件」。
  - 右に「すべて既読」と、並び替え(新しい順/古い順)。
- **既読になるとき**: 行を開いたときに、その1件が既読になる。「すべて既読」で全部が既読になる。
- 画面を開いただけでは既読にしない。

## 6. サーバー側の通知一覧(実装済み 2026-10-13)

ログインした端末どうしで既読をそろえ、サーバーで期限を管理する。API の詳細は api-design.md 24.9〜24.11節(v1.23)。

- **テーブル `notification_inbox`**(`supabase/migrations/20261013000002_notification_inbox.sql`):

  | 列 | 内容 |
  |---|---|
  | `id` | 主キー(uuid) |
  | `user_id` | 利用者(`profiles.id`。利用者を消すと行も消える) |
  | `kind` | INDICATOR / SPEECH / RATE_ALERT / CALENDAR_UPDATE / SYSTEM |
  | `target_id` | イベントIDなど(INDICATOR は `economic_events.id`、SPEECH は `speech_events.id`) |
  | `trigger` | 発表の何分前か。`LEAD_5`(5分前)など、0分は `AT_RELEASE` |
  | `title` | 見出し(指標の正式名・発言のタイトル。`GET /notifications/upcoming` の `title` と同じ) |
  | `body` | 本文(例: 「発表の5分前です（10/16 8:30発表・重要度 高）」。アプリのローカル通知と同じ書き方、時刻は表示設定のタイムゾーン) |
  | `display_name` | 指標の表示名(SPEECH は null) |
  | `speaker_name` | 発言者(INDICATOR は null) |
  | `country_code` / `importance` / `scheduled_at` | 国・重要度・発表時刻 |
  | `notify_at` | 通知の時刻(`scheduled_at` − 何分前か) |
  | `read_at` | 既読にした時刻(未読は null) |
  | `expires_at` | `notify_at` + 種類ごとの保存期間 |
  | `created_at` | 行を作った時刻 |

- **保存期間**: 1章の表のとおり(30日 / 7日)。値は `src/domain/notificationInbox.ts` の `NOTIFICATION_RETENTION_DAYS` の1か所だけに持つ。
- **行を作るとき**: `GET /notifications` を呼ぶたびに、`GET /notifications/upcoming` と同じ条件(通知設定・プランの上限・何分前か・通知しない時間帯・表示名)で選んだ通知のうち、`notify_at` を過ぎていて期限切れでないものを入れる。
  - 発表済み(RELEASED)・発言済み(DELIVERED)のイベントも入れる。中止(CANCELLED)は入れない。
  - 通知設定を最後に保存した時刻(`user_settings.updated_at`)より前の通知はさかのぼって入れない。初めて使う人や、何分前かを変えた人に、受け取る設定ではなかった過去30日分の通知が並ばないようにするため。
- **重複防止**: 一意制約 `(user_id, kind, target_id, trigger)`。同じ通知は何度呼んでも1件(`ON CONFLICT DO NOTHING`)。「5分前」(`LEAD_5`)と「発表時」(`AT_RELEASE`)は別の行。
- **期限切れの削除**: 一覧のAPIは `expires_at > now()` だけを返し、呼び出しのたびにその利用者の `expires_at <= now()` の行を消す。全員分は1日1回のジョブ `npm run jobs:cleanup-notifications`(SQL関数 `delete_expired_notification_inbox()`)で消す。
- **API**:
  - `GET /notifications?order=desc|asc&kind=…`: 既定は新しい順(`notify_at`)。`{ items, unread_count }` を返す。`unread_count` は `kind` で絞り込まない未読件数。
  - `POST /notifications/{id}/read`: 1件を既読にする(本人の行だけ。2回目は最初の既読時刻のまま)。
  - `POST /notifications/read-all`: 未読をすべて既読にし、件数を返す。
- **プッシュ通知との関係**: プッシュ通知の配信記録とは別のテーブル。プッシュを消しても `notification_inbox` は変わらない。
- **RLS**: 本人は自分の行だけ読める。書き込みはBackend(service_role)だけ。
- **種類ごとの `target_id` / `trigger`**(2026-10-15):

  | kind | target_id | trigger |
  |---|---|---|
  | INDICATOR | `economic_events.id` | `LEAD_N` / `AT_RELEASE` |
  | SPEECH | `speech_events.id` | `LEAD_N` / `AT_RELEASE` |
  | RATE_ALERT | `rate_alerts.id` | `CROSSED` |
  | CALENDAR_UPDATE | `event_schedule_changes.id` | `RESCHEDULED` / `CANCELLED` |

## 7. レートアラート(実装済み 2026-10-15)

通貨ペアの価格が決めた値を上回った・下回ったときに、通知一覧に入れる。API の詳細は api-design.md 24.12〜24.14節(v1.27)。

- **テーブル `rate_alerts`**(`supabase/migrations/20261015000001_rate_alerts.sql`): `user_id`・`fx_pair_id`・`direction`(`ABOVE` 上回ったら / `BELOW` 下回ったら)・`target_price`・`is_active`・`triggered_at`。RLS は本人だけ読める・書き込みはBackendだけ。
- **API**: `GET /rate-alerts`(一覧と上限)、`POST /rate-alerts`(作成)、`DELETE /rate-alerts/{id}`(削除)。
- **プランの上限**: 有効な(まだ通知していない)アラートは FREE 1件・PRO 10件(`src/domain/planLimits.ts` の `rate_alerts_max`)。FREE で超えると `403 PLAN_LIMIT_EXCEEDED`(`required_plan: "PRO"`)、PRO で超えると `422 VALIDATION_ERROR`(ほかのプランの上限と同じ書き方)。
- **価格**: `fx_prices` の最新の行(`timestamp` が最も新しい行、時間足は問わない)の `close`。ホームの `major_fx` の `price` と同じ値。価格の無い通貨ペアのアラートは通知しない。
- **判定**: `ABOVE` は価格 >= `target_price`、`BELOW` は価格 <= `target_price`。
- **判定するとき**: `GET /notifications` を呼ぶたび(呼んだ本人の分)と、ジョブ `npm run jobs:evaluate-rate-alerts`(全員分。価格の取り込みのたびに cron で動かす)。プランの上限より多く有効なアラートがある人(PRO から FREE に戻った人)は、古い順に上限の件数だけ判定する。
- **通知したとき**: `RATE_ALERT` の行を入れ(`target_id` = アラートのID、`trigger` = `CROSSED`、見出し「USD/JPY が 155.00 を上回りました」/「…を下回りました」、本文「現在 155.42（アラート: 155.00 以上）」、重要度 `HIGH`、`notify_at` = 判定した時刻、`scheduled_at`・`country_code` は null、保存期間 7日)、アラートを `is_active = false`・`triggered_at` = 判定した時刻にする。アラートは1回だけ通知する。もう一度知りたいときは作り直す。
  - 価格の小数は、円の通貨ペアは2桁、それ以外は4桁(目標の値の桁が多ければその桁まで)。
- **重複防止**: 一意制約 `(user_id, kind, target_id, trigger)` で、同時に判定しても1件だけ。
- **プッシュ通知がオフのとき**: 6章と同じく、通知一覧に新しい行を入れない。アラートも判定せず、有効なまま残す(オンに戻したあと、その時点の価格で判定する)。

## 8. カレンダー更新(実装済み 2026-10-15)

予定の経済指標・要人発言の日時が変わったとき・中止になったときに、通知一覧に入れる。

- **テーブル `event_schedule_changes`**(`supabase/migrations/20261015000002_event_schedule_changes.sql`): `kind`(INDICATOR / SPEECH)・`target_id`(イベントのID)・`change_type`(`RESCHEDULED` 日時の変更 / `CANCELLED` 中止)・`old_datetime`・`new_datetime`(中止は null)・`changed_at`。
- **記録**: DBのトリガーが書く(Backendは書かない)。`economic_events` の `release_datetime`、`speech_events` の `statement_datetime` が変わったとき、または `status` が `CANCELLED` になったとき。変更前に `SCHEDULED` だったイベントだけ(発表済み・発言済みの時刻の訂正は記録しない)。
- **通知一覧に入れるとき**: `GET /notifications` を呼ぶたびに、直近7日の変更のうち、そのイベントが6章と同じ条件(通知設定の種類ごとのオンオフ・重要度・通貨ペア・プランの上限、指標は発表時刻が `EXACT` のものだけ)で通知の対象になるものを入れる。何分前か・通知しない時間帯は使わない(何分前の通知ではないため)。
  - 通知設定を最後に保存した時刻(`user_settings.updated_at`)より前の変更は入れない(6章と同じ)。
  - プッシュ通知がオフのときは入れない(6章と同じ)。
- **行の中身**: `target_id` = 変更のID、`trigger` = `change_type`、`notify_at` = `changed_at`、`scheduled_at` = 変更後の日時(中止は変更前の日時)、重要度 = イベントの重要度、`display_name` / `speaker_name` / `country_code` は6章と同じ。
  - 見出し: 指標は「日本の消費者物価指数（CPI）の発表日時が変更されました」/「…の発表が中止されました」(国名 + 表示名。表示名が無い指標は正式名)。発言は「パウエルFRB理事の発言日時が変更されました」/「…の発言が中止されました」(発言者の姓 + 役職、ホームの要人発言と同じ)。
  - 本文: 「発表日時 10/16 8:30 → 10/17 8:30（重要度 高）」/ 中止は「10/16 8:30の発表は行われません（重要度 高）」(発言は「発言」)。時刻は表示設定のタイムゾーン。
- **古い変更の削除**: 7日を過ぎた変更は日次ジョブ `npm run jobs:cleanup-notifications` で消す。
