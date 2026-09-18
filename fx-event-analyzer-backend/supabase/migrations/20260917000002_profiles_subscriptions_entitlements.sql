-- db-design.md v4.2 §3.1-3.3: user-specific tables.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_set_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan text not null default 'FREE' check (plan in ('FREE', 'PRO')),
  status text not null check (status in ('ACTIVE', 'CANCELED', 'EXPIRED', 'TRIAL')),
  provider text not null default 'APP_STORE',
  provider_customer_id text,
  provider_subscription_id text,
  started_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_user_id on subscriptions(user_id);
-- db-design.md §3.2: at most one ACTIVE subscription per user; historical
-- rows may accumulate freely.
create unique index uq_subscriptions_active_per_user on subscriptions(user_id) where status = 'ACTIVE';

create trigger trg_subscriptions_set_updated_at
  before update on subscriptions
  for each row
  execute function set_updated_at();

-- db-design.md §3.3: feature_code deliberately has no CHECK constraint so
-- new values (AI_ANALYSIS / SPEECH_ANALYSIS / ALERT, etc.) can be added by
-- future migrations without a schema change. FREE/PRO naming is never
-- embedded in feature_code itself (HQ confirmed).
create table entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  feature_code text not null,
  enabled boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature_code)
);

create index idx_entitlements_user_id on entitlements(user_id);

create trigger trg_entitlements_set_updated_at
  before update on entitlements
  for each row
  execute function set_updated_at();
