-- 古い購入データの再送で PRO に戻れる穴を塞ぐ(HQ指示 2026-10-27「G4: FREEからPROへの転換」の監査で判明)。
--
-- これまで apply_app_store_subscription() は、受け取った状態で subscriptions と entitlements を
-- そのまま上書きしていた。署名が正しく期限内の JWS なら、いつ署名されたものでも受け付けるため、
-- 「返金の前に保存しておいた JWS を、返金(revocationDate 付きの JWS で EXPIRED)の後に送り直す」と
-- ACTIVE に戻り、revoked_at も null に上書きされて、期限(年額なら最長1年)まで PRO を使えた。
--
-- 変更:
-- 1. subscriptions.last_signed_at: 受け付けた JWS の署名日時(signedTransaction と signedRenewalInfo の
--    signedDate の新しい方。Apple が署名した時刻で、利用者は変えられない)
-- 2. 受け取った署名日時が、保存済みの last_signed_at より古ければ何も書かない(subscriptions も
--    entitlements も、他の購入の EXPIRED 化も)。今の保存済みの状態を返す。同じ時刻は受け付ける(再送は冪等)
-- 3. 保存済みの revoked_at があり、同じ取引(last_transaction_id)の取り消しなしの状態が来たら、
--    署名日時に関係なく書かない(この migration より前に保存された返金の行は last_signed_at が null のため)
--
-- 引数 p_signed_at を末尾に既定値 null で足す。PostgREST は名前で引数を渡すので、
-- この migration の後なら、p_signed_at を渡さない古い Backend も今までどおり動く(順序の確認をしないだけ)。
-- **適用の順序: この migration → Backend のデプロイ**(新しい Backend は p_signed_at を渡すので、
-- migration が無いと「関数が無い」エラーで POST /subscription/verify が 500 になる)。
-- 既存の行は last_signed_at が null のまま。次に検証したときに入る(null の行は 2 の確認をしない)。

alter table subscriptions add column if not exists last_signed_at timestamptz;

comment on column subscriptions.last_signed_at is
  '最後に受け付けた App Store の JWS の署名日時(signedDate)。これより古い JWS は反映しない(古い購入データの再送の防止)';

drop function apply_app_store_subscription(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, text[]
);

create function apply_app_store_subscription(
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
  p_pro_feature_codes text[],
  p_signed_at timestamptz default null
)
returns table (plan text, status text, started_at timestamptz, expires_at timestamptz, product_id text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_owner uuid;
  v_last_signed_at timestamptz;
  v_last_transaction_id text;
  v_revoked_at timestamptz;
  v_entitled boolean;
begin
  select s.user_id, s.last_signed_at, s.last_transaction_id, s.revoked_at
    into v_owner, v_last_signed_at, v_last_transaction_id, v_revoked_at
    from subscriptions s
    where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id
    for update;

  if v_owner is not null and v_owner <> p_user_id then
    raise exception 'App Store subscription belongs to another user' using errcode = 'P0409';
  end if;

  -- 古い JWS(2)・取り消し済みの取引の取り消しなしの状態(3): 何も書かずに今の状態を返す。
  if v_owner is not null and (
    (p_signed_at is not null and v_last_signed_at is not null and p_signed_at < v_last_signed_at)
    or (v_revoked_at is not null and p_revoked_at is null and p_transaction_id = v_last_transaction_id)
  ) then
    return query
      select s.plan, s.status, s.started_at, s.expires_at, s.product_id
        from subscriptions s
        where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id;
    return;
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
      last_transaction_id, auto_renew, revoked_at, started_at, expires_at, last_verified_at, last_signed_at
    ) values (
      p_user_id, 'PRO', p_status, 'APP_STORE', p_original_transaction_id, p_product_id, p_environment,
      p_transaction_id, p_auto_renew, p_revoked_at, p_started_at, p_expires_at, now(), p_signed_at
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
          last_verified_at = now(),
          last_signed_at = coalesce(p_signed_at, s.last_signed_at)
      where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id;
  end if;

  -- CANCELED keeps PRO until expires_at (api-design.md §26); EXPIRED loses it.
  v_entitled := p_status in ('ACTIVE', 'CANCELED', 'TRIAL') and (p_expires_at is null or p_expires_at > now());

  insert into entitlements (user_id, feature_code, enabled, expires_at)
    select p_user_id, code, v_entitled, p_expires_at from unnest(p_pro_feature_codes) as code
    on conflict (user_id, feature_code) do update
      set enabled = excluded.enabled, expires_at = excluded.expires_at;

  return query
    select s.plan, s.status, s.started_at, s.expires_at, s.product_id
      from subscriptions s
      where s.provider = 'APP_STORE' and s.provider_subscription_id = p_original_transaction_id;
end;
$$;

-- service_role (the Backend) only — never callable by app users directly.
revoke all on function apply_app_store_subscription(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, text[], timestamptz
) from public, anon, authenticated;
grant execute on function apply_app_store_subscription(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, text[], timestamptz
) to service_role;
