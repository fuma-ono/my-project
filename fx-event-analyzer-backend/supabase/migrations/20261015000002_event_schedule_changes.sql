-- カレンダー更新 (notification-inbox-spec.md §8, api-design.md §24.9,
-- db-design.md §3.19).
--
-- A log of schedule changes to *scheduled* indicator releases and speeches,
-- written by the triggers below — never by the Backend. GET /notifications
-- turns the last 7 days of these into CALENDAR_UPDATE inbox rows
-- (target_id = this id, trigger = change_type) for users who would be
-- notified about the event (same rules as GET /notifications/upcoming).
--
--   RESCHEDULED: release_datetime / statement_datetime changed while the
--                event stayed un-cancelled (old → new).
--   CANCELLED:   status changed to CANCELLED (new_datetime is null).
--
-- Only events that were SCHEDULED before the update are logged: correcting
-- the time of an already RELEASED / DELIVERED event is not a calendar
-- change anyone needs to be told about.
--
-- target_id is economic_events.id (INDICATOR) or speech_events.id (SPEECH).
-- No FK (it points at one of two tables); a row whose event was deleted is
-- simply never matched. Rows older than the CALENDAR_UPDATE retention are
-- removed by `npm run jobs:cleanup-notifications`.

create table event_schedule_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('INDICATOR', 'SPEECH')),
  target_id uuid not null,
  change_type text not null check (change_type in ('RESCHEDULED', 'CANCELLED')),
  old_datetime timestamptz not null,
  new_datetime timestamptz,
  changed_at timestamptz not null default now(),

  constraint event_schedule_changes_new_datetime check ((change_type = 'CANCELLED') = (new_datetime is null))
);

create index idx_event_schedule_changes_changed_at on event_schedule_changes(changed_at);
create index idx_event_schedule_changes_target on event_schedule_changes(kind, target_id);

create or replace function record_economic_event_schedule_change()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'SCHEDULED' then
    return new;
  end if;
  if new.status = 'CANCELLED' then
    insert into event_schedule_changes (kind, target_id, change_type, old_datetime, new_datetime)
    values ('INDICATOR', new.id, 'CANCELLED', old.release_datetime, null);
  elsif new.release_datetime is distinct from old.release_datetime then
    insert into event_schedule_changes (kind, target_id, change_type, old_datetime, new_datetime)
    values ('INDICATOR', new.id, 'RESCHEDULED', old.release_datetime, new.release_datetime);
  end if;
  return new;
end;
$$;

create or replace function record_speech_event_schedule_change()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'SCHEDULED' then
    return new;
  end if;
  if new.status = 'CANCELLED' then
    insert into event_schedule_changes (kind, target_id, change_type, old_datetime, new_datetime)
    values ('SPEECH', new.id, 'CANCELLED', old.statement_datetime, null);
  elsif new.statement_datetime is distinct from old.statement_datetime then
    insert into event_schedule_changes (kind, target_id, change_type, old_datetime, new_datetime)
    values ('SPEECH', new.id, 'RESCHEDULED', old.statement_datetime, new.statement_datetime);
  end if;
  return new;
end;
$$;

create trigger trg_economic_events_schedule_change
  after update of release_datetime, status on economic_events
  for each row
  execute function record_economic_event_schedule_change();

create trigger trg_speech_events_schedule_change
  after update of statement_datetime, status on speech_events
  for each row
  execute function record_speech_event_schedule_change();

-- Shared market data like economic_events / speech_events (db-design.md §6):
-- any authenticated user may SELECT; writes happen only through the
-- triggers above (run by service_role, which bypasses RLS).
alter table event_schedule_changes enable row level security;

create policy event_schedule_changes_select_authenticated on event_schedule_changes
  for select using (auth.role() = 'authenticated');
