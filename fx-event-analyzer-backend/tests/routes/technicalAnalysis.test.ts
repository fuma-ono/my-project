/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- response bodies are read as untyped JSON on purpose (the payload shape is what is under test) */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import {
  atr,
  bollinger,
  canEnable,
  detectKeyZones,
  ema,
  emptyRights,
  macd,
  resample,
  rsi,
  type RightsLedgerEntry,
  sma,
  stochastic,
} from '../../src/domain/technical/index.js';
import {
  TECHNICAL_RIGHTS_LEDGER,
  TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
} from '../../src/domain/technical/rightsRegistry.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * GET /fx-pairs/{id}/technical: flag gate (404, no DB read), rights gate (403 DATA_RIGHTS_UNCONFIRMED, no DB read),
 * and, with a confirmed fake ledger, the payload (alignment, NY17 daily, 4h resample, engine-equal indicators, caps).
 * JWT verification is mocked (no network); the DB is a fake that records the tables it was asked to read.
 */
const TOKEN = 'eyJ.technical.sig';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const PAIR_ID = '33333333-3333-3333-3333-333333333333';
const NOW = '2026-11-20T11:00:00.000Z'; // Friday; the newest stored 60m bar opens 10:00Z
const HOUR = 3_600_000;

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

const CONFIRMED: RightsLedgerEntry = {
  sourceId: TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
  rights: Object.fromEntries(
    Object.keys(emptyRights()).map((k) => [k, { status: 'confirmed', evidenceUrl: `https://evidence.example/${k}` }]),
  ) as RightsLedgerEntry['rights'],
};

/** FX market is closed Fri 17:00 NY (22:00Z in EST) to Sun 17:00 NY (22:00Z). Nov 1 2026 = DST end, so EST afterwards. */
function isClosed(ms: number): boolean {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  const h = d.getUTCHours();
  return (dow === 5 && h >= 22) || dow === 6 || (dow === 0 && h < 22);
}

interface Ohlc {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Deterministic wavy walk with swings (so key zones exist). */
function makeBars(stepMs: number, fromMs: number, toExclusiveMs: number): Ohlc[] {
  const out: Ohlc[] = [];
  let i = 0;
  for (let t = fromMs; t < toExclusiveMs; t += stepMs) {
    if (isClosed(t)) continue;
    const base = 150 + 2 * Math.sin(i / 7) + 0.8 * Math.sin(i / 2.3);
    const o = base;
    const c = base + 0.3 * Math.cos(i / 3);
    out.push({
      t,
      o: Number(o.toFixed(3)),
      c: Number(c.toFixed(3)),
      h: Number((Math.max(o, c) + 0.2 + 0.1 * Math.abs(Math.sin(i))).toFixed(3)),
      l: Number((Math.min(o, c) - 0.2 - 0.1 * Math.abs(Math.cos(i))).toFixed(3)),
    });
    i++;
  }
  return out;
}

const END = Date.parse(NOW);
const H1 = makeBars(HOUR, Date.parse('2026-11-01T22:00:00Z'), END);
const M5 = makeBars(300_000, END - 3 * 86_400_000, END);

function row(timeframe: string, b: Ohlc, extra: Record<string, unknown> = {}) {
  return {
    fx_pair_id: PAIR_ID,
    timeframe,
    timestamp: new Date(b.t).toISOString(),
    open: String(b.o),
    high: String(b.h),
    low: String(b.l),
    close: String(b.c),
    ...extra,
  };
}

function tables(overrides: Partial<{ h1: Ohlc[]; m5: Ohlc[] }> = {}): Record<string, unknown[]> {
  return {
    fx_pairs: [{ id: PAIR_ID, symbol: 'USDJPY', pip_size: 0.01 }],
    fx_prices: [
      ...(overrides.h1 ?? H1).map((b) => row('60m', b)),
      ...(overrides.m5 ?? M5).map((b) => row('5m', b)),
      // decoys that must never be read: another timeframe and an UNVERIFIED row
      { ...row('1m', { t: END - 60_000, o: 1, h: 1, l: 1, c: 1 }) },
      row('60m', { t: END - HOUR, o: 999, h: 999, l: 999, c: 999 }, { verification_status: 'UNVERIFIED' }),
    ],
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
  flags: { technical: boolean; price: boolean },
  options: { ledger?: readonly RightsLedgerEntry[]; data?: Record<string, unknown[]> } = {},
) {
  const { buildApp } = await import('../../src/app.js');
  const { client, reads } = recordingClient(options.data ?? tables());
  const app = buildApp({
    env: {
      ...loadEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' }),
      PRICE_FEATURES_ENABLED: flags.price,
      TECHNICAL_ANALYSIS_ENABLED: flags.technical,
    },
    supabase: client,
    logger: false,
    ...(options.ledger ? { technicalRightsLedger: options.ledger } : {}),
  });
  apps.push(app);
  await app.ready();
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${TOKEN}` } });
  return { get, reads };
}

const open = (options: Parameters<typeof appWith>[1] = {}) =>
  appWith({ technical: true, price: true }, { ledger: [CONFIRMED], ...options });
const url = (qs: string, pair = PAIR_ID) => `/fx-pairs/${pair}/technical?${qs}`;

describe('flag gate', () => {
  it.each([
    [{ technical: false, price: true }, 'TECHNICAL_ANALYSIS_ENABLED off'],
    [{ technical: true, price: false }, 'PRICE_FEATURES_ENABLED off'],
    [{ technical: false, price: false }, 'both off'],
  ])('%j (%s): 404 NOT_FOUND and no DB read, even with a confirmed ledger', async (flags) => {
    const { get, reads } = await appWith(flags, { ledger: [CONFIRMED] });
    const response = await get(url('timeframe=60m&limit=10'));
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(reads).toEqual([]);
  });

  it('flag gate comes before validation (invalid input is still 404 when off)', async () => {
    const { get, reads } = await appWith({ technical: false, price: true });
    expect((await get(url('timeframe=bad'))).statusCode).toBe(404);
    expect(reads).toEqual([]);
  });
});

describe('rights gate (flags on)', () => {
  it('the real registry keeps the route closed: 403 DATA_RIGHTS_UNCONFIRMED, no DB read', async () => {
    const { get, reads } = await appWith({ technical: true, price: true });
    const response = await get(url('timeframe=60m&limit=10'));
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error: { code: string; missing: string[] } }>();
    expect(body.error.code).toBe('DATA_RIGHTS_UNCONFIRMED');
    expect(body.error.missing).toContain('twelvedata_free_internal:externalDisplay');
    expect(body.error.missing).toContain('twelvedata_free_internal:derivedData');
    expect(reads).toEqual([]);
  });

  it('registry: twelvedata_free_internal has every right unconfirmed and enables nothing', () => {
    expect(TECHNICAL_RIGHTS_LEDGER.map((e) => e.sourceId)).toEqual(['twelvedata_free_internal']);
    for (const entry of TECHNICAL_RIGHTS_LEDGER) {
      for (const r of Object.values(entry.rights)) expect(r.status).toBe('unconfirmed');
    }
    for (const f of ['chartHistory', 'technicalIndicators', 'keyZones'] as const) {
      expect(canEnable(f, TECHNICAL_RIGHTS_LEDGER)).toBe(false);
    }
  });

  it.each([
    ['confirmed without evidenceUrl', { status: 'confirmed' as const }],
    ['evidenceUrl but unconfirmed', { status: 'unconfirmed' as const, evidenceUrl: 'https://x.example/a' }],
    ['denied', { status: 'denied' as const, evidenceUrl: 'https://x.example/a' }],
  ])('refused when derivedData is %s', async (_name, derived) => {
    const ledger: RightsLedgerEntry = { ...CONFIRMED, rights: { ...CONFIRMED.rights, derivedData: derived } };
    const { get, reads } = await appWith({ technical: true, price: true }, { ledger: [ledger] });
    const response = await get(url('timeframe=60m&limit=10'));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'DATA_RIGHTS_UNCONFIRMED' } });
    expect(reads).toEqual([]);
  });

  it('refused when the ledger has no entry for the data source', async () => {
    const { get } = await appWith({ technical: true, price: true }, { ledger: [{ ...CONFIRMED, sourceId: 'other' }] });
    const response = await get(url('timeframe=60m&limit=10'));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'DATA_RIGHTS_UNCONFIRMED', missing: ['twelvedata_free_internal:*'] },
    });
  });

  it('opens (200) once every right is confirmed with evidenceUrl, and reports the ledger entry id', async () => {
    const { get, reads } = await open();
    const response = await get(url('timeframe=60m&limit=10'));
    expect(response.statusCode).toBe(200);
    expect(reads).toContain('fx_prices');
    const meta = response.json().data.meta;
    expect(meta.data_source).toBe('twelvedata_free_internal');
    expect(meta.rights_ledger).toMatchObject({ entry_id: 'twelvedata_free_internal', status: 'confirmed' });
    expect(meta.rights_ledger.evidence_urls.length).toBeGreaterThan(0);
  });
});

describe('payload', () => {
  const toEngine = (bars: Ohlc[]) => bars.map((b) => ({ ...b }));

  it('60m: candles aligned with every indicator series; values equal the engine', async () => {
    const { get } = await open();
    const response = await get(url('timeframe=60m&limit=120&indicators=sma20,ema50,rsi14,macd,bollinger,atr14,stoch'));
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    const expectedBars = H1.slice(-120);
    expect(data.symbol).toBe('USDJPY');
    expect(data.candles).toHaveLength(120);
    expect(data.candles[0]).toEqual({
      t: new Date(expectedBars[0]!.t).toISOString(),
      o: expectedBars[0]!.o,
      h: expectedBars[0]!.h,
      l: expectedBars[0]!.l,
      c: expectedBars[0]!.c,
    });
    expect(data.candles.at(-1).t).toBe(new Date(H1.at(-1)!.t).toISOString());
    // the UNVERIFIED decoy (999) and the 1m decoy never appear
    expect(data.candles.every((c: { c: number }) => c.c < 900 && c.c > 100)).toBe(true);

    const closes = expectedBars.map((b) => b.c);
    const near = (actual: (number | null)[], expected: (number | null)[]) => {
      expect(actual).toHaveLength(120);
      actual.forEach((v, i) => {
        if (expected[i] === null) expect(v).toBeNull();
        else expect(v).toBeCloseTo(expected[i]!, 5);
      });
    };
    near(data.indicators.sma20, sma(closes, 20));
    near(data.indicators.ema50, ema(closes, 50));
    near(data.indicators.rsi14, rsi(closes, 14));
    const m = macd(closes);
    near(data.indicators.macd.macd, m.macd);
    near(data.indicators.macd.signal, m.signal);
    near(data.indicators.macd.histogram, m.histogram);
    const bb = bollinger(closes);
    near(data.indicators.bollinger.upper, bb.upper);
    near(data.indicators.bollinger.middle, bb.middle);
    near(data.indicators.bollinger.lower, bb.lower);
    near(data.indicators.atr14, atr(toEngine(expectedBars), 14));
    const st = stochastic(toEngine(expectedBars));
    near(data.indicators.stoch.k, st.k);
    near(data.indicators.stoch.d, st.d);
    // warm-up is null, not 0
    expect(data.indicators.sma20.slice(0, 19).every((v: unknown) => v === null)).toBe(true);
    expect(data.indicators.sma20[19]).not.toBeNull();
    expect(data.indicators.ema50.slice(0, 49).every((v: unknown) => v === null)).toBe(true);

    // key zones equal the engine's and carry touches + a kind relative to the last close
    const zones = detectKeyZones(toEngine(expectedBars));
    expect(data.key_zones).toHaveLength(zones.length);
    expect(zones.length).toBeGreaterThan(0);
    data.key_zones.forEach((z: { center: number; touches: number; kind: string }, i: number) => {
      expect(z.center).toBeCloseTo(zones[i]!.center, 5);
      expect(z.touches).toBe(zones[i]!.touches);
      expect(['support', 'resistance', 'at_price']).toContain(z.kind);
    });
  });

  it('indicators omitted: no indicator series, candles + zones still returned', async () => {
    const { get } = await open();
    const { data } = (await get(url('timeframe=60m&limit=50'))).json();
    expect(data.indicators).toEqual({});
    expect(data.candles).toHaveLength(50);
  });

  it('5m reads the stored 5m rows; meta reports a clean window (weekend closure is not a gap)', async () => {
    const { get } = await open();
    const { data } = (await get(url('timeframe=5m&limit=100'))).json();
    expect(data.candles).toHaveLength(100);
    expect(data.candles.at(-1).t).toBe(new Date(M5.at(-1)!.t).toISOString());
    expect(data.meta).toMatchObject({
      timeframe: '5m',
      convention: 'NY17',
      bar_count: 100,
      has_gaps: false,
      partial_last: false,
    });
  });

  it('5m: a missing bar is reported as a gap, the weekend closure is not', async () => {
    const withHole = M5.filter((_, i) => i !== M5.length - 10);
    const { get } = await open({ data: tables({ m5: withHole }) });
    const { data } = (await get(url('timeframe=5m&limit=400'))).json();
    expect(data.meta.has_gaps).toBe(true);
    expect(data.meta.expected_source_bars - data.meta.source_bar_count).toBe(1);
  });

  it('1d: NY17 FX days (EST: starts 22:00Z; Sunday open starts Monday), equal to the engine; partial last day', async () => {
    const { get } = await open();
    const response = await get(url('timeframe=1d&limit=300&indicators=sma20'));
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    const expected = resample(H1, '1h', '1D');
    expect(data.candles).toHaveLength(expected.length);
    expect(data.candles[0].t).toBe('2026-11-01T22:00:00.000Z');
    data.candles.forEach((c: { t: string; o: number; h: number; l: number; c: number }, i: number) => {
      expect(c.t).toBe(new Date(expected[i]!.t).toISOString());
      expect(c.t.endsWith('T22:00:00.000Z')).toBe(true);
      expect([c.o, c.h, c.l, c.c]).toEqual([expected[i]!.o, expected[i]!.h, expected[i]!.l, expected[i]!.c]);
    });
    // there is no Saturday daily bar and the Friday bar is the one that ends at Fri 17:00 NY
    expect(data.candles.map((c: { t: string }) => new Date(c.t).getUTCDay())).not.toContain(6);
    expect(data.meta.partial_last).toBe(true);
    expect(data.meta.has_gaps).toBe(true); // the in-progress day has fewer than 24 hourly bars
    expect(data.meta.bar_count).toBe(expected.length);
    expect(data.indicators.sma20).toHaveLength(expected.length);
  });

  it('4h: resampled from 60m on NY wall-clock boundaries, equal to the engine', async () => {
    const { get } = await open();
    const { data } = (await get(url('timeframe=4h&limit=1500&indicators=ema50'))).json();
    const expected = resample(H1, '1h', '4h');
    expect(data.candles).toHaveLength(expected.length);
    const utcHours = new Set<number>(data.candles.map((c: { t: string }) => new Date(c.t).getUTCHours()));
    expect([...utcHours].sort((a, b) => a - b)).toEqual([2, 6, 10, 14, 18, 22]); // 21,01,05,09,13,17 NY (EST)
    data.candles.forEach((c: { t: string; c: number }, i: number) => {
      expect(c.t).toBe(new Date(expected[i]!.t).toISOString());
      expect(c.c).toBe(expected[i]!.c);
    });
    expect(data.meta.partial_last).toBe(true);
  });

  it('limit caps the candles (returns the newest N); row cap drops the possibly-incomplete head candle', async () => {
    const { get } = await open();
    const small = (await get(url('timeframe=60m&limit=7'))).json().data;
    expect(small.candles.map((c: { t: string }) => c.t)).toEqual(H1.slice(-7).map((b) => new Date(b.t).toISOString()));
    const four = (await get(url('timeframe=4h&limit=5'))).json().data;
    expect(four.meta.source_row_cap_hit).toBe(true);
    const full = resample(H1, '1h', '4h').slice(-5);
    expect(four.candles.map((c: { t: string }) => c.t)).toEqual(full.map((c) => new Date(c.t).toISOString()));
    expect(four.candles.map((c: { c: number }) => c.c)).toEqual(full.map((c) => c.c));
  });

  it('technical row cap: limit is reduced to what 10,000 stored rows can produce (1d: 415)', async () => {
    const { get } = await open();
    const { data } = (await get(url('timeframe=1d&limit=1500'))).json();
    expect(data.meta).toMatchObject({ requested_limit: 1500, applied_limit: 415 });
    const fiveM = (await get(url('timeframe=5m&limit=1500'))).json().data;
    expect(fiveM.meta.applied_limit).toBe(1500);
  });

  it('unknown pair: 404 FX_PAIR_NOT_FOUND; no prices read', async () => {
    const { get, reads } = await open();
    const response = await get(url('timeframe=60m', '99999999-9999-9999-9999-999999999999'));
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'FX_PAIR_NOT_FOUND' } });
    expect(reads).not.toContain('fx_prices');
  });

  it('no stored bars: 200 with empty candles', async () => {
    const { get } = await open({ data: { fx_pairs: tables().fx_pairs!, fx_prices: [] } });
    const { data } = (await get(url('timeframe=1d&indicators=sma20,macd'))).json();
    expect(data.candles).toEqual([]);
    expect(data.key_zones).toEqual([]);
    expect(data.indicators.sma20).toEqual([]);
    expect(data.meta).toMatchObject({ bar_count: 0, has_gaps: false, partial_last: false });
  });
});

describe('input validation (422 VALIDATION_ERROR, the repo status for invalid input)', () => {
  it.each([
    ['missing timeframe', 'limit=10'],
    ['1m not offered', 'timeframe=1m'],
    ['1h is the engine name, not the API name', 'timeframe=1h'],
    ['unknown timeframe', 'timeframe=2h'],
    ['limit 0', 'timeframe=60m&limit=0'],
    ['limit above max', 'timeframe=60m&limit=1501'],
    ['limit not a number', 'timeframe=60m&limit=abc'],
    ['limit fractional', 'timeframe=60m&limit=1.5'],
    ['unknown indicator', 'timeframe=60m&indicators=foo'],
    ['period too small', 'timeframe=60m&indicators=sma1'],
    ['period too large', 'timeframe=60m&indicators=ema401'],
    ['macd with params', 'timeframe=60m&indicators=macd12'],
    ['too many indicators', 'timeframe=60m&indicators=sma5,sma6,sma7,sma8,sma9,sma10,sma11,sma12,sma13'],
  ])('%s', async (_name, qs) => {
    const { get, reads } = await open();
    const response = await get(url(qs));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(reads).toEqual([]);
  });

  it('rejects a non-uuid pair id', async () => {
    const { get } = await open();
    expect((await get(url('timeframe=60m', 'not-a-uuid'))).statusCode).toBe(422);
  });

  it('repeated indicators are de-duplicated and whitespace tolerated', async () => {
    const { get } = await open();
    const { data } = (await get(url('timeframe=60m&limit=30&indicators=sma5,sma5, rsi14'))).json();
    expect(Object.keys(data.indicators)).toEqual(['sma5', 'rsi14']);
  });
});

describe('GET /entitlements technical_analysis_enabled', () => {
  it.each([
    [{ technical: false, price: true }, [CONFIRMED], false],
    [{ technical: true, price: false }, [CONFIRMED], false],
    [{ technical: true, price: true }, undefined, false], // real registry: unconfirmed
    [{ technical: true, price: true }, [CONFIRMED], true],
  ])('%j with ledger confirmed=%j gives %s', async (flags, ledger, expected) => {
    const { get } = await appWith(flags, ledger ? { ledger } : {});
    const response = await get('/entitlements');
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body.technical_analysis_enabled).toBe(expected);
    expect(body.price_features_enabled).toBe(flags.price);
  });
});
