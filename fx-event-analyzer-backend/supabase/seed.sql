-- Development/test seed data ONLY (Phase 2 instruction §19). This is not
-- production Provider data, and must never be presented in UI as if it
-- were real economic data — it exists so screens/endpoints have something
-- concrete to render while no Ingestion Worker exists yet (Phase 6).
--
-- Profile/Subscription/Entitlement rows are intentionally NOT seeded here:
-- profiles.id is a FK to auth.users(id), and hand-inserting into the
-- auth schema is GoTrue-version-sensitive. Exercise that path via real
-- Supabase Auth sign-up against a running local stack instead.

-- ---------------------------------------------------------------------
-- Economic indicators
-- ---------------------------------------------------------------------

-- name_en / key_points / 日本語の description は SCR-006 指標詳細の
-- 英語名・注目される理由・概要 (HQ指示 2026-10-09)。
-- market_view_above / market_view_below は SCR-008 相場反応詳細の
-- 「一般的な見方」(結果が予想を上回った / 下回ったとき。人が書いた定型文)。
insert into economic_indicators (id, code, name, name_en, country_code, currency_code, importance, description, key_points, frequency, unit, source, favorable_direction, market_view_above, market_view_below) values
  ('10000000-0000-0000-0000-000000000001', 'US_CPI', '米国CPI(消費者物価指数)', 'Consumer Price Index', 'US', 'USD', 'HIGH',
    '消費者物価指数（CPI）は、消費者が購入するモノやサービスの価格の変動を測定する指標です。インフレの動向を示す重要な指標であり、金融政策の判断材料として注目されます。',
    array['インフレの動向を把握できる', '金融政策への影響が大きい', '為替や株式市場に大きな影響を与える'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'HIGHER_IS_POSITIVE',
    '米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。'),
  ('10000000-0000-0000-0000-000000000002', 'US_NFP', '米国雇用統計(非農業部門雇用者数)', 'Nonfarm Payrolls', 'US', 'USD', 'HIGH',
    '非農業部門雇用者数（NFP）は、農業部門を除く米国の雇用者数が前月から何人増減したかを示す指標です。米国の景気や雇用の強さを測る代表的な指標として注目されます。',
    array['米国の景気の強さを把握できる', 'FRBの金融政策判断に影響する', '発表直後に為替が大きく動きやすい'],
    'MONTHLY', 'K', 'U.S. Bureau of Labor Statistics', 'HIGHER_IS_POSITIVE',
    '米国の非農業部門雇用者数が予想を上回ると、雇用の底堅さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国の非農業部門雇用者数が予想を下回ると、雇用の減速から利下げが意識され、ドルが売られやすいとされる。'),
  ('10000000-0000-0000-0000-000000000003', 'US_FOMC', 'FOMC政策金利', 'FOMC Interest Rate Decision', 'US', 'USD', 'HIGH',
    'FOMC（連邦公開市場委員会）が決定する、米国の政策金利（フェデラル・ファンド金利の誘導目標）です。米国の金融政策の方向性を示し、世界の金融市場に大きな影響を与えます。',
    array['米国の金融政策の方向性がわかる', '米ドルの金利水準を直接左右する', '声明や会見で今後の見通しが示される', '世界の株式・債券市場にも影響する'],
    'IRREGULAR', '%', 'Federal Reserve', 'NEUTRAL',
    'FOMCの政策金利が予想より高い水準に決まると、米国の金利が高止まりするとの見方が強まり、ドルが買われやすいとされる。',
    'FOMCの政策金利が予想より低い水準に決まると、米国の金融緩和が進むとの見方が強まり、ドルが売られやすいとされる。'),
  ('10000000-0000-0000-0000-000000000004', 'JP_CPI', '日本CPI(消費者物価指数)', 'Japan Consumer Price Index', 'JP', 'JPY', 'HIGH',
    '日本の消費者物価指数（CPI）は、国内の消費者が購入するモノやサービスの価格の変動を前年同月比で示す指標です。日本のインフレの動向を示し、日銀の金融政策の判断材料として注目されます。',
    array['日本のインフレの動向を把握できる', '日銀の金融政策の判断材料になる', '円相場の方向性に影響する'],
    'MONTHLY', '%', 'Statistics Bureau of Japan', 'HIGHER_IS_POSITIVE',
    '日本CPIが予想を上回ると、物価の上昇から日銀の利上げ観測が強まり、円が買われやすいとされる。',
    '日本CPIが予想を下回ると、物価の伸び悩みから日銀の利上げが遠のくとの見方が強まり、円が売られやすいとされる。'),
  ('10000000-0000-0000-0000-000000000005', 'BOJ_RATE', '日銀政策金利', 'BOJ Interest Rate Decision', 'JP', 'JPY', 'HIGH',
    '日本銀行が金融政策決定会合で決定する政策金利です。日本の金融政策の方向性を示し、円の金利水準や為替相場に大きな影響を与えます。',
    array['日本の金融政策の方向性がわかる', '円の金利水準を直接左右する', '総裁会見の発言で相場が動きやすい'],
    'IRREGULAR', '%', 'Bank of Japan', 'NEUTRAL',
    '日銀の政策金利が予想より高い水準に決まると、金融引き締めが進むとの見方が強まり、円が買われやすいとされる。',
    '日銀の政策金利が予想より低い水準に決まると、金融緩和的な姿勢が続くとの見方が強まり、円が売られやすいとされる。');

-- ---------------------------------------------------------------------
-- FX pairs
-- ---------------------------------------------------------------------

insert into fx_pairs (id, symbol, base_currency, quote_currency, pip_size, price_precision) values
  ('20000000-0000-0000-0000-000000000001', 'USDJPY', 'USD', 'JPY', 0.01, 3),
  ('20000000-0000-0000-0000-000000000002', 'EURUSD', 'EUR', 'USD', 0.0001, 5),
  ('20000000-0000-0000-0000-000000000003', 'EURJPY', 'EUR', 'JPY', 0.01, 3),
  -- SCR-026 ホーム通貨ペア編集の選択肢 (2026-10-07)。価格データは持たない
  -- (GET /home の major_fx では price 等が null になる)。
  ('20000000-0000-0000-0000-000000000004', 'GBPJPY', 'GBP', 'JPY', 0.01, 3),
  ('20000000-0000-0000-0000-000000000005', 'AUDUSD', 'AUD', 'USD', 0.0001, 5),
  ('20000000-0000-0000-0000-000000000006', 'GBPUSD', 'GBP', 'USD', 0.0001, 5),
  ('20000000-0000-0000-0000-000000000007', 'USDCHF', 'USD', 'CHF', 0.0001, 5),
  ('20000000-0000-0000-0000-000000000008', 'AUDJPY', 'AUD', 'JPY', 0.01, 3),
  ('20000000-0000-0000-0000-000000000009', 'CADJPY', 'CAD', 'JPY', 0.01, 3);

-- ---------------------------------------------------------------------
-- Indicator <-> FX pair relevance
-- ---------------------------------------------------------------------

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1), -- US CPI x USDJPY
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 2), -- US CPI x EURUSD
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 1), -- US NFP x USDJPY
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 2), -- US NFP x EURUSD
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 1), -- FOMC x USDJPY
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 1), -- Japan CPI x USDJPY
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 2), -- Japan CPI x EURJPY
  ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 1); -- BOJ x USDJPY

-- ---------------------------------------------------------------------
-- Event 1: US CPI, already released, forecast present, has a revision and
-- a fact-based explanation, and reaction data for USDJPY across all
-- timeframes. Exercises the full "analyzable" path.
-- ---------------------------------------------------------------------

insert into economic_events (id, indicator_id, provider, provider_event_id, release_datetime, release_datetime_precision, importance, status, data_status) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'seed', 'seed-us-cpi-2026-09', '2026-09-10T12:30:00Z', 'EXACT', 'HIGH', 'RELEASED', 'AVAILABLE');

insert into event_snapshots (event_id, snapshot_type, forecast, actual, previous, unit, source, captured_at, surprise, surprise_direction) values
  ('30000000-0000-0000-0000-000000000001', 'RELEASE', 3.1, 3.3, 3.0, '%', 'U.S. Bureau of Labor Statistics', '2026-09-10T12:30:00Z', 0.2, 'POSITIVE');

-- Later revision to the previous month's figure — RELEASE snapshot above is
-- untouched; this is purely additive reference information.
insert into event_revisions (event_id, field_name, old_value, new_value, effective_at, source) values
  ('30000000-0000-0000-0000-000000000001', 'PREVIOUS', 3.0, 3.1, '2026-10-05T12:30:00Z', 'BLS monthly revision release');

insert into event_explanations (event_id, version, explanation_type, summary, source, source_url, published_at) values
  ('30000000-0000-0000-0000-000000000001', 1, 'FACT_SUMMARY', 'Headline CPI rose 3.3% YoY versus a forecast of 3.1%, driven largely by shelter and energy costs according to the BLS release.', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/cpi/', '2026-09-10T12:30:00Z');

insert into event_price_reactions (event_id, fx_pair_id, timeframe, pre_release_price, post_release_price, movement, pips, change_percent, max_upward, max_downward, max_upward_pips, max_downward_pips, data_status, calculated_at) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '1m', 147.20, 147.48, 0.28, 28.0, 0.1902, 0.30, -0.05, 30.0, -5.0, 'AVAILABLE', '2026-09-10T12:31:00Z'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '5m', 147.20, 147.76, 0.56, 56.0, 0.3804, 0.60, -0.05, 60.0, -5.0, 'AVAILABLE', '2026-09-10T12:35:00Z'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '15m', 147.20, 148.05, 0.85, 85.0, 0.5774, 0.90, -0.05, 90.0, -5.0, 'AVAILABLE', '2026-09-10T12:45:00Z'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30m', 147.20, 148.10, 0.90, 90.0, 0.6114, 0.95, -0.10, 95.0, -10.0, 'AVAILABLE', '2026-09-10T13:00:00Z'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60m', 147.20, 147.95, 0.75, 75.0, 0.5095, 0.95, -0.15, 95.0, -15.0, 'AVAILABLE', '2026-09-10T13:30:00Z');

-- Matching 1m FX price candles so Movement/Chart queries have something to
-- return for this event's window.
insert into fx_prices (fx_pair_id, "timestamp", timeframe, open, high, low, close, source) values
  ('20000000-0000-0000-0000-000000000001', '2026-09-10T12:29:00Z', '1m', 147.18, 147.22, 147.17, 147.20, 'seed'),
  ('20000000-0000-0000-0000-000000000001', '2026-09-10T12:30:00Z', '1m', 147.20, 147.50, 147.19, 147.48, 'seed'),
  ('20000000-0000-0000-0000-000000000001', '2026-09-10T12:31:00Z', '1m', 147.48, 147.55, 147.44, 147.52, 'seed');

-- ---------------------------------------------------------------------
-- Event 2: BOJ policy rate decision, released, no forecast available —
-- exercises "surprise = null, never 0" (requirements.md §11.2 / db-design
-- §5).
-- ---------------------------------------------------------------------

insert into economic_events (id, indicator_id, provider, provider_event_id, release_datetime, release_datetime_precision, importance, status, data_status) values
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 'seed', 'seed-boj-2026-09', '2026-09-12T03:00:00Z', 'APPROXIMATE', 'HIGH', 'RELEASED', 'PARTIAL');

insert into event_snapshots (event_id, snapshot_type, forecast, actual, previous, unit, source, captured_at, surprise, surprise_direction) values
  ('30000000-0000-0000-0000-000000000002', 'RELEASE', null, -0.1, -0.1, '%', 'Bank of Japan', '2026-09-12T03:00:00Z', null, null);

-- ---------------------------------------------------------------------
-- Event 3: US Non-Farm Payrolls, not yet released — exercises the
-- SCHEDULED / PENDING "before release" state on Home/Event Detail.
-- ---------------------------------------------------------------------

insert into economic_events (id, indicator_id, provider, provider_event_id, release_datetime, release_datetime_precision, importance, status, data_status) values
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'seed', 'seed-us-nfp-2026-10', '2026-10-03T12:30:00Z', 'EXACT', 'HIGH', 'SCHEDULED', 'PENDING');

-- ---------------------------------------------------------------------
-- 要人発言 (HQ指示 2026-10-05): speakers / speech_events. Past ones are
-- DELIVERED with a fact-only summary; future ones are SCHEDULED so
-- GET /notifications/upcoming has speech candidates. Euro area uses
-- country_code 'EU' (same alpha-2 style as economic_indicators).
-- ---------------------------------------------------------------------

insert into speakers (id, name, title, organization, country_code, currency_code) values
  ('40000000-0000-0000-0000-000000000001', 'ジェローム・パウエル', 'FRB議長', 'FRB', 'US', 'USD'),
  ('40000000-0000-0000-0000-000000000002', '植田和男', '日本銀行総裁', '日本銀行', 'JP', 'JPY'),
  ('40000000-0000-0000-0000-000000000003', 'クリスティーヌ・ラガルド', 'ECB総裁', 'ECB', 'EU', 'EUR');

insert into speech_events (id, speaker_id, provider, provider_event_id, title, summary, statement_datetime, importance, status) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'seed', 'seed-powell-2026-09-17', 'FOMC後の記者会見', '政策金利の据え置きを説明し、今後の判断はデータ次第との認識を示した。', '2026-09-17T18:30:00Z', 'HIGH', 'DELIVERED'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'seed', 'seed-ueda-2026-09-19', '金融政策決定会合後の記者会見', '現行の金融緩和の枠組みを維持する方針を説明した。', '2026-09-19T06:30:00Z', 'HIGH', 'DELIVERED'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'seed', 'seed-lagarde-2026-09-24', '欧州議会での証言', 'ユーロ圏のインフレ動向について説明した。', '2026-09-24T13:00:00Z', 'MEDIUM', 'DELIVERED'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 'seed', 'seed-powell-2026-10-14', '経済見通しに関する講演', null, '2026-10-14T16:00:00Z', 'HIGH', 'SCHEDULED'),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000002', 'seed', 'seed-ueda-2026-10-16', '国会答弁', null, '2026-10-16T01:00:00Z', 'MEDIUM', 'SCHEDULED');
