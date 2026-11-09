import { describe, expect, it } from 'vitest';
import { BlsAdapter } from '../../src/ingestion/adapters/bls.js';
import { parseEcbPressRss } from '../../src/ingestion/adapters/ecbPress.js';
import { parseFinnhubCalendar } from '../../src/ingestion/adapters/finnhub.js';
import { parseFmpCalendar } from '../../src/ingestion/adapters/fmp.js';
import { FrbCalendarAdapter, parseFrbCalendar, parseFrbTime } from '../../src/ingestion/adapters/frbCalendar.js';
import { FredAdapter, parseFredReleaseDates } from '../../src/ingestion/adapters/fred.js';
import { parsePolygonAggregates, PolygonAdapter } from '../../src/ingestion/adapters/polygon.js';
import { parseTradingEconomicsCalendar } from '../../src/ingestion/adapters/tradingEconomics.js';
import { parseTwelveDataSeries, TwelveDataAdapter } from '../../src/ingestion/adapters/twelveData.js';
import { fixture, jsonFixture, noSleep, stubFetch } from '../helpers/memoryIngestionStore.js';

const FETCHED_AT = '2026-10-15T09:00:00.000Z';

describe('FRED adapter (docs-format fixtures)', () => {
  it('requests point-in-time observations and parses "." as missing', async () => {
    const body = await fixture('fred-cpiaucns-asof-2026-10-14.json');
    const stub = stubFetch(() => ({ body }));
    const fred = new FredAdapter('test-key', { fetch: stub.fetch, sleep: noSleep });
    const observations = await fred.fetchObservations({
      seriesId: 'CPIAUCNS',
      observationStart: '2025-09-01',
      observationEnd: '2026-09-01',
      asOfDate: '2026-10-14',
    });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/fred/series/observations');
    expect(url.searchParams.get('realtime_start')).toBe('2026-10-14');
    expect(url.searchParams.get('realtime_end')).toBe('2026-10-14');
    expect(url.searchParams.get('file_type')).toBe('json');
    expect(observations).toHaveLength(13);
    expect(observations.find((o) => o.periodStart === '2025-10-01')?.value).toBeNull();
    expect(observations.at(-1)).toMatchObject({ periodStart: '2026-09-01', value: 336.94, asOfDate: '2026-10-14' });
  });

  it('parses release dates', async () => {
    expect(parseFredReleaseDates(await jsonFixture('fred-release-dates-10.json'))).toContain('2026-10-14');
  });
});

describe('BLS adapter (recorded v1 response, 2026-10-15)', () => {
  it('uses v1 without a key and v2 with the key in the POST body (never in the URL)', async () => {
    const body = await fixture('bls-v1-2025-2026.json');
    const stub = stubFetch(() => ({ body }));
    const v1 = new BlsAdapter(undefined, { fetch: stub.fetch, sleep: noSleep, today: () => '2026-10-15' });
    const cpi = await v1.fetchObservations({
      seriesId: 'CUUR0000SA0',
      observationStart: '2025-09-01',
      observationEnd: '2026-09-01',
    });
    expect(stub.calls[0]!.url).toContain('/publicAPI/v1/');
    expect(cpi.map((o) => o.seriesId)).toEqual(Array(cpi.length).fill('CUUR0000SA0'));
    expect(cpi[0]).toMatchObject({ periodStart: '2025-09-01', value: 324.8 });

    const v2 = new BlsAdapter('secret-key', { fetch: stub.fetch, sleep: noSleep });
    await v2.fetchObservations({
      seriesId: 'LNS14000000',
      observationStart: '2026-01-01',
      observationEnd: '2026-09-01',
    });
    expect(stub.calls[1]!.url).toBe('https://api.bls.gov/publicAPI/v2/timeseries/data/');
    expect(JSON.parse(stub.calls[1]!.init?.body as string)).toMatchObject({
      registrationkey: 'secret-key',
      seriesid: ['LNS14000000'],
    });
  });

  it('throws on a failed request status', async () => {
    const stub = stubFetch(() => ({
      body: JSON.stringify({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold'] }),
    }));
    const bls = new BlsAdapter(undefined, { fetch: stub.fetch, sleep: noSleep });
    await expect(
      bls.fetchObservations({ seriesId: 'CUUR0000SA0', observationStart: '2026-01-01', observationEnd: '2026-09-01' }),
    ).rejects.toThrow('REQUEST_NOT_PROCESSED daily threshold');
  });

  it("throws BLS's own status/message, not a raw schema error, when Results is present but empty (2026-10-17 failure shape)", async () => {
    // Observed on 2026-10-17 (first ingest:official:bls-calendar run, job
    // 117273067187): BLS returned Results as an object without `series`
    // rather than omitting it. Before the fix this raised a bare Zod
    // "expected: array, received: undefined" at path Results.series,
    // instead of surfacing BLS's own explanation.
    const stub = stubFetch(() => ({
      body: JSON.stringify({ status: 'REQUEST_NOT_SUCCEEDED', message: ['Daily threshold exceeded'], Results: {} }),
    }));
    const bls = new BlsAdapter(undefined, { fetch: stub.fetch, sleep: noSleep });
    await expect(
      bls.fetchObservations({ seriesId: 'CUUR0000SA0', observationStart: '2026-01-01', observationEnd: '2026-09-01' }),
    ).rejects.toThrow('REQUEST_NOT_SUCCEEDED Daily threshold exceeded');
  });
});

describe('FRB calendar adapter (recorded calendar.json, 2026-10-15)', () => {
  it('parses Eastern times into UTC instants and keeps only speeches / testimony', async () => {
    const result = parseFrbCalendar(await jsonFixture('frb-calendar.json'));
    const bowman = result.speeches.find((s) => s.providerEventId.startsWith('2026-10-14_2255'));
    // "10:55 p.m." EDT on 10/14 = 02:55 UTC on 10/15 (matches the speeches RSS pubDate).
    expect(bowman).toMatchObject({
      speakerName: 'Michelle W. Bowman',
      organization: 'FRB',
      kind: 'SPEECH',
      topic: 'Supervision and Regulation',
      startsAt: '2026-10-15T02:55:00.000Z',
      timePrecision: 'EXACT',
    });
    const warsh = result.speeches.find((s) => s.speakerName === 'Kevin Warsh' && s.kind === 'DISCUSSION');
    expect(warsh?.startsAt).toBe('2026-10-16T03:30:00.000Z');
    expect(result.speeches.some((s) => s.kind === 'TESTIMONY')).toBe(true);
    expect(result.speeches.every((s) => !/FOMC|Z\.1/.test(s.topic ?? ''))).toBe(true);
    // Ids are unique even for the same speaker on the same day.
    const ids = result.speeches.map((s) => s.providerEventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('strips the UTF-8 BOM the live feed starts with', async () => {
    const stub = stubFetch(() => ({ body: `${String.fromCharCode(0xfeff)}{"events":[]}` }));
    const adapter = new FrbCalendarAdapter({ fetch: stub.fetch, sleep: noSleep });
    await expect(adapter.fetchSpeeches()).resolves.toEqual([]);
  });

  it('parses 12-hour times strictly', () => {
    expect(parseFrbTime('12:00 p.m.')).toEqual({ hour: 12, minute: 0 });
    expect(parseFrbTime('12:30 a.m.')).toEqual({ hour: 0, minute: 30 });
    expect(parseFrbTime('3:45 a.m.')).toEqual({ hour: 3, minute: 45 });
    expect(parseFrbTime('TBA')).toBeNull();
  });
});

describe('ECB press RSS adapter (recorded, 2026-10-14)', () => {
  it('keeps speeches / interviews as PUBLICATION_TIME items with the speaker before the colon', async () => {
    const speeches = parseEcbPressRss(await fixture('ecb-press-rss.xml'));
    expect(speeches.length).toBeGreaterThan(0);
    expect(speeches[0]).toMatchObject({
      speakerName: 'Frank Elderson',
      organization: 'ECB',
      kind: 'SPEECH',
      topic: 'Ensuring resilience in the face of uncertainty',
      startsAt: '2026-10-14T00:00:00.000Z',
      timePrecision: 'PUBLICATION_TIME',
      providerEventId: 'ecb.sp261014~e4ca33588e',
    });
    expect(speeches.some((s) => s.kind === 'INTERVIEW')).toBe(true);
    // Press releases / accounts are not speeches.
    expect(speeches.some((s) => /Meeting of|Results of/.test(s.topic ?? ''))).toBe(false);
  });
});

describe('paid calendar skeletons (hand-written from public docs)', () => {
  it('Trading Economics: consensus Forecast is used, TEForecast never', async () => {
    const releases = parseTradingEconomicsCalendar(await jsonFixture('tradingeconomics-calendar.json'), FETCHED_AT);
    const cpi = releases.find((r) => r.providerEventId === '400001')!;
    expect(cpi).toMatchObject({
      provider: 'tradingeconomics',
      providerIndicatorKey: 'united states|inflation rate yoy',
      releaseAt: '2026-10-14T12:30:00.000Z',
      releaseAtPrecision: 'EXACT',
      referencePeriod: '2026-09',
      actual: { value: 3.7, unit: '%' },
      forecast: { value: 3.6, unit: '%' },
      previous: { value: 3.4, unit: '%' },
      revisedPrevious: null,
    });
    const nfp = releases.find((r) => r.providerEventId === '400003')!;
    expect(nfp.actual).toEqual({ value: 29, unit: 'K' });
    expect(nfp.revisedPrevious).toEqual({ value: 133, unit: 'K' });
    expect(releases.find((r) => r.providerEventId === '400005')!.actual).toBeNull();
  });

  it('Trading Economics: rejects unparseable values instead of dropping them', () => {
    expect(() =>
      parseTradingEconomicsCalendar(
        [{ CalendarId: '1', Date: '2026-10-14T12:30:00', Country: 'United States', Event: 'X', Actual: 'n.a.x' }],
        FETCHED_AT,
      ),
    ).toThrow('unparseable Actual');
  });

  it('Finnhub / FMP: no reference period (null) and derived ids', async () => {
    const finnhub = parseFinnhubCalendar(await jsonFixture('finnhub-calendar.json'), FETCHED_AT);
    expect(finnhub[0]).toMatchObject({ providerEventId: 'US|CPI YoY|2026-10-14 12:30:00', referencePeriod: null });
    expect(finnhub[1]!.actual).toEqual({ value: 29, unit: 'K' });
    const fmp = parseFmpCalendar(await jsonFixture('fmp-economic-calendar.json'), FETCHED_AT);
    expect(fmp[1]!.forecast).toBeNull();
    expect(fmp[2]!.releaseAt).toBe('2026-10-02T12:31:00.000Z');
  });
});

describe('FX adapters', () => {
  it('Twelve Data: always asks for timezone=UTC; datetime is the candle open time (recorded demo response)', async () => {
    const body = await fixture('twelvedata-usdjpy-1min-utc.json');
    const stub = stubFetch(() => ({ body }));
    const adapter = new TwelveDataAdapter('demo-key', { fetch: stub.fetch, sleep: noSleep });
    const candles = await adapter.fetchOneMinuteCandles('USDJPY', {
      from: '2026-10-15T08:28:00.000Z',
      to: '2026-10-15T08:31:00.000Z',
    });
    const url = new URL(stub.calls[0]!.url);
    expect(url.searchParams.get('timezone')).toBe('UTC');
    expect(url.searchParams.get('symbol')).toBe('USD/JPY');
    expect(url.searchParams.get('end_date')).toBe('2026-10-15 08:30:00');
    expect(candles.map((c) => c.openTime)).toEqual([
      '2026-10-15T08:30:00.000Z',
      '2026-10-15T08:29:00.000Z',
      '2026-10-15T08:28:00.000Z',
    ]);
    expect(candles[0]).toMatchObject({ open: 157.73425, close: 157.72959, volume: null });
  });

  it('Twelve Data: error bodies throw', () => {
    expect(() => parseTwelveDataSeries({ status: 'error', code: 401, message: 'bad key' }, 'USDJPY')).toThrow(
      '401 bad key',
    );
  });

  it('Polygon: t is the window start in ms; gaps stay gaps', async () => {
    const parsed = parsePolygonAggregates(await jsonFixture('polygon-usdjpy-1min.json'), 'USDJPY');
    expect(parsed.candles.map((c) => c.openTime)).toEqual([
      '2026-10-15T08:28:00.000Z',
      '2026-10-15T08:29:00.000Z',
      '2026-10-15T08:30:00.000Z',
    ]);
    const stub = stubFetch(() => ({ body: JSON.stringify({ status: 'OK', results: [] }) }));
    const adapter = new PolygonAdapter('k', { fetch: stub.fetch, sleep: noSleep });
    await adapter.fetchOneMinuteCandles('EURUSD', { from: '2026-10-15T08:00:00Z', to: '2026-10-15T09:00:00Z' });
    expect(stub.calls[0]!.url).toContain('/v2/aggs/ticker/C%3AEURUSD/range/1/minute/');
  });
});
