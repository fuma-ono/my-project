/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- response bodies are read as untyped JSON on purpose (the payload shape is what is under test) */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { emptyRights, type RightKey, type RightsLedgerEntry } from '../../src/domain/technical/index.js';
import { TWELVEDATA_FREE_INTERNAL_SOURCE_ID } from '../../src/domain/technical/rightsRegistry.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * GET /events/{id}/reaction-analysis with SYNTHETIC data only (made-up prices around 150, made-up ids). JWT verification
 * is mocked (no network); the DB is a fake that records the tables it was asked to read. The rights ledger is injected.
 */
const TOKEN = 'eyJ.reaction.sig';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const CO_EVENT_ID = '00000000-0000-4000-8000-000000000002';
const INDICATOR_ID = '00000000-0000-4000-8000-0000000000a1';
const CO_INDICATOR_ID = '00000000-0000-4000-8000-0000000000a2';
const USDJPY = '00000000-0000-4000-8000-0000000000b1';
const EURUSD = '00000000-0000-4000-8000-0000000000b2';
const GBPCHF = '00000000-0000-4000-8000-0000000000b3'; // does not contain USD
const MIN = 60_000;
const T = Date.parse('2030-01-10T13:30:00.000Z'); // a Thursday, 08:30 New York (EST)
const NOW = '2030-01-10T16:00:00.000Z'; // 2.5 hours after the release: every window is closed

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

function ledgerWith(confirmed: readonly RightKey[], extra: Partial<RightsLedgerEntry> = {}): RightsLedgerEntry {
  const rights = emptyRights();
  for (const k of confirmed) {
    rights[k] = { status: 'confirmed', evidenceUrl: `https://evidence.example/${k}`, confirmedAt: '2030-01-01' };
  }
  return {
    sourceId: TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
    providerName: 'Synthetic Test Provider',
    termsUrl: 'https://example.invalid/terms',
    rights,
    ...extra,
  };
}
/** Raw-data redistribution is deliberately NOT confirmed: the analysis needs only commercial use, derived display, storage. */
const CONFIRMED = ledgerWith(['commercialUse', 'derivedDisplay', 'storage']);
/** Same plus externalDisplay (display of price information): the only ledger under which price points are returned. */
const PRICED = ledgerWith(['commercialUse', 'derivedDisplay', 'storage', 'externalDisplay']);

// ---- synthetic market data -------------------------------------------------
/** Pips (1 pip = 0.01) above P0 of the golden shapes: index = minutes after the release. */
function shape(points: [number, number][]): number[] {
  const out: number[] = [];
  for (let m = 0; m <= 60; m++) {
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, va] = points[i]!;
      const [b, vb] = points[i + 1]!;
      if (m >= a && m <= b) {
        out.push(va + ((vb - va) * (m - a)) / (b - a));
        break;
      }
    }
  }
  return out;
}
const SHAPES = {
  CONTINUATION: shape([
    [0, 0],
    [2, 4],
    [10, 12],
    [60, 25],
  ]),
  PULLBACK: shape([
    [0, 0],
    [2, 4],
    [5, 10],
    [20, 4],
    [60, 12],
  ]),
  FULL_RETRACE: shape([
    [0, 0],
    [2, 4],
    [5, 10],
    [40, -3],
    [60, 0.5],
  ]),
  REVERSAL: shape([
    [0, 0],
    [2, 4],
    [5, 10],
    [40, -4],
    [60, -12],
  ]),
  SMALL: shape([
    [0, 0],
    [2, 1],
    [10, 2],
    [60, -3],
  ]),
};

/** A quiet market: closes alternate by exactly 0.01 (1 pip) every minute, so sigma_own = sigma_typical = 0.01. */
const quiet = (minute: number) => 150 + (minute % 2) * 0.01;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

interface EventSpec {
  id: string;
  at: number;
  shape: number[];
  skipMinutes?: number[];
}
const PAST: EventSpec[] = [
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    at: Date.parse('2030-01-03T13:30:00.000Z'),
    shape: SHAPES.CONTINUATION,
  },
  { id: '00000000-0000-4000-8000-0000000000d2', at: Date.parse('2029-12-27T13:30:00.000Z'), shape: SHAPES.PULLBACK },
  {
    id: '00000000-0000-4000-8000-0000000000d3',
    at: Date.parse('2029-12-20T13:30:00.000Z'),
    shape: SHAPES.FULL_RETRACE,
  },
  { id: '00000000-0000-4000-8000-0000000000d4', at: Date.parse('2029-12-13T13:30:00.000Z'), shape: SHAPES.REVERSAL },
  { id: '00000000-0000-4000-8000-0000000000d5', at: Date.parse('2029-12-06T13:30:00.000Z'), shape: SHAPES.SMALL },
];

function priceRows(pairId: string, specs: EventSpec[], withRows: (minute: number) => boolean = () => true) {
  const rows: Record<string, unknown>[] = [];
  const firstDay = Date.parse('2029-11-20T00:00:00Z');
  const lastDay = Date.parse('2030-01-10T00:00:00Z');
  const paths = new Map<number, number>();
  for (const s of specs) {
    const t0 = Math.floor(s.at / MIN);
    const c0 = quiet(t0 - 1);
    for (let k = 1; k <= 60; k++) paths.set(t0 + k - 1, r6(c0 + s.shape[k]! * 0.01));
  }
  const skip = new Set(specs.flatMap((s) => (s.skipMinutes ?? []).map((k) => Math.floor(s.at / MIN) + k - 1)));
  for (let day = firstDay; day <= lastDay; day += 86_400_000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (
      let minute = Math.floor((day + 12 * 3_600_000) / MIN);
      minute < Math.floor((day + 14.5 * 3_600_000) / MIN);
      minute++
    ) {
      if (skip.has(minute) || !withRows(minute)) continue;
      rows.push({
        fx_pair_id: pairId,
        timeframe: '1m',
        timestamp: new Date(minute * MIN).toISOString(),
        close: paths.get(minute) ?? r6(quiet(minute)),
        verification_status: 'VERIFIED',
      });
    }
  }
  return rows;
}

const indicator = (code: string, currency = 'USD') => ({
  code,
  name: `${code} name`,
  display_name: null,
  country_code: 'US',
  currency_code: currency,
  favorable_direction: 'HIGHER_IS_BETTER',
});
function eventRow(id: string, indicatorId: string, code: string, at: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    indicator_id: indicatorId,
    release_datetime: new Date(at).toISOString(),
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status: 'RELEASED',
    data_status: 'AVAILABLE',
    is_provisional: false,
    provider: 'example_provider',
    provider_event_id: null,
    economic_indicators: indicator(code),
    ...extra,
  };
}
const pairRow = (id: string, symbol: string, base: string, quote: string, active = true) => ({
  id,
  symbol,
  base_currency: base,
  quote_currency: quote,
  is_active: active,
});

const NOW_SPEC: EventSpec = { id: EVENT_ID, at: T, shape: SHAPES.PULLBACK };

function tables(over: Record<string, unknown[]> = {}, spec: EventSpec = NOW_SPEC): Record<string, unknown[]> {
  return {
    entitlements: [
      { user_id: USER_ID, feature_code: 'VIEW_BASIC_EVENT', enabled: true, expires_at: null },
      { user_id: USER_ID, feature_code: 'VIEW_ADVANCED_STATS', enabled: true, expires_at: null },
    ],
    economic_events: [
      eventRow(EVENT_ID, INDICATOR_ID, 'EXAMPLE_INDICATOR', spec.at),
      eventRow(CO_EVENT_ID, CO_INDICATOR_ID, 'EXAMPLE_INDICATOR_2', spec.at),
      ...PAST.map((p) => eventRow(p.id, INDICATOR_ID, 'EXAMPLE_INDICATOR', p.at)),
    ],
    indicator_fx_pairs: [
      { indicator_id: INDICATOR_ID, priority: 1, is_active: true, fx_pairs: pairRow(USDJPY, 'USDJPY', 'USD', 'JPY') },
      { indicator_id: INDICATOR_ID, priority: 2, is_active: true, fx_pairs: pairRow(EURUSD, 'EURUSD', 'EUR', 'USD') },
    ],
    fx_pairs: [
      pairRow(USDJPY, 'USDJPY', 'USD', 'JPY'),
      pairRow(EURUSD, 'EURUSD', 'EUR', 'USD'),
      pairRow(GBPCHF, 'GBPCHF', 'GBP', 'CHF'),
    ],
    event_price_reactions: [
      reaction('1m', 4, 4.2, 150.04, 4.5, -0.3),
      reaction('5m', 10, 10, 150.1, 10.3, -0.3),
      reaction('15m', 6, 6, 150.06, 10.5, -0.3),
      { ...reaction('30m', null, null, null, null, null), data_status: 'UNAVAILABLE' },
      // no 60m row: DATA_PENDING
    ],
    fx_prices: priceRows(USDJPY, [spec, ...PAST]),
    speech_events: [],
    ...over,
  };
}
function reaction(
  timeframe: string,
  pips: number | null,
  _x: number | null,
  post: number | null,
  up: number | null,
  down: number | null,
) {
  return {
    event_id: EVENT_ID,
    fx_pair_id: USDJPY,
    timeframe,
    pre_release_price: 150,
    post_release_price: post,
    movement: null,
    pips,
    change_percent: null,
    max_upward: null,
    max_downward: null,
    max_upward_pips: up,
    max_downward_pips: down,
    data_status: 'AVAILABLE',
  };
}

function recordingClient(data: Record<string, unknown[]>): { client: SupabaseClient; reads: string[] } {
  const inner = fakeSupabaseClient(data);
  const reads: string[] = [];
  const client = {
    from: (table: string) => {
      reads.push(table);
      return inner.from(table);
    },
  } as unknown as SupabaseClient;
  return { client, reads };
}

const apps: FastifyInstance[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(
  options: { price?: boolean; ledger?: readonly RightsLedgerEntry[]; data?: Record<string, unknown[]> } = {},
) {
  const { buildApp } = await import('../../src/app.js');
  const { client, reads } = recordingClient(options.data ?? tables());
  const app = buildApp({
    env: {
      ...loadEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' }),
      PRICE_FEATURES_ENABLED: options.price ?? true,
    },
    supabase: client,
    logger: false,
    ...(options.ledger ? { technicalRightsLedger: options.ledger } : {}),
  });
  apps.push(app);
  await app.ready();
  const get = (url: string, token: string | null = TOKEN) =>
    app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return { get, reads };
}
const open = (options: Parameters<typeof appWith>[0] = {}) => appWith({ ledger: [CONFIRMED], ...options });
const URL_OF = (id = EVENT_ID, qs = '') => `/events/${id}/reaction-analysis${qs}`;
const PRICE_TABLES = [
  'fx_prices',
  'event_price_reactions',
  'fx_pairs',
  'economic_events',
  'speech_events',
  'indicator_fx_pairs',
];

describe('gate order: auth -> 404 flag -> 403 rights -> authorization -> DB', () => {
  it('no token: 401 before anything else, even with the flag off and the ledger closed', async () => {
    const { get, reads } = await appWith({ price: false });
    expect((await get(URL_OF(), null)).statusCode).toBe(401);
    expect(reads).toEqual([]);
  });

  it('PRICE_FEATURES_ENABLED off: 404 NOT_FOUND and no DB read, even with a confirmed ledger', async () => {
    const { get, reads } = await appWith({ price: false, ledger: [CONFIRMED] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(reads).toEqual([]);
  });

  it('flag gate comes before validation (a bad id is still 404 when off)', async () => {
    const { get, reads } = await appWith({ price: false });
    expect((await get(URL_OF('not-a-uuid', '?fx_pair_id=bad'))).statusCode).toBe(404);
    expect(reads).toEqual([]);
  });

  it('the real registry keeps the route closed: 403 DATA_RIGHTS_UNCONFIRMED with detail.missing, no DB read', async () => {
    const { get, reads } = await appWith({});
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error: { code: string; message: string; missing: string[] } }>();
    expect(body.error.code).toBe('DATA_RIGHTS_UNCONFIRMED');
    expect(body.error.message).toBe('Data rights for this feature are not confirmed.');
    expect(body.error.missing.sort()).toEqual(
      ['commercialUse', 'derivedDisplay', 'storage'].map((k) => `${TWELVEDATA_FREE_INTERNAL_SOURCE_ID}:${k}`).sort(),
    );
    expect(reads).toEqual([]);
  });

  it('rights without a confirmation date do not open it (403, no DB read)', async () => {
    const rights = ledgerWith(['commercialUse', 'derivedDisplay', 'storage']).rights;
    for (const k of ['commercialUse', 'derivedDisplay', 'storage'] as const) {
      rights[k] = { status: 'confirmed', evidenceUrl: 'https://evidence.example/x' };
    }
    const { get, reads } = await appWith({ ledger: [{ ...CONFIRMED, rights }] });
    expect((await get(URL_OF())).statusCode).toBe(403);
    expect(reads).toEqual([]);
  });

  it('a ledger with a source but without analysis display rights stays closed even if raw redistribution is confirmed', async () => {
    const { get, reads } = await appWith({ ledger: [ledgerWith(['redistribution', 'storage', 'externalDisplay'])] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(403);
    expect(response.json().error.missing).toEqual(
      expect.arrayContaining([
        `${TWELVEDATA_FREE_INTERNAL_SOURCE_ID}:commercialUse`,
        `${TWELVEDATA_FREE_INTERNAL_SOURCE_ID}:derivedDisplay`,
      ]),
    );
    expect(reads).toEqual([]);
  });

  it('an empty ledger lists the source as missing', async () => {
    const { get } = await appWith({ ledger: [] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(403);
    expect(response.json().error.missing).toEqual([`${TWELVEDATA_FREE_INTERNAL_SOURCE_ID}:*`]);
  });

  it('raw-data redistribution is NOT required: commercialUse + derivedDisplay + storage are enough', async () => {
    const { get } = await open();
    expect((await get(URL_OF())).statusCode).toBe(200);
  });

  it('without VIEW_BASIC_EVENT: 403 FEATURE_NOT_ENTITLED, no price table is read', async () => {
    const { get, reads } = await open({ data: tables({ entitlements: [] }) });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FEATURE_NOT_ENTITLED' } });
    expect(reads.filter((t) => PRICE_TABLES.includes(t))).toEqual([]);
  });

  it('without VIEW_ADVANCED_STATS: 200 available:false and no price / event table is read', async () => {
    const data = tables({
      entitlements: [{ user_id: USER_ID, feature_code: 'VIEW_BASIC_EVENT', enabled: true, expires_at: null }],
    });
    const { get, reads } = await open({ data });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      event_id: EVENT_ID,
      available: false,
      required_entitlement: 'VIEW_ADVANCED_STATS',
      event: null,
      fx_pair: null,
      windows: [],
      history: null,
    });
    expect(reads.filter((t) => PRICE_TABLES.includes(t))).toEqual([]);
  });
});

describe('input and lookup errors', () => {
  it('a non-uuid fx_pair_id is 422 VALIDATION_ERROR', async () => {
    const { get } = await open();
    const response = await get(URL_OF(EVENT_ID, '?fx_pair_id=nope'));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
  it('a non-uuid event id is 422', async () => {
    const { get } = await open();
    expect((await get(URL_OF('nope'))).statusCode).toBe(422);
  });
  it('an unknown event is 404 EVENT_NOT_FOUND', async () => {
    const { get } = await open();
    const response = await get(URL_OF('00000000-0000-4000-8000-0000000000ff'));
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'EVENT_NOT_FOUND' } });
  });
  it.each([
    ['an unknown pair', '00000000-0000-4000-8000-0000000000fe'],
    ['a pair without the indicator currency', GBPCHF],
  ])('%s is 404 FX_PAIR_NOT_FOUND', async (_name, pair) => {
    const { get } = await open();
    const response = await get(URL_OF(EVENT_ID, `?fx_pair_id=${pair}`));
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'FX_PAIR_NOT_FOUND' } });
  });
  it('unknown query keys are ignored', async () => {
    const { get } = await open();
    expect((await get(URL_OF(EVENT_ID, '?other=1&limit=5'))).statusCode).toBe(200);
  });
  it('no usable pair at all: 200 with fx_pair null and empty windows', async () => {
    const { get } = await open({ data: tables({ indicator_fx_pairs: [] }) });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      available: true,
      fx_pair: null,
      selectable_pairs: [],
      windows: [],
      history: { windows: [] },
      dst_mismatch_caution: { active: false },
    });
  });
});

async function analysis(options: Parameters<typeof appWith>[0] = {}, qs = '') {
  const { get, reads } = await open(options);
  const response = await get(URL_OF(EVENT_ID, qs));
  expect(response.statusCode).toBe(200);
  return { body: response.json(), reads };
}

describe('200 response', () => {
  it('has exactly the documented top-level keys, in order', async () => {
    const { body } = await analysis();
    expect(Object.keys(body)).toEqual([
      'event_id',
      'available',
      'required_entitlement',
      'event',
      'fx_pair',
      'selectable_pairs',
      'market_event',
      'meta',
      'dst_mismatch_caution',
      'reference',
      'baseline',
      'initial',
      'windows',
      'history',
    ]);
    expect(body).toMatchObject({ event_id: EVENT_ID, available: true, required_entitlement: null });
  });

  it('event, pair, selectable pairs and the simultaneous-release group', async () => {
    const { body } = await analysis();
    expect(body.event).toEqual({
      indicator_id: INDICATOR_ID,
      indicator_code: 'EXAMPLE_INDICATOR',
      name: 'EXAMPLE_INDICATOR name',
      country_code: 'US',
      currency_code: 'USD',
      release_datetime: '2030-01-10T13:30:00.000Z',
      release_datetime_precision: 'EXACT',
    });
    expect(body.fx_pair).toEqual({ fx_pair_id: USDJPY, symbol: 'USDJPY', pip_size: 0.01 });
    expect(body.selectable_pairs).toEqual([
      { fx_pair_id: USDJPY, symbol: 'USDJPY', is_default: true },
      { fx_pair_id: EURUSD, symbol: 'EURUSD', is_default: false },
    ]);
    expect(body.market_event).toEqual({
      group_key: 'example_provider|2030-01-10T13:30:00.000Z',
      independent_market_events: 1,
      indicator_count: 2,
      co_released_indicators: [{ indicator_id: CO_INDICATOR_ID, indicator_code: 'EXAMPLE_INDICATOR_2' }],
      label_shared: true,
    });
  });

  it('meta carries the parameter set, hash, source, bars_as_of, ledger and limits', async () => {
    const { body } = await analysis();
    expect(body.meta).toMatchObject({
      param_set_id: 'rx-v1',
      param_set_status: 'PROVISIONAL',
      classifier_version: '1.0.0',
      data_source: TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
      bars_as_of: '2030-01-10T14:30:00.000Z',
      computed_at: NOW,
      time_basis: { event_times: 'UTC', baseline_clock: 'America/New_York' },
      history_limits: { max_samples: 10, min_required: 3 },
      rights_ledger: {
        entry_id: TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
        provider_name: 'Synthetic Test Provider',
        terms_url: 'https://example.invalid/terms',
        status: 'confirmed',
        features: ['eventReactionAnalysis'],
        confirmed_at: '2030-01-01',
      },
    });
    expect(body.meta.params_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.meta.params).toMatchObject({
      windows: [1, 5, 15, 30, 60],
      classified_windows: [15, 30, 60],
      w0: 2,
      k_small: 2,
      rho: 1,
    });
    expect(body.meta.rights_ledger.evidence_urls.sort()).toEqual(
      ['commercialUse', 'derivedDisplay', 'storage'].map((k) => `https://evidence.example/${k}`).sort(),
    );
  });

  it('reference price, baseline and initial move come from the synthetic bars', async () => {
    // Contract of this endpoint: pre_release_price / close_price exist only with externalDisplay confirmed (PRICED ledger).
    const { body } = await analysis({ ledger: [PRICED] });
    const c0 = Math.round(quiet(Math.floor(T / MIN) - 1) * 1e6) / 1e6;
    expect(body.reference).toEqual({ pre_release_price: c0, pre_release_bar_closed_at: '2030-01-10T13:30:00.000Z' });
    expect(body.baseline).toMatchObject({
      kind: 'MAX_OWN_TYPICAL_NY',
      source: 'MAX_OWN_TYPICAL',
      sigma_pips: 1,
      sigma_own_pips: 1,
      sigma_typical_pips: 1,
      typical_session_count: 10,
      clock_mismatch_sessions: 0,
      pre_window_overlaps: [],
    });
    expect(body.initial).toEqual({ window_minutes: 2, signed_pips: 4, direction: 'UP', z0: 2.8284 });
    expect(body.dst_mismatch_caution).toEqual({ active: false });
  });

  it('windows: fixed order, reaction values, REFERENCE_ONLY for 1 and 5, labels for 15 / 30 / 60', async () => {
    const { body } = await analysis({ ledger: [PRICED] }); // close_price needs externalDisplay
    expect(body.windows.map((w: { minutes: number }) => w.minutes)).toEqual([1, 5, 15, 30, 60]);
    const [w1, w5, w15, w30, w60] = body.windows;
    expect(w1).toMatchObject({
      data_status: 'AVAILABLE',
      pips: 4,
      close_price: 150.04,
      high_pips: 4.5,
      low_pips: -0.3,
      range_pips: 4.8,
      classification_status: 'REFERENCE_ONLY',
      label: null,
      reason: 'WINDOW_TOO_SHORT',
      evidence: null,
    });
    expect(w5).toMatchObject({
      classification_status: 'REFERENCE_ONLY',
      label: null,
      reason: 'WINDOW_EXCLUDED_BY_PARAMS',
      evidence: null,
      pips: 10,
    });
    expect(w15).toMatchObject({
      data_status: 'AVAILABLE',
      range_pips: 10.8,
      classification_status: 'CLASSIFIED',
      label: 'CONTINUATION',
      reason: null,
    });
    expect(w30).toMatchObject({
      data_status: 'UNAVAILABLE',
      pips: null,
      range_pips: null,
      classification_status: 'CLASSIFIED',
      label: 'PULLBACK',
    });
    expect(w60).toMatchObject({
      data_status: 'DATA_PENDING',
      pips: null,
      classification_status: 'CLASSIFIED',
      label: 'PULLBACK',
    });
    expect(w30.evidence).toMatchObject({
      initial_z: 2.8284,
      peak_offset_pips: 10,
      worst_pullback_pips: 6,
      worst_pullback_ratio: 0.6,
      final_offset_pips: 5.8, // median of the last three closes (minutes 28 to 30)
      borderline: false,
    });
    for (const w of body.windows) expect(w.overlap).toEqual({ has_overlap: false, items: [] });
  });

  it('history: classified windows only, every past event is a sample, rules on the sample count', async () => {
    const { body } = await analysis();
    expect(body.history.windows.map((w: { minutes: number }) => w.minutes)).toEqual([15, 30, 60]);
    const h60 = body.history.windows[2];
    expect(h60).toMatchObject({
      status: 'OK',
      sample_count: 5,
      min_required: 3,
      max_samples: 10,
      determined_count: 4,
      undetermined_count: 1,
      undetermined_by_reason: { SMALL_INITIAL: 1 },
      overlap_count: 0,
      class_counts: { CONTINUATION: 1, PULLBACK: 1, FULL_RETRACE: 1, REVERSAL: 1 },
      shares: { CONTINUATION: 0.25, PULLBACK: 0.25, FULL_RETRACE: 0.25, REVERSAL: 0.25 },
      dominant_label: null, // four-way tie
    });
    expect(h60.samples.map((s: { event_id: string; label: string }) => [s.event_id, s.label])).toEqual([
      [PAST[0]!.id, 'CONTINUATION'],
      [PAST[1]!.id, 'PULLBACK'],
      [PAST[2]!.id, 'FULL_RETRACE'],
      [PAST[3]!.id, 'REVERSAL'],
      [PAST[4]!.id, 'UNDETERMINED'],
    ]);
    expect(h60.samples[4]).toMatchObject({ reason: 'SMALL_INITIAL', has_overlap: false });
    expect(h60.samples[0]).toMatchObject({ release_datetime: '2030-01-03T13:30:00.000Z', reason: null });
  });

  it('past events without 1-minute bars are samples (NO_PRICE_DATA) and below the minimum the shares are withheld', async () => {
    const bare = PAST.slice(2).map((p) => Math.floor(p.at / MIN));
    const data = tables({
      fx_prices: priceRows(USDJPY, [NOW_SPEC, PAST[0]!, PAST[1]!], (m) => !bare.some((t) => m >= t - 1 && m < t + 61)),
    });
    const { body } = await analysis({ data });
    const h = body.history.windows[2];
    expect(h).toMatchObject({
      status: 'INSUFFICIENT_SAMPLE',
      sample_count: 5,
      determined_count: 2,
      undetermined_count: 3,
      undetermined_by_reason: { NO_PRICE_DATA: 3 },
      shares: null,
      dominant_label: null,
    });
    expect(h.class_counts).toEqual({ CONTINUATION: 1, PULLBACK: 1, FULL_RETRACE: 0, REVERSAL: 0 });
    expect(h.samples).toHaveLength(5);
  });

  it('no earlier events: NO_HISTORY with counts', async () => {
    const data = tables();
    data.economic_events = (data.economic_events as { id: string }[]).filter((e) => !PAST.some((p) => p.id === e.id));
    const { body } = await analysis({ data });
    for (const h of body.history.windows) {
      expect(h).toMatchObject({
        status: 'NO_HISTORY',
        sample_count: 0,
        min_required: 3,
        determined_count: 0,
        samples: [],
      });
      expect(h.shares).toBeNull();
      expect(h.dominant_label).toBeNull();
    }
  });

  it('caps the past comparison at 10 samples (newest first)', async () => {
    const extra = Array.from({ length: 8 }, (_, i) =>
      eventRow(
        `00000000-0000-4000-8000-00000000e0${i}`,
        INDICATOR_ID,
        'EXAMPLE_INDICATOR',
        Date.parse('2029-12-0' + (i + 1) + 'T13:30:00.000Z') - 1,
      ),
    );
    const data = tables();
    data.economic_events = [...(data.economic_events as unknown[]), ...extra];
    const { body } = await analysis({ data });
    const h = body.history.windows[2];
    expect(h.sample_count).toBe(10);
    expect(h.samples).toHaveLength(10);
    expect(h.samples[0].event_id).toBe(PAST[0]!.id);
  });

  it('no peak / trough / extreme times anywhere in the response', async () => {
    const { body } = await analysis();
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(body);
    // The only peak-related key is the size of the peak (pips). No key names a time of a peak / trough / high / low.
    expect([...keys].filter((k) => /peak|trough/.test(k))).toEqual(['peak_offset_pips']);
    const timeKeys = [...keys].filter((k) => /time|date|_at$|_minute/.test(k)).sort();
    expect(timeKeys).toEqual(
      [
        'computed_at',
        'confirmed_at',
        'datetime',
        'event_times',
        'from_date',
        'lookback_minutes',
        'pre_release_bar_closed_at',
        'release_datetime',
        'release_datetime_precision',
        'time_basis',
        'time_uncertain',
        'to_date',
        'window_minutes',
      ].filter((k) => keys.has(k)),
    );
    expect(keys.has('high_pips') && keys.has('low_pips')).toBe(true); // values are there; which came first is not
  });

  it('is deterministic: the same input gives the same body (computed_at aside)', async () => {
    const a = (await analysis()).body;
    const b = (await analysis()).body;
    expect(b).toEqual(a);
  });
});

describe('overlaps (another scheduled item inside a window)', () => {
  const speech = (id: string, minutes: number, extra: Record<string, unknown> = {}, currency = 'USD') => ({
    id,
    title: `Example speech ${id}`,
    statement_datetime: new Date(T + minutes * MIN).toISOString(),
    importance: 'MEDIUM',
    status: 'SCHEDULED',
    time_precision: 'EXACT',
    speakers: { currency_code: currency },
    ...extra,
  });

  it('lists items per window, (T, T+n] only, and separates the hour before the release', async () => {
    const data = tables({
      speech_events: [
        speech('s-30', 30),
        speech('s-pre', -30),
        speech('s-eur', 10, {}, 'EUR'),
        speech('s-low', 12, { importance: 'LOW' }),
        speech('s-cancelled', 14, { status: 'CANCELLED' }),
        speech('s-pub', 45, { time_precision: 'PUBLICATION_TIME' }),
      ],
    });
    const { body } = await analysis({ data });
    const byMinutes = Object.fromEntries(
      body.windows.map((w: { minutes: number; overlap: unknown }) => [w.minutes, w.overlap]),
    );
    expect(byMinutes[1]).toEqual({ has_overlap: false, items: [] });
    expect(byMinutes[5]).toEqual({ has_overlap: false, items: [] });
    expect(byMinutes[15]).toEqual({ has_overlap: false, items: [] });
    expect(byMinutes[30].items.map((i: { id: string }) => i.id)).toEqual(['s-30']);
    expect(byMinutes[30].items[0]).toEqual({
      kind: 'SPEECH',
      id: 's-30',
      name: 'Example speech s-30',
      datetime: '2030-01-10T14:00:00.000Z',
      currency: 'USD',
      importance: 'MEDIUM',
      offset_minutes: 30,
      time_uncertain: false,
    });
    expect(byMinutes[60].items.map((i: { id: string }) => i.id)).toEqual(['s-30', 's-pub']);
    expect(byMinutes[60].items[1].time_uncertain).toBe(true);
    expect(byMinutes[60].has_overlap).toBe(true);
    expect(body.baseline.pre_window_overlaps.map((i: { id: string }) => i.id)).toEqual(['s-pre']);
  });

  it('a different indicator released inside the window is listed, an approximate time is flagged, the simultaneous group is not', async () => {
    const data = tables();
    (data.economic_events as unknown[]).push(
      eventRow(
        '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000a3',
        'OTHER_EVENT',
        T + 20 * MIN,
        {
          release_datetime_precision: 'APPROXIMATE',
          importance: 'HIGH',
          status: 'SCHEDULED',
          provider: 'other_provider',
        },
      ),
    );
    const { body } = await analysis({ data });
    const w30 = body.windows.find((w: { minutes: number }) => w.minutes === 30);
    expect(w30.overlap.items).toHaveLength(1);
    expect(w30.overlap.items[0]).toMatchObject({
      kind: 'EVENT',
      id: '00000000-0000-4000-8000-0000000000e1',
      time_uncertain: true,
    });
  });

  it('past events carry their own overlap flag per window', async () => {
    const data = tables({
      speech_events: [speech('s-past', 25, {}, 'USD')].map((s) => ({
        ...s,
        statement_datetime: new Date(PAST[0]!.at + 25 * MIN).toISOString(),
      })),
    });
    const { body } = await analysis({ data });
    const [h15, h30] = body.history.windows;
    expect(h15.samples[0].has_overlap).toBe(false);
    expect(h30.samples[0].has_overlap).toBe(true);
    expect(h30.overlap_count).toBe(1);
  });
});

describe('data gaps never become values', () => {
  it('one missing minute inside the 60-minute window only affects the windows that contain it', async () => {
    const spec: EventSpec = { ...NOW_SPEC, skipMinutes: [40] };
    const { body } = await analysis({ data: tables({}, spec) });
    const status = Object.fromEntries(
      body.windows.map((w: { minutes: number; label: string | null; reason: string | null }) => [
        w.minutes,
        [w.label, w.reason],
      ]),
    );
    expect(status[30][0]).toBe('PULLBACK');
    expect(status[60]).toEqual(['UNDETERMINED', 'MISSING_BARS']);
    expect(body.windows[4]).toMatchObject({ classification_status: 'UNDETERMINED', evidence: null });
  });

  it('no 1-minute bars at all: every classified window is UNDETERMINED / NO_PRICE_DATA, values from the reaction rows stay', async () => {
    const { body } = await analysis({ ledger: [PRICED], data: tables({ fx_prices: [] }) });
    expect(body.meta.bars_as_of).toBeNull();
    expect(body.reference).toEqual({ pre_release_price: null, pre_release_bar_closed_at: null });
    expect(body.baseline).toMatchObject({ source: 'NONE', sigma_pips: null });
    expect(body.windows.slice(2).map((w: { reason: string }) => w.reason)).toEqual([
      'NO_PRICE_DATA',
      'NO_PRICE_DATA',
      'NO_PRICE_DATA',
    ]);
    expect(body.windows[0].pips).toBe(4);
  });

  it('a release time that is not EXACT classifies nothing and reads no 1-minute bars', async () => {
    const data = tables();
    data.economic_events = (data.economic_events as Record<string, unknown>[]).map((e) =>
      e.id === EVENT_ID ? { ...e, release_datetime_precision: 'APPROXIMATE' } : e,
    );
    const { get, reads } = await open({ data });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(200);
    expect(reads).not.toContain('fx_prices');
    const body = response.json();
    expect(body.windows.slice(2).map((w: { reason: string }) => w.reason)).toEqual(
      Array(3).fill('RELEASE_TIME_NOT_EXACT'),
    );
    expect(body.history.windows.map((h: { status: string }) => h.status)).toEqual(Array(3).fill('NO_HISTORY'));
  });
});

describe('windows that have not closed yet', () => {
  it('are PENDING with no label while the closed ones are classified', async () => {
    vi.setSystemTime(new Date(T + 20 * MIN));
    const { body } = await analysis();
    const byMinutes = Object.fromEntries(
      body.windows.map((w: { minutes: number; classification_status: string }) => [w.minutes, w.classification_status]),
    );
    expect(byMinutes).toEqual({
      1: 'REFERENCE_ONLY',
      5: 'REFERENCE_ONLY',
      15: 'CLASSIFIED',
      30: 'PENDING',
      60: 'PENDING',
    });
    expect(body.windows[3]).toMatchObject({ label: null, reason: null, evidence: null });
  });
});

/** Every key of a JSON value at any depth (arrays flattened), to prove a key is nowhere in the body. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}
/** Absolute price levels = price information itself. (pips / high_pips / low_pips / range_pips are analysis results and stay.) */
const PRICE_POINT_KEYS = [
  'close_price',
  'pre_release_price',
  'post_release_price',
  'open_price',
  'high_price',
  'low_price',
];

describe('price points are gated by externalDisplay (owner decision 2026-11-27)', () => {
  it('commercialUse + derivedDisplay + storage without externalDisplay: 200 with results, no price point key anywhere', async () => {
    const { get } = await open({ ledger: [CONFIRMED] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.available).toBe(true);
    expect(body.meta.price_points_included).toBe(false);
    // the analysis results are all still there
    expect(body.windows).toHaveLength(5);
    expect(body.windows[0]).toMatchObject({ pips: 4, high_pips: 4.5, low_pips: -0.3, range_pips: 4.8 });
    expect(body.windows[2]).toMatchObject({ label: 'CONTINUATION', classification_status: 'CLASSIFIED' });
    expect(body.baseline.sigma_pips).toBe(1);
    expect(body.reference).toEqual({ pre_release_bar_closed_at: '2030-01-10T13:30:00.000Z' });
    // deep scan of the keys, and of the serialized text (nothing echoes a price anywhere, e.g. meta / evidence)
    const keys = allKeys(body);
    for (const k of PRICE_POINT_KEYS) expect(keys.has(k)).toBe(false);
    expect(response.body).not.toMatch(/close_price|pre_release_price|post_release_price|150\.04/);
  });

  it('every window, including the reference-only ones (1 and 5), has no price key (the key is omitted, not null)', async () => {
    const { get } = await open({ ledger: [CONFIRMED] });
    const body = (await get(URL_OF())).json();
    for (const w of body.windows) expect(Object.keys(w)).not.toContain('close_price');
    expect(Object.keys(body.windows[0])).toEqual([
      'minutes',
      'data_status',
      'pips',
      'high_pips',
      'low_pips',
      'range_pips',
      'classification_status',
      'label',
      'reason',
      'evidence',
      'overlap',
    ]);
  });

  it('with externalDisplay confirmed as well: the price points are present with the correct values', async () => {
    const { get } = await open({ ledger: [PRICED] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.price_points_included).toBe(true);
    const c0 = Math.round(quiet(Math.floor(T / MIN) - 1) * 1e6) / 1e6;
    expect(body.reference.pre_release_price).toBe(c0);
    expect(body.windows[0].close_price).toBe(150.04);
    for (const w of body.windows) expect('close_price' in w).toBe(true);
  });

  it('the results are identical with and without the right; only the price point keys differ', async () => {
    const off = (await (await open({ ledger: [CONFIRMED] })).get(URL_OF())).json();
    const on = (await (await open({ ledger: [PRICED] })).get(URL_OF())).json();
    const strip = (b: unknown) => {
      const copy = JSON.parse(JSON.stringify(b)) as {
        reference: Record<string, unknown>;
        meta: Record<string, unknown>;
        windows: Record<string, unknown>[];
      };
      delete copy.reference.pre_release_price;
      delete copy.meta.price_points_included;
      for (const w of copy.windows) delete w.close_price;
      return copy;
    };
    expect(strip(on)).toEqual(strip(off));
  });

  it.each([
    ['status unconfirmed', { status: 'unconfirmed' as const }],
    ['denied', { status: 'denied' as const, evidenceUrl: 'https://evidence.example/x', confirmedAt: '2030-01-01' }],
    ['confirmed without evidence url', { status: 'confirmed' as const, confirmedAt: '2030-01-01' }],
    [
      'confirmed without confirmation date',
      { status: 'confirmed' as const, evidenceUrl: 'https://evidence.example/x' },
    ],
  ])('externalDisplay %s: price points omitted, endpoint still open', async (_n, right) => {
    const entry = ledgerWith(['commercialUse', 'derivedDisplay', 'storage']);
    entry.rights.externalDisplay = right;
    const { get } = await open({ ledger: [entry] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(200);
    const keys = allKeys(response.json());
    expect(keys.has('close_price') || keys.has('pre_release_price')).toBe(false);
  });

  it('externalDisplay alone does not open the endpoint (the existing three rights are still required)', async () => {
    const { get, reads } = await appWith({ ledger: [ledgerWith(['externalDisplay'])] });
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('DATA_RIGHTS_UNCONFIRMED');
    expect(reads).toEqual([]);
  });

  it('fully unconfirmed registry (production default): 403, nothing leaks, DB not read', async () => {
    const { get, reads } = await appWith({});
    const response = await get(URL_OF());
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toMatch(/close_price|pre_release_price|price_points_included|150/);
    expect(reads).toEqual([]);
  });

  it('no env var, query parameter or header can switch the price points on (the registry itself is pinned unconfirmed in reactionRights.test.ts)', async () => {
    const { buildApp } = await import('../../src/app.js');
    const { client } = recordingClient(tables());
    const app = buildApp({
      env: {
        ...loadEnv({
          SUPABASE_URL: 'http://127.0.0.1:54321',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
          EXTERNAL_DISPLAY: 'true',
          PRICE_POINTS_ENABLED: 'true',
          INCLUDE_PRICE_POINTS: 'true',
        }),
        PRICE_FEATURES_ENABLED: true,
      },
      supabase: client,
      logger: false,
      technicalRightsLedger: [CONFIRMED],
    });
    apps.push(app);
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1' + URL_OF(EVENT_ID, '?include_price_points=true&price_points=1&external_display=true'),
      headers: {
        authorization: 'Bearer ' + TOKEN,
        'x-include-price-points': 'true',
        'x-external-display': 'true',
        'x-price-points': '1',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.price_points_included).toBe(false);
    const keys = allKeys(body);
    expect(keys.has('close_price') || keys.has('pre_release_price')).toBe(false);
  });
});

describe('GET /entitlements event_reaction_analysis_enabled', () => {
  it.each([
    ['flag on, real registry (all unconfirmed)', { price: true }, undefined, false],
    ['flag off, confirmed ledger', { price: false }, [CONFIRMED], false],
    ['flag on, confirmed ledger', { price: true }, [CONFIRMED], true],
    [
      'flag on, ledger without confirmation dates',
      { price: true },
      [{ ...CONFIRMED, rights: { ...emptyRights() } }],
      false,
    ],
  ])('%s -> %s', async (_name, flags, ledger, expected) => {
    const { get } = await appWith({ price: flags.price, ...(ledger ? { ledger } : {}) });
    const response = await get('/entitlements');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.event_reaction_analysis_enabled).toBe(expected);
    expect(body.price_features_enabled).toBe(flags.price);
    expect(body.technical_analysis_enabled).toBe(false);
  });
});
