-- ユーロ圏の経済指標の指標マスタ (HQ承認 2026-10-30「ユーロ圏経済指標 第1弾」: 失業率・HICP速報値)。
--
-- 2指標とも Eurostat の公表日程の経路 (npm run ingest:official:eurostat-calendar、
-- src/ingestion/mappings/eurostatSchedule.ts・indicators.ts) で取り込む。この行が無い間は、
-- ジョブはこの2指標を indicator_not_in_db として飛ばすだけ (米国の指標には影響しない)。
--
-- | code                 | Eurostat の系列 (地域 EA21)                         | 値                         | 発表 (ルクセンブルク時間) |
-- |----------------------|-----------------------------------------------------|----------------------------|---------------------------|
-- | EU_HICP              | prc_hicp_fpd (coicop18=TOTAL, release=FLS, RCH_A)    | 前年比 % (速報値)           | 速報の日 11:00 (APPROXIMATE) |
-- | EU_UNEMPLOYMENT_RATE | une_rt_m (s_adj=SA, age=TOTAL, sex=T, PC_ACT)        | 水準 % (季節調整済み)       | 失業率の日 11:00 (APPROXIMATE) |
--
-- 表示名は docs/projects/fx-event-analyzer/indicator-display-names.md の「ユーロ圏の主要指標」の表どおり。
-- 関連の通貨ペアは EURUSD 1・EURJPY 2 (ユーロを含む既存のペア。FREE の既定の通知ペア USDJPY は加えない、
-- HQ判断 2026-10-30 5)。source / source_url は Eurostat (出典の表示は API の attribution、api-design v1.43)。
--
-- 何度流しても同じ結果になる (code・(indicator_id, fx_pair_id) の一意制約で、既にある行は変えない)。
-- 既存の行は変えない。戻すときは、この2指標の economic_events が無いことを確かめてから、
-- indicator_fx_pairs → economic_indicators の順にこの2つの code の行を消す。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('EU_HICP', 'ユーロ圏消費者物価指数(HICP、速報値)', 'Euro Area HICP Flash Estimate', '消費者物価指数（CPI）', 'EU', 'EUR', 'HIGH',
    'ユーロ圏の消費者物価指数(HICP、総合)の前年比の速報値です。Eurostat が月末から翌月初めに公表し、ECBの金融政策の判断材料として注目されます。',
    array['ユーロ圏の物価の動きを把握できる', 'ECBの金融政策判断に影響する', '確報より先に公表される速報値'],
    'MONTHLY', '%', 'Eurostat', 'https://ec.europa.eu/eurostat', 'HIGHER_IS_POSITIVE',
    'ユーロ圏のHICPが予想を上回ると、物価の強さから利下げが遠のくとの見方が強まり、ユーロが買われやすいとされる。',
    'ユーロ圏のHICPが予想を下回ると、物価の落ち着きから利下げが意識され、ユーロが売られやすいとされる。'),
  ('EU_UNEMPLOYMENT_RATE', 'ユーロ圏失業率', 'Euro Area Unemployment Rate', '失業率', 'EU', 'EUR', 'MEDIUM',
    'ユーロ圏の失業率(季節調整済み)です。働く意思と能力がありながら職に就いていない人の割合を示し、Eurostat が毎月公表します。',
    array['ユーロ圏の雇用情勢を把握できる', 'ECBの金融政策判断の材料になる', '毎月 Eurostat が公表する'],
    'MONTHLY', '%', 'Eurostat', 'https://ec.europa.eu/eurostat', 'LOWER_IS_POSITIVE',
    'ユーロ圏の失業率が予想を上回ると、雇用の悪化から利下げが意識され、ユーロが売られやすいとされる。',
    'ユーロ圏の失業率が予想を下回ると、雇用の底堅さから利下げが遠のくとの見方が強まり、ユーロが買われやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('EU_HICP', 'EURUSD', 1),
  ('EU_HICP', 'EURJPY', 2),
  ('EU_UNEMPLOYMENT_RATE', 'EURUSD', 1),
  ('EU_UNEMPLOYMENT_RATE', 'EURJPY', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
