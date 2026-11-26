-- ECB 政策金利(EU_ECB_RATE)の指標マスタ(HQ指示 2026-11-25「日銀・ECB の予定表」)。
--
-- この行が無い間は、ingest:boj-ecb-schedule ジョブは EU_ECB_RATE の表を「economic_indicators has no EU_ECB_RATE row」
-- としてエラーにするだけ(何も書かない。日銀の表と既存の指標には影響しない)。
--
-- ECB 金融政策会合の日程は npm run ingest:boj-ecb-schedule(src/ingestion/mappings/centralBankSchedule.ts の人が確認した表)で
-- 入れる。決定値(政策金利)はこの migration・このジョブのいずれも入れない。発表時刻は公式ページに無いため DATE_ONLY。
-- 表示名は docs/projects/fx-event-analyzer/indicator-display-names.md の「政策金利は機関名を残す」(ECB政策金利)に従う。
-- 説明・見方は事実と一般的な見方だけ(売買の助言・値動きの断定はしない)。
--
-- 関連の通貨ペアは EURUSD 1・EURJPY 2(EU_HICP と同じ)。
-- 何度流しても同じ結果になる(code・(indicator_id, fx_pair_id) の一意制約で、既にある行は変えない)。
-- 戻し方: この指標の economic_events が無いことを確かめてから、indicator_fx_pairs → economic_indicators の順に消す。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('EU_ECB_RATE', 'ECB政策金利', 'ECB Interest Rate Decision', 'ECB政策金利', 'EU', 'EUR', 'HIGH',
    '欧州中央銀行(ECB)の理事会が金融政策会合で決定する政策金利です。ユーロ圏の金融政策の方向性を示し、会合の2日目に決定が公表され、記者会見が開かれます。',
    array['ユーロ圏の金融政策の方向性がわかる', '決定の公表後に総裁の記者会見が開かれる', '会合の日程は年ごとに公表される'],
    'IRREGULAR', '%', 'European Central Bank', 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html', 'NEUTRAL',
    'ECBの政策金利が予想より高い水準に決まると、金融引き締めが続くとの見方が強まるとされる。',
    'ECBの政策金利が予想より低い水準に決まると、金融緩和的な姿勢が意識されるとの見方が強まるとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('EU_ECB_RATE', 'EURUSD', 1), ('EU_ECB_RATE', 'EURJPY', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
