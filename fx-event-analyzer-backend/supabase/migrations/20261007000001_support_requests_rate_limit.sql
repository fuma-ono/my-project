-- SCR-020 ヘルプ・お問い合わせ (db-design.md §3.17 v4.8, api-design.md §24.7 v1.11):
--
-- 1. 送信回数の上限 (1ユーザー1時間あたり5件) を、件数の確認と保存を
--    1つの関数で行う方式に変更する。以前はBackendが件数を数えてから
--    別のリクエストで保存していたため、同時に送られると上限を超えて
--    保存できてしまった。関数はユーザーごとのadvisory lockを取ってから
--    数えるので、同じユーザーの同時送信は順番に処理される。
--    上限に達しているときは SQLSTATE 'P0429' を返し、Backendが
--    429 RATE_LIMITED に変換する (保存しない)。
--
-- 2. classification / github_issue_* をアプリから直接読めないようにする。
--    以前の「本人のみSELECT可」のポリシーでは、Supabaseのクライアントから
--    直接読むと内部情報の列も見えていた。アプリはBackend
--    (GET /support/requests、service_role) 経由でだけ読む。

create or replace function insert_support_request(
  p_user_id uuid,
  p_kind text,
  p_category text,
  p_body text,
  p_app_version text,
  p_os_version text,
  p_device_model text,
  p_classification text,
  p_status text,
  p_reply_body text,
  p_replied_at timestamptz,
  p_max_per_hour int
)
returns table (
  id uuid,
  kind text,
  category text,
  body text,
  status text,
  reply_body text,
  replied_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_recent int;
begin
  -- Held until the transaction ends, so a concurrent call for the same user
  -- waits here and then counts this call's row.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select count(*) into v_recent
    from support_requests s
    where s.user_id = p_user_id
      and s.created_at >= now() - interval '1 hour';

  if v_recent >= p_max_per_hour then
    raise exception 'Too many support requests' using errcode = 'P0429';
  end if;

  -- Profiles are not created by a trigger (see tests/integration/setup.ts).
  insert into profiles (id) values (p_user_id) on conflict (id) do nothing;

  return query
    with inserted as (
      insert into support_requests (
        user_id, kind, category, body, app_version, os_version, device_model,
        classification, status, reply_body, replied_at
      ) values (
        p_user_id, p_kind, p_category, p_body, p_app_version, p_os_version, p_device_model,
        p_classification, p_status, p_reply_body, p_replied_at
      )
      returning support_requests.id, support_requests.kind, support_requests.category,
        support_requests.body, support_requests.status, support_requests.reply_body,
        support_requests.replied_at, support_requests.created_at
    )
    select i.id, i.kind, i.category, i.body, i.status, i.reply_body, i.replied_at, i.created_at
      from inserted i;
end;
$$;

-- service_role (the Backend) only — never callable by app users directly.
revoke all on function insert_support_request(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, int
) from public, anon, authenticated;
grant execute on function insert_support_request(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, int
) to service_role;

-- アプリからの直接アクセスをなくす。RLSは有効のまま (ポリシーなし = 全行拒否)。
drop policy if exists support_requests_select_own on support_requests;
revoke all on table support_requests from anon, authenticated;
