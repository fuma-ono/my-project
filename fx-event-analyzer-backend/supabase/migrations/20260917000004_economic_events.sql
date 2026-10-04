-- db-design.md v4.2 §3.5: EconomicEvent holds metadata only. No
-- event_name / revised_previous / country_code / currency_code column —
-- see Phase 2 instruction §4.

create table economic_events (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references economic_indicators(id) on delete restrict,
  provider text,
  provider_event_id text,
  release_datetime timestamptz not null,
  release_datetime_precision text not null check (release_datetime_precision in ('EXACT', 'DATE_ONLY', 'APPROXIMATE', 'UNKNOWN')),
  importance text not null check (importance in ('LOW', 'MEDIUM', 'HIGH')),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'RELEASED', 'CANCELLED')),
  data_status text not null default 'PENDING' check (data_status in ('PENDING', 'AVAILABLE', 'PARTIAL', 'UNAVAILABLE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- db-design.md §3.5: provider_event_id is the primary de-dup key when a
-- provider supplies one; indicator_id + release_datetime is only an
-- auxiliary lookup/dup-detection index, never a UNIQUE constraint (a
-- future multi-provider setup must not be blocked by it).
create unique index uq_economic_events_provider_event on economic_events(provider, provider_event_id) where provider_event_id is not null;
create index idx_economic_events_indicator_id on economic_events(indicator_id);
create index idx_economic_events_indicator_release on economic_events(indicator_id, release_datetime);
create index idx_economic_events_release_datetime on economic_events(release_datetime);
create index idx_economic_events_status on economic_events(status);

create trigger trg_economic_events_set_updated_at
  before update on economic_events
  for each row
  execute function set_updated_at();
