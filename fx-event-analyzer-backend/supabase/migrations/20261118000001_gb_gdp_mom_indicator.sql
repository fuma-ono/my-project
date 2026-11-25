-- 英国の月次 GDP(前月比)を経済指標として追加する(経済指標バックエンド担当 D、2026-11-18)。
-- **この migration はまだ適用しない**(HQ の承認が先)。内容は、既にある GB_CPI などと同じ形の追加だけ(既存の指標・
-- イベントには触れない)。何度流しても同じ結果(on conflict do nothing)。
--
-- 取得元と利用条件: 英国 ONS(Office for National Statistics)。Open Government Licence v3.0(商用利用可・出典の表示が必要)。
--   migration 20261110000002 の説明と同じ。出典は「Source: Office for National Statistics licensed under the Open Government
--   Licence v.3.0」(src/domain/attribution.ts の ONS_ATTRIBUTION)。
-- 系列: ECYX「Gross Value Added - Monthly (period on period growth) :CVM SA」(%)。ONS の月次 GDP の前月比。
--   https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/ecyx/mgdp
-- 公表: 「GDP monthly estimate, UK」毎月 07:00(英国時間)。予定は src/ingestion/mappings/gbAuCaSchedule.ts(各回の公式ページで確認)。
--
-- 表示名は indicator-display-names.md の決まり(国名は入れない・発表区分は全角カッコで付ける)に合わせて「GDP（前月比）」。
-- 関連の通貨ペアは、ほかの英国の指標と同じ GBPUSD・GBPJPY。ローカル・CI では migration が seed の前に流れ、その時点では
-- fx_pairs が空なので、seed.sql でも同じ行を入れる(20261110000002 と同じ)。
-- 戻す手順: delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code = 'GB_GDP_MOM');
--          delete from economic_indicators where code = 'GB_GDP_MOM';(イベントが無いうちだけ)

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('GB_GDP_MOM', '英国GDP(月次、前月比)', 'UK GDP monthly estimate, month-on-month growth', 'GDP（前月比）', 'GB', 'GBP', 'HIGH',
    '英国の月次 GDP(実質、季節調整済み)の前月比です。英国統計局(ONS)が毎月「GDP monthly estimate, UK」として公表し、景気の動きをいち早く示す指標として注目されます。',
    array['英国の景気の勢いを月ごとに把握できる', 'イングランド銀行の金融政策判断に影響する', '毎月 ONS が公表する'],
    'MONTHLY', '%', 'Office for National Statistics', 'https://www.ons.gov.uk', 'HIGHER_IS_POSITIVE',
    '英国のGDPが予想を上回ると、景気の強さが意識され、ポンドが買われやすいとされる。',
    '英国のGDPが予想を下回ると、景気の減速が意識され、ポンドが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('GB_GDP_MOM', 'GBPUSD', 1),
  ('GB_GDP_MOM', 'GBPJPY', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
