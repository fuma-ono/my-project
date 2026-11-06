#!/usr/bin/env bash
# migration 20261105000001_fomc_policy_decisions.sql を「何度流しても安全」かを、CI のローカルの Supabase(supabase db reset の後)で
# 確かめる(HQ指示 2026-11-06「DEV反映準備の修正候補」)。DEV には接続しない。
#
#   check-fomc-policy-migration-rerun.sh <postgres の接続文字列>
#
# どの場面も BEGIN … ROLLBACK の中で行うので、終わった後の DB は db reset の直後と同じ(後の結合テストに影響しない)。
#   1. 適用済みの DB にもう一度流す → 成功し、制約・トリガー・ポリシー・RLS の定義が変わらない
#   2. 行がある状態でもう一度流す → 成功し、行が残る
#   3. 一部だけ適用・前の版が適用された状態(トリガー・CHECK 制約が無い、RLS が無効、前の版の「認証済みなら SELECT 可」の
#      ポリシーがある、authenticated に SELECT がある)で流す → 足りないものが戻り、ポリシーは消え、権限は外れる
#   4. 列の形が違う表(source が NULL 可)に流す → 例外で止まる(列を変えない)
#   5. anon / authenticated / PUBLIC に権限が足されている → 外れる(HQ指示 2026-11-06「政策金利テーブルの権限問題」)
#   6. 同じ名前で中身の違う CHECK 制約がある → 例外で止まる
#   7. 期待していないポリシーが足されている → 例外で止まる(黙って消さない)
#   8. service_role の権限が外されている → SELECT・INSERT が戻る
set -euo pipefail

db="${1:?postgres connection string}"
here="$(cd "$(dirname "$0")/.." && pwd)"
migration="$here/supabase/migrations/20261105000001_fomc_policy_decisions.sql"
us_fomc='10000000-0000-0000-0000-000000000003' # seed.sql の US_FOMC

psql_run() { psql "$db" -v ON_ERROR_STOP=1 -X -q "$@"; }

# psql が失敗したら、その出力を注記(::error::)に出す(CI のログ本文を読めなくても原因が分かるように)。
fail_with_output() {
  local name="$1"
  while IFS= read -r line; do echo "::error title=$name::$line"; done < /tmp/rerun.out
  exit 1
}

state() {
  if ! psql_run -At >/tmp/rerun.state 2>/tmp/rerun.out <<'SQL'; then
select 'constraint ' || conname::text || ' ' || pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.fomc_policy_decisions'::regclass
union all
select 'trigger ' || tgname::text || ' ' || tgtype::text || ' ' || tgenabled::text || ' ' || tgfoid::regprocedure::text from pg_trigger
  where tgrelid = 'public.fomc_policy_decisions'::regclass and not tgisinternal
union all
select 'policy ' || policyname::text || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') from pg_policies
  where tablename = 'fomc_policy_decisions'
union all
select 'rls ' || relrowsecurity::text from pg_class where oid = 'public.fomc_policy_decisions'::regclass
union all
select 'privilege ' || r || ' ' || priv || ' ' || has_table_privilege(r, 'public.fomc_policy_decisions', priv)::text
  from unnest(array['anon', 'authenticated', 'service_role']) as r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as priv
order by 1;
SQL
    fail_with_output "reading the definitions"
  fi
}

expect_ok() {
  local name="$1" sql="$2"
  if ! printf '%s\n' "$sql" | psql_run >/tmp/rerun.out 2>&1; then
    echo "::error::$name: expected success"
    fail_with_output "$name"
  fi
  echo "ok: $name"
}

expect_fail() {
  local name="$1" message="$2" sql="$3"
  if printf '%s\n' "$sql" | psql_run >/tmp/rerun.out 2>&1; then
    echo "::error::$name: expected the migration to stop"
    fail_with_output "$name"
  fi
  if ! grep -q "$message" /tmp/rerun.out; then
    echo "::error::$name: stopped, but not with \"$message\""
    fail_with_output "$name"
  fi
  echo "ok: $name (stopped: $message)"
}

# state は $(…) の中で呼ばない(失敗の注記が変数に吸われて CI に出なくなるため)。結果は /tmp/rerun.state。
state; cp /tmp/rerun.state /tmp/rerun.before
[ -s /tmp/rerun.before ] || { echo "::error::fomc_policy_decisions is not there after db reset"; exit 1; }

# 1. もう一度流す(2回)
expect_ok "re-run on an applied DB" "begin;
\\i '$migration'
\\i '$migration'
rollback;"
state
if ! diff /tmp/rerun.before /tmp/rerun.state > /tmp/rerun.out; then
  echo "::error::re-running changed the definitions"
  fail_with_output "definitions changed"
fi

# 2. 行がある状態でもう一度流す → 行が残る
expect_ok "re-run keeps existing rows" "begin;
insert into economic_events (id, indicator_id, provider, provider_event_id, release_datetime, release_datetime_precision, importance, status, data_status)
  values ('3f000000-0000-0000-0000-0000000000f1', '$us_fomc', 'rerun-check', 'rerun-check-1', '2019-07-31T18:00:00Z', 'EXACT', 'HIGH', 'SCHEDULED', 'PENDING');
insert into fomc_policy_decisions (event_id, target_range_lower, target_range_upper, announced_at, effective_date, source, source_url, fetched_at)
  values ('3f000000-0000-0000-0000-0000000000f1', 2, 2.25, '2019-07-31T18:00:00Z', '2019-08-01', 'check', 'https://example.invalid', '2019-08-02T00:00:00Z');
\\i '$migration'
do \$\$ begin
  if (select count(*) from fomc_policy_decisions where event_id = '3f000000-0000-0000-0000-0000000000f1') <> 1 then
    raise exception 'the existing row is gone';
  end if;
end \$\$;
rollback;"

# 3. 一部だけ適用された状態 → 足りないものだけ戻る
expect_ok "re-run restores the trigger, check and RLS, drops the old policy and revokes the old grant" "begin;
drop trigger trg_prevent_fomc_policy_decision_mutation on fomc_policy_decisions;
alter table fomc_policy_decisions drop constraint fomc_policy_decisions_range_check;
alter table fomc_policy_decisions disable row level security;
create policy fomc_policy_decisions_select_authenticated on fomc_policy_decisions for select using (auth.role() = 'authenticated');
grant select on fomc_policy_decisions to authenticated;
\\i '$migration'
do \$\$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fomc_policy_decisions'::regclass and tgname = 'trg_prevent_fomc_policy_decision_mutation') then raise exception 'trigger not restored'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.fomc_policy_decisions'::regclass and conname = 'fomc_policy_decisions_range_check') then raise exception 'check not restored'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.fomc_policy_decisions'::regclass) then raise exception 'RLS not restored'; end if;
  if exists (select 1 from pg_policies where tablename = 'fomc_policy_decisions') then raise exception 'the old policy is left'; end if;
  if has_table_privilege('authenticated', 'public.fomc_policy_decisions', 'SELECT') then raise exception 'authenticated can still SELECT'; end if;
end \$\$;
rollback;"

# 4〜7. 形の違う表には手を入れずに止まる
expect_fail "a different column stops the migration" "columns differ" "begin;
alter table fomc_policy_decisions alter column source drop not null;
\\i '$migration'
rollback;"

expect_ok "re-run revokes grants given to anon, authenticated and PUBLIC" "begin;
grant select on fomc_policy_decisions to anon;
grant all on fomc_policy_decisions to authenticated;
grant select on fomc_policy_decisions to public;
\\i '$migration'
do \$\$ declare r text; priv text; begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.fomc_policy_decisions', priv) then raise exception '% still has %', r, priv; end if;
    end loop;
  end loop;
end \$\$;
rollback;"

expect_ok "re-run gives service_role SELECT and INSERT back" "begin;
revoke all on fomc_policy_decisions from service_role;
\\i '$migration'
do \$\$ begin
  if not has_table_privilege('service_role', 'public.fomc_policy_decisions', 'SELECT') then raise exception 'service_role cannot SELECT'; end if;
  if not has_table_privilege('service_role', 'public.fomc_policy_decisions', 'INSERT') then raise exception 'service_role cannot INSERT'; end if;
end \$\$;
rollback;"

expect_fail "a different check constraint stops the migration" "constraint fomc_policy_decisions_range_check differs" "begin;
alter table fomc_policy_decisions drop constraint fomc_policy_decisions_range_check;
alter table fomc_policy_decisions add constraint fomc_policy_decisions_range_check check (target_range_upper > target_range_lower);
\\i '$migration'
rollback;"

expect_fail "an extra policy stops the migration" "unexpected policies" "begin;
create policy fomc_policy_decisions_write_all on fomc_policy_decisions for all using (true);
\\i '$migration'
rollback;"

state
if ! diff /tmp/rerun.before /tmp/rerun.state > /tmp/rerun.out; then
  echo "::error::the DB was left changed"
  fail_with_output "DB left changed"
fi
echo "fomc_policy_decisions migration: re-run checks passed"
