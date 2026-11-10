-- 英国・豪州・カナダの主要経済指標(HQ指示 2026-11-10「6地域の経済指標拡張・実装準備」)。
--
-- 取得元と利用条件(2026-11-10 に原文を確認。どれも商用利用可・出典の表示が必要):
--   英国 ONS(Office for National Statistics): Open Government Licence v3.0。
--     「if you wish to use or re-use ONS material, whether commercially or privately, you may do so freely without a specific
--      application for a licence」(https://www.ons.gov.uk/methodology/geography/licences)。出典「Source: Office for National
--      Statistics licensed under the Open Government Licence v.3.0」。
--   豪州 ABS(Australian Bureau of Statistics): 「All material presented on this website is provided under a Creative Commons
--      Attribution 4.0 International licence」(https://www.abs.gov.au/website-privacy-copyright-and-disclaimer)。
--   カナダ Statistics Canada: Open Licence「use, reproduce, publish, freely distribute, or sell the Information」。出典「Source:
--      Statistics Canada, name of product, reference date. Reproduced and distributed on an 'as is' basis with the permission of
--      Statistics Canada.」(https://www.statcan.gc.ca/en/terms-conditions/open-licence)。
-- 政策金利(BoE・RBA・BoC)は入れない(BoE はサイトの本文の商用利用に許可が必要。RBA・BoE は公表の時刻を公式で確認できていない)。
--
-- 国のコードは iOS に合わせて GB・AU・CA(Formatting.swift の国旗・国名)。表示名は indicator-display-names.md の決まり
-- (消費者物価指数（CPI）・コアCPI・失業率)。関連の通貨ペアは、指標の通貨を含む今あるペア(CAD は CADJPY だけ)。
-- 何度流しても同じ結果(on conflict do nothing)。既存の指標・イベントには触れない。
-- 戻す手順: delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code in (…7件…));
--          delete from economic_indicators where code in (…7件…);(イベントが無いうちだけ)

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('GB_CPI', '英国消費者物価指数(CPI、前年比)', 'UK Consumer Prices Index (CPI), 12-month rate', '消費者物価指数（CPI）', 'GB', 'GBP', 'HIGH',
    '英国の消費者物価指数(CPI)の前年比です。英国統計局(ONS)が毎月公表し、イングランド銀行の金融政策の判断材料として注目されます。',
    array['英国の物価の動きを把握できる', 'イングランド銀行の金融政策判断に影響する', '毎月 ONS が公表する'],
    'MONTHLY', '%', 'Office for National Statistics', 'https://www.ons.gov.uk', 'HIGHER_IS_POSITIVE',
    '英国のCPIが予想を上回ると、物価の強さから利下げが遠のくとの見方が強まり、ポンドが買われやすいとされる。',
    '英国のCPIが予想を下回ると、物価の落ち着きから利下げが意識され、ポンドが売られやすいとされる。'),
  ('GB_CORE_CPI', '英国コアCPI(エネルギー・食品・アルコール・たばこを除く、前年比)', 'UK CPI excluding energy, food, alcohol and tobacco, 12-month rate', 'コアCPI', 'GB', 'GBP', 'MEDIUM',
    '英国の消費者物価指数から、値動きの大きいエネルギー・食品・アルコール・たばこを除いた指数の前年比です。CPI と同時に ONS が公表します。',
    array['基調的な物価の動きを把握できる', 'CPIと同時に公表される', '毎月 ONS が公表する'],
    'MONTHLY', '%', 'Office for National Statistics', 'https://www.ons.gov.uk', 'HIGHER_IS_POSITIVE',
    '英国のコアCPIが予想を上回ると、基調的な物価の強さが意識され、ポンドが買われやすいとされる。',
    '英国のコアCPIが予想を下回ると、基調的な物価の落ち着きが意識され、ポンドが売られやすいとされる。'),
  ('GB_UNEMPLOYMENT_RATE', '英国失業率(ILO基準、3か月)', 'UK Unemployment Rate (ILO, 3 months)', '失業率', 'GB', 'GBP', 'MEDIUM',
    '英国の失業率(ILO基準、16歳以上、季節調整済み、3か月の平均)です。ONS が毎月「UK Labour Market」として公表します。',
    array['英国の雇用情勢を把握できる', '3か月の平均の値で公表される', '毎月 ONS が公表する'],
    'MONTHLY', '%', 'Office for National Statistics', 'https://www.ons.gov.uk', 'LOWER_IS_POSITIVE',
    '英国の失業率が予想を上回ると、雇用の悪化から利下げが意識され、ポンドが売られやすいとされる。',
    '英国の失業率が予想を下回ると、雇用の底堅さが意識され、ポンドが買われやすいとされる。'),
  ('AU_CPI', '豪州消費者物価指数(CPI、前年比)', 'Australia Consumer Price Index (CPI), annual change', '消費者物価指数（CPI）', 'AU', 'AUD', 'HIGH',
    '豪州の消費者物価指数(CPI)の前年比です。豪州統計局(ABS)が毎月公表し、豪州準備銀行の金融政策の判断材料として注目されます。',
    array['豪州の物価の動きを把握できる', '豪州準備銀行の金融政策判断に影響する', '毎月 ABS が公表する'],
    'MONTHLY', '%', 'Australian Bureau of Statistics', 'https://www.abs.gov.au', 'HIGHER_IS_POSITIVE',
    '豪州のCPIが予想を上回ると、物価の強さから利下げが遠のくとの見方が強まり、豪ドルが買われやすいとされる。',
    '豪州のCPIが予想を下回ると、物価の落ち着きから利下げが意識され、豪ドルが売られやすいとされる。'),
  ('AU_UNEMPLOYMENT_RATE', '豪州失業率', 'Australia Unemployment Rate', '失業率', 'AU', 'AUD', 'MEDIUM',
    '豪州の失業率(季節調整済み)です。ABS が毎月「Labour Force, Australia」として公表します。',
    array['豪州の雇用情勢を把握できる', '豪州準備銀行の金融政策判断の材料になる', '毎月 ABS が公表する'],
    'MONTHLY', '%', 'Australian Bureau of Statistics', 'https://www.abs.gov.au', 'LOWER_IS_POSITIVE',
    '豪州の失業率が予想を上回ると、雇用の悪化から利下げが意識され、豪ドルが売られやすいとされる。',
    '豪州の失業率が予想を下回ると、雇用の底堅さが意識され、豪ドルが買われやすいとされる。'),
  ('CA_CPI', 'カナダ消費者物価指数(CPI、前年比)', 'Canada Consumer Price Index (CPI), 12-month change', '消費者物価指数（CPI）', 'CA', 'CAD', 'HIGH',
    'カナダの消費者物価指数(CPI)の前年比です。カナダ統計局(Statistics Canada)が毎月公表し、カナダ銀行の金融政策の判断材料として注目されます。',
    array['カナダの物価の動きを把握できる', 'カナダ銀行の金融政策判断に影響する', '毎月 Statistics Canada が公表する'],
    'MONTHLY', '%', 'Statistics Canada', 'https://www.statcan.gc.ca', 'HIGHER_IS_POSITIVE',
    'カナダのCPIが予想を上回ると、物価の強さから利下げが遠のくとの見方が強まり、カナダドルが買われやすいとされる。',
    'カナダのCPIが予想を下回ると、物価の落ち着きから利下げが意識され、カナダドルが売られやすいとされる。'),
  ('CA_UNEMPLOYMENT_RATE', 'カナダ失業率', 'Canada Unemployment Rate', '失業率', 'CA', 'CAD', 'MEDIUM',
    'カナダの失業率(季節調整済み)です。Statistics Canada が毎月「Labour Force Survey」として公表します。',
    array['カナダの雇用情勢を把握できる', 'カナダ銀行の金融政策判断の材料になる', '毎月 Statistics Canada が公表する'],
    'MONTHLY', '%', 'Statistics Canada', 'https://www.statcan.gc.ca', 'LOWER_IS_POSITIVE',
    'カナダの失業率が予想を上回ると、雇用の悪化から利下げが意識され、カナダドルが売られやすいとされる。',
    'カナダの失業率が予想を下回ると、雇用の底堅さが意識され、カナダドルが買われやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('GB_CPI', 'GBPUSD', 1),
  ('GB_CPI', 'GBPJPY', 2),
  ('GB_CORE_CPI', 'GBPUSD', 1),
  ('GB_CORE_CPI', 'GBPJPY', 2),
  ('GB_UNEMPLOYMENT_RATE', 'GBPUSD', 1),
  ('GB_UNEMPLOYMENT_RATE', 'GBPJPY', 2),
  ('AU_CPI', 'AUDUSD', 1),
  ('AU_CPI', 'AUDJPY', 2),
  ('AU_UNEMPLOYMENT_RATE', 'AUDUSD', 1),
  ('AU_UNEMPLOYMENT_RATE', 'AUDJPY', 2),
  ('CA_CPI', 'CADJPY', 1),
  ('CA_UNEMPLOYMENT_RATE', 'CADJPY', 1)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
