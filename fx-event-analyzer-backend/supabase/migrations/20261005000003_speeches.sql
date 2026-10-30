-- 要人発言 (HQ指示 2026-10-05): db-design.md §1 で P2・設計対象外としていた
-- Person / SpeechEvent を、SCR-016 通知設定「要人発言の通知」と
-- GET /speeches のために前倒しで追加する (db-design.md §3.15/§3.16)。
-- SpeechPriceReaction は引き続き対象外。
--
-- country_code / currency_code は economic_indicators と同じ形式 (text、
-- ISO 3166-1 alpha-2 / ISO 4217。ユーロ圏は 'EU')。

create table speakers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null,          -- 役職 (例: 'FRB議長')
  organization text not null,   -- 所属機関 (例: 'FRB')
  country_code text not null,
  currency_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_speakers_currency_code on speakers(currency_code);

create trigger trg_speakers_set_updated_at
  before update on speakers
  for each row
  execute function set_updated_at();

create table speech_events (
  id uuid primary key default gen_random_uuid(),
  speaker_id uuid not null references speakers(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  title text not null,
  summary text,
  statement_datetime timestamptz not null,
  importance text not null check (importance in ('LOW', 'MEDIUM', 'HIGH')),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'DELIVERED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index idx_speech_events_statement_datetime on speech_events(statement_datetime);
create index idx_speech_events_speaker_id on speech_events(speaker_id);

create trigger trg_speech_events_set_updated_at
  before update on speech_events
  for each row
  execute function set_updated_at();

-- Shared market data — same policy as economic_indicators / economic_events
-- (20260917000009_rls.sql, db-design.md §6): any authenticated user may
-- SELECT; writes are service_role only.
alter table speakers enable row level security;
alter table speech_events enable row level security;

create policy speakers_select_authenticated on speakers
  for select using (auth.role() = 'authenticated');

create policy speech_events_select_authenticated on speech_events
  for select using (auth.role() = 'authenticated');
