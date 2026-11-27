import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * Golden snapshot of GET /events/{id}/strategy-analysis (byte-exact string comparison).
 *
 * Purpose: the event reaction analysis work (GET /events/{id}/reaction-analysis) must not change the existing
 * strategy-analysis response at all. This test was added BEFORE any of that code. The expected body is the
 * response of the unmodified implementation to a fixed, fully synthetic fake-Supabase scenario (no real data),
 * stored verbatim in tests/fixtures/strategy-analysis.snapshot.json. If this test fails, the existing response
 * changed (a value, a key, or the key order).
 */
const TOKEN = 'eyJ.strategy-snapshot.sig';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const CO_EVENT_ID = '00000000-0000-4000-8000-000000000002';
const INDICATOR_ID = '00000000-0000-4000-8000-0000000000a1';
const CO_INDICATOR_ID = '00000000-0000-4000-8000-0000000000a2';
const USDJPY_ID = '00000000-0000-4000-8000-0000000000b1';
const EURUSD_ID = '00000000-0000-4000-8000-0000000000b2';
const RELEASE_AT = '2030-01-10T13:30:00.000Z';
const SNAPSHOT_PATH = new URL('../fixtures/strategy-analysis.snapshot.json', import.meta.url);

vi.mock('../../src/auth/jwt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/jwt.js')>();
  return {
    ...actual,
    verifySupabaseJwt: vi.fn((token: string | undefined) =>
      Promise.resolve(
        token === TOKEN
          ? { ok: true, payload: { sub: USER_ID, email: 'a@example.com', exp: 9_999_999_999 } }
          : { ok: false, reason: token ? 'invalid' : 'missing' },
      ),
    ),
  };
});

const indicator = {
  code: 'EXAMPLE_INDICATOR',
  name: 'Example indicator',
  display_name: null,
  country_code: 'US',
  currency_code: 'USD',
  favorable_direction: 'HIGHER_IS_BETTER',
};

function eventRow(
  id: string,
  indicatorId: string,
  code: string,
  releaseAt: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    indicator_id: indicatorId,
    release_datetime: releaseAt,
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status: 'RELEASED',
    data_status: 'AVAILABLE',
    is_provisional: false,
    provider: 'example_provider',
    provider_event_id: null,
    economic_indicators: { ...indicator, code },
    ...extra,
  };
}

/** A past RELEASED event with its RELEASE snapshot (the fake client has no joins: the filter key is set explicitly). */
function pastRow(n: number, releaseAt: string, surpriseDirection: string) {
  return eventRow(`00000000-0000-4000-8000-0000000000d${n}`, INDICATOR_ID, 'EXAMPLE_INDICATOR', releaseAt, {
    'event_snapshots.snapshot_type': 'RELEASE',
    event_snapshots: [
      {
        snapshot_type: 'RELEASE',
        forecast: 2 + n / 10,
        actual: 2.2 + n / 10,
        previous: 2,
        surprise: 0.2,
        surprise_direction: surpriseDirection,
        secondary_value_kind: null,
        secondary_forecast: null,
        secondary_actual: null,
        secondary_previous: null,
      },
    ],
  });
}

const PAST = [
  {
    n: 1,
    at: '2029-12-06T13:30:00.000Z',
    surprise: 'POSITIVE',
    pips1: 8.5,
    pips5: 12,
    pips15: 15,
    up15: 20,
    down15: -2,
  },
  { n: 2, at: '2029-11-08T13:30:00.000Z', surprise: 'POSITIVE', pips1: 6, pips5: 3, pips15: -4, up15: 9, down15: -9 },
  {
    n: 3,
    at: '2029-10-04T12:30:00.000Z',
    surprise: 'NEGATIVE',
    pips1: -5,
    pips5: -9,
    pips15: -11,
    up15: 1,
    down15: -14,
  },
  { n: 4, at: '2029-09-06T12:30:00.000Z', surprise: 'NEUTRAL', pips1: 0, pips5: 2, pips15: 3, up15: 4, down15: -1 },
];

function reactionRows() {
  return PAST.flatMap((p) => {
    const id = `00000000-0000-4000-8000-0000000000d${p.n}`;
    const base = { event_id: id, fx_pair_id: USDJPY_ID, data_status: 'AVAILABLE' };
    return [
      { ...base, timeframe: '1m', pips: p.pips1, max_upward: 0.06, max_downward: -0.02 },
      { ...base, timeframe: '5m', pips: p.pips5, max_upward: 0.1, max_downward: -0.03 },
      { ...base, timeframe: '15m', pips: p.pips15, max_upward: p.up15 / 100, max_downward: p.down15 / 100 },
      { ...base, timeframe: '30m', pips: p.pips15, max_upward: p.up15 / 100, max_downward: p.down15 / 100 },
      { ...base, timeframe: '60m', pips: p.pips15, max_upward: p.up15 / 100, max_downward: p.down15 / 100 },
    ];
  });
}

function minuteCandles(fxPairId: string, releaseAt: string, count: number) {
  const startMs = Date.parse(releaseAt);
  return Array.from({ length: count }, (_, i) => ({
    fx_pair_id: fxPairId,
    timeframe: '1m',
    timestamp: new Date(startMs + i * 60_000).toISOString(),
    verification_status: 'VERIFIED',
  }));
}

function tables(): Record<string, unknown[]> {
  return {
    entitlements: [
      { user_id: USER_ID, feature_code: 'VIEW_BASIC_EVENT', enabled: true, expires_at: null },
      { user_id: USER_ID, feature_code: 'VIEW_ADVANCED_STATS', enabled: true, expires_at: null },
    ],
    economic_events: [
      eventRow(EVENT_ID, INDICATOR_ID, 'EXAMPLE_INDICATOR', RELEASE_AT, { status: 'SCHEDULED' }),
      eventRow(CO_EVENT_ID, CO_INDICATOR_ID, 'EXAMPLE_INDICATOR_2', RELEASE_AT, { status: 'SCHEDULED' }),
      ...PAST.map((p) => pastRow(p.n, p.at, p.surprise)),
    ],
    indicator_fx_pairs: [
      {
        indicator_id: INDICATOR_ID,
        priority: 1,
        is_active: true,
        fx_pairs: { id: USDJPY_ID, symbol: 'USDJPY', base_currency: 'USD', quote_currency: 'JPY', is_active: true },
      },
      {
        indicator_id: INDICATOR_ID,
        priority: 2,
        is_active: true,
        fx_pairs: { id: EURUSD_ID, symbol: 'EURUSD', base_currency: 'EUR', quote_currency: 'USD', is_active: true },
      },
    ],
    fx_pairs: [
      { id: USDJPY_ID, symbol: 'USDJPY', base_currency: 'USD', quote_currency: 'JPY', is_active: true },
      { id: EURUSD_ID, symbol: 'EURUSD', base_currency: 'EUR', quote_currency: 'USD', is_active: true },
    ],
    event_price_reactions: reactionRows(),
    // Past #1 and #2 have a complete 60-minute window of verified 1m candles; #3 is short; #4 has none.
    fx_prices: [
      ...minuteCandles(USDJPY_ID, PAST[0]!.at, 60),
      ...minuteCandles(USDJPY_ID, PAST[1]!.at, 60),
      ...minuteCandles(USDJPY_ID, PAST[2]!.at, 40),
    ],
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function get(url: string, data: Record<string, unknown[]> = tables()) {
  const { buildApp } = await import('../../src/app.js');
  const app = buildApp({
    env: {
      ...loadEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' }),
      PRICE_FEATURES_ENABLED: true,
    },
    supabase: fakeSupabaseClient(data),
    logger: false,
  });
  apps.push(app);
  await app.ready();
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${TOKEN}` } });
}

describe('GET /events/{id}/strategy-analysis golden snapshot', () => {
  it('the response body is byte-identical to the recorded snapshot', async () => {
    const response = await get(`/events/${EVENT_ID}/strategy-analysis`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(readFileSync(SNAPSHOT_PATH, 'utf8'));
  });

  it('the response key sets are pinned (no key added or removed)', async () => {
    const response = await get(`/events/${EVENT_ID}/strategy-analysis`);
    const body = response.json<Record<string, unknown> & { analysis: Record<string, unknown> }>();
    expect(Object.keys(body)).toEqual([
      'event_id',
      'available',
      'required_entitlement',
      'fx_pair',
      'co_released_indicators',
      'market_event_coverage',
      'analysis',
    ]);
    expect(Object.keys(body.analysis)).toEqual(['status', 'sample_window', 'minimum_samples', 'releases', 'summary']);
  });

  it('the scenario really exercises the analysis (not an empty response)', async () => {
    const body = (await get(`/events/${EVENT_ID}/strategy-analysis`)).json<{
      fx_pair: { symbol: string };
      co_released_indicators: unknown[];
      analysis: { status: string; releases: unknown[] };
    }>();
    expect(body.fx_pair.symbol).toBe('USDJPY');
    expect(body.co_released_indicators).toHaveLength(1);
    expect(body.analysis.status).toBe('READY');
    expect(body.analysis.releases).toHaveLength(PAST.length);
  });
});
