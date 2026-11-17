-- Strategy Analysis 第1段階: DEV の実データの確認(読み取り専用。HQ指示 2026-11-17)
--
-- **未実行・構文未検証**。DEV の読み取り権限がある人が、SQL Editor などで実行する(SELECT だけ。書き込み・DDL なし)。
-- **本番(PROD)では実行しない。** 結果に値・個人情報は含まれない(件数・分布だけ)。
-- 目的: (1) fx_prices・event_price_reactions の件数 (2) event_snapshots の欠損 (3) イベント別の分析可能サンプル数
--       (4) 値動きの分類の閾値(pullback_min_ratio)を決めるための、通貨ペアごとの戻し率の分布
-- サンプルが少ないうちは閾値を確定しない(各通貨ペアで、下の (4) の n が十分に大きいことを確かめてから決める)。

-- (1) fx_prices のペア別・時間足別の件数と期間
select p.symbol, f.timeframe, count(*) as candles, min(f."timestamp") as first_candle, max(f."timestamp") as last_candle,
       count(*) filter (where f.verification_status = 'UNVERIFIED') as unverified
from fx_prices f join fx_pairs p on p.id = f.fx_pair_id
group by p.symbol, f.timeframe
order by p.symbol, f.timeframe;

-- (2) event_price_reactions のペア別・時間足別の件数(data_status 別)
select p.symbol, r.timeframe, r.data_status, count(*) as reactions
from event_price_reactions r join fx_pairs p on p.id = r.fx_pair_id
group by p.symbol, r.timeframe, r.data_status
order by p.symbol, r.timeframe, r.data_status;

-- (3a) event_snapshots(RELEASE)の予想値・実績値・前回値の欠損(指標別)
select i.code,
       count(*) as release_snapshots,
       count(*) filter (where s.forecast is null) as forecast_null,
       count(*) filter (where s.actual is null) as actual_null,
       count(*) filter (where s.previous is null) as previous_null
from event_snapshots s
join economic_events e on e.id = s.event_id
join economic_indicators i on i.id = e.indicator_id
where s.snapshot_type = 'RELEASE'
group by i.code
order by i.code;

-- (3b) イベント別の分析可能サンプル数: 発表時刻が EXACT の RELEASED のうち、通貨ペアごとに 1分・15分・60分の値動きが
--      AVAILABLE なもの(戦略分析は直近5回・最低3件。15分・60分の分類は、さらに1分足の欠損確認が要る)
select i.code, p.symbol,
       count(distinct e.id) filter (where e.status = 'RELEASED' and e.release_datetime_precision = 'EXACT') as exact_released,
       count(distinct e.id) filter (
         where e.status = 'RELEASED' and e.release_datetime_precision = 'EXACT'
           and exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '1m' and r.data_status = 'AVAILABLE')
           and exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '15m' and r.data_status = 'AVAILABLE')
       ) as analyzable_15m,
       count(distinct e.id) filter (
         where e.status = 'RELEASED' and e.release_datetime_precision = 'EXACT'
           and exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '1m' and r.data_status = 'AVAILABLE')
           and exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '60m' and r.data_status = 'AVAILABLE')
       ) as analyzable_60m
from economic_events e
join economic_indicators i on i.id = e.indicator_id
cross join fx_pairs p
where p.is_active
group by i.code, p.symbol
having count(distinct e.id) filter (where e.status = 'RELEASED') > 0
order by i.code, p.symbol;

-- (4) 戻し率(retrace_ratio)の分布(通貨ペア別・15分の窓)。分類の規則④に当たる発表(最終的に初動と同じ側で、
--     1分より後に発表直前の価格を逆側に超えていない)だけを数える。pullback_min_ratio を決める材料。
--     1分足の欠損確認(minuteCompleteness)は SQL では見ていないので、(3b) と合わせて、n が十分あるか確かめる。
with m as (
  select e.id as event_id, p.symbol,
         r1.pips as pips_1m, r1.max_upward as up_1m, r1.max_downward as down_1m,
         rw.pips as pips_w, rw.max_upward as up_w, rw.max_downward as down_w,
         rw.max_upward_pips, rw.max_downward_pips,
         sign(r1.pips) as d
  from economic_events e
  join event_price_reactions r1 on r1.event_id = e.id and r1.timeframe = '1m' and r1.data_status = 'AVAILABLE'
  join event_price_reactions rw on rw.event_id = e.id and rw.fx_pair_id = r1.fx_pair_id and rw.timeframe = '15m' and rw.data_status = 'AVAILABLE'
  join fx_pairs p on p.id = r1.fx_pair_id
  where e.status = 'RELEASED' and e.release_datetime_precision = 'EXACT' and r1.pips <> 0
), x as (
  select symbol, event_id, d,
         case when d > 0 then max_upward_pips else -max_downward_pips end as peak,
         d * pips_w as final,
         case when d > 0 then (down_w <= 0 and down_w < down_1m) else (up_w >= 0 and up_w > up_1m) end as crossed
  from m
)
select symbol,
       count(*) as n,
       percentile_cont(array[0.1, 0.25, 0.5, 0.75, 0.9]) within group (order by (peak - final) / nullif(peak, 0)) as retrace_ratio_p10_p25_p50_p75_p90
from x
where peak > 0 and final > 0 and not crossed
group by symbol
order by symbol;
