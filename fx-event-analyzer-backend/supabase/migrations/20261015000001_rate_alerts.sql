-- レートアラート (notification-inbox-spec.md §7, api-design.md §24.12-§24.14,
-- db-design.md §3.18).
--
-- A user asks to be told when an FX pair's latest price goes ABOVE / BELOW
-- a target. GET /notifications (for the caller) and the job
-- `npm run jobs:evaluate-rate-alerts` (for everyone) compare each active
-- alert with the latest stored fx_prices close for its pair — the same
-- price GET /home major_fx shows. When it has crossed they insert a
-- RATE_ALERT row into notification_inbox (target_id = this id, trigger
-- 'CROSSED') and set is_active = false / triggered_at = now(). An alert
-- fires once; the user creates a new one to be told again.
--
-- The per-plan number of *active* alerts (FREE 1 / PRO 10) is enforced by
-- the Backend (src/domain/planLimits.ts rate_alerts_max), not here.

create table rate_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  fx_pair_id uuid not null references fx_pairs(id) on delete cascade,
  direction text not null check (direction in ('ABOVE', 'BELOW')),
  target_price numeric(12, 6) not null check (target_price > 0),
  is_active boolean not null default true,
  triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A fired alert is never active again.
  constraint rate_alerts_triggered_inactive check (triggered_at is null or not is_active)
);

-- GET /rate-alerts and the per-user active count.
create index idx_rate_alerts_user_id on rate_alerts(user_id, created_at);
-- The all-users job: active alerts only.
create index idx_rate_alerts_active on rate_alerts(fx_pair_id) where is_active;

create trigger trg_rate_alerts_set_updated_at
  before update on rate_alerts
  for each row
  execute function set_updated_at();

-- Same policy shape as user_settings / notification_inbox (db-design.md §6):
-- the owner may SELECT, writes are service_role (the Backend) only.
alter table rate_alerts enable row level security;

create policy rate_alerts_select_own on rate_alerts
  for select using (user_id = auth.uid());
