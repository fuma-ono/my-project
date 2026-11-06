#!/usr/bin/env bash
# migration 20261105000001_fomc_policy_decisions.sql を「何度流しても安全」かを、CI のローカルの Supabase(supabase db reset の後)で
# 確かめる(HQ指示 2026-11-06「DEV反映準備の修正候補」)。DEV には接続しない。
#
#   check-fomc-policy-migration-rerun.sh <postgres の接続文字列>
#
# どの場面も BEGIN … ROLLBACK の中で行うので、終わった後の DB は db reset の直後と同じ(後の結合テストに影響しない)。
#   1. 適用済みの DB にもう一度流す → 成功し、制約・トリガー・ポリシー・RLS の定義が変わらない
#   2. 行がある状態でもう一度流す → 成功し、行が残る
#   3. 一部だけ適用された状態(トリガー・ポリシー・CHECK 制約が無い、RLS が無効)で流す → 足りないものだけ戻る
#   4. 列の形が違う表(source が NULL 可)に流す → 例外で止まる(列を変えない)
#   5. 同じ名前で中身の違うポリシー(書き込みも許す)がある → 例外で止まる
#   6. 同じ名前で中身の違う CHECK 制約がある → 例外で止まる
#   7. 期待していないポリシーが足されている → 例外で止まる
set -euo pipefail

db="${1:?postgres connection string}"
here="$(cd "$(dirname "$0")/.." && pwd)"
migration="$here/supabase/migrations/20261105000001_fomc_policy_decisions.sql"
us_fomc='10000000-0000-0000-0000-000000000003' # seed.sql の US_FOMC

psql_run() { psql "$db" -v ON_ERROR_STOP=1 -X -q "$@"; }

state() {
  psql_run -At <<'SQL'
select 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.fomc_policy_decisions'::regclass
union all
select 'trigger ' || tgname || ' ' || tgtype || ' ' || tgenabled || ' ' || tgfoid::regprocedure::text from pg_trigger
  where tgrelid = 'public.fomc_policy_decisions'::regclass and not tgisinternal
union all
select 'policy ' || policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') from pg_policies
  where tablename = 'fomc_policy_decisions'
union all
select 'rls ' || relrowsecurity from pg_class where oid = 'public.fomc_policy_decisions'::regclass
order by 1;
SQL
}

expect_ok() {
  local name="$1" sql="$2"
  if ! printf '%s\n' "$sql" | psql_run >/tmp/rerun.out 2>&1; then
    cat /tmp/rerun.out
    echo "::error::$name: expected success"
    exit 1
  fi
  echo "ok: $name"
}

expect_fail() {
  local name="$1" message="$2" sql="$3"
  if printf '%s\n' "$sql" | psql_run >/tmp/rerun.out 2>&1; then
    cat /tmp/rerun.out
    echo "::error::$name: expected the migration to stop"
    exit 1
  fi
  if ! grep -q "$message" /tmp/rerun.out; then
    cat /tmp/rerun.out
    echo "::error::$name: stopped, but not with \"$message\""
    exit 1
  fi
  echo "ok: $name (stopped: $message)"
}

before="$(state)"
[ -n "$before" ] || { echo "::error::fomc_policy_decisions is not there after db reset"; exit 1; }

# 1. もう一度流す(2回)
expect_ok "re-run on an applied DB" "begin;
\\i '$migration'
\\i '$migration'
rollback;"
after="$(state)"
if [ "$before" != "$after" ]; then
  diff <(echo "$before") <(echo "$after") || true
  echo "::error::re-running changed the definitions"
  exit 1
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
expect_ok "re-run restores missing trigger, policy, check and RLS" "begin;
drop trigger trg_prevent_fomc_policy_decision_mutation on fomc_policy_decisions;
drop policy fomc_policy_decisions_select_authenticated on fomc_policy_decisions;
alter table fomc_policy_decisions drop constraint fomc_policy_decisions_range_check;
alter table fomc_policy_decisions disable row level security;
\\i '$migration'
do \$\$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fomc_policy_decisions'::regclass and tgname = 'trg_prevent_fomc_policy_decision_mutation') then raise exception 'trigger not restored'; end if;
  if not exists (select 1 from pg_policies where tablename = 'fomc_policy_decisions' and policyname = 'fomc_policy_decisions_select_authenticated') then raise exception 'policy not restored'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.fomc_policy_decisions'::regclass and conname = 'fomc_policy_decisions_range_check') then raise exception 'check not restored'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.fomc_policy_decisions'::regclass) then raise exception 'RLS not restored'; end if;
end \$\$;
rollback;"

# 4〜7. 形の違う表には手を入れずに止まる
expect_fail "a different column stops the migration" "columns differ" "begin;
alter table fomc_policy_decisions alter column source drop not null;
\\i '$migration'
rollback;"

expect_fail "a different policy stops the migration" "policy fomc_policy_decisions_select_authenticated differs" "begin;
drop policy fomc_policy_decisions_select_authenticated on fomc_policy_decisions;
create policy fomc_policy_decisions_select_authenticated on fomc_policy_decisions for all using (true);
\\i '$migration'
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

final="$(state)"
[ "$before" = "$final" ] || { echo "::error::the DB was left changed"; exit 1; }
echo "fomc_policy_decisions migration: re-run checks passed"
