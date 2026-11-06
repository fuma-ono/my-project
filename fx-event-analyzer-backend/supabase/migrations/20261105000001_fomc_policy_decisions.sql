-- FOMC の政策決定(フェデラルファンド金利の誘導目標レンジ)を入れる専用の表
-- (HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A)。
--
-- 1行 = 1回の FOMC 会合(economic_events の US_FOMC の行、provider 'fomc_schedule')の決定。
-- 値は NY連銀の Markets Data API(/api/rates/unsecured/effr/search.json)の targetRateFrom(下限)・
-- targetRateTo(上限)を、そのまま別々の列に入れる(1つの金利に変換しない)。同じ応答の percentRate
-- (EFFR = 実際の取引の加重中央値)は誘導目標ではないので入れない。
--
-- 会合への結びつけ(src/ingestion/pipelines/fomcPolicyRates.ts): 発表日(ニューヨークの日付)より後の、最初の
-- effectiveDate の目標レンジ(新しいレンジは発表の翌営業日から有効になる。2026-09-16 の発表 → 09-17 から
-- 3.75〜4.00 を API で確認)。その日の値は翌営業日の 9:00 ごろ公開されるので、それまでは行を作らない
-- (economic_events は変えず、data_status は PENDING のまま)。
--
-- 値は書いたら変えない・消さない(下のトリガー)。同じ会合は1行だけ(event_id の一意制約)。
-- economic_events・event_snapshots には何も書かない(既存の列の意味を変えない)。
--
-- 何度流しても安全にする(HQ指示 2026-11-06「DEV反映準備の修正候補」。DEV には SQL Editor で手で流すため):
-- - 表が無ければ作る。表があれば作り直さない・列を足さない・型を変えない・行を消さない。
-- - 表があるのに列・型・NOT NULL・既定値が期待と違えば、例外で止める(列の確認は表に手を入れる前に行う)。
--   supabase の migration は1つのトランザクションで流れるので、途中で止まれば全部戻る。SQL Editor で手で流すときも、
--   全体を BEGIN; … COMMIT; で囲んで流す(途中で止まったら ROLLBACK; で何も変わらない)。
--   「同じ名前の表があるから OK」とはしない。
-- - 制約・トリガー・RLS・ポリシーは、名前で見て無いものだけ足す。同じ名前があって中身が違えば例外で止める
--   (勝手に作り直さない)。足すときに既存の行が制約に合わなければ、ADD CONSTRAINT 自体が失敗して止まる(行は消さない)。
-- - 関数は CREATE OR REPLACE(中身は常に同じ)。COMMENT ON は何度でも同じ。
-- - 最後に、全部がそろっていることを確かめる(そろわなければ例外)。
-- 期待どおりかの比べ方: 同じ定義の一時表(pg_temp、このセッションだけ)を作り、列・制約の定義の文字列を突き合わせる
-- (PostgreSQL が出す正規化された定義どうしを比べるので、空白・括弧・型の書き方の違いに左右されない)。
--
-- 戻し方(API のコードを先に戻すこと。戻さずにこの表を消すと、GET /events/{id} が FOMC の会合で 500 になる —
-- routes/events.ts の getFomcPolicyDecision がこの表を読む): docs/projects/fx-event-analyzer/dev-environment.md
-- 15.3 節。他の表からこの表への参照は無い。

create table if not exists fomc_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  -- 対象の FOMC 会合(US_FOMC の economic_events の行)。同じ会合は1行だけ。
  event_id uuid not null unique references economic_events(id) on delete restrict,
  -- 誘導目標レンジの下限・上限(%)。NY連銀の targetRateFrom・targetRateTo のまま。
  target_range_lower numeric(6, 4) not null,
  target_range_upper numeric(6, 4) not null,
  -- 政策の発表日時(会合の予定の release_datetime と同じ。FRB の声明の公表、ニューヨーク 14:00)。
  announced_at timestamptz not null,
  -- 新しいレンジが有効になった日(NY連銀の effectiveDate。ニューヨークの日付)。
  effective_date date not null,
  -- 取得元(表示用の名前・取得した API の URL)と取得日時。
  source text not null,
  source_url text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint fomc_policy_decisions_range_check
    check (target_range_lower >= 0 and target_range_upper > target_range_lower and target_range_upper <= 25),
  constraint fomc_policy_decisions_effective_after_announcement
    check (effective_date > (announced_at at time zone 'America/New_York')::date)
);

-- 期待する形(比べるためだけの一時表。外部キーは一時表から永続の表へ張れないので、外部キーは下で個別に比べる)。
drop table if exists pg_temp.fomc_policy_decisions_expected;
create temp table fomc_policy_decisions_expected (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  target_range_lower numeric(6, 4) not null,
  target_range_upper numeric(6, 4) not null,
  announced_at timestamptz not null,
  effective_date date not null,
  source text not null,
  source_url text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint fomc_policy_decisions_range_check
    check (target_range_lower >= 0 and target_range_upper > target_range_lower and target_range_upper <= 25),
  constraint fomc_policy_decisions_effective_after_announcement
    check (effective_date > (announced_at at time zone 'America/New_York')::date)
);

do $$
declare
  actual_columns text;
  expected_columns text;
  missing_or_different text;
  expected_def text;
  actual_def text;
  c record;
begin
  -- 1. 列(名前・型・NOT NULL・既定値・順番)が期待どおりか。違えば何も変えずに止める。
  select string_agg(format('%s %s %s %s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                           coalesce(pg_get_expr(d.adbin, d.adrelid), '')), ', ' order by a.attnum)
    into actual_columns
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.fomc_policy_decisions'::regclass and a.attnum > 0 and not a.attisdropped;
  select string_agg(format('%s %s %s %s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                           coalesce(pg_get_expr(d.adbin, d.adrelid), '')), ', ' order by a.attnum)
    into expected_columns
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'pg_temp.fomc_policy_decisions_expected'::regclass and a.attnum > 0 and not a.attisdropped;
  if actual_columns is distinct from expected_columns then
    raise exception 'fomc_policy_decisions: columns differ from this migration (stopped). actual: % / expected: %',
      actual_columns, expected_columns;
  end if;

  -- 2. 主キー・一意・CHECK: 同じ名前のものが無ければ足す(既存の行が合わなければ ADD 自体が失敗して止まる)。
  --    同じ名前で中身が違えば止める。
  for c in
    select replace(conname, 'fomc_policy_decisions_expected', 'fomc_policy_decisions') as name,
           pg_get_constraintdef(oid) as def
      from pg_constraint where conrelid = 'pg_temp.fomc_policy_decisions_expected'::regclass
  loop
    select pg_get_constraintdef(oid) into actual_def
      from pg_constraint where conrelid = 'public.fomc_policy_decisions'::regclass and conname = c.name;
    if actual_def is null then
      execute format('alter table public.fomc_policy_decisions add constraint %I %s', c.name, c.def);
      raise notice 'fomc_policy_decisions: added missing constraint %', c.name;
    elsif actual_def <> c.def then
      raise exception 'fomc_policy_decisions: constraint % differs (stopped). actual: % / expected: %',
        c.name, actual_def, c.def;
    end if;
  end loop;

  -- 3. 外部キー(会合の行。会合の行を消せないようにする)。
  expected_def := 'FOREIGN KEY (event_id) REFERENCES economic_events(id) ON DELETE RESTRICT';
  select pg_get_constraintdef(oid) into actual_def
    from pg_constraint where conrelid = 'public.fomc_policy_decisions'::regclass and conname = 'fomc_policy_decisions_event_id_fkey';
  if actual_def is null then
    alter table public.fomc_policy_decisions
      add constraint fomc_policy_decisions_event_id_fkey foreign key (event_id) references economic_events(id) on delete restrict;
    raise notice 'fomc_policy_decisions: added missing constraint fomc_policy_decisions_event_id_fkey';
  elsif actual_def <> expected_def then
    raise exception 'fomc_policy_decisions: constraint fomc_policy_decisions_event_id_fkey differs (stopped). actual: % / expected: %',
      actual_def, expected_def;
  end if;

  -- 4. 期待していない制約があれば止める(誰かが別の制約を足した表を、この migration の表として扱わない)。
  select string_agg(conname, ', ') into missing_or_different
    from pg_constraint
    where conrelid = 'public.fomc_policy_decisions'::regclass
      and conname not in (select replace(conname, 'fomc_policy_decisions_expected', 'fomc_policy_decisions')
                            from pg_constraint where conrelid = 'pg_temp.fomc_policy_decisions_expected'::regclass)
      and conname <> 'fomc_policy_decisions_event_id_fkey';
  if missing_or_different is not null then
    raise exception 'fomc_policy_decisions: unexpected constraints % (stopped)', missing_or_different;
  end if;
end;
$$;

drop table pg_temp.fomc_policy_decisions_expected;

comment on table fomc_policy_decisions is
  'FOMC の政策決定(誘導目標レンジ)。NY連銀 Markets Data API の targetRateFrom/targetRateTo。値は不変(trg_prevent_fomc_policy_decision_mutation)。';
comment on column fomc_policy_decisions.target_range_lower is 'NY連銀の targetRateFrom(誘導目標レンジの下限、%)。';
comment on column fomc_policy_decisions.target_range_upper is 'NY連銀の targetRateTo(誘導目標レンジの上限、%)。';
comment on column fomc_policy_decisions.effective_date is 'NY連銀の effectiveDate(このレンジが有効になった最初の日、ニューヨークの日付)。';

create or replace function prevent_fomc_policy_decision_mutation()
returns trigger as $$
begin
  raise exception 'fomc_policy_decisions: a recorded decision is immutable (event_id=%)', old.event_id;
end;
$$ language plpgsql;

-- トリガー・RLS・ポリシー: 無ければ足す。あって中身が違えば止める(消して作り直さない — その間に書き込めてしまうため)。
do $$
declare
  t record;
  p record;
begin
  select tgenabled, tgtype, tgfoid::regprocedure::text as func into t
    from pg_trigger
    where tgrelid = 'public.fomc_policy_decisions'::regclass and tgname = 'trg_prevent_fomc_policy_decision_mutation';
  if not found then
    create trigger trg_prevent_fomc_policy_decision_mutation
      before update or delete on fomc_policy_decisions
      for each row
      execute function prevent_fomc_policy_decision_mutation();
    raise notice 'fomc_policy_decisions: added missing trigger trg_prevent_fomc_policy_decision_mutation';
  -- tgtype 27 = ROW(1) + BEFORE(2) + DELETE(8) + UPDATE(16)。tgenabled 'O' = 有効。
  elsif t.tgtype <> 27 or t.tgenabled <> 'O' or t.func <> 'prevent_fomc_policy_decision_mutation()' then
    raise exception 'fomc_policy_decisions: trigger trg_prevent_fomc_policy_decision_mutation differs (type %, enabled %, function %) — stopped',
      t.tgtype, t.tgenabled, t.func;
  end if;

  -- 共有の市場データと同じ(20260917000009_rls.sql): 認証済みなら SELECT 可、書き込みは service_role だけ。
  alter table public.fomc_policy_decisions enable row level security;

  select cmd, permissive, roles::text as roles, qual, with_check into p
    from pg_policies
    where schemaname = 'public' and tablename = 'fomc_policy_decisions' and policyname = 'fomc_policy_decisions_select_authenticated';
  if not found then
    create policy fomc_policy_decisions_select_authenticated on fomc_policy_decisions
      for select using (auth.role() = 'authenticated');
    raise notice 'fomc_policy_decisions: added missing policy fomc_policy_decisions_select_authenticated';
  elsif p.cmd <> 'SELECT' or p.permissive <> 'PERMISSIVE' or p.roles <> '{public}'
        or p.qual <> '(auth.role() = ''authenticated''::text)' or p.with_check is not null then
    raise exception 'fomc_policy_decisions: policy fomc_policy_decisions_select_authenticated differs (cmd %, roles %, qual %) — stopped',
      p.cmd, p.roles, p.qual;
  end if;

  -- 期待していないポリシー(書き込みを許すものなど)があれば止める。
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fomc_policy_decisions'
               and policyname <> 'fomc_policy_decisions_select_authenticated') then
    raise exception 'fomc_policy_decisions: unexpected policies exist (stopped)';
  end if;
end;
$$;
