-- db-design.md v4.2 §3.6: RELEASE snapshots are immutable, enforced at the
-- DB level (HQ confirmed) via the trigger below — Phase 2 instruction §4
-- "DB trigger等を利用して、可能な限りDBレベルで変更を防止する".

create table event_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references economic_events(id) on delete restrict,
  snapshot_type text not null default 'RELEASE',
  forecast numeric(18, 4),
  actual numeric(18, 4),
  previous numeric(18, 4),
  unit text,
  source text,
  source_url text,
  captured_at timestamptz not null,
  surprise numeric(18, 4),
  surprise_direction text check (surprise_direction in ('POSITIVE', 'NEGATIVE', 'NEUTRAL')),
  created_at timestamptz not null default now(),
  unique (event_id, snapshot_type)
);

create index idx_event_snapshots_event_id on event_snapshots(event_id);

create or replace function prevent_release_snapshot_mutation()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if old.snapshot_type = 'RELEASE' then
      raise exception 'event_snapshots: RELEASE snapshot is immutable and cannot be deleted (event_id=%)', old.event_id;
    end if;
    return old;
  else
    if old.snapshot_type = 'RELEASE' then
      raise exception 'event_snapshots: RELEASE snapshot is immutable and cannot be updated (event_id=%)', old.event_id;
    end if;
    return new;
  end if;
end;
$$ language plpgsql;

create trigger trg_prevent_release_snapshot_mutation
  before update or delete on event_snapshots
  for each row
  execute function prevent_release_snapshot_mutation();
