-- FOMC 議事要旨の指標マスタ(HQ指示 2026-10-27「FOMC議事要旨は会合日とは別イベントにする」)。
--
-- npm run ingest:fomc-schedule が、会合(US_FOMC、provider 'fomc_schedule')とは別に、議事要旨の公表予定を
-- この指標の economic_events(provider 'fomc_minutes_schedule')として入れる(mappings/fomcSchedule.ts の
-- FOMC_MINUTES_SCHEDULE。FRB の calendar.json の "FOMC Minutes" の日時だけ)。値は無い(文書の公表)。
-- この行が無い間は、議事要旨だけ入らない(会合の予定は今までどおり入る)。
--
-- 重要度 MEDIUM: 会合の結果(HIGH)より市場の反応は小さいため。無料プランの通知(HIGH のみ)には出ない。
-- unit は null(値の無い指標)。関連の通貨ペアは US_FOMC と同じ USDJPY(1)、EURUSD(2)。
-- 何度流しても同じ結果になる。戻し方: この指標の economic_events を消してから、indicator_fx_pairs → economic_indicators。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('US_FOMC_MINUTES', 'FOMC議事要旨', 'FOMC Minutes', 'FOMC議事要旨', 'US', 'USD', 'MEDIUM',
    'FOMC議事要旨は、FOMC（連邦公開市場委員会）の会合での議論の内容をまとめた文書です。政策決定の約3週間後に公表され、今後の金融政策の方向性を読み取る材料として注目されます。',
    array['会合での議論の内容がわかる', '今後の金融政策の手がかりになる', '政策決定の約3週間後に公表される'],
    'IRREGULAR', null, 'Federal Reserve', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', 'NEUTRAL',
    null, null)
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values ('US_FOMC_MINUTES', 'USDJPY', 1), ('US_FOMC_MINUTES', 'EURUSD', 2)) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
