-- db-design.md §3.14 (HQ確定 2026-10-02): per-user settings behind
-- SCR-018 通知設定 / SCR-020 表示・地域設定 / SCR-021 チャート設定.
--
-- One row per user, created lazily on the first PATCH /settings — a user
-- with no row yet simply gets the column defaults below from GET /settings
-- (src/repositories/userSettingsRepository.ts), so nothing has to be
-- backfilled for existing users.
--
-- Columns are grouped by screen with a shared prefix (notify_ / display_ /
-- chart_). Push delivery itself is out of MVP scope (HQ確定 2026-10-02):
-- the notify_ columns only record *what* the user wants to be notified
-- about, so a future Push infrastructure can read them as-is. New settings
-- are added as new columns with defaults (no data migration needed).

create table user_settings (
  user_id uuid primary key references profiles(id) on delete cascade,

  -- SCR-018 通知設定
  notify_pre_release boolean not null default true,
  notify_result boolean not null default true,
  notify_favorites boolean not null default true,
  notify_min_importance smallint not null default 3 check (notify_min_importance between 1 and 5),

  -- SCR-020 表示・地域設定. display_timezone is the IANA zone the client
  -- passes to timezone-scoped APIs such as Home (api-design.md §6/§12 —
  -- the API itself still never reads it implicitly, A-4).
  display_language text not null default 'ja' check (display_language in ('ja', 'en')),
  display_region text not null default 'JP' check (display_region ~ '^[A-Z]{2}$'),
  display_timezone text not null default 'Asia/Tokyo',

  -- SCR-021 チャート設定. chart_default_fx_pair_symbol is nullable: null
  -- means "no preference" (the client falls back to its own default pair).
  chart_default_fx_pair_symbol text references fx_pairs(symbol) on update cascade on delete set null,
  chart_default_timeframe text not null default '5m'
    check (chart_default_timeframe in ('1m', '5m', '15m', '30m', '60m')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_settings_set_updated_at
  before update on user_settings
  for each row
  execute function set_updated_at();

-- Same policy shape as profiles/subscriptions/entitlements (db-design.md §6):
-- the owner may SELECT, writes are service_role (the Backend) only.
alter table user_settings enable row level security;

create policy user_settings_select_own on user_settings
  for select using (user_id = auth.uid());
