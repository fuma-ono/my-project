-- 豪州の賃金指数 WPI(前期比)を経済指標として追加する(経済指標バックエンド担当 D、2026-11-18)。
-- **この migration はまだ適用しない**(HQ の承認が先)。既存の指標・イベントには触れない。何度流しても同じ結果。
--
-- 取得元と利用条件: 豪州統計局(ABS)。CC BY 4.0(商用利用可・出典の表示)。migration 20261110000002 と同じ。
--   出典は ABS_ATTRIBUTION(「Source: Australian Bureau of Statistics. © Commonwealth of Australia. Licensed under CC BY 4.0 …」)。
-- 系列: ABS データ API の WPI 1.2.0、キー 2.THRPEB.7.TOT.20.AUS.Q(前期比 %、時間当たり賃金(賞与を除く)、民間+公共、
--   全産業、季節調整済み、豪州全体、四半期)。ABS の公表文の見出し「seasonally adjusted WPI rose 1.1% in the September quarter」と同じ系列。
-- 公表: 四半期ごと 11:30(シドニー)。予定は src/ingestion/mappings/gbAuCaSchedule.ts(latest-release ページの「Next Release」)。
-- 戻す手順: delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code = 'AU_WPI_QOQ');
--          delete from economic_indicators where code = 'AU_WPI_QOQ';(イベントが無いうちだけ)

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('AU_WPI_QOQ', '豪州賃金指数(WPI、前期比)', 'Australia Wage Price Index (WPI), quarterly change', '賃金指数（前期比）', 'AU', 'AUD', 'MEDIUM',
    '豪州の賃金指数(WPI、賞与を除く時間当たり賃金、季節調整済み)の前期比です。豪州統計局(ABS)が四半期ごとに公表し、豪州準備銀行が物価や賃金の動きを見る材料として注目されます。',
    array['豪州の賃金上昇の勢いを把握できる', '豪州準備銀行の金融政策判断の材料になる', '四半期ごとに ABS が公表する'],
    'QUARTERLY', '%', 'Australian Bureau of Statistics', 'https://www.abs.gov.au', 'HIGHER_IS_POSITIVE',
    '豪州の賃金指数が予想を上回ると、賃金上昇による物価の強さから利下げが遠のくとの見方が強まり、豪ドルが買われやすいとされる。',
    '豪州の賃金指数が予想を下回ると、賃金上昇の鈍化から利下げが意識され、豪ドルが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('AU_WPI_QOQ', 'AUDUSD', 1),
  ('AU_WPI_QOQ', 'AUDJPY', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
