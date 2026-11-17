-- Strategy Analysis 第1段階: DEV の実データの確認(読み取り専用。HQ指示 2026-11-17。同日の C レビュー反映で改訂)
--
-- **未実行。** C のレビューが終わるまで、DEV でも実行しない。実行は、DEV の読み取り権限を持つ担当者が、SQL Editor などで行う。
-- **SELECT だけ**(INSERT・UPDATE・DELETE・DDL・関数の作成を含まない)。**本番(PROD)では実行しない。**
-- 結果は件数・分布だけで、値・個人情報は含まれない。
--
-- 目的:
--   (1) fx_prices のペア別・時間足別の件数と期間
--   (2) event_price_reactions のペア別・時間足別・状態別の件数
--   (3a) event_snapshots の予想値・実績値・前回値の欠損(指標別)
--   (3b) 指標 × 通貨ペアごとの、分析可能な発表の数(1分足の完全性つき)
--   (3c) 市場イベント単位(重複排除)の、通貨ペアごとの分析可能な発表の数
--   (4)  値動きの分類の閾値(pullback_min_ratio)を決めるための、通貨ペア × 窓(15分・60分)ごとの分布と件数
--
-- 注意(読み方):
--  * 同時発表の重複排除: 同じ provider・同じ release_datetime(かつ発表時刻が EXACT)の発表は、1つの市場イベントとして数える
--    (コードの domain/marketEventGrouping.ts と同じ規則。provider が無い・EXACT でない発表は、他と束ねず単独)。
--    (3c)・(4) は、(市場イベント, 通貨ペア) ごとに1件にして数える(同じ値動きを、指標の数だけ重ねて数えない)。
--    (3b) は指標ごとの件数(戦略分析は指標ごとに過去5回を使うため)で、重複排除しない。
--  * 1分足の完全性: (3b)・(3c)・(4) は、コードと同じく、窓の1分足が全部(15本・60本)あり、UNVERIFIED が無い発表だけを数える。
--    (3b) の exact_released と analyzable_* の差は、1分足の欠け・UNVERIFIED だけで生じるわけではない。次の理由もすべて含む:
--    ① 窓の値動き(event_price_reactions)が AVAILABLE でない(行が無い・UNAVAILABLE・まだ計算されていない)
--    ② 窓の1分足が15本・60本揃っていない・UNVERIFIED がある
--    ③ 15分・60分で除外の理由が違う(analyzable_15m と analyzable_60m が別々に数える)
--    差の内訳(①と②)は、この集計からは分からない。内訳が要るときは、別の集計を足す。
--  * それでも、SQL の件数は、コード上の「分析可能なサンプル数」と一致しない可能性がある。コードはさらに、保存値の矛盾
--    (極値と pips の整合、1分足の系列との整合。DATA_INCONSISTENT)で判定不可にするが、SQL ではその矛盾を見ていない。
--    SQL の件数は、コードの件数以上になる(コードの方が少なくなりうる)。
--  * 閾値は、各通貨ペアの (4) の n が十分に大きいことを確かめてから決める。サンプルが少ないうちは決めない。

-- (1) fx_prices のペア別・時間足別の件数と期間
select p.symbol, f.timeframe, count(*) as candles, min(f."timestamp") as first_candle, max(f."timestamp") as last_candle,
       count(*) filter (where f.verification_status = 'UNVERIFIED') as unverified
from fx_prices f
join fx_pairs p on p.id = f.fx_pair_id
group by p.symbol, f.timeframe
order by p.symbol, f.timeframe;

-- (2) event_price_reactions のペア別・時間足別の件数(data_status 別)
select p.symbol, r.timeframe, r.data_status, count(*) as reactions
from event_price_reactions r
join fx_pairs p on p.id = r.fx_pair_id
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

-- (3b) 指標 × 通貨ペアごとの分析可能な発表の数(重複排除しない。1分足の完全性つき)。
--      exact_released = 発表時刻が EXACT の RELEASED。analyzable_15m / analyzable_60m = さらに、1分・窓の値動きが AVAILABLE で、
--      窓の1分足が全部あり UNVERIFIED が無いもの。
--      exact_released はその通貨ペアの値動きの行が(状態を問わず)1行でもある発表。exact_released − analyzable_* の差は、値動きが AVAILABLE でない・
--      1分足の欠け・UNVERIFIED の合計で、内訳は分からない(上の注意を参照)。
select i.code, p.symbol,
       count(*) as exact_released,
       count(*) filter (where x.n15 = 15 and x.u15 = 0 and x.r1 and x.r15) as analyzable_15m,
       count(*) filter (where x.n60 = 60 and x.u60 = 0 and x.r1 and x.r60) as analyzable_60m
from economic_events e
join economic_indicators i on i.id = e.indicator_id
cross join fx_pairs p
cross join lateral (
  select
    count(*) filter (where f."timestamp" < e.release_datetime + interval '15 minutes') as n15,
    count(*) filter (where f."timestamp" < e.release_datetime + interval '15 minutes' and f.verification_status = 'UNVERIFIED') as u15,
    count(*) as n60,
    count(*) filter (where f.verification_status = 'UNVERIFIED') as u60,
    exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '1m' and r.data_status = 'AVAILABLE') as r1,
    exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '15m' and r.data_status = 'AVAILABLE') as r15,
    exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id and r.timeframe = '60m' and r.data_status = 'AVAILABLE') as r60
  from fx_prices f
  where f.fx_pair_id = p.id and f.timeframe = '1m'
    and f."timestamp" >= e.release_datetime
    and f."timestamp" < e.release_datetime + interval '60 minutes'
) x
where p.is_active
  and e.status = 'RELEASED'
  and e.release_datetime_precision = 'EXACT'
  and exists (select 1 from event_price_reactions r where r.event_id = e.id and r.fx_pair_id = p.id)
group by i.code, p.symbol
order by i.code, p.symbol;

-- (3c) 市場イベント単位(重複排除)の、通貨ペアごとの分析可能な発表の数。
--      同じ provider・release_datetime(EXACT)の発表は1件。(市場イベント, 通貨ペア, 窓) ごとに1件にして数える。
with ev as (
  select e.id as event_id, e.release_datetime,
         case when e.provider is not null and e.release_datetime_precision = 'EXACT'
              then e.provider || '|' || e.release_datetime::text
              else e.id::text end as market_key
  from economic_events e
  where e.status = 'RELEASED' and e.release_datetime_precision = 'EXACT'
),
cand as (
  select distinct on (ev.market_key, r1.fx_pair_id, w.minutes)
         ev.event_id, ev.release_datetime, ev.market_key, r1.fx_pair_id as pair_id, w.minutes
  from ev
  join event_price_reactions r1 on r1.event_id = ev.event_id and r1.timeframe = '1m' and r1.data_status = 'AVAILABLE'
  cross join (values (15), (60)) as w(minutes)
  join event_price_reactions rw on rw.event_id = ev.event_id and rw.fx_pair_id = r1.fx_pair_id
                               and rw.timeframe = (w.minutes::text || 'm') and rw.data_status = 'AVAILABLE'
  order by ev.market_key, r1.fx_pair_id, w.minutes, ev.event_id
)
select p.symbol, c.minutes as window_minutes, count(*) as market_events_analyzable
from cand c
join fx_pairs p on p.id = c.pair_id
cross join lateral (
  select count(*) as n,
         count(*) filter (where f.verification_status = 'UNVERIFIED') as u
  from fx_prices f
  where f.fx_pair_id = c.pair_id and f.timeframe = '1m'
    and f."timestamp" >= c.release_datetime
    and f."timestamp" < c.release_datetime + (c.minutes::text || ' minutes')::interval
) m
where m.n = c.minutes and m.u = 0
group by p.symbol, c.minutes
order by p.symbol, c.minutes;

-- (4) 値動きの分類の閾値を決めるための、通貨ペア × 窓ごとの分布と件数(重複排除・1分足の完全性つき)。
--     コードの規則(domain/eventStrategyAnalysis.ts assessMovement)と同じ定義:
--       d = sign(1分の pips)(0 は除く)、peak = 初動の方向に最も伸びた幅(上なら max_upward_pips、下なら -max_downward_pips)、
--       fin = d × 窓の pips、crossed = 2分目以降(発表の1分後以降)の1分足で、初動が上なら low <= 発表直前の価格、下なら high >= 発表直前の価格、
--       retrace_ratio = (peak - fin) / peak。
--     分類の規則④(閾値が要る場合)に当たるのは、fin > 0 かつ crossed でない発表。
--     閾値(pullback_min_ratio)は retrace_ratio の分布(rule4_* の列)から決める。n(rule4_n)が少ないペアは決めない。
with ev as (
  select e.id as event_id, e.release_datetime,
         case when e.provider is not null and e.release_datetime_precision = 'EXACT'
              then e.provider || '|' || e.release_datetime::text
              else e.id::text end as market_key
  from economic_events e
  where e.status = 'RELEASED' and e.release_datetime_precision = 'EXACT'
),
base as (
  select distinct on (ev.market_key, r1.fx_pair_id, w.minutes)
         ev.event_id, ev.release_datetime, r1.fx_pair_id as pair_id, w.minutes,
         r1.pre_release_price as pre, sign(r1.pips) as d, r1.pips as pips_1m,
         rw.pips as pips_w, rw.max_upward_pips, rw.max_downward_pips
  from ev
  join event_price_reactions r1 on r1.event_id = ev.event_id and r1.timeframe = '1m' and r1.data_status = 'AVAILABLE'
  cross join (values (15), (60)) as w(minutes)
  join event_price_reactions rw on rw.event_id = ev.event_id and rw.fx_pair_id = r1.fx_pair_id
                               and rw.timeframe = (w.minutes::text || 'm') and rw.data_status = 'AVAILABLE'
  where r1.pips <> 0
    and r1.pre_release_price is not null
    and rw.pips is not null and rw.max_upward_pips is not null and rw.max_downward_pips is not null
  order by ev.market_key, r1.fx_pair_id, w.minutes, ev.event_id
),
checked as (
  select b.*, c.n, c.u, c.crossed
  from base b
  cross join lateral (
    select count(*) as n,
           count(*) filter (where f.verification_status = 'UNVERIFIED') as u,
           coalesce(bool_or(
             f."timestamp" >= b.release_datetime + interval '1 minute'
             and ((b.d > 0 and f.low <= b.pre) or (b.d < 0 and f.high >= b.pre))
           ), false) as crossed
    from fx_prices f
    where f.fx_pair_id = b.pair_id and f.timeframe = '1m'
      and f."timestamp" >= b.release_datetime
      and f."timestamp" < b.release_datetime + (b.minutes::text || ' minutes')::interval
  ) c
),
m as (
  select pair_id, minutes, d, crossed,
         abs(pips_1m) as initial_abs,
         case when d > 0 then max_upward_pips else -max_downward_pips end as peak,
         d * pips_w as fin
  from checked
  where n = minutes and u = 0
),
k as (
  select m.*,
         case when fin < 0 then 'OPPOSITE' when fin = 0 then 'AT_PRE' else 'SAME' end as final_side,
         case when peak > 0 and peak >= fin then (peak - fin) / peak end as retrace_ratio
  from m
)
select p.symbol, k.minutes as window_minutes,
       count(*) as n,
       count(*) filter (where final_side = 'SAME') as final_same,
       count(*) filter (where final_side = 'OPPOSITE') as final_opposite,
       count(*) filter (where final_side = 'AT_PRE') as final_at_pre,
       count(*) filter (where crossed) as crossed_true,
       count(*) filter (where not crossed) as crossed_false,
       -- 初動幅 |pips_1m| の分布
       percentile_cont(0.1) within group (order by initial_abs) as initial_abs_p10,
       percentile_cont(0.5) within group (order by initial_abs) as initial_abs_p50,
       percentile_cont(0.9) within group (order by initial_abs) as initial_abs_p90,
       -- 最終位置 |fin| の分布
       percentile_cont(0.1) within group (order by abs(fin)) as final_abs_p10,
       percentile_cont(0.5) within group (order by abs(fin)) as final_abs_p50,
       percentile_cont(0.9) within group (order by abs(fin)) as final_abs_p90,
       -- 規則④(fin > 0 かつ crossed でない)の戻し率の分布。rule4_n がこの分布のサンプル数
       count(*) filter (where fin > 0 and not crossed and retrace_ratio is not null) as rule4_n,
       percentile_cont(0.1) within group (order by retrace_ratio) filter (where fin > 0 and not crossed and retrace_ratio is not null) as rule4_retrace_p10,
       percentile_cont(0.25) within group (order by retrace_ratio) filter (where fin > 0 and not crossed and retrace_ratio is not null) as rule4_retrace_p25,
       percentile_cont(0.5) within group (order by retrace_ratio) filter (where fin > 0 and not crossed and retrace_ratio is not null) as rule4_retrace_p50,
       percentile_cont(0.75) within group (order by retrace_ratio) filter (where fin > 0 and not crossed and retrace_ratio is not null) as rule4_retrace_p75,
       percentile_cont(0.9) within group (order by retrace_ratio) filter (where fin > 0 and not crossed and retrace_ratio is not null) as rule4_retrace_p90
from k
join fx_pairs p on p.id = k.pair_id
group by p.symbol, k.minutes
order by p.symbol, k.minutes;
