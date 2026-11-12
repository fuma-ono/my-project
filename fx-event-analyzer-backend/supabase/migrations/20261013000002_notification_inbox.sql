-- アプリ内の通知一覧 (notification-inbox-spec.md §6, api-design.md §24.9-§24.11,
-- HQ指示 2026-10-13).
--
-- GET /notifications writes a row here once a notification's notify_at has
-- passed (the same candidates GET /notifications/upcoming computes for the
-- user), so the read state and the retention live on the server and are
-- shared by every device the user signs in on. Separate from any push
-- delivery record: clearing a push notification never touches this table.
--
-- Retention (src/domain/notificationInbox.ts NOTIFICATION_RETENTION_DAYS):
-- expires_at = notify_at + 30 days (INDICATOR / SPEECH / SYSTEM) or 7 days
-- (RATE_ALERT / CALENDAR_UPDATE). The API never returns expired rows and
-- deletes the caller's on each GET; delete_expired_notification_inbox()
-- below removes everyone's (`npm run jobs:cleanup-notifications`, daily).

create table notification_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('INDICATOR', 'SPEECH', 'RATE_ALERT', 'CALENDAR_UPDATE', 'SYSTEM')),
  -- economic_events.id / speech_events.id (text so future kinds can use other ids).
  target_id text not null,
  -- 通知の種類: 'LEAD_5' (発表の5分前) / 'AT_RELEASE' (発表時, lead 0) / ...
  trigger text not null,
  title text not null,
  body text,
  display_name text,
  speaker_name text,
  country_code text,
  importance text,
  scheduled_at timestamptz,
  notify_at timestamptz not null,
  read_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),

  -- 同じイベント・同じ通知の種類は1件だけ (spec §3). LEAD_5 and AT_RELEASE
  -- for the same event are different rows.
  constraint notification_inbox_dedup unique (user_id, kind, target_id, trigger)
);

-- Listing / unread count / per-user expiry all filter on (user_id, expires_at).
create index idx_notification_inbox_user_id_expires_at on notification_inbox(user_id, expires_at);
-- The all-users expiry job.
create index idx_notification_inbox_expires_at on notification_inbox(expires_at);

-- Same policy shape as profiles/subscriptions/entitlements/user_settings
-- (db-design.md §6): the owner may SELECT, writes are service_role (the
-- Backend) only.
alter table notification_inbox enable row level security;

create policy notification_inbox_select_own on notification_inbox
  for select using (user_id = auth.uid());

-- Deletes every expired row (all users) and returns how many were deleted.
create or replace function delete_expired_notification_inbox()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from notification_inbox where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- service_role (the Backend / the cleanup job) only.
revoke all on function delete_expired_notification_inbox() from public, anon, authenticated;
grant execute on function delete_expired_notification_inbox() to service_role;
