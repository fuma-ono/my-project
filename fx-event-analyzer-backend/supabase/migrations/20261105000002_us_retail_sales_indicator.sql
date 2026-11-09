-- 米国小売売上高(速報、US_RETAIL_SALES)の指標マスタ(HQ承認 2026-11-05「US_RETAIL_SALES
-- 公式発表日程の自動取り込み実装」)。
--
-- この行が無い間は、ingest:retail-sales-scheduleジョブはこの指標をeconomic_indicators has no
-- US_RETAIL_SALES rowとしてエラーにするだけ(既存の指標には影響しない)。
--
-- 発表日程は npm run ingest:retail-sales-schedule(src/ingestion/pipelines/retailSalesSchedule.ts)
-- で、人が確認した表(src/ingestion/mappings/retailSalesSchedule.ts)から入れる。値(小売売上高の
-- 結果)はこのmigration・このジョブのいずれも入れない — 値の照合元(Census APIの利用条件・鍵)は
-- まだ確認していないため(mappings/indicators.tsの既存コメント・data-sources.md §13.1、
-- `official: []`・`requireOfficialMatch: true`のまま)。
--
-- 関連の通貨ペアはUS_CPI・US_NFP等と同じ(USDJPY 1、EURUSD 2)。
-- 何度流しても同じ結果になる(code・(indicator_id, fx_pair_id)の一意制約で、既にある行は変えない)。
-- 戻し方: この指標のeconomic_eventsが無いことを確かめてから、indicator_fx_pairs →
-- economic_indicatorsの順に消す。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('US_RETAIL_SALES', '米国小売売上高(速報、小売・飲食サービス)', 'Advance Retail Sales', '小売売上高（速報）', 'US', 'USD', 'MEDIUM',
    '小売売上高（速報）は、米国の小売店・飲食サービス業の売上高が前月から何パーセント増減したかを示す指標です。個人消費の強さを示し、米国経済の動向を見る材料として注目されます。',
    array['個人消費の強さを把握できる', '米国経済の動向の判断材料になる', 'FRBの金融政策判断に影響する'],
    'MONTHLY', '%', 'U.S. Census Bureau', 'https://www.census.gov/retail/', 'HIGHER_IS_POSITIVE',
    '米国の小売売上高が予想を上回ると、個人消費の底堅さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国の小売売上高が予想を下回ると、個人消費の弱まりから利下げが意識され、ドルが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('US_RETAIL_SALES', 'USDJPY', 1), ('US_RETAIL_SALES', 'EURUSD', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
