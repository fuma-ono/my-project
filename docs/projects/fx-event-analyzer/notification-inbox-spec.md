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
- レートアラートとカレンダー更新の通知はまだ無い。足すときにこの保存期間で入れる。

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
