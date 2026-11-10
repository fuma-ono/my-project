-- 経済指標の予測値(市場予想・公式見通し)の履歴(HQ指示 2026-11-10「経済指標の市場予測値（コンセンサス）取得」)。
--
-- 取得元ごとに、取得のたびに1行を足す(上書きしない)。発表の前の最後の行を「発表前の最終予想」とし、実績値と比べる。
--   - forecast_kind: MARKET_CONSENSUS(市場の予想の集計)と OFFICIAL_PROJECTION(中央銀行・政府の見通し)を分ける。混ぜない。
--   - 発表の時刻以降に取得した値は入れられない(発表の後の「予想」は予想ではない)。
--   - release_datetime は取得した時点のイベントの発表時刻と一致しなければならない(別の回の予想を入れない)。
--   - 数値・単位・出典(source・source_url)・対象期間・取得時刻は必須。
--   - 更新はできない(DB のトリガー)。削除は service_role だけ(取得元の利用条件で消す必要が出たとき・テストの片付け)。
-- 2026-11-10 時点で、無料・商用アプリで利用可・保存と再表示が可・公式 API があり・条件が明確、をすべて満たす取得元は
-- 見つかっていない(docs は src/domain/consensusForecasts.ts の CONSENSUS_SOURCE_CANDIDATES)。この表は空のまま。
-- 戻す手順: drop view indicator_forecast_finals; drop table indicator_forecasts; drop function indicator_forecasts_guard();

create table indicator_forecasts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references economic_events(id) on delete restrict,
  indicator_code text not null,
  reference_period text not null check (reference_period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
  release_datetime timestamptz not null,
  forecast_kind text not null check (forecast_kind in ('MARKET_CONSENSUS', 'OFFICIAL_PROJECTION')),
  forecast_value numeric(18, 4) not null,
  unit text not null check (length(btrim(unit)) > 0),
  source text not null check (length(btrim(source)) > 0),
  source_url text not null check (source_url ~ '^https://'),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (fetched_at < release_datetime),
  unique (event_id, source, forecast_kind, fetched_at)
);

create index idx_indicator_forecasts_latest on indicator_forecasts(event_id, source, forecast_kind, fetched_at desc);

create or replace function indicator_forecasts_guard() returns trigger
language plpgsql
as $$
declare
  event_release timestamptz;
  event_code text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'indicator_forecasts: rows are append-only and cannot be updated (id=%)', old.id;
  end if;
  select e.release_datetime, i.code into event_release, event_code
    from economic_events e join economic_indicators i on i.id = e.indicator_id
    where e.id = new.event_id;
  if event_release is distinct from new.release_datetime then
    raise exception 'indicator_forecasts: release_datetime % does not match the event (%)', new.release_datetime, event_release;
  end if;
  if event_code is distinct from new.indicator_code then
    raise exception 'indicator_forecasts: indicator_code % does not match the event (%)', new.indicator_code, event_code;
  end if;
  return new;
end;
$$;

create trigger trg_indicator_forecasts_guard
  before insert or update on indicator_forecasts
  for each row execute function indicator_forecasts_guard();

-- 発表前の最終予想: 取得元・種類ごとに、発表の前に取得した最後の行。
create view indicator_forecast_finals with (security_invoker = true) as
select distinct on (event_id, source, forecast_kind)
  id, event_id, indicator_code, reference_period, release_datetime, forecast_kind, forecast_value, unit, source,
  source_url, fetched_at
from indicator_forecasts
where fetched_at < release_datetime
order by event_id, source, forecast_kind, fetched_at desc;

alter table indicator_forecasts enable row level security;
revoke all on table indicator_forecasts from public, anon, authenticated;
revoke all on table indicator_forecast_finals from public, anon, authenticated;
