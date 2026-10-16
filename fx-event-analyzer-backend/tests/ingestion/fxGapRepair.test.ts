import { MISSING_CAUSE_LABELS } from '../../src/ingestion/quality/report.js';
import { describe, expect, it } from 'vitest';
import { TwelveDataAdapter } from '../../src/ingestion/adapters/twelveData.js';
import { FX_FETCH_SETTINGS, type FxFetchSettings } from '../../src/ingestion/config.js';
import { CreditBudgetExceededError, CreditGate, HttpError } from '../../src/ingestion/http.js';
import { FX_PAIR_MAPPINGS } from '../../src/ingestion/mappings/fxPairs.js';
import { isFxMarketOpen, marketMinutes, MINUTE_MS } from '../../src/ingestion/marketHours.js';
import {
  classifyFetchError,
  noDataHistoryFromLogs,
  planFxFetches,
  UNRECOVERED_REASON_LABELS,
  type PairPlanInput,
  type PlannedRequest,
} from '../../src/ingestion/pipelines/fxGapRepair.js';
import { ingestFxWithGapRepair, type FxReconciliation } from '../../src/ingestion/pipelines/fxPrices.js';
import { runIngestionJob } from '../../src/ingestion/runner.js';
import type { FxPriceRow } from '../../src/ingestion/store.js';
import { MemoryIngestionStore, noSleep } from '../helpers/memoryIngestionStore.js';

const HOUR = 60 * MINUTE_MS;
const DAY = 24 * HOUR;
const t = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const SETTINGS: FxFetchSettings = FX_FETCH_SETTINGS;

/** Stored minutes: every open-market minute in [from, to) except `holes`. */
function present(from: number, to: number, holes: [number, number][] = []): Set<number> {
  return new Set(marketMinutes(from, to).filter((ms) => !holes.some(([a, b]) => ms >= a && ms < b)));
}

function plan(now: number, pairs: PairPlanInput[], maxRequests = 27, settings: FxFetchSettings = SETTINGS) {
  return planFxFetches({ now, pairs, maxRequests, settings });
}

function expectOnlyOpenMinutes(requests: readonly PlannedRequest[]): void {
  for (const r of requests) {
    expect(r.to - r.from).toBeLessThanOrEqual(SETTINGS.maxWindowMinutes * MINUTE_MS);
    for (let ms = r.from; ms < r.to; ms += MINUTE_MS) {
      if (!isFxMarketOpen(ms)) throw new Error(`${r.symbol} ${r.kind} window contains closed minute ${iso(ms)}`);
    }
  }
}

const span = (r: PlannedRequest) => ({ kind: r.kind, from: iso(r.from), to: iso(r.to) });

// Wednesday, market open.
const WED = t('2026-10-14T12:00:30Z');

describe('planFxFetches (pure)', () => {
  it('first run: one FORWARD window of the last 120 minutes, nothing "missing" before it', () => {
    const p = plan(WED, [{ symbol: 'USDJPY', firstMinute: null, present: new Set() }]);
    expect(p.requests.map(span)).toEqual([
      { kind: 'FORWARD', from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z' },
    ]);
    expect(p.unscheduled).toEqual([]);
  });

  it('a stop of ≤ 120 minutes is covered by the FORWARD window alone; the forming minute is never requested', () => {
    const first = t('2026-10-10T00:00:00Z');
    const p = plan(WED, [{ symbol: 'USDJPY', firstMinute: first, present: present(first, WED - 100 * MINUTE_MS) }]);
    expect(p.requests.map(span)).toEqual([
      { kind: 'FORWARD', from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z' },
    ]);
  });

  it('a 340-minute stop is recovered by one (extended) FORWARD request per pair', () => {
    const first = t('2026-10-10T00:00:00Z');
    const pairs = ['USDJPY', 'EURUSD'].map((symbol) => ({
      symbol,
      firstMinute: first,
      present: present(first, t('2026-10-14T06:20:00Z')),
    }));
    const p = plan(WED, pairs);
    expect(p.requests.map((r) => [r.symbol, ...Object.values(span(r))])).toEqual([
      ['USDJPY', 'FORWARD', '2026-10-14T06:20:00.000Z', '2026-10-14T12:00:00.000Z'],
      ['EURUSD', 'FORWARD', '2026-10-14T06:20:00.000Z', '2026-10-14T12:00:00.000Z'],
    ]);
  });

  it('a stop longer than maxWindowMinutes is split; what does not fit in the run is BUDGET', () => {
    const now = t('2026-10-16T20:00:30Z'); // Friday
    const first = t('2026-10-09T22:00:00Z');
    const pairs = [{ symbol: 'USDJPY', firstMinute: first, present: present(first, t('2026-10-12T00:00:00Z')) }];
    const all = plan(now, pairs);
    expect(all.requests.map(span)).toEqual([
      { kind: 'FORWARD', from: '2026-10-13T12:00:00.000Z', to: '2026-10-16T20:00:00.000Z' },
      { kind: 'REPAIR', from: '2026-10-12T00:00:00.000Z', to: '2026-10-13T12:00:00.000Z' },
    ]);
    expectOnlyOpenMinutes(all.requests);
    const capped = plan(now, pairs, 1);
    expect(capped.requests.map((r) => r.kind)).toEqual(['FORWARD']);
    expect(capped.unscheduled.map(span)).toEqual([all.requests[1]].map((r) => span(r!)));
  });

  it('finds a hole in the middle of stored data, and merges nearby holes of one session into one request', () => {
    const first = t('2026-10-08T00:00:00Z');
    // Previous week's session (closed Fri 2026-10-09 21:00 UTC): its own REPAIR window.
    const holes: [number, number][] = [
      [t('2026-10-09T03:00:00Z'), t('2026-10-09T03:30:00Z')],
      [t('2026-10-09T05:00:00Z'), t('2026-10-09T05:10:00Z')],
    ];
    const p = plan(WED, [
      { symbol: 'USDJPY', firstMinute: first, present: present(first, WED - 2 * MINUTE_MS, holes) },
    ]);
    expect(p.requests.map(span)).toEqual([
      { kind: 'FORWARD', from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z' },
      { kind: 'REPAIR', from: '2026-10-09T03:00:00.000Z', to: '2026-10-09T05:10:00.000Z' },
    ]);
  });

  it('a hole in the current session within maxWindowMinutes of now is folded into the FORWARD request', () => {
    const first = t('2026-10-08T00:00:00Z');
    const hole: [number, number] = [t('2026-10-12T03:00:00Z'), t('2026-10-12T03:30:00Z')];
    const p = plan(WED, [
      { symbol: 'USDJPY', firstMinute: first, present: present(first, WED - 2 * MINUTE_MS, [hole]) },
    ]);
    expect(p.requests.map(span)).toEqual([
      { kind: 'FORWARD', from: '2026-10-12T03:00:00.000Z', to: '2026-10-14T12:00:00.000Z' },
    ]);
  });

  it('never requests gaps older than the horizon (BEYOND_HORIZON) nor before ingestion start', () => {
    const first = t('2026-10-06T12:00:00Z');
    const hole: [number, number] = [t('2026-10-07T00:00:00Z'), t('2026-10-07T00:30:00Z')];
    const p = plan(WED, [
      { symbol: 'USDJPY', firstMinute: first, present: present(first, WED - 2 * MINUTE_MS, [hole]) },
    ]);
    expect(p.requests.map((r) => r.kind)).toEqual(['FORWARD']);
    expect(p.pairs.get('USDJPY')!.beyond).toEqual([{ from: hole[0], to: hole[1] }]);
  });

  it('budget exhausted → zero requests, everything unscheduled', () => {
    const p = plan(WED, [{ symbol: 'USDJPY', firstMinute: null, present: new Set() }], 0);
    expect(p.requests).toEqual([]);
    expect(p.unscheduled).toHaveLength(1);
  });

  it('round-robin: every pair gets its FORWARD first, then repairs take turns up to the cap', () => {
    const first = t('2026-10-08T00:00:00Z');
    const holes: [number, number][] = [
      [t('2026-10-13T03:00:00Z'), t('2026-10-13T03:10:00Z')],
      [t('2026-10-09T03:00:00Z'), t('2026-10-09T03:10:00Z')],
    ];
    const pairs = ['USDJPY', 'EURUSD', 'EURJPY'].map((symbol) => ({
      symbol,
      firstMinute: first,
      present: present(first, WED - 2 * MINUTE_MS, holes),
    }));
    const p = plan(WED, pairs, 5, { ...SETTINGS, maxWindowMinutes: 600 });
    expect(p.requests.map((r) => `${r.symbol}:${r.kind}:${iso(r.from).slice(0, 10)}`)).toEqual([
      'USDJPY:FORWARD:2026-10-14',
      'EURUSD:FORWARD:2026-10-14',
      'EURJPY:FORWARD:2026-10-14',
      'USDJPY:REPAIR:2026-10-13',
      'EURUSD:REPAIR:2026-10-13',
    ]);
    expect(p.unscheduled.map((r) => `${r.symbol}:${iso(r.from).slice(0, 10)}`)).toEqual([
      'EURJPY:2026-10-13',
      'USDJPY:2026-10-09',
      'EURUSD:2026-10-09',
      'EURJPY:2026-10-09',
    ]);
  });

  it('weekend: no request while closed; a stop across the weekend is split at the close', () => {
    const saturday = plan(t('2026-10-17T12:00:30Z'), [{ symbol: 'USDJPY', firstMinute: null, present: new Set() }]);
    expect(saturday.requests).toEqual([]);

    const now = t('2026-10-19T01:00:30Z'); // Monday
    const first = t('2026-10-13T00:00:00Z');
    const p = plan(now, [{ symbol: 'USDJPY', firstMinute: first, present: present(first, t('2026-10-16T20:00:00Z')) }]);
    expect(p.requests.map(span)).toEqual([
      { kind: 'FORWARD', from: '2026-10-18T21:00:00.000Z', to: '2026-10-19T01:00:00.000Z' },
      { kind: 'REPAIR', from: '2026-10-16T20:00:00.000Z', to: '2026-10-16T21:00:00.000Z' },
    ]);
    expectOnlyOpenMinutes(p.requests);
  });

  it.each([
    // US DST starts 2026-03-08: Friday close 22:00 UTC (EST), Sunday open 21:00 UTC (EDT).
    {
      name: 'DST start 2026-03-08',
      now: '2026-03-09T03:00:30Z',
      until: '2026-03-06T20:00:00Z',
      expected: [
        ['FORWARD', '2026-03-08T21:00:00.000Z', '2026-03-09T03:00:00.000Z'],
        ['REPAIR', '2026-03-06T20:00:00.000Z', '2026-03-06T22:00:00.000Z'],
      ],
    },
    // US DST ends 2026-11-01: Friday close 21:00 UTC (EDT), Sunday open 22:00 UTC (EST).
    {
      name: 'DST end 2026-11-01',
      now: '2026-11-02T00:00:30Z',
      until: '2026-10-30T20:00:00Z',
      expected: [
        ['FORWARD', '2026-11-01T22:00:00.000Z', '2026-11-02T00:00:00.000Z'],
        ['REPAIR', '2026-10-30T20:00:00.000Z', '2026-10-30T21:00:00.000Z'],
      ],
    },
    // 2026-12-25 (Fri) closed all day (New York date) → the week closes at Dec 25 00:00 NY = 05:00 UTC.
    {
      name: 'Christmas 2026-12-25',
      now: '2026-12-28T00:00:30Z',
      until: '2026-12-24T12:00:00Z',
      expected: [
        ['FORWARD', '2026-12-27T22:00:00.000Z', '2026-12-28T00:00:00.000Z'],
        ['REPAIR', '2026-12-24T12:00:00.000Z', '2026-12-25T05:00:00.000Z'],
      ],
    },
    // 2026-12-31 (Thu) → 2027-01-01 (Fri, closed) → weekend → Sunday 2027-01-03 22:00 UTC.
    {
      name: 'New Year 2026-12-31 → 2027-01-01',
      now: '2027-01-04T00:00:30Z',
      until: '2026-12-31T18:00:00Z',
      expected: [
        ['FORWARD', '2027-01-03T22:00:00.000Z', '2027-01-04T00:00:00.000Z'],
        ['REPAIR', '2026-12-31T18:00:00.000Z', '2027-01-01T05:00:00.000Z'],
      ],
    },
  ])('market hours: $name — only open minutes are requested', ({ now, until, expected }) => {
    const nowMs = t(now);
    const first = nowMs - 6 * DAY;
    const p = plan(nowMs, [{ symbol: 'USDJPY', firstMinute: first, present: present(first, t(until)) }]);
    expect(p.requests.map((r) => Object.values(span(r)))).toEqual(expected);
    expectOnlyOpenMinutes(p.requests);
  });

  it('NO_DATA_UNCONFIRMED minutes: held on the same UTC day, retried on 2 later days, then held for good', () => {
    const first = t('2026-10-08T00:00:00Z');
    const hole: [number, number] = [t('2026-10-09T03:00:00Z'), t('2026-10-09T03:10:00Z')];
    const base = { symbol: 'USDJPY', firstMinute: first, present: present(first, WED - 2 * MINUTE_MS, [hole]) };
    const record = (day: string) => ({ from: hole[0], to: hole[1], day });
    const kinds = (history: { from: number; to: number; day: string }[]) =>
      plan(WED, [{ ...base, noDataHistory: history }]).requests.map((r) => r.kind);
    expect(kinds([])).toEqual(['FORWARD', 'REPAIR']);
    expect(kinds([record('2026-10-14')])).toEqual(['FORWARD']); // already tried today
    expect(kinds([record('2026-10-12'), record('2026-10-13')])).toEqual(['FORWARD', 'REPAIR']);
    expect(kinds([record('2026-10-12'), record('2026-10-12'), record('2026-10-13'), record('2026-10-13')])).toEqual([
      'FORWARD',
      'REPAIR',
    ]);
    expect(kinds([record('2026-10-11'), record('2026-10-12'), record('2026-10-13')])).toEqual(['FORWARD']);
  });

  it('reads the no-data history from earlier logs and ignores malformed entries', () => {
    const history = noDataHistoryFromLogs([
      {
        started_at: '2026-10-13T12:00:00.000Z',
        details: {
          no_data_unconfirmed: {
            USDJPY: [{ from: '2026-10-12T03:00:00.000Z', to: '2026-10-12T03:10:00.000Z' }, { from: 'x' }, null],
            EURUSD: 'nope',
          },
        },
      },
      { started_at: '2026-10-13T12:20:00.000Z', details: {} },
      { started_at: '2026-10-13T12:40:00.000Z', details: { no_data_unconfirmed: [1, 2] } },
    ]);
    expect([...history.keys()]).toEqual(['USDJPY']);
    expect(history.get('USDJPY')).toEqual([
      { from: t('2026-10-12T03:00:00Z'), to: t('2026-10-12T03:10:00Z'), day: '2026-10-13' },
    ]);
  });

  it('classifies fetch errors', () => {
    expect(classifyFetchError(new HttpError('x', 429, true))).toBe('RATE_LIMITED');
    expect(classifyFetchError(new HttpError('x', null, true, 'TIMEOUT'))).toBe('TIMEOUT');
    expect(classifyFetchError(new HttpError('x', 500, true))).toBe('API_ERROR');
    expect(classifyFetchError(new HttpError('x', null, true, 'NETWORK'))).toBe('API_ERROR');
    expect(classifyFetchError(new CreditBudgetExceededError('x', 'CAP_REACHED'))).toBe('BUDGET');
    expect(classifyFetchError(new Error('twelvedata USDJPY: 429 You have run out of API credits'))).toBe(
      'RATE_LIMITED',
    );
    expect(classifyFetchError(new Error('twelvedata USDJPY: 400 bad symbol'))).toBe('API_ERROR');
    expect(UNRECOVERED_REASON_LABELS.BEYOND_HORIZON).toBe('未回収(回収期間外・7日超)');
    // レポートと同じ文言(HQ判断 2026-10-16)。
    for (const [reason, label] of Object.entries(UNRECOVERED_REASON_LABELS)) {
      expect(MISSING_CAUSE_LABELS[reason as keyof typeof MISSING_CAUSE_LABELS], reason).toBe(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Job-level: ingestFxWithGapRepair with the real TwelveDataAdapter + HttpClient
// (retries, credit gate) over a fake Twelve Data (no network).
// ---------------------------------------------------------------------------

interface Market {
  now: number;
  /** Minutes the fake provider has no candle for, per symbol. */
  noData: Map<string, [number, number][]>;
  /** Added to every price of the symbol (to simulate provider corrections). */
  bump: Map<string, number>;
}

function price(symbol: string, ms: number, bump = 0): number {
  const k = (ms / MINUTE_MS) % 100;
  return symbol.endsWith('JPY') ? 150 + k / 1000 + bump : 1.1 + k / 100_000 + bump;
}

function candle(symbol: string, ms: number, bump = 0) {
  const close = price(symbol, ms, bump);
  const step = symbol.endsWith('JPY') ? 0.001 : 0.00001;
  return {
    datetime: iso(ms).slice(0, 19).replace('T', ' '),
    open: close - step,
    high: close + step,
    low: close - 2 * step,
    close,
  };
}

interface Call {
  symbol: string;
  from: number;
  to: number;
}

type Script = (call: Call, nth: number) => Response | Promise<Response> | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeTwelveData(market: Market, script?: Script) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const symbol = url.searchParams.get('symbol')!.replace('/', '');
    const from = t(`${url.searchParams.get('start_date')!.replace(' ', 'T')}Z`);
    const to = t(`${url.searchParams.get('end_date')!.replace(' ', 'T')}Z`) + MINUTE_MS;
    const call = { symbol, from, to };
    calls.push(call);
    const scripted = await script?.(call, calls.length);
    if (scripted) return scripted;
    const holes = market.noData.get(symbol) ?? [];
    const values = marketMinutes(from, Math.min(to, Math.floor(market.now / MINUTE_MS) * MINUTE_MS + MINUTE_MS))
      .filter((ms) => !holes.some(([a, b]) => ms >= a && ms < b))
      .map((ms) => candle(symbol, ms, market.bump.get(symbol) ?? 0));
    if (values.length === 0) {
      return json({ code: 400, message: 'No data is available on the specified dates.', status: 'error' });
    }
    return json({ status: 'ok', values });
  };
  return { fetch: impl, calls };
}

function newStore(): MemoryIngestionStore {
  const store = new MemoryIngestionStore();
  store.fxPairs = FX_PAIR_MAPPINGS.map((m) => ({
    id: `pair-${m.symbol}`,
    symbol: m.symbol,
    pip_size: m.pipSize,
    price_precision: m.pricePrecision,
  }));
  return store;
}

function seed(store: MemoryIngestionStore, symbol: string, from: number, to: number, holes: [number, number][] = []) {
  const rows: FxPriceRow[] = [...present(from, to, holes)].map((ms) => {
    const c = candle(symbol, ms);
    return {
      fx_pair_id: `pair-${symbol}`,
      timestamp: iso(ms),
      timeframe: '1m',
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: null,
      source: 'twelvedata',
      verification_status: 'SINGLE_SOURCE',
      cross_check_source: null,
      cross_check_close: null,
      cross_check_diff_pips: null,
    };
  });
  return store.upsertFxPrices(rows);
}

function prefillLedger(store: MemoryIngestionStore, credits: number, at: number) {
  store.creditUsage.push({
    provider: 'twelvedata',
    job: 'other',
    runId: 'other-run',
    mode: 'MANUAL',
    credits,
    cap: 800,
    usage_date: iso(at).slice(0, 10),
  });
}

/** details of the ingest:fx-prices ingestion_logs row (the shape the data-quality report reads). */
interface Details {
  api_requests: number;
  budget: { mode: string; daily: number; used_before_run: number; left_after_run: number };
  requests: {
    symbol: string;
    kind: string;
    from: string;
    to: string;
    outcome: string;
    fetched: number;
    accepted: number;
  }[];
  unrecovered: { symbol: string; from: string; to: string; minutes: number; reason: string }[];
  unrecovered_total: number;
  no_data_unconfirmed: Record<string, { from: string; to: string; minutes: number; attempt: number }[]>;
  reconciliation: FxReconciliation;
  corrections: { symbol: string; minute: string; old_close: number; new_close: number }[];
  latest_candle: { symbol: string; open_time: string | null }[];
  range: { from: string; to: string }[];
  notes?: string[];
}

let runSeq = 0;

async function run(
  store: MemoryIngestionStore,
  market: Market,
  options: {
    symbols?: string[];
    mode?: 'AUTOMATIC' | 'MANUAL';
    settings?: Partial<FxFetchSettings>;
    script?: Script;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const settings = { ...SETTINGS, ...options.settings };
  const mode = options.mode ?? 'AUTOMATIC';
  store.clock = () => new Date(market.now);
  runSeq += 1;
  const gate = new CreditGate(store, {
    provider: 'twelvedata',
    job: 'ingest:fx-prices',
    runId: `test-${runSeq}`,
    mode,
    dailyCap: mode === 'MANUAL' ? 800 : 700,
    runCap: settings.perRunRequestCap,
  });
  const fake = fakeTwelveData(market, options.script);
  let attempts = 0;
  const primary = new TwelveDataAdapter('TEST_KEY', {
    fetch: options.fetchImpl ?? fake.fetch,
    sleep: noSleep,
    beforeAttempt: gate.beforeAttempt,
    onAttempt: () => (attempts += 1),
  });
  const now = new Date(market.now);
  const result = await runIngestionJob(
    store,
    { provider: 'twelvedata', dataType: 'FX_PRICE', job: 'ingest:fx-prices' },
    (counters) =>
      ingestFxWithGapRepair(
        { store, primary, now: () => now, gate, mode, settings },
        { symbols: options.symbols ?? ['USDJPY'] },
        counters,
      ),
    () => now,
  );
  const log = store.logs[store.logs.length - 1]!;
  return { result, log, details: log.details as unknown as Details, calls: fake.calls, attempts };
}

function minutes1m(store: MemoryIngestionStore, symbol: string): number[] {
  return store.fxPrices
    .filter((p) => p.fx_pair_id === `pair-${symbol}` && p.timeframe === '1m')
    .map((p) => t(p.timestamp))
    .sort((a, b) => a - b);
}

const market = (now: number): Market => ({ now, noData: new Map(), bump: new Map() });

describe('ingestFxWithGapRepair', () => {
  it('first run with no data: 120 minutes per pair, aggregates, and the log details shape', async () => {
    const store = newStore();
    const m = market(WED);
    const { result, details, calls } = await run(store, m, { symbols: ['USDJPY', 'EURUSD'] });
    expect(result.status).toBe('SUCCESS');
    expect(calls).toHaveLength(2);
    expect(minutes1m(store, 'USDJPY')).toHaveLength(120);
    const count = (tf: string) => store.fxPrices.filter((p) => p.timeframe === tf && p.fx_pair_id === 'pair-USDJPY');
    expect([count('5m').length, count('15m').length, count('30m').length, count('60m').length]).toEqual([24, 8, 4, 2]);
    expect(details).toMatchObject({
      api_requests: 2,
      budget: { mode: 'AUTOMATIC', daily: 700, used_before_run: 0, left_after_run: 698 },
      unrecovered: [],
      unrecovered_total: 0,
      no_data_unconfirmed: {},
      reconciliation: {
        fetched: 240,
        accepted: 240,
        rejected_by_reason: {},
        upserted_1m: 240,
        upserted_aggregated: 76,
        corrected: 0,
        failed_requests: 0,
      },
      range: [{ from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z' }],
    });
    expect(details.requests[0]).toEqual({
      symbol: 'USDJPY',
      kind: 'FORWARD',
      from: '2026-10-14T10:00:00.000Z',
      to: '2026-10-14T12:00:00.000Z',
      outcome: 'OK',
      fetched: 120,
      accepted: 120,
    });
    expect(details.latest_candle).toEqual([
      { symbol: 'USDJPY', open_time: '2026-10-14T11:59:00.000Z' },
      { symbol: 'EURUSD', open_time: '2026-10-14T11:59:00.000Z' },
    ]);
    expect(store.creditUsage.reduce((s, u) => s + u.credits, 0)).toBe(2);
  });

  it('recovers a 340-minute stop in one run (one request per pair)', async () => {
    const store = newStore();
    await seed(store, 'USDJPY', t('2026-10-12T00:00:00Z'), WED - 340 * MINUTE_MS);
    const { details, calls } = await run(store, market(WED));
    expect(calls).toHaveLength(1);
    expect(details.unrecovered_total).toBe(0);
    expect(minutes1m(store, 'USDJPY').at(-1)).toBe(t('2026-10-14T11:59:00Z'));
    expect(present(t('2026-10-12T00:00:00Z'), WED).size).toBe(minutes1m(store, 'USDJPY').length);
  });

  it('a stop of several days: split windows, rest BUDGET, recovered on the next run', async () => {
    const store = newStore();
    const now = t('2026-10-16T20:00:30Z');
    await seed(store, 'USDJPY', t('2026-10-09T22:00:00Z'), t('2026-10-12T00:00:00Z'));
    const m = market(now);
    const first = await run(store, m, { settings: { perRunRequestCap: 1 } });
    expect(first.calls).toHaveLength(1);
    expect(first.result.status).toBe('SUCCESS');
    expect(first.details.unrecovered).toEqual([
      {
        symbol: 'USDJPY',
        from: '2026-10-12T00:00:00.000Z',
        to: '2026-10-13T12:00:00.000Z',
        minutes: 36 * 60,
        reason: 'BUDGET',
      },
    ]);
    m.now = now + 20 * MINUTE_MS;
    const second = await run(store, m);
    expect(second.details.requests.map((r: { kind: string }) => r.kind)).toEqual(['FORWARD', 'REPAIR']);
    expect(second.details.unrecovered_total).toBe(0);
  });

  it('reports a gap older than the horizon as BEYOND_HORIZON and never fetches it', async () => {
    const store = newStore();
    const hole: [number, number] = [t('2026-10-07T00:00:00Z'), t('2026-10-07T00:30:00Z')];
    await seed(store, 'USDJPY', t('2026-10-06T12:00:00Z'), WED - 2 * MINUTE_MS, [hole]);
    const { details, calls } = await run(store, market(WED));
    expect(calls).toHaveLength(1);
    expect(details.unrecovered).toEqual([
      { symbol: 'USDJPY', from: iso(hole[0]), to: iso(hole[1]), minutes: 30, reason: 'BEYOND_HORIZON' },
    ]);
  });

  it('repairs a past hole and rebuilds the aggregates that mix stored and repaired minutes', async () => {
    const store = newStore();
    const hole: [number, number] = [t('2026-10-13T03:30:00Z'), t('2026-10-13T04:00:00Z')];
    await seed(store, 'USDJPY', t('2026-10-12T00:00:00Z'), WED - 2 * MINUTE_MS, [hole]);
    const { details } = await run(store, market(WED));
    // Same session and within 4800 minutes of now → folded into the FORWARD request.
    expect(details.requests.map((r: { kind: string; from: string }) => [r.kind, r.from])).toEqual([
      ['FORWARD', '2026-10-13T03:30:00.000Z'],
    ]);
    const bar = store.fxPrices.find((p) => p.timeframe === '60m' && p.timestamp === '2026-10-13T03:00:00.000Z');
    expect(bar).toMatchObject({ open: candle('USDJPY', t('2026-10-13T03:00:00Z')).open });
    expect(bar?.close).toBe(price('USDJPY', t('2026-10-13T03:59:00Z')));
    // An hour the run did not touch is not rebuilt.
    expect(store.fxPrices.some((p) => p.timeframe === '60m' && p.timestamp === '2026-10-13T02:00:00.000Z')).toBe(false);
    expect(details.unrecovered_total).toBe(0);
  });

  it('fetching the same range twice: no duplicates, corrected 0, counts consistent', async () => {
    const store = newStore();
    const m = market(WED);
    await run(store, m);
    const rows = store.fxPrices.length;
    const again = await run(store, m);
    expect(store.fxPrices.length).toBe(rows);
    const r = again.details.reconciliation;
    expect(r).toMatchObject({ fetched: 120, accepted: 120, upserted_1m: 120, corrected: 0, failed_requests: 0 });
    expect(r.fetched).toBe(r.accepted + Object.values(r.rejected_by_reason).reduce((a, b) => a + b, 0));
    expect(again.details.corrections).toEqual([]);
  });

  it('a changed price overwrites (provider wins), is counted as corrected with examples, rows are not duplicated', async () => {
    const store = newStore();
    const m = market(WED);
    await run(store, m);
    const rows = store.fxPrices.length;
    m.bump.set('USDJPY', 0.005);
    const { details } = await run(store, m);
    expect(store.fxPrices.length).toBe(rows);
    expect(details.reconciliation.corrected).toBe(120);
    expect(details.corrections).toHaveLength(20);
    expect(details.corrections[0]).toEqual({
      symbol: 'USDJPY',
      minute: '2026-10-14T10:00:00.000Z',
      old_close: price('USDJPY', t('2026-10-14T10:00:00Z')),
      new_close: price('USDJPY', t('2026-10-14T10:00:00Z'), 0.005),
    });
    const stored = store.fxPrices.find((p) => p.timeframe === '1m' && p.timestamp === '2026-10-14T10:00:00.000Z');
    expect(stored?.close).toBe(price('USDJPY', t('2026-10-14T10:00:00Z'), 0.005));
  });

  it('reconciles fetched = accepted + rejected (duplicates, conflicts, invalid OHLC); upserted_1m = accepted', async () => {
    const store = newStore();
    const at = (min: number) => candle('USDJPY', t('2026-10-14T11:00:00Z') + min * MINUTE_MS);
    const values = [
      at(0),
      at(1),
      at(2),
      at(0), // identical duplicate
      at(3),
      { ...at(3), close: at(3).close + 0.002 }, // conflicting duplicate
      { ...at(4), high: at(4).low - 0.01 }, // invalid OHLC
    ];
    const { details, result } = await run(store, market(WED), { script: () => json({ status: 'ok', values }) });
    expect(result.status).toBe('SUCCESS');
    expect(details.reconciliation).toMatchObject({
      fetched: 7,
      accepted: 3,
      rejected_by_reason: { DUPLICATE: 1, CONFLICTING_DUPLICATE: 2, INVALID_OHLC: 1 },
      upserted_1m: 3,
    });
    // The window came back OK but most minutes are missing → NO_DATA_UNCONFIRMED, never invented.
    expect(details.unrecovered.every((u: { reason: string }) => u.reason === 'NO_DATA_UNCONFIRMED')).toBe(true);
  });

  it('counts every HTTP attempt (retries included) in api_requests and the ledger', async () => {
    const store = newStore();
    const { details, attempts, result } = await run(store, market(WED), {
      script: (_call, nth) => (nth === 1 ? new Response('down', { status: 503 }) : undefined),
    });
    expect(result.status).toBe('SUCCESS');
    expect([details.api_requests, attempts, store.creditUsage.length]).toEqual([2, 2, 2]);
  });

  it('429 that survives the retries: stops further requests, RATE_LIMITED + BUDGET, PARTIAL', async () => {
    const store = newStore();
    const { details, result, calls } = await run(store, market(WED), {
      symbols: ['USDJPY', 'EURUSD', 'EURJPY'],
      script: (call) => (call.symbol === 'EURUSD' ? new Response('', { status: 429 }) : undefined),
    });
    expect(result.status).toBe('PARTIAL');
    expect(calls.map((c) => c.symbol)).toEqual(['USDJPY', 'EURUSD', 'EURUSD', 'EURUSD', 'EURUSD']);
    expect(details.api_requests).toBe(5);
    expect(details.unrecovered.map((u: { symbol: string; reason: string }) => `${u.symbol}:${u.reason}`)).toEqual([
      'EURUSD:RATE_LIMITED',
      'EURJPY:BUDGET',
    ]);
    expect(details.reconciliation).toMatchObject({ failed_requests: 1, not_sent_requests: 1, ok_requests: 1 });
    expect(details.notes).toEqual([expect.stringContaining('rate limited (429)')]);
  });

  it('Twelve Data quota error in an HTTP 200 body is RATE_LIMITED too', async () => {
    const store = newStore();
    const { details } = await run(store, market(WED), {
      symbols: ['USDJPY', 'EURUSD'],
      script: () => json({ code: 429, message: 'You have run out of API credits for the day.', status: 'error' }),
    });
    expect(details.requests.map((r: { outcome: string }) => r.outcome)).toEqual(['RATE_LIMITED']);
    expect(details.reconciliation.not_sent_requests).toBe(1);
  });

  it('a timeout or API error for one pair does not stop the others → PARTIAL', async () => {
    const store = newStore();
    const fake = fakeTwelveData(market(WED));
    const fetchImpl = ((input: string) =>
      input.includes('EUR%2FUSD')
        ? Promise.reject(new DOMException('timed out', 'TimeoutError'))
        : fake.fetch(input)) as unknown as typeof fetch;
    const timeout = await run(store, market(WED), { symbols: ['USDJPY', 'EURUSD', 'EURJPY'], fetchImpl });
    expect(timeout.result.status).toBe('PARTIAL');
    expect(timeout.details.requests.map((r: { outcome: string }) => r.outcome)).toEqual(['OK', 'TIMEOUT', 'OK']);
    expect(timeout.details.unrecovered.map((u: { reason: string }) => u.reason)).toEqual(['TIMEOUT']);
    expect(timeout.details.api_requests).toBe(1 + 4 + 1);

    const store2 = newStore();
    const apiError = await run(store2, market(WED), {
      symbols: ['USDJPY', 'EURUSD', 'EURJPY'],
      script: (call) =>
        call.symbol === 'EURUSD' ? json({ code: 400, message: '**symbol** not found', status: 'error' }) : undefined,
    });
    expect(apiError.result.status).toBe('PARTIAL');
    expect(apiError.details.requests.map((r: { outcome: string }) => r.outcome)).toEqual(['OK', 'API_ERROR', 'OK']);
    expect(apiError.result.counters.errorMessages.join('\n')).not.toContain('TEST_KEY');
  });

  it('NO_DATA_UNCONFIRMED: not re-requested the same day, at most 2 more times on later days', async () => {
    const store = newStore();
    const hole: [number, number] = [t('2026-10-13T10:00:00Z'), t('2026-10-13T10:30:00Z')];
    await seed(store, 'USDJPY', t('2026-10-12T00:00:00Z'), WED - 60 * MINUTE_MS, [hole]);
    const m = market(WED);
    m.noData.set('USDJPY', [hole]);
    const covers = (calls: Call[]) => calls.some((c) => c.from <= hole[0] && hole[0] < c.to);

    const day1 = await run(store, m);
    expect(covers(day1.calls)).toBe(true);
    expect(day1.details.no_data_unconfirmed).toEqual({
      USDJPY: [{ from: iso(hole[0]), to: iso(hole[1]), minutes: 30, attempt: 1 }],
    });
    expect(day1.details.unrecovered).toEqual([
      { symbol: 'USDJPY', from: iso(hole[0]), to: iso(hole[1]), minutes: 30, reason: 'NO_DATA_UNCONFIRMED' },
    ]);

    m.now = WED + 20 * MINUTE_MS; // same UTC day
    const sameDay = await run(store, m);
    expect(covers(sameDay.calls)).toBe(false);
    expect(sameDay.details.unrecovered.map((u: { reason: string }) => u.reason)).toEqual(['NO_DATA_UNCONFIRMED']);

    m.now = t('2026-10-15T12:00:30Z');
    const day2 = await run(store, m);
    expect(covers(day2.calls)).toBe(true);
    expect(day2.details.no_data_unconfirmed.USDJPY?.at(-1)).toMatchObject({ from: iso(hole[0]), attempt: 2 });

    m.now = t('2026-10-16T12:00:30Z');
    const day3 = await run(store, m);
    expect(covers(day3.calls)).toBe(true);
    expect(day3.details.no_data_unconfirmed.USDJPY?.at(-1)).toMatchObject({ from: iso(hole[0]), attempt: 3 });

    m.now = t('2026-10-19T12:00:30Z');
    const day4 = await run(store, m);
    expect(covers(day4.calls)).toBe(false);
    expect(day4.details.unrecovered).toEqual([
      { symbol: 'USDJPY', from: iso(hole[0]), to: iso(hole[1]), minutes: 30, reason: 'NO_DATA_UNCONFIRMED' },
    ]);
  });

  it('an empty answer for a whole window is OK + NO_DATA_UNCONFIRMED (not an error)', async () => {
    const store = newStore();
    const m = market(WED);
    m.noData.set('USDJPY', [[0, WED + DAY]]);
    const { result, details } = await run(store, m);
    expect(result.status).toBe('SUCCESS');
    expect(details.requests[0]?.outcome).toBe('OK');
    expect(details.unrecovered.map((u: { reason: string }) => u.reason)).toEqual(['NO_DATA_UNCONFIRMED']);
  });

  it('weekend: zero requests, SUCCESS', async () => {
    const store = newStore();
    const { result, calls } = await run(store, market(t('2026-10-17T12:00:30Z')), { symbols: ['USDJPY', 'EURUSD'] });
    expect(result.status).toBe('SUCCESS');
    expect(calls).toHaveLength(0);
  });
});

describe('ingestFxWithGapRepair — credit ledger', () => {
  const ALL = FX_PAIR_MAPPINGS.map((m) => m.symbol);
  const used = (store: MemoryIngestionStore) => store.creditUsage.reduce((s, u) => s + u.credits, 0);

  it('daily cap already reached: no request, SUCCESS with a clear note, missing minutes BUDGET', async () => {
    const store = newStore();
    prefillLedger(store, 700, WED);
    const { result, details, calls } = await run(store, market(WED), { symbols: ALL });
    expect(calls).toHaveLength(0);
    expect(result.status).toBe('SUCCESS');
    expect(details.api_requests).toBe(0);
    expect(details.budget).toEqual({ mode: 'AUTOMATIC', daily: 700, used_before_run: 700, left_after_run: 0 });
    expect(details.notes).toEqual([expect.stringContaining('daily credit cap already reached')]);
    expect(details.unrecovered_total).toBe(9);
    expect(details.unrecovered.every((u: { reason: string }) => u.reason === 'BUDGET')).toBe(true);
  });

  it('automatic runs stop at 700 (leaving 100); manual runs may use 701–800', async () => {
    const store = newStore();
    prefillLedger(store, 698, WED);
    const auto = await run(store, market(WED), { symbols: ALL });
    expect(auto.calls).toHaveLength(2);
    expect(used(store)).toBe(700);
    expect(auto.details.unrecovered.filter((u: { reason: string }) => u.reason === 'BUDGET')).toHaveLength(7);

    const manual = await run(store, market(WED), { symbols: ALL, mode: 'MANUAL' });
    expect(manual.calls).toHaveLength(9);
    expect(used(store)).toBe(709);
    expect(manual.details.budget).toMatchObject({
      mode: 'MANUAL',
      daily: 800,
      used_before_run: 700,
      left_after_run: 91,
    });

    prefillLedger(store, 89, WED); // 798 used
    const lastManual = await run(store, market(WED), { symbols: ALL, mode: 'MANUAL' });
    expect(lastManual.calls).toHaveLength(2);
    expect(used(store)).toBe(800);
  });

  it('cap reached mid-run (another run took the credits): not sent, BUDGET, PARTIAL, note', async () => {
    const store = newStore();
    prefillLedger(store, 690, WED);
    const { result, details, calls } = await run(store, market(WED), {
      symbols: ['USDJPY', 'EURUSD', 'EURJPY'],
      script: (_call, nth) => {
        if (nth === 1) prefillLedger(store, 9, WED); // a concurrent run uses 9 → 1 credit was ours
        return undefined;
      },
    });
    expect(calls).toHaveLength(1);
    expect(used(store)).toBe(700);
    expect(result.status).toBe('PARTIAL');
    expect(details.requests.map((r: { outcome: string }) => r.outcome)).toEqual(['OK', 'BUDGET']);
    expect(details.unrecovered.map((u: { symbol: string; reason: string }) => `${u.symbol}:${u.reason}`)).toEqual([
      'EURUSD:BUDGET',
      'EURJPY:BUDGET',
    ]);
    expect(details.notes).toEqual([expect.stringContaining('daily credit cap 700 (AUTOMATIC) reached')]);
    expect(result.counters.errorMessages[0]).toContain('request not sent');
  });

  it('two concurrent runs cannot exceed the cap together', async () => {
    const store = newStore();
    prefillLedger(store, 695, WED);
    const [a, b] = await Promise.all([
      run(store, market(WED), { symbols: ALL }),
      run(store, market(WED), { symbols: ALL }),
    ]);
    expect(used(store)).toBe(700);
    expect(a.calls.length + b.calls.length).toBe(5);
    expect(a.details.api_requests + b.details.api_requests).toBe(5);
  });

  it('the per-run cap also bounds HTTP attempts (retries included)', async () => {
    const store = newStore();
    const { details, calls } = await run(store, market(WED), {
      symbols: ['USDJPY', 'EURUSD'],
      settings: { perRunRequestCap: 2 },
      script: (call, nth) => (call.symbol === 'USDJPY' && nth === 1 ? new Response('', { status: 503 }) : undefined),
    });
    expect(calls).toHaveLength(2);
    expect(details.api_requests).toBe(2);
    expect(details.requests.map((r: { outcome: string }) => r.outcome)).toEqual(['OK', 'BUDGET']);
    expect(details.notes).toEqual([expect.stringContaining('per-run cap 2 reached')]);
  });
});
