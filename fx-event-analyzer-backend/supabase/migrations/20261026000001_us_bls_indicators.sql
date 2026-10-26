-- 米国コアCPI・失業率・平均時給の指標マスタ (HQ指示 2026-10-26「米国コアCPI・失業率・平均時給の追加」)。
--
-- 3指標とも BLS の公式発表スケジュール経路 (npm run ingest:official:bls-calendar、
-- src/ingestion/mappings/blsSchedule.ts・indicators.ts) で取り込む。この行が無い間は、
-- ジョブはこの3指標を indicator_not_in_db として飛ばすだけ (既存の US_CPI・US_NFP には影響しない)。
--
-- | code                    | BLS 系列                         | 値                    | 発表        |
-- |-------------------------|----------------------------------|-----------------------|-------------|
-- | US_CORE_CPI             | CUUR0000SA0L1E (前月比 CUSR…)    | 前年比 % (季節調整なし)| CPI と同じ  |
-- | US_UNEMPLOYMENT_RATE    | LNS14000000                      | 水準 % (季節調整済み) | 雇用統計と同じ |
-- | US_AVG_HOURLY_EARNINGS  | CES0500000003                    | 前月比 % (季節調整済み、前年比も) | 雇用統計と同じ |
--
-- 表示名は docs/projects/fx-event-analyzer/indicator-display-names.md (HQ指示 2026-10-13) の
-- 「米国の主要指標」の表どおり。関連の通貨ペアは US_CPI・US_NFP と同じ (USDJPY 1、EURUSD 2)。
--
-- 何度流しても同じ結果になる (code・(indicator_id, fx_pair_id) の一意制約で、既にある行は変えない)。
-- 既存の行 (US_CPI など) は変えない。戻すときは、この3指標の economic_events が無いことを
-- 確かめてから、indicator_fx_pairs → economic_indicators の順にこの3つの code の行を消す。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('US_CORE_CPI', '米国コアCPI(食品・エネルギーを除く消費者物価指数)', 'Core Consumer Price Index', 'コアCPI', 'US', 'USD', 'HIGH',
    'コアCPIは、消費者物価指数（CPI）から値動きの大きい食品とエネルギーを除いた指標です。物価の基調的な動きを示し、FRBの金融政策の判断材料として注目されます。',
    array['物価の基調的な動きを把握できる', '一時的な要因に左右されにくい', 'FRBの金融政策判断に影響する'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/cpi/', 'HIGHER_IS_POSITIVE',
    '米国コアCPIが予想を上回ると、物価の基調の強さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国コアCPIが予想を下回ると、物価の基調の落ち着きから利下げが意識され、ドルが売られやすいとされる。'),
  ('US_UNEMPLOYMENT_RATE', '米国失業率', 'Unemployment Rate', '失業率', 'US', 'USD', 'HIGH',
    '失業率は、働く意思と能力がありながら職に就いていない人の割合を示す指標です。雇用統計の一部として非農業部門雇用者数と同時に発表され、米国の雇用情勢を測る指標として注目されます。',
    array['米国の雇用情勢を把握できる', 'FRBの金融政策判断に影響する', '非農業部門雇用者数と同時に発表される'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/cps/', 'LOWER_IS_POSITIVE',
    '米国の失業率が予想を上回ると、雇用の悪化から利下げが意識され、ドルが売られやすいとされる。',
    '米国の失業率が予想を下回ると、雇用の底堅さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。'),
  ('US_AVG_HOURLY_EARNINGS', '米国平均時給', 'Average Hourly Earnings', '平均時給', 'US', 'USD', 'MEDIUM',
    '平均時給は、民間部門の労働者の1時間あたりの平均賃金です。雇用統計の一部として発表され、賃金の伸びからインフレの先行きを見る指標として注目されます。',
    array['賃金の伸びを把握できる', 'インフレの先行きの判断材料になる', '非農業部門雇用者数と同時に発表される'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/ces/', 'HIGHER_IS_POSITIVE',
    '米国の平均時給が予想を上回ると、賃金の伸びからインフレが続くとの見方が強まり、ドルが買われやすいとされる。',
    '米国の平均時給が予想を下回ると、賃金の伸びの鈍化から利下げが意識され、ドルが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('US_CORE_CPI', 'USDJPY', 1),
  ('US_CORE_CPI', 'EURUSD', 2),
  ('US_UNEMPLOYMENT_RATE', 'USDJPY', 1),
  ('US_UNEMPLOYMENT_RATE', 'EURUSD', 2),
  ('US_AVG_HOURLY_EARNINGS', 'USDJPY', 1),
  ('US_AVG_HOURLY_EARNINGS', 'EURUSD', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
