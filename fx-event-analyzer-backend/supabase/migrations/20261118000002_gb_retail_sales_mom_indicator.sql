-- 英国の小売売上高(前月比)を経済指標として追加する(経済指標バックエンド担当 D、2026-11-18)。
-- **この migration はまだ適用しない**(HQ の承認が先)。既存の指標・イベントには触れない。何度流しても同じ結果。
--
-- 取得元と利用条件: 英国 ONS。Open Government Licence v3.0(商用利用可・出典の表示が必要)。migration 20261110000002 と同じ。
--   出典は「Source: Office for National Statistics licensed under the Open Government Licence v.3.0」(ONS_ATTRIBUTION)。
-- 系列: J5EC「RSI:Month on prev month % change:All Business All retail inc fuel VOL SA」(%、数量・季節調整済み、
--   燃料を含む全小売、Great Britain)。https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j5ec/drsi
-- 公表: 「Retail sales, Great Britain」毎月 07:00(英国時間)。予定は src/ingestion/mappings/gbAuCaSchedule.ts。
-- 戻す手順: delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code = 'GB_RETAIL_SALES_MOM');
--          delete from economic_indicators where code = 'GB_RETAIL_SALES_MOM';(イベントが無いうちだけ)

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('GB_RETAIL_SALES_MOM', '英国小売売上高(数量、前月比)', 'Great Britain retail sales volume, month-on-month change', '小売売上高（前月比）', 'GB', 'GBP', 'MEDIUM',
    '英国(グレートブリテン)の小売売上高(数量、季節調整済み、燃料を含む)の前月比です。英国統計局(ONS)が毎月公表し、個人消費の動きを示す指標として注目されます。',
    array['英国の個人消費の勢いを把握できる', 'イングランド銀行の金融政策判断の材料になる', '毎月 ONS が公表する'],
    'MONTHLY', '%', 'Office for National Statistics', 'https://www.ons.gov.uk', 'HIGHER_IS_POSITIVE',
    '英国の小売売上高が予想を上回ると、個人消費の強さが意識され、ポンドが買われやすいとされる。',
    '英国の小売売上高が予想を下回ると、個人消費の弱さが意識され、ポンドが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('GB_RETAIL_SALES_MOM', 'GBPUSD', 1),
  ('GB_RETAIL_SALES_MOM', 'GBPJPY', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
