-- db-design.md v4.2 §3.4, §3.9, §3.10: indicator master, fx pair master,
-- and their many-to-many relation. No independent event_name/country_code/
-- currency_code column is ever added to economic_events (§4 of Phase 2
-- instruction) — country/currency are always derived via indicator_id.

create table economic_indicators (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country_code text not null,
  currency_code text not null,
  importance text not null check (importance in ('LOW', 'MEDIUM', 'HIGH')),
  description text,
  frequency text not null check (frequency in ('MONTHLY', 'QUARTERLY', 'IRREGULAR')),
  unit text,
  source text,
  source_url text,
  favorable_direction text not null check (favorable_direction in ('HIGHER_IS_POSITIVE', 'LOWER_IS_POSITIVE', 'NEUTRAL')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_economic_indicators_country_code on economic_indicators(country_code);
create index idx_economic_indicators_currency_code on economic_indicators(currency_code);
create index idx_economic_indicators_importance on economic_indicators(importance);

create trigger trg_economic_indicators_set_updated_at
  before update on economic_indicators
  for each row
  execute function set_updated_at();

create table fx_pairs (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  base_currency text not null,
  quote_currency text not null,
  pip_size numeric(10, 6) not null,
  price_precision smallint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_fx_pairs_set_updated_at
  before update on fx_pairs
  for each row
  execute function set_updated_at();

create table indicator_fx_pairs (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references economic_indicators(id) on delete restrict,
  fx_pair_id uuid not null references fx_pairs(id) on delete restrict,
  priority smallint not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (indicator_id, fx_pair_id)
);

create index idx_indicator_fx_pairs_indicator_id on indicator_fx_pairs(indicator_id);
create index idx_indicator_fx_pairs_fx_pair_id on indicator_fx_pairs(fx_pair_id);

create trigger trg_indicator_fx_pairs_set_updated_at
  before update on indicator_fx_pairs
  for each row
  execute function set_updated_at();
