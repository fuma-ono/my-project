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

insert into economic_indicators (id, code, name, country_code, currency_code, importance, description, frequency, unit, source, favorable_direction) values
  ('10000000-0000-0000-0000-000000000001', 'US_CPI', 'US Consumer Price Index (YoY)', 'US', 'USD', 'HIGH', 'US headline inflation rate, year-over-year.', 'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'HIGHER_IS_POSITIVE'),
  ('10000000-0000-0000-0000-000000000002', 'US_NFP', 'US Non-Farm Payrolls', 'US', 'USD', 'HIGH', 'Change in the number of employed people, excluding the farming industry.', 'MONTHLY', 'K', 'U.S. Bureau of Labor Statistics', 'HIGHER_IS_POSITIVE'),
  ('10000000-0000-0000-0000-000000000003', 'US_FOMC', 'FOMC Interest Rate Decision', 'US', 'USD', 'HIGH', 'Federal Open Market Committee target rate decision.', 'IRREGULAR', '%', 'Federal Reserve', 'NEUTRAL'),
  ('10000000-0000-0000-0000-000000000004', 'JP_CPI', 'Japan Consumer Price Index (YoY)', 'JP', 'JPY', 'HIGH', 'Japan headline inflation rate, year-over-year.', 'MONTHLY', '%', 'Statistics Bureau of Japan', 'HIGHER_IS_POSITIVE'),
  ('10000000-0000-0000-0000-000000000005', 'BOJ_RATE', 'BOJ Policy Rate Decision', 'JP', 'JPY', 'HIGH', 'Bank of Japan monetary policy rate decision.', 'IRREGULAR', '%', 'Bank of Japan', 'NEUTRAL');

-- ---------------------------------------------------------------------
-- FX pairs
-- ---------------------------------------------------------------------

insert into fx_pairs (id, symbol, base_currency, quote_currency, pip_size, price_precision) values
  ('20000000-0000-0000-0000-000000000001', 'USDJPY', 'USD', 'JPY', 0.01, 3),
  ('20000000-0000-0000-0000-000000000002', 'EURUSD', 'EUR', 'USD', 0.0001, 5),
  ('20000000-0000-0000-0000-000000000003', 'EURJPY', 'EUR', 'JPY', 0.01, 3);

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
