-- db-design.md v4.2 §6 RLS方針, applied verbatim. RLS is defense-in-depth
-- here, not the primary access-control layer — the Backend API's own
-- Authorization (JWT -> user_id -> Entitlement check, api-design.md
-- §2.3.1) is the primary boundary and connects via service_role, which
-- bypasses RLS entirely. These policies matter if anything ever queries
-- Postgres directly as an authenticated (non-service_role) user — Phase 2
-- instruction §18 explicitly forbids the iOS client ever doing that, but
-- the policies stand regardless as the documented, enforced fallback.

alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table entitlements enable row level security;
alter table economic_indicators enable row level security;
alter table economic_events enable row level security;
alter table event_snapshots enable row level security;
alter table event_revisions enable row level security;
alter table event_explanations enable row level security;
alter table indicator_fx_pairs enable row level security;
alter table fx_pairs enable row level security;
alter table fx_prices enable row level security;
alter table event_price_reactions enable row level security;
alter table ingestion_logs enable row level security;

-- User-specific: auth.uid() owns the row for SELECT. INSERT/UPDATE/DELETE
-- has no policy here, so only service_role (which bypasses RLS) can write
-- — matching db-design.md §6 "本人のみSELECT可。INSERT/UPDATE/DELETEは
-- service_roleのみ".
create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy subscriptions_select_own on subscriptions
  for select using (user_id = auth.uid());

create policy entitlements_select_own on entitlements
  for select using (user_id = auth.uid());

-- Shared market data: any authenticated user may SELECT; writes are
-- service_role only (Ingestion Worker / admin tooling), matching
-- db-design.md §6 "ユーザー単位のRLSを前提とせず、原則として全認証ユーザー
-- からSELECT可能".
create policy economic_indicators_select_authenticated on economic_indicators
  for select using (auth.role() = 'authenticated');

create policy economic_events_select_authenticated on economic_events
  for select using (auth.role() = 'authenticated');

create policy event_snapshots_select_authenticated on event_snapshots
  for select using (auth.role() = 'authenticated');

create policy event_revisions_select_authenticated on event_revisions
  for select using (auth.role() = 'authenticated');

create policy event_explanations_select_authenticated on event_explanations
  for select using (auth.role() = 'authenticated');

create policy indicator_fx_pairs_select_authenticated on indicator_fx_pairs
  for select using (auth.role() = 'authenticated');

create policy fx_pairs_select_authenticated on fx_pairs
  for select using (auth.role() = 'authenticated');

create policy fx_prices_select_authenticated on fx_prices
  for select using (auth.role() = 'authenticated');

create policy event_price_reactions_select_authenticated on event_price_reactions
  for select using (auth.role() = 'authenticated');

-- ingestion_logs: no policy at all — not even authenticated SELECT.
-- db-design.md §6 "一般ユーザーからは非公開。管理者機能・service_roleのみ
-- アクセス可". RLS being enabled with zero policies denies all access to
-- non-service_role roles by default.
