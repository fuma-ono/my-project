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
-- 戻すときは、この表を drop する(他の表から参照されていない)。

create table fomc_policy_decisions (
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

create trigger trg_prevent_fomc_policy_decision_mutation
  before update or delete on fomc_policy_decisions
  for each row
  execute function prevent_fomc_policy_decision_mutation();

-- 共有の市場データと同じ(20260917000009_rls.sql): 認証済みなら SELECT 可、書き込みは service_role だけ。
alter table fomc_policy_decisions enable row level security;

create policy fomc_policy_decisions_select_authenticated on fomc_policy_decisions
  for select using (auth.role() = 'authenticated');
