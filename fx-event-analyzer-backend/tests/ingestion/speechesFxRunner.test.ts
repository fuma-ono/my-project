import { beforeEach, describe, expect, it } from 'vitest';
import { parseEcbPressRss } from '../../src/ingestion/adapters/ecbPress.js';
import { parseFrbCalendar } from '../../src/ingestion/adapters/frbCalendar.js';
import { parsePolygonAggregates } from '../../src/ingestion/adapters/polygon.js';
import { parseTwelveDataSeries } from '../../src/ingestion/adapters/twelveData.js';
import { aggregateMinuteRows, ingestFxCandles } from '../../src/ingestion/pipelines/fxPrices.js';
import { ingestSpeeches, speechTitle } from '../../src/ingestion/pipelines/speeches.js';
import type { FxPriceProvider } from '../../src/ingestion/providers.js';
import type { FxPriceRow } from '../../src/ingestion/store.js';
import { JobCounters, resolveJobStatus, runIngestionJob } from '../../src/ingestion/runner.js';
import type { NormalizedCandle, NormalizedSpeech } from '../../src/ingestion/types.js';
import { checkCandles, usableForReactions } from '../../src/ingestion/validation/fxCandles.js';
import { fixture, jsonFixture, MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

describe('speech pipeline (recorded FRB calendar / ECB RSS)', () => {
  let store: MemoryIngestionStore;
  beforeEach(() => {
    store = new MemoryIngestionStore();
    // Like the DB after migration 20261013000004: Waller has an alias but no speakers row.
    store.speakers = [
      { id: 'sp-warsh', name: 'ケビン・ウォーシュ', organization: 'FRB' },
      { id: 'sp-bowman', name: 'ミシェル・ボウマン', organization: 'FRB' },
      { id: 'sp-cook', name: 'リサ・クック', organization: 'FRB' },
      { id: 'sp-jefferson', name: 'フィリップ・ジェファーソン', organization: 'FRB' },
      { id: 'sp-lagarde', name: 'クリスティーヌ・ラガルド', organization: 'ECB' },
    ];
  });

  it('upserts known speakers, skips unknown ones without creating them, and is idempotent', async () => {
    const { speeches } = parseFrbCalendar(await jsonFixture('frb-calendar.json'));
    const counters = new JobCounters();
    const now = () => new Date('2026-10-15T12:00:00Z');
    await ingestSpeeches('frb_calendar', speeches, { store, now, pastDays: 365 }, counters);

    expect(store.speakers).toHaveLength(5);
    expect(counters.skipReasons).toEqual({ SPEAKER_NOT_IN_DB: 3, SPEAKER_UNKNOWN: 1 });
    expect(counters.details.unknown_speakers).toEqual(['FRB: Stephen I. Miran']);
    expect(counters.details.speakers_not_in_db).toContain('FRB: クリストファー・ウォラー');

    const warsh = store.speeches.find((s) => s.speaker_id === 'sp-warsh' && s.title.startsWith('討論'));
    // 11:30 p.m. EDT on 10/15 = 03:30 UTC 10/16 — still in the future at "now".
    expect(warsh).toMatchObject({
      provider: 'frb_calendar',
      statement_datetime: '2026-10-16T03:30:00.000Z',
      status: 'SCHEDULED',
      importance: 'HIGH',
    });
    expect(store.speeches.find((s) => s.statement_datetime === '2026-10-15T02:55:00.000Z')).toMatchObject({
      speaker_id: 'sp-bowman',
      title: '講演: Supervision and Regulation',
      status: 'DELIVERED',
      importance: 'MEDIUM',
    });

    const before = JSON.stringify(store.speeches);
    await ingestSpeeches('frb_calendar', speeches, { store, now, pastDays: 365 }, new JobCounters());
    expect(JSON.stringify(store.speeches)).toBe(before);
  });

  it('ignores speeches older than the window (the feed carries years of history)', async () => {
    const { speeches } = parseFrbCalendar(await jsonFixture('frb-calendar.json'));
    const counters = new JobCounters();
    await ingestSpeeches('frb_calendar', speeches, { store, now: () => new Date('2026-10-15T12:00:00Z') }, counters);
    // July testimony and April Miran discussion are outside the default 14 days.
    expect(counters.skipReasons.OUTSIDE_WINDOW).toBe(2);
    expect(store.speeches.every((s) => s.statement_datetime >= '2026-10-01')).toBe(true);
  });

  it('logs a SCHEDULED speech that vanished from the source instead of cancelling it', async () => {
    const { speeches } = parseFrbCalendar(await jsonFixture('frb-calendar.json'));
    const now = () => new Date('2026-10-15T12:00:00Z');
    await ingestSpeeches('frb_calendar', speeches, { store, now }, new JobCounters());
    const warshId = store.speeches.find(
      (s) => s.speaker_id === 'sp-warsh' && s.status === 'SCHEDULED',
    )!.provider_event_id;
    const counters = new JobCounters();
    await ingestSpeeches(
      'frb_calendar',
      speeches.filter((s) => s.providerEventId !== warshId),
      { store, now },
      counters,
    );
    // The second fetch's latest speech is already past, so it covers no future window yet.
    expect(counters.details.disappeared_scheduled_speeches).toBeUndefined();
    expect(store.speeches.find((s) => s.provider_event_id === warshId)?.status).toBe('SCHEDULED');
    const later = {
      ...speeches[0]!,
      providerEventId: 'later',
      startsAt: '2026-10-20T14:00:00.000Z',
      speakerName: 'Lisa D. Cook',
    };
    const third = new JobCounters();
    await ingestSpeeches('frb_calendar', [later], { store, now }, third);
    expect(third.details.disappeared_scheduled_speeches).toEqual([warshId]);
  });

  it('skips publication-time-only items (ECB RSS) by default', async () => {
    const speeches = parseEcbPressRss(await fixture('ecb-press-rss.xml'));
    const counters = new JobCounters();
    await ingestSpeeches(
      'ecb_press_rss',
      speeches,
      { store, now: () => new Date('2026-10-15T12:00:00Z'), pastDays: 365 },
      counters,
    );
    expect(store.speeches).toHaveLength(0);
    expect(counters.skipReasons.TIME_NOT_EXACT).toBe(speeches.length);
  });

  describe('鮮度の記録 source_latest_at / source_future_count (HQ承認 2026-10-23)', () => {
    const NOW = new Date('2026-10-20T12:00:00Z');
    const item = (
      id: string,
      speakerName: string,
      startsAt: string,
      overrides: Partial<NormalizedSpeech> = {},
    ): NormalizedSpeech => ({
      provider: 'frb_calendar',
      providerEventId: id,
      speakerName,
      organization: 'FRB',
      kind: 'SPEECH',
      topic: 'Economic Outlook',
      startsAt,
      timePrecision: 'EXACT',
      url: null,
      ...overrides,
    });
    const items: NormalizedSpeech[] = [
      item('old', 'Lisa D. Cook', '2026-09-01T15:00:00Z'), // OUTSIDE_WINDOW
      item('past', 'Lisa D. Cook', '2026-10-19T15:00:00Z'), // DELIVERED
      item('future', 'Philip N. Jefferson', '2026-10-22T15:00:00Z'), // SCHEDULED
      item('latest-unknown', 'Stephen I. Miran', '2026-10-28T15:00:00Z'), // SPEAKER_UNKNOWN (最新)
      item('no-time', 'Lisa D. Cook', '2026-10-25T00:00:00Z', { timePrecision: 'PUBLICATION_TIME' }),
    ];

    it('computes them from ALL fetched items, including skipped ones', async () => {
      const counters = new JobCounters();
      await ingestSpeeches('frb_calendar', items, { store, now: () => NOW }, counters);
      // 最新はスキップされた話者未登録の項目、未来の予定はスキップ分も含めて3件
      expect(counters.details.source_latest_at).toBe('2026-10-28T15:00:00.000Z');
      expect(counters.details.source_future_count).toBe(3);
    });

    it('records null / 0 when nothing was fetched', async () => {
      const counters = new JobCounters();
      await ingestSpeeches('frb_calendar', [], { store, now: () => NOW }, counters);
      expect(counters.details).toEqual({ source_latest_at: null, source_future_count: 0 });
      expect(counters.fetched).toBe(0);
      expect(store.speeches).toEqual([]);
    });

    it('leaves the upserted rows and the counters exactly as before', async () => {
      const counters = new JobCounters();
      await ingestSpeeches('frb_calendar', items, { store, now: () => NOW }, counters);
      expect(
        store.speeches.map(({ provider_event_id, speaker_id, status, statement_datetime }) => ({
          provider_event_id,
          speaker_id,
          status,
          statement_datetime,
        })),
      ).toEqual([
        {
          provider_event_id: 'past',
          speaker_id: 'sp-cook',
          status: 'DELIVERED',
          statement_datetime: '2026-10-19T15:00:00Z',
        },
        {
          provider_event_id: 'future',
          speaker_id: 'sp-jefferson',
          status: 'SCHEDULED',
          statement_datetime: '2026-10-22T15:00:00Z',
        },
      ]);
      expect({
        fetched: counters.fetched,
        success: counters.success,
        skipped: counters.skipped,
        errors: counters.errors,
        skipReasons: counters.skipReasons,
      }).toEqual({
        fetched: 5,
        success: 2,
        skipped: 3,
        errors: 0,
        skipReasons: { OUTSIDE_WINDOW: 1, SPEAKER_UNKNOWN: 1, TIME_NOT_EXACT: 1 },
      });
      // 追加したのは2つのキーだけ(既存の details はそのまま)
      expect(Object.keys(counters.details).sort()).toEqual([
        'source_future_count',
        'source_latest_at',
        'unknown_speakers',
      ]);
      expect(counters.details.unknown_speakers).toEqual(['FRB: Stephen I. Miran']);
    });
  });

  it('builds a Japanese kind label + the source topic (no translation)', () => {
    expect(
      speechTitle({
        provider: 'x',
        providerEventId: 'x',
        speakerName: 'x',
        organization: 'FRB',
        kind: 'TESTIMONY',
        topic: '  Semiannual   Monetary Policy Report ',
        startsAt: '2026-07-14T14:00:00Z',
        timePrecision: 'EXACT',
        url: null,
      }),
    ).toBe('議会証言: Semiannual Monetary Policy Report');
  });
});

const NOW = new Date('2026-10-15T08:31:27Z');

async function candles(): Promise<{ td: NormalizedCandle[]; polygon: NormalizedCandle[] }> {
  return {
    td: parseTwelveDataSeries(await jsonFixture('twelvedata-usdjpy-1min-utc.json'), 'USDJPY'),
    polygon: parsePolygonAggregates(await jsonFixture('polygon-usdjpy-1min.json'), 'USDJPY').candles,
  };
}

describe('FX candle checks', () => {
  it('cross-checks ③ vs ⑤ per minute and marks big differences UNVERIFIED', async () => {
    const { td, polygon } = await candles();
    const result = checkCandles(td, { pipSize: 0.01, now: NOW, maxJumpPips: 500, maxDiffPips: 3, secondary: polygon });
    const byMinute = new Map(result.accepted.map((c) => [c.candle.openTime, c]));
    expect(byMinute.get('2026-10-15T08:28:00.000Z')).toMatchObject({
      verificationStatus: 'VERIFIED',
      crossCheckDiffPips: 0,
    });
    expect(byMinute.get('2026-10-15T08:30:00.000Z')).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      crossCheckClose: 157.7896,
      crossCheckDiffPips: -6,
      notes: ['CROSS_CHECK_DIFF'],
    });
  });

  it('drops the still-forming candle and malformed ones; never invents minutes', async () => {
    const { td } = await candles();
    const early = new Date('2026-10-15T08:30:30Z');
    const broken: NormalizedCandle = { ...td[1]!, openTime: '2026-10-15T08:20:15.000Z' };
    const badOhlc: NormalizedCandle = { ...td[1]!, openTime: '2026-10-15T08:10:00.000Z', high: 1, low: 2 };
    const result = checkCandles([...td, broken, badOhlc], {
      pipSize: 0.01,
      now: early,
      maxJumpPips: 500,
      maxDiffPips: 3,
    });
    expect(result.rejected.map((r) => r.reason).sort()).toEqual(['INCOMPLETE', 'INVALID_OHLC', 'NOT_MINUTE_ALIGNED']);
    expect(result.accepted.map((c) => c.candle.openTime)).toEqual([
      '2026-10-15T08:28:00.000Z',
      '2026-10-15T08:29:00.000Z',
    ]);
    expect(result.accepted.every((c) => c.verificationStatus === 'SINGLE_SOURCE')).toBe(true);
  });

  it('marks an implausible jump UNVERIFIED and rejects conflicting duplicates', async () => {
    const { td } = await candles();
    const jump: NormalizedCandle = { ...td[0]!, open: 160, high: 160, low: 157, close: 159 };
    const dup: NormalizedCandle = { ...td[2]!, close: 157.72 };
    const result = checkCandles([td[2]!, dup, td[1]!, jump], {
      pipSize: 0.01,
      now: NOW,
      maxJumpPips: 100,
      maxDiffPips: 3,
    });
    expect(result.rejected).toEqual([expect.objectContaining({ reason: 'CONFLICTING_DUPLICATE' })]);
    expect(result.accepted.find((c) => c.candle.openTime === '2026-10-15T08:30:00.000Z')).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      notes: ['PRICE_JUMP'],
    });
  });

  it('usableForReactions treats UNVERIFIED minutes as missing', () => {
    const rows = [
      { verification_status: 'VERIFIED' },
      { verification_status: 'UNVERIFIED' },
      { verification_status: 'SINGLE_SOURCE' },
    ];
    expect(usableForReactions(rows)).toHaveLength(2);
  });
});

describe('FX pipeline', () => {
  it('upserts by (pair, 1m, open time), records the cross-check, and refuses a pip-size mismatch', async () => {
    const { td, polygon } = await candles();
    const provider = (name: string, data: NormalizedCandle[]): FxPriceProvider => ({
      name,
      fetchOneMinuteCandles: () => Promise.resolve(data),
    });
    const store = new MemoryIngestionStore();
    store.fxPairs = [
      { id: 'pair-usdjpy', symbol: 'USDJPY', pip_size: 0.01, price_precision: 3 },
      { id: 'pair-eurusd', symbol: 'EURUSD', pip_size: 0.001, price_precision: 5 },
    ];
    const deps = {
      store,
      primary: provider('twelvedata', td),
      secondary: provider('polygon', polygon),
      now: () => NOW,
    };
    const range = { from: '2026-10-15T08:28:00Z', to: '2026-10-15T08:31:00Z' };
    const counters = new JobCounters();
    await ingestFxCandles(deps, ['USDJPY', 'EURUSD'], range, counters);
    expect(store.fxPrices).toHaveLength(3);
    expect(store.fxPrices.find((p) => p.timestamp === '2026-10-15T08:30:00.000Z')).toMatchObject({
      verification_status: 'UNVERIFIED',
      cross_check_source: 'polygon',
      source: 'twelvedata',
    });
    expect(counters.review).toBe(1);
    expect(counters.errorMessages[0]).toContain('EURUSD: fx_pairs pip_size/price_precision differ');

    await ingestFxCandles(deps, ['USDJPY'], range, new JobCounters());
    expect(store.fxPrices).toHaveLength(3);
  });
});

describe('FX aggregation (5m–60m from 1m)', () => {
  const minute = (iso: string, close: number, status: FxPriceRow['verification_status'] = 'VERIFIED'): FxPriceRow => ({
    fx_pair_id: 'pair-usdjpy',
    timestamp: new Date(iso).toISOString(),
    timeframe: '1m',
    open: close - 0.01,
    high: close + 0.02,
    low: close - 0.03,
    close,
    volume: null,
    source: 'twelvedata',
    verification_status: status,
    cross_check_source: null,
    cross_check_close: null,
    cross_check_diff_pips: null,
  });
  const fiveMinutes = (start: number, closes: number[]): FxPriceRow[] =>
    closes.map((close, i) => minute(`2026-10-15T08:${String(start + i).padStart(2, '0')}:00Z`, close));
  const now = new Date('2026-10-15T09:00:00Z');

  it('builds open/high/low/close from complete, finished buckets only', () => {
    const rows = fiveMinutes(30, [150.1, 150.3, 149.9, 150.0, 150.2]);
    const [bar] = aggregateMinuteRows(rows, '5m', 5, now);
    expect(bar).toMatchObject({
      timeframe: '5m',
      timestamp: '2026-10-15T08:30:00.000Z',
      verification_status: 'VERIFIED',
    });
    expect(bar?.open).toBeCloseTo(150.09, 10);
    expect(bar?.high).toBeCloseTo(150.32, 10);
    expect(bar?.low).toBeCloseTo(149.87, 10);
    expect(bar?.close).toBe(150.2);
    // Not finished yet at 08:33.
    expect(aggregateMinuteRows(rows, '5m', 5, new Date('2026-10-15T08:33:00Z'))).toEqual([]);
  });

  it('leaves out a bucket with a missing or UNVERIFIED minute, and marks SINGLE_SOURCE ones', () => {
    const missing = fiveMinutes(30, [150.1, 150.3, 149.9, 150.0, 150.2]).filter((_, i) => i !== 2);
    expect(aggregateMinuteRows(missing, '5m', 5, now)).toEqual([]);
    const bad = fiveMinutes(30, [150.1, 150.3, 149.9, 150.0, 150.2]);
    bad[1] = { ...bad[1]!, verification_status: 'UNVERIFIED' };
    expect(aggregateMinuteRows(bad, '5m', 5, now)).toEqual([]);
    const single = fiveMinutes(30, [150.1, 150.3, 149.9, 150.0, 150.2]);
    single[4] = { ...single[4]!, verification_status: 'SINGLE_SOURCE' };
    expect(aggregateMinuteRows(single, '5m', 5, now)[0]?.verification_status).toBe('SINGLE_SOURCE');
  });

  it('writes 1m and the aggregated timeframes through the pipeline', async () => {
    const store = new MemoryIngestionStore();
    store.fxPairs = [{ id: 'pair-usdjpy', symbol: 'USDJPY', pip_size: 0.01, price_precision: 3 }];
    const candlesFrom = Array.from({ length: 15 }, (_, i) => ({
      provider: 'twelvedata',
      symbol: 'USDJPY',
      openTime: `2026-10-15T08:${String(30 + i).padStart(2, '0')}:00Z`,
      open: 150,
      high: 150.2,
      low: 149.95,
      close: 150 + i / 100,
      volume: null,
    }));
    const primary: FxPriceProvider = { name: 'twelvedata', fetchOneMinuteCandles: () => Promise.resolve(candlesFrom) };
    const range = { from: '2026-10-15T08:30:00Z', to: '2026-10-15T08:45:00Z' };
    await ingestFxCandles({ store, primary, now: () => now }, ['USDJPY'], range, new JobCounters());
    const count = (tf: string) => store.fxPrices.filter((p) => p.timeframe === tf).length;
    expect([count('1m'), count('5m'), count('15m'), count('30m'), count('60m')]).toEqual([15, 3, 1, 0, 0]);
    expect(store.fxPrices.find((p) => p.timeframe === '15m')).toMatchObject({
      close: 150.14,
      verification_status: 'SINGLE_SOURCE',
    });
  });
});

describe('job runner', () => {
  it('always writes an ingestion log, also when the body throws', async () => {
    const store = new MemoryIngestionStore();
    const ok = await runIngestionJob(store, { provider: 'p', dataType: 'OTHER', job: 'j' }, (c) => {
      c.fetched = 3;
      c.success = 2;
      c.skip('X');
      return Promise.resolve();
    });
    expect(ok.status).toBe('SUCCESS');
    const crashed = await runIngestionJob(store, { provider: 'p', dataType: 'OTHER', job: 'j' }, () =>
      Promise.reject(new Error('boom')),
    );
    expect(crashed.status).toBe('FAILURE');
    expect(store.logs).toHaveLength(2);
    expect(store.logs[0]).toMatchObject({
      job: 'j',
      fetched_count: 3,
      success_count: 2,
      skipped_count: 1,
      details: { skip_reasons: { X: 1 } },
    });
    expect(store.logs[1]).toMatchObject({ status: 'FAILURE', error_count: 1, error_message: 'Error: boom' });
  });

  it('resolves PARTIAL when some items failed', () => {
    const counters = new JobCounters();
    counters.success = 1;
    counters.error('x');
    expect(resolveJobStatus(counters, false)).toBe('PARTIAL');
  });
});
