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
--   push_notification_targets 通知ごと・端末ごとの送信の状態(HQ指示 2026-11-10「複数端末配信・部分失敗対応」)
--   push_delivery_attempts    送信の試行ごとの記録(端末ごと。結果・HTTP の状態・APNs の理由)
--
-- 利用者が読めるのは自分の行だけ(push_devices・push_favorite_currencies・push_notifications の select)。書き込みは
-- Backend(service_role)だけ。push_delivery_attempts はアプリから読めない。
-- 何度流しても同じ結果ではない(create table)。戻す手順:
--   drop function push_queue_stats(timestamptz); drop function cleanup_push_notifications(integer, integer);
--   drop function expire_push_notifications(); drop function renew_push_notification_lease(uuid, uuid, integer);
--   drop function claim_due_push_notifications(integer, integer, integer);
--   drop function complete_push_delivery_attempt(uuid, text, integer, text, text, integer);
--   drop table push_notification_targets;
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
  -- 通知全体の状態(端末ごとの状態は push_notification_targets):
  --   PENDING(送る前・再試行待ち)/ SENDING(送信中)/ SENT(対象の端末すべてに届いた)/
  --   PARTIAL_FAILURE(届いた端末と、最終的に届かなかった端末がある)/ FAILED(どの端末にも届かなかった)/
  --   CANCELLED(送る前に取り消した)/ SKIPPED(送らなかった: 期限切れ・通知しない時間帯・端末なし)
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENDING', 'SENT', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED', 'SKIPPED')),
  -- CANCELLED / SKIPPED / FAILED の理由(TARGET_CANCELLED・RESCHEDULED・SETTINGS_CHANGED・EXPIRED・NO_DEVICE・QUIET_HOURS・
  -- MAX_ATTEMPTS・STUCK_IN_SENDING など)。PENDING で再試行待ちなら RETRY・CONFIG_ERROR
  status_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null,
  -- 取り出し(claim)の印と持ち時間(HQ指示 2026-11-10「障害復旧・信頼性強化」):
  --   claim_token: 取り出すたびに新しくする。結果の記録・持ち時間の延長・差し戻しは、この印が一致するときだけできる
  --     (持ち時間を過ぎて別の worker が取り直した後に、前の worker が状態を書き換えない)
  --   lease_until: SENDING の持ち時間。過ぎても SENDING のまま(送信の途中で止まった)なら、もう一度取り出せる
  --   recovery_count: 持ち時間切れで取り直した回数。上限を超えたら FAILED STUCK_IN_SENDING(毎回止まる行で詰まらない)
  claim_token uuid,
  lease_until timestamptz,
  last_claimed_at timestamptz,
  recovery_count integer not null default 0 check (recovery_count >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > scheduled_send_at),
  check (status <> 'SENDING' or (claim_token is not null and lease_until is not null)),
  -- 同じ利用者・同じ種類・同じ対象・同じ予定時刻は1件だけ(重複して送らない)。延期で時刻が変われば別の行になる
  constraint push_notifications_dedup unique (user_id, push_type, target_kind, target_id, event_scheduled_at)
);

create index idx_push_notifications_due on push_notifications(next_attempt_at) where status in ('PENDING', 'SENDING');
create index idx_push_notifications_user_created on push_notifications(user_id, created_at desc);
create index idx_push_notifications_status_updated on push_notifications(status, updated_at);

create trigger trg_push_notifications_set_updated_at
  before update on push_notifications
  for each row execute function set_updated_at();

-- 端末ごとの送信の記録。送る前に IN_FLIGHT の行を作り、APNs の応答で結果を入れる。IN_FLIGHT のまま持ち時間が切れた行は、
-- 取り直しのときに UNKNOWN にする(APNs に届いたかどうか分からない)。
create table push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references push_notifications(id) on delete cascade,
  device_id uuid references push_devices(id) on delete set null,
  attempt integer not null check (attempt >= 1),
  claim_token uuid not null,
  attempted_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null check (outcome in (
    'IN_FLIGHT', 'SUCCESS', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'INVALID_TOKEN', 'CONFIG_ERROR', 'UNKNOWN')),
  http_status integer,
  apns_id text,
  reason text,
  check ((outcome = 'IN_FLIGHT') = (finished_at is null))
);

create index idx_push_delivery_attempts_notification on push_delivery_attempts(notification_id, device_id);
create index idx_push_delivery_attempts_finished on push_delivery_attempts(finished_at);

-- 通知ごと・端末ごとの送信の状態(HQ指示 2026-11-10「複数端末配信・部分失敗対応」)。最初に送るときに、その時点の有効な端末で
-- 作る(対象の端末はそこで決まる。後から登録した端末には、その通知を送らない)。
--   PENDING(まだ送っていない)/ RETRY(一時的な失敗。再試行する)/ SUCCESS(届いた。二度と送らない)/
--   FAILED(最終的に届かなかった: PERMANENT_ERROR・INVALID_TOKEN・MAX_ATTEMPTS・EXPIRED)/
--   CANCELLED(届く前に端末が外れた: DEVICE_REMOVED)
create table push_notification_targets (
  notification_id uuid not null references push_notifications(id) on delete cascade,
  device_id uuid not null references push_devices(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'RETRY', 'SUCCESS', 'FAILED', 'CANCELLED')),
  status_reason text,
  -- 結果の出た試行の回数(CONFIG_ERROR・UNKNOWN は数えない)
  attempts integer not null default 0 check (attempts >= 0),
  last_outcome text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, device_id)
);

create index idx_push_notification_targets_open on push_notification_targets(notification_id) where status in ('PENDING', 'RETRY');

create trigger trg_push_notification_targets_set_updated_at
  before update on push_notification_targets
  for each row execute function set_updated_at();

-- 送る時刻になった行を取り出して SENDING にする(新しい claim_token)。for update skip locked で、同時に動いた送信ジョブが
-- 同じ行を取らない。対象:
--   PENDING で next_attempt_at を過ぎ、期限(expires_at)前の行
--   SENDING のまま持ち時間(lease_until)を過ぎた行(送信の途中で止まった)— 取り直し(recovery)。その行の IN_FLIGHT の
--     記録は UNKNOWN にする。取り直しの回数が p_max_recoveries を超えたら、取り出さずに FAILED STUCK_IN_SENDING
-- 持ち時間の中の SENDING(正常に送信中)は取らない。
create or replace function claim_due_push_notifications(p_limit integer, p_lease_seconds integer, p_max_recoveries integer default 3)
returns setof push_notifications
language plpgsql
as $$
declare
  v_ids uuid[];
  v_recovered uuid[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 1 and 3600' using errcode = '22023';
  end if;
  if p_max_recoveries is null or p_max_recoveries < 0 or p_max_recoveries > 10 then
    raise exception 'p_max_recoveries must be between 0 and 10' using errcode = '22023';
  end if;

  select coalesce(array_agg(d.id), '{}'), coalesce(array_agg(d.id) filter (where d.status = 'SENDING'), '{}')
    into v_ids, v_recovered
  from (
    select n.id, n.status
    from push_notifications n
    where (n.status = 'PENDING' and n.next_attempt_at <= now() and n.expires_at > now())
       or (n.status = 'SENDING' and n.lease_until <= now())
    order by n.next_attempt_at, n.id
    limit p_limit
    for update skip locked
  ) d;

  if cardinality(v_recovered) > 0 then
    update push_delivery_attempts a
    set outcome = 'UNKNOWN', finished_at = now(), reason = coalesce(a.reason, 'LEASE_EXPIRED_DURING_SEND')
    where a.notification_id = any(v_recovered) and a.outcome = 'IN_FLIGHT';

    update push_notifications n
    set status = 'FAILED', status_reason = 'STUCK_IN_SENDING', recovery_count = n.recovery_count + 1,
        claim_token = null, lease_until = null,
        last_error = coalesce(n.last_error, 'lease expired while SENDING')
    where n.id = any(v_recovered) and n.recovery_count + 1 > p_max_recoveries;
  end if;

  return query
  update push_notifications n
  set status = 'SENDING',
      claim_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      last_claimed_at = now(),
      recovery_count = n.recovery_count + (case when n.id = any(v_recovered) then 1 else 0 end)
  where n.id = any(v_ids) and n.status in ('PENDING', 'SENDING')
  returning n.*;
end;
$$;

-- 送信の記録を終え、同じ transaction で端末の状態を進める(記録と状態がずれない)。IN_FLIGHT の記録だけ。戻り値 = 端末の状態の行。
--   SUCCESS → SUCCESS / PERMANENT_ERROR → FAILED PERMANENT_ERROR / INVALID_TOKEN → FAILED INVALID_TOKEN /
--   RETRYABLE_ERROR → RETRY(結果の出た試行が p_max_attempts に達したら FAILED MAX_ATTEMPTS)/
--   CONFIG_ERROR → 端末の状態は変えない(APNs の鍵・設定の問題で、端末の失敗ではない)
-- 一度 SUCCESS になった端末は、ほかの結果で戻さない。
create or replace function complete_push_delivery_attempt(
  p_attempt_id uuid, p_outcome text, p_http_status integer, p_apns_id text, p_reason text, p_max_attempts integer)
returns setof push_notification_targets
language plpgsql
as $$
declare
  v_notification uuid;
  v_device uuid;
begin
  if p_outcome is null or p_outcome not in ('SUCCESS', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'INVALID_TOKEN', 'CONFIG_ERROR') then
    raise exception 'p_outcome % is not a final outcome', p_outcome using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'p_max_attempts must be between 1 and 20' using errcode = '22023';
  end if;
  update push_delivery_attempts
  set outcome = p_outcome, http_status = p_http_status, apns_id = p_apns_id, reason = p_reason, finished_at = now()
  where id = p_attempt_id and outcome = 'IN_FLIGHT'
  returning notification_id, device_id into v_notification, v_device;
  if not found then
    raise exception 'attempt % is not IN_FLIGHT', p_attempt_id using errcode = '55000';
  end if;
  if p_outcome = 'CONFIG_ERROR' then
    return query select * from push_notification_targets t where t.notification_id = v_notification and t.device_id = v_device;
    return;
  end if;
  return query
  update push_notification_targets t
  set attempts = t.attempts + 1,
      last_outcome = p_outcome,
      last_error = case when p_outcome = 'SUCCESS' then t.last_error else concat_ws(' ', p_http_status::text, p_reason) end,
      status = case
        when t.status = 'SUCCESS' or p_outcome = 'SUCCESS' then 'SUCCESS'
        when p_outcome in ('PERMANENT_ERROR', 'INVALID_TOKEN') then 'FAILED'
        when t.attempts + 1 >= p_max_attempts then 'FAILED'
        else 'RETRY' end,
      status_reason = case
        when t.status = 'SUCCESS' or p_outcome = 'SUCCESS' then null
        when p_outcome in ('PERMANENT_ERROR', 'INVALID_TOKEN') then p_outcome
        when t.attempts + 1 >= p_max_attempts then 'MAX_ATTEMPTS'
        else 'RETRY' end
  where t.notification_id = v_notification and t.device_id = v_device
  returning t.*;
end;
$$;

-- 持ち時間の延長(端末に送る前ごとに呼ぶ)。印が一致して SENDING のときだけ。false = 取り出しを失った(送らない)。
create or replace function renew_push_notification_lease(p_id uuid, p_claim_token uuid, p_lease_seconds integer)
returns boolean
language plpgsql
as $$
declare
  v_found boolean;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 1 and 3600' using errcode = '22023';
  end if;
  update push_notifications
  set lease_until = now() + make_interval(secs => p_lease_seconds)
  where id = p_id and claim_token = p_claim_token and status = 'SENDING';
  v_found := found;
  return v_found;
end;
$$;

-- 期限を過ぎた PENDING を終わらせる(APNs が未設定のときも動かす。期限を過ぎた通知は、設定が直っても送らない)。戻り値 = 件数。
--   まだ1回も送っていない → SKIPPED EXPIRED
--   再試行待ちで、届いた端末がある → PARTIAL_FAILURE EXPIRED_BEFORE_RETRY / 届いた端末が無い → FAILED EXPIRED_BEFORE_RETRY
--   再試行待ちの端末(PENDING・RETRY)は FAILED EXPIRED
-- 行は消さない(古い行の整理は cleanup_push_notifications)。
create or replace function expire_push_notifications()
returns integer
language plpgsql
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(e.id), '{}') into v_ids
  from (
    select n.id from push_notifications n
    where n.status = 'PENDING' and n.expires_at <= now()
    for update skip locked
  ) e;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  update push_notifications n
  set status = case
        when exists (select 1 from push_notification_targets x where x.notification_id = n.id and x.status = 'SUCCESS')
          then 'PARTIAL_FAILURE'
        when n.attempts > 0 then 'FAILED'
        else 'SKIPPED' end,
      status_reason = case
        when n.attempts > 0
          or exists (select 1 from push_notification_targets x where x.notification_id = n.id and x.status = 'SUCCESS')
          then 'EXPIRED_BEFORE_RETRY'
        else 'EXPIRED' end,
      claim_token = null, lease_until = null
  where n.id = any(v_ids);
  update push_notification_targets t
  set status = 'FAILED', status_reason = 'EXPIRED'
  where t.notification_id = any(v_ids) and t.status in ('PENDING', 'RETRY');
  return cardinality(v_ids);
end;
$$;

-- 古い行の整理。終わった行(SENT・CANCELLED・SKIPPED)は p_keep_days 日、FAILED・PARTIAL_FAILURE は p_keep_failed_days 日残す
-- (失敗の履歴は長めに残す)。送信の記録は cascade で消える。PENDING・SENDING は消さない。戻り値 = 消した件数。
create or replace function cleanup_push_notifications(p_keep_days integer default 30, p_keep_failed_days integer default 90)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  if p_keep_days is null or p_keep_days < 1 or p_keep_failed_days is null or p_keep_failed_days < p_keep_days then
    raise exception 'p_keep_days must be >= 1 and p_keep_failed_days >= p_keep_days' using errcode = '22023';
  end if;
  delete from push_notifications
  where (status in ('SENT', 'CANCELLED', 'SKIPPED') and updated_at < now() - make_interval(days => p_keep_days))
     or (status in ('FAILED', 'PARTIAL_FAILURE') and updated_at < now() - make_interval(days => p_keep_failed_days));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 運用の集計(読むだけ)。キューの滞留・止まった送信・状態ごとの件数・送信の記録の結果ごとの件数・成功率。
create or replace function push_queue_stats(p_since timestamptz)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'pending', (select count(*) from push_notifications where status = 'PENDING'),
    'pending_due', (select count(*) from push_notifications
                    where status = 'PENDING' and next_attempt_at <= now() and expires_at > now()),
    'pending_retrying', (select count(*) from push_notifications where status = 'PENDING' and attempts > 0),
    'oldest_due_seconds', (select coalesce(extract(epoch from now() - min(next_attempt_at))::integer, 0)
                           from push_notifications
                           where status = 'PENDING' and next_attempt_at <= now() and expires_at > now()),
    'sending', (select count(*) from push_notifications where status = 'SENDING'),
    'sending_lease_expired', (select count(*) from push_notifications where status = 'SENDING' and lease_until <= now()),
    'by_status_since', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                        from (select status, count(*) as n from push_notifications
                              where updated_at >= p_since group by status) s),
    'targets_open', (select count(*) from push_notification_targets where status in ('PENDING', 'RETRY')),
    'targets_by_status_since', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                                from (select status, count(*) as n from push_notification_targets
                                      where updated_at >= p_since group by status) t),
    'attempts_since', (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb)
                       from (select outcome, count(*) as n from push_delivery_attempts
                             where attempted_at >= p_since group by outcome) a),
    'retried_notifications_since', (select count(*) from push_notifications where updated_at >= p_since and attempts > 1),
    'success_rate_since', (select case when count(*) = 0 then null
                                  else round(count(*) filter (where outcome = 'SUCCESS')::numeric / count(*), 4) end
                           from push_delivery_attempts where attempted_at >= p_since and outcome <> 'IN_FLIGHT')
  );
$$;

alter table push_devices enable row level security;
alter table push_favorite_currencies enable row level security;
alter table push_notifications enable row level security;
alter table push_delivery_attempts enable row level security;
alter table push_notification_targets enable row level security;

-- 同じ形(db-design.md §6): 自分の行を読むだけ。書き込みは service_role(Backend)だけ
create policy push_devices_select_own on push_devices for select using (user_id = auth.uid());
create policy push_favorite_currencies_select_own on push_favorite_currencies for select using (user_id = auth.uid());
create policy push_notifications_select_own on push_notifications for select using (user_id = auth.uid());
revoke all on table push_delivery_attempts from public, anon, authenticated;
revoke all on table push_notification_targets from public, anon, authenticated;

revoke all on function claim_due_push_notifications(integer, integer, integer) from public, anon, authenticated;
grant execute on function claim_due_push_notifications(integer, integer, integer) to service_role;
revoke all on function renew_push_notification_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function renew_push_notification_lease(uuid, uuid, integer) to service_role;
revoke all on function expire_push_notifications() from public, anon, authenticated;
grant execute on function expire_push_notifications() to service_role;
revoke all on function cleanup_push_notifications(integer, integer) from public, anon, authenticated;
grant execute on function cleanup_push_notifications(integer, integer) to service_role;
revoke all on function push_queue_stats(timestamptz) from public, anon, authenticated;
grant execute on function push_queue_stats(timestamptz) to service_role;
revoke all on function complete_push_delivery_attempt(uuid, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function complete_push_delivery_attempt(uuid, text, integer, text, text, integer) to service_role;
