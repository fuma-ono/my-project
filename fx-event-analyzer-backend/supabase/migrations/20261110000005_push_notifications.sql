-- プッシュ通知(サーバーからの送信)のバックエンド — HQ指示 2026-11-10「プッシュ通知バックエンド実装」。
--
-- これまで(HQ指示 2026-10-05、migration 20261005000002)は、iOS が GET /notifications/upcoming から端末内のローカル通知を
-- 予約していて、Backend にはデバイストークン・送信基盤が無かった。この migration は、サーバーから APNs で送るための
-- 表を足す。通知の対象・条件(SCR-016 の通知設定、プランの上限、通知しない時間帯、暫定の予定・時刻の無い発言を除く)は
-- 今の判定(src/domain/notifications.ts)をそのまま使う。設計は docs/projects/fx-event-analyzer/push-notifications-spec.md。
--
--   push_devices              端末(APNs のデバイストークン)。1つのトークンは最後に登録した利用者のもの
--   push_favorite_currencies  お気に入り通貨(サーバーで判定するため。端末内のお気に入りとは別に、iOS が登録する)
--   push_notifications        送信の予定と状態(キュー)。同じ利用者・同じ対象・同じ種類・同じ予定時刻は1件だけ
--   push_delivery_attempts    送信の試行ごとの記録(端末ごと。結果・HTTP の状態・APNs の理由)
--
-- 利用者が読めるのは自分の行だけ(push_devices・push_favorite_currencies・push_notifications の select)。書き込みは
-- Backend(service_role)だけ。push_delivery_attempts はアプリから読めない。
-- 何度流しても同じ結果ではない(create table)。戻す手順:
--   drop function claim_due_push_notifications(integer, integer);
--   drop table push_delivery_attempts; drop table push_notifications; drop table push_favorite_currencies; drop table push_devices;

create table push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null default 'IOS' check (platform in ('IOS')),
  -- APNs のデバイストークン(16進の文字列)。小文字にそろえて保存する。
  device_token text not null check (device_token ~ '^[0-9a-f]{64,200}$'),
  -- アプリのビルドがつながる APNs の環境(開発用の署名 = SANDBOX、TestFlight・App Store = PRODUCTION)
  environment text not null check (environment in ('SANDBOX', 'PRODUCTION')),
  app_version text check (app_version is null or length(app_version) <= 32),
  is_active boolean not null default true,
  last_registered_at timestamptz not null default now(),
  disabled_at timestamptz,
  -- USER_UNREGISTERED(利用者が外した)/ APNS_INVALID_TOKEN(APNs が無効と返した)/ REASSIGNED(別の利用者が登録した)
  disabled_reason text check (disabled_reason is null or disabled_reason in ('USER_UNREGISTERED', 'APNS_INVALID_TOKEN', 'REASSIGNED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_token, environment)
);

create index idx_push_devices_user_active on push_devices(user_id) where is_active;

create trigger trg_push_devices_set_updated_at
  before update on push_devices
  for each row execute function set_updated_at();

create table push_favorite_currencies (
  user_id uuid not null references profiles(id) on delete cascade,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, currency_code)
);

create table push_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- PRE_RELEASE: 発表・発言の N 分前(lead 0 = その時刻)。RELEASED: 経済指標の結果の公表。SPEECH_DELIVERED: 発言の公開
  push_type text not null check (push_type in ('PRE_RELEASE', 'RELEASED', 'SPEECH_DELIVERED')),
  target_kind text not null check (target_kind in ('INDICATOR', 'SPEECH')),
  -- economic_events.id / speech_events.id
  target_id uuid not null,
  -- 予約したときの発表・発言の時刻。送る前に今の時刻と比べ、違えば(延期・前倒し)送らない
  event_scheduled_at timestamptz not null,
  -- SETTINGS: 通知設定に合った / FAVORITE_CURRENCY: お気に入り通貨の重要(HIGH)なイベント
  reason text not null check (reason in ('SETTINGS', 'FAVORITE_CURRENCY')),
  scheduled_send_at timestamptz not null,
  -- これを過ぎたら送らない(発表前の通知を発表の後に送らない、など)
  expires_at timestamptz not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED')),
  -- CANCELLED / SKIPPED / FAILED の理由(TARGET_CANCELLED・RESCHEDULED・SETTINGS_CHANGED・EXPIRED・NO_DEVICE・QUIET_HOURS など)
  status_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null,
  -- SENDING の間の持ち時間。過ぎても SENDING のまま(送信の途中で止まった)なら、もう一度取り出せる
  lease_until timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > scheduled_send_at),
  -- 同じ利用者・同じ種類・同じ対象・同じ予定時刻は1件だけ(重複して送らない)。延期で時刻が変われば別の行になる
  constraint push_notifications_dedup unique (user_id, push_type, target_kind, target_id, event_scheduled_at)
);

create index idx_push_notifications_due on push_notifications(next_attempt_at) where status in ('PENDING', 'SENDING');
create index idx_push_notifications_user_created on push_notifications(user_id, created_at desc);

create trigger trg_push_notifications_set_updated_at
  before update on push_notifications
  for each row execute function set_updated_at();

create table push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references push_notifications(id) on delete cascade,
  device_id uuid references push_devices(id) on delete set null,
  attempt integer not null check (attempt >= 1),
  attempted_at timestamptz not null default now(),
  outcome text not null check (outcome in ('SUCCESS', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'INVALID_TOKEN')),
  http_status integer,
  apns_id text,
  reason text
);

create index idx_push_delivery_attempts_notification on push_delivery_attempts(notification_id);

-- 送る時刻になった行を取り出して SENDING にする。for update skip locked で、同時に動いた送信ジョブが同じ行を取らない。
-- PENDING で next_attempt_at を過ぎた行と、SENDING のまま持ち時間(lease_until)を過ぎた行が対象。
create or replace function claim_due_push_notifications(p_limit integer, p_lease_seconds integer)
returns setof push_notifications
language plpgsql
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 10 and 3600' using errcode = '22023';
  end if;
  return query
  with due as (
    select n.id
    from push_notifications n
    where (n.status = 'PENDING' and n.next_attempt_at <= now())
       or (n.status = 'SENDING' and n.lease_until <= now())
    order by n.next_attempt_at, n.id
    limit p_limit
    for update skip locked
  )
  update push_notifications n
  set status = 'SENDING', lease_until = now() + make_interval(secs => p_lease_seconds)
  from due
  where n.id = due.id
  returning n.*;
end;
$$;

alter table push_devices enable row level security;
alter table push_favorite_currencies enable row level security;
alter table push_notifications enable row level security;
alter table push_delivery_attempts enable row level security;

-- 同じ形(db-design.md §6): 自分の行を読むだけ。書き込みは service_role(Backend)だけ
create policy push_devices_select_own on push_devices for select using (user_id = auth.uid());
create policy push_favorite_currencies_select_own on push_favorite_currencies for select using (user_id = auth.uid());
create policy push_notifications_select_own on push_notifications for select using (user_id = auth.uid());
revoke all on table push_delivery_attempts from public, anon, authenticated;

revoke all on function claim_due_push_notifications(integer, integer) from public, anon, authenticated;
grant execute on function claim_due_push_notifications(integer, integer) to service_role;
