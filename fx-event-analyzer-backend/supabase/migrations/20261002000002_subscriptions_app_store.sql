-- db-design.md §3.2 追記 (HQ確定 2026-10-02): StoreKit 2 purchase
-- verification (POST /subscription/verify, api-design.md §25.1).
--
-- provider_subscription_id holds the App Store originalTransactionId — the
-- id that stays the same across every renewal / plan change within one
-- Subscription Group, so one App Store subscription is always one row.
-- The new columns are the minimum needed to re-derive state later when App
-- Store Server API / App Store Server Notifications are added (not in MVP).

alter table subscriptions
  add column product_id text,
  add column provider_environment text check (provider_environment in ('Production', 'Sandbox')),
  add column last_transaction_id text,
  add column auto_renew boolean,
  add column revoked_at timestamptz,
  add column last_verified_at timestamptz;

-- One App Store subscription can only ever belong to one user: a second
-- account presenting the same originalTransactionId is rejected (409), not
-- silently re-assigned.
create unique index uq_subscriptions_provider_subscription
  on subscriptions(provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- Applies one verified App Store transaction atomically: upserts the
-- subscription row, retires any other ACTIVE row of the same user (the
-- one-ACTIVE-per-user index would otherwise reject the write), and syncs
-- the PRO-only entitlements (api-design.md §28) to the subscription's
-- validity. Done in one function so a partial failure can never leave a
-- PRO subscription without its entitlements or vice versa.
--
-- Raises SQLSTATE 'P0409' when the subscription already belongs to another
-- user; the Backend maps that to 409 CONFLICT.
create or replace function apply_app_store_subscription(
  p_user_id uuid,
  p_original_transaction_id text,
  p_transaction_id text,
  p_product_id text,
  p_environment text,
  p_status text,
  p_started_at timestamptz,
  p_expires_at timestamptz,
  p_auto_renew boolean,
  p_revoked_at timestamptz,
  p_pro_feature_codes text[]
)
returns table (plan text, status text, started_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_owner uuid;
  v_entitled boolean;
begin
  select s.user_id into v_owner
    from subscriptions s
    where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id
    for update;

  if v_owner is not null and v_owner <> p_user_id then
    raise exception 'App Store subscription belongs to another user' using errcode = 'P0409';
  end if;

  -- Profiles are not created by a trigger (see tests/integration/setup.ts);
  -- make sure the FK target exists for users who never hit PATCH /account.
  insert into profiles (id) values (p_user_id) on conflict (id) do nothing;

  if p_status = 'ACTIVE' then
    update subscriptions s
      set status = 'EXPIRED'
      where s.user_id = p_user_id
        and s.status = 'ACTIVE'
        and s.provider_subscription_id is distinct from p_original_transaction_id;
  end if;

  if v_owner is null then
    insert into subscriptions (
      user_id, plan, status, provider, provider_subscription_id, product_id, provider_environment,
      last_transaction_id, auto_renew, revoked_at, started_at, expires_at, last_verified_at
    ) values (
      p_user_id, 'PRO', p_status, 'APP_STORE', p_original_transaction_id, p_product_id, p_environment,
      p_transaction_id, p_auto_renew, p_revoked_at, p_started_at, p_expires_at, now()
    );
  else
    update subscriptions s
      set plan = 'PRO',
          status = p_status,
          product_id = p_product_id,
          provider_environment = p_environment,
          last_transaction_id = p_transaction_id,
          auto_renew = p_auto_renew,
          revoked_at = p_revoked_at,
          started_at = p_started_at,
          expires_at = p_expires_at,
          last_verified_at = now()
      where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id;
  end if;

  -- CANCELED keeps PRO until expires_at (api-design.md §26); EXPIRED loses it.
  v_entitled := p_status in ('ACTIVE', 'CANCELED', 'TRIAL') and (p_expires_at is null or p_expires_at > now());

  insert into entitlements (user_id, feature_code, enabled, expires_at)
    select p_user_id, code, v_entitled, p_expires_at from unnest(p_pro_feature_codes) as code
    on conflict (user_id, feature_code) do update
      set enabled = excluded.enabled, expires_at = excluded.expires_at;

  return query
    select s.plan, s.status, s.started_at, s.expires_at
      from subscriptions s
      where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id;
end;
$$;

-- service_role (the Backend) only — never callable by app users directly.
revoke all on function apply_app_store_subscription(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, text[]
) from public, anon, authenticated;
grant execute on function apply_app_store_subscription(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, text[]
) to service_role;
