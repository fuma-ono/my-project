import { describe, expect, it } from 'vitest';
import {
  analyzeFxSchedule,
  buildDataQualityReport,
  checkReleaseWindows,
  computeFxCompleteness,
  countMarketOpenMinutes,
  countSpeechTimeNotExact,
  findGaps,
  isFxMarketOpen,
  median,
  summarizeEconomicValues,
  summarizeRuns,
  usableMinuteSet,
  type FxRowSample,
  type IngestionLogSample,
} from '../../src/ingestion/quality/metrics.js';
import { fetchAllPages, PAGE_SIZE } from '../../src/ingestion/quality/reader.js';
import { renderDataQualityMarkdown } from '../../src/ingestion/quality/report.js';

const MIN = 60_000;
const ms = (iso: string): number => Date.parse(iso);
const iso = (value: number): string => new Date(value).toISOString();

/** 1m rows for every minute in [from, to) except `skip` (ISO minutes). */
function minuteRows(
  fromIso: string,
  toIso: string,
  options: { skip?: readonly string[]; status?: (minute: number) => Partial<FxRowSample> } = {},
): FxRowSample[] {
  const skip = new Set((options.skip ?? []).map(ms));
  const rows: FxRowSample[] = [];
  for (let m = ms(fromIso); m < ms(toIso); m += MIN) {
    if (skip.has(m)) continue;
    rows.push({
      timestamp: iso(m),
      timeframe: '1m',
      verification_status: 'SINGLE_SOURCE',
      cross_check_diff_pips: null,
      ...options.status?.(m),
    });
  }
  return rows;
}

function log(
  job: string,
  startedAt: string,
  status: IngestionLogSample['status'],
  extra: Partial<IngestionLogSample> = {},
) {
  return {
    job,
    provider: 'twelvedata',
    data_type: 'FX_PRICE',
    started_at: startedAt,
    completed_at: iso(ms(startedAt) + 30_000),
    status,
    details: { skip_reasons: {} },
    ...extra,
  } satisfies IngestionLogSample;
}

describe('market-open minutes', () => {
  it('treats Friday 21:00 UTC → Sunday 21:00 UTC as closed', () => {
    expect(isFxMarketOpen(ms('2026-10-09T20:59:00Z'))).toBe(true); // Fri
    expect(isFxMarketOpen(ms('2026-10-09T21:00:00Z'))).toBe(false);
    expect(isFxMarketOpen(ms('2026-10-10T12:00:00Z'))).toBe(false); // Sat
    expect(isFxMarketOpen(ms('2026-10-11T20:59:00Z'))).toBe(false); // Sun
    expect(isFxMarketOpen(ms('2026-10-11T21:00:00Z'))).toBe(true);
  });

  it('counts only open minutes across a weekend', () => {
    // Fri 20:00 → Sun 22:00: Fri 20:00–21:00 + Sun 21:00–22:00
    expect(countMarketOpenMinutes({ from: ms('2026-10-09T20:00:00Z'), to: ms('2026-10-11T22:00:00Z') })).toBe(120);
    // one full week = 120 hours
    expect(countMarketOpenMinutes({ from: ms('2026-10-11T00:00:00Z'), to: ms('2026-10-18T00:00:00Z') })).toBe(120 * 60);
  });
});

describe('gap detection', () => {
  it('lists the longest gaps first and splits gaps at the weekend close', () => {
    const period = { from: ms('2026-10-09T20:50:00Z'), to: ms('2026-10-11T21:10:00Z') };
    const rows = minuteRows('2026-10-09T20:50:00Z', '2026-10-11T21:10:00Z', {
      skip: [
        '2026-10-09T20:52:00Z',
        '2026-10-09T20:58:00Z',
        '2026-10-09T20:59:00Z',
        '2026-10-11T21:00:00Z',
        '2026-10-11T21:01:00Z',
        '2026-10-11T21:02:00Z',
      ],
    });
    const present = new Set(rows.map((r) => ms(r.timestamp)));
    expect(findGaps(present, period)).toEqual([
      { start: '2026-10-11T21:00:00.000Z', minutes: 3 },
      { start: '2026-10-09T20:58:00.000Z', minutes: 2 },
      { start: '2026-10-09T20:52:00.000Z', minutes: 1 },
    ]);
    expect(findGaps(present, period, 1)).toHaveLength(1);
  });
});

describe('FX completeness', () => {
  const period = { from: ms('2026-10-12T10:00:00Z'), to: ms('2026-10-12T11:00:00Z') }; // Monday
  const rows: FxRowSample[] = [
    ...minuteRows('2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z', {
      skip: Array.from({ length: 10 }, (_, i) => iso(ms('2026-10-12T10:30:00Z') + i * MIN)),
      status: (m) => {
        if (m === ms('2026-10-12T10:07:00Z')) return { verification_status: 'UNVERIFIED', cross_check_diff_pips: -4.5 };
        if (m < ms('2026-10-12T10:10:00Z')) return { verification_status: 'VERIFIED', cross_check_diff_pips: 0.3 };
        return {};
      },
    }),
    // aggregated: 10:10 and 10:15 5m buckets present; 10:05 present but not eligible (10:07 UNVERIFIED)
    {
      timestamp: '2026-10-12T10:05:00.000Z',
      timeframe: '5m',
      verification_status: 'VERIFIED',
      cross_check_diff_pips: null,
    },
    {
      timestamp: '2026-10-12T10:10:00.000Z',
      timeframe: '5m',
      verification_status: 'SINGLE_SOURCE',
      cross_check_diff_pips: null,
    },
    {
      timestamp: '2026-10-12T10:15:00.000Z',
      timeframe: '5m',
      verification_status: 'SINGLE_SOURCE',
      cross_check_diff_pips: null,
    },
    // newer than the period: only used for the latest-candle age
    ...minuteRows('2026-10-12T11:00:00Z', '2026-10-12T11:05:00Z'),
  ];

  it('computes present / missing / rates / cross-check agreement', () => {
    const result = computeFxCompleteness('USDJPY', rows, period);
    expect(result.expectedMinutes).toBe(60);
    expect(result.presentMinutes).toBe(50);
    expect(result.missingMinutes).toBe(10);
    expect(result.missingRate).toBeCloseTo(10 / 60);
    expect(result.usableMinutes).toBe(49);
    expect(result.status).toEqual({ VERIFIED: 9, SINGLE_SOURCE: 40, UNVERIFIED: 1 });
    expect(result.crossChecked).toBe(10);
    expect(result.agreementRate).toBeCloseTo(0.9);
    expect(result.maxAbsDiffPips).toBe(4.5);
    expect(result.longestGaps).toEqual([{ start: '2026-10-12T10:30:00.000Z', minutes: 10 }]);
    expect(result.latestCandleOpen).toBe('2026-10-12T11:04:00.000Z');
  });

  it('measures aggregated coverage only over buckets whose 1m minutes are all present and usable', () => {
    const fiveMinute = computeFxCompleteness('USDJPY', rows, period).aggregates.find((a) => a.timeframe === '5m')!;
    // 12 buckets − 10:05 (UNVERIFIED) − 10:30, 10:35 (missing) = 9 eligible; 10:10, 10:15 present
    expect(fiveMinute).toEqual({ timeframe: '5m', eligibleBuckets: 9, presentBuckets: 2, coverageRate: 2 / 9 });
    const sixty = computeFxCompleteness('USDJPY', rows, period).aggregates.find((a) => a.timeframe === '60m')!;
    expect(sixty.eligibleBuckets).toBe(0);
    expect(sixty.coverageRate).toBeNull();
  });

  it('does not count rows outside the market week as present', () => {
    const weekend = { from: ms('2026-10-10T00:00:00Z'), to: ms('2026-10-10T01:00:00Z') };
    const result = computeFxCompleteness('USDJPY', minuteRows('2026-10-10T00:00:00Z', '2026-10-10T00:10:00Z'), weekend);
    expect(result).toMatchObject({ expectedMinutes: 0, presentMinutes: 0, outsideMarketRows: 10, missingRate: null });
  });
});

describe('release-window completeness', () => {
  const period = { from: ms('2026-10-12T00:00:00Z'), to: ms('2026-10-17T00:00:00Z') };
  const full = usableMinuteSet(minuteRows('2026-10-12T12:00:00Z', '2026-10-12T14:00:00Z'));
  const holed = usableMinuteSet(
    minuteRows('2026-10-12T12:00:00Z', '2026-10-12T14:00:00Z', {
      skip: ['2026-10-12T13:00:00Z'],
      status: (m) => (m === ms('2026-10-12T12:25:00Z') ? { verification_status: 'UNVERIFIED' } : {}),
    }),
  );
  const usable = new Map([
    ['USDJPY', full],
    ['EURUSD', holed],
  ]);

  it('needs every usable 1m candle from T−5 to T+60 (UNVERIFIED counts as missing)', () => {
    const summary = checkReleaseWindows(
      [{ kind: 'ECONOMIC', at: '2026-10-12T12:30:00Z', label: 'US_CPI' }],
      usable,
      period,
    );
    expect(summary.byKind.ECONOMIC).toEqual({
      windows: 2,
      complete: 1,
      incomplete: 1,
      outsideMarket: 0,
      outsidePeriod: 0,
    });
    expect(summary.issues).toEqual([
      { kind: 'ECONOMIC', at: '2026-10-12T12:30:00Z', label: 'US_CPI', symbol: 'EURUSD', missingMinutes: 2 },
    ]);
  });

  it('accepts exactly T−5 .. T+59 and floors non-aligned instants', () => {
    const window = usableMinuteSet(minuteRows('2026-10-12T12:25:00Z', '2026-10-12T13:30:00Z'));
    const summary = checkReleaseWindows(
      [{ kind: 'SPEECH', at: '2026-10-12T12:30:40Z', label: 'speech' }],
      new Map([['USDJPY', window]]),
      period,
    );
    expect(summary.byKind.SPEECH.complete).toBe(1);
  });

  it('does not judge windows in the closed market or at the period edges', () => {
    const summary = checkReleaseWindows(
      [
        { kind: 'SPEECH', at: '2026-10-10T15:00:00Z', label: 'Saturday' },
        { kind: 'SPEECH', at: '2026-10-16T23:30:00Z', label: 'edge' },
      ],
      usable,
      { from: ms('2026-10-10T00:00:00Z'), to: ms('2026-10-17T00:00:00Z') },
    );
    expect(summary.byKind.SPEECH).toEqual({
      windows: 0,
      complete: 0,
      incomplete: 0,
      outsideMarket: 2,
      outsidePeriod: 2,
    });
  });
});

describe('ingestion runs', () => {
  const runs = [
    log('ingest:fx-prices', '2026-10-12T10:00:00Z', 'SUCCESS'),
    log('ingest:fx-prices', '2026-10-12T10:20:00Z', 'SUCCESS'),
    log('ingest:fx-prices', '2026-10-12T10:40:00Z', 'FAILURE'),
    log('ingest:fx-prices', '2026-10-12T11:00:00Z', 'PARTIAL'),
    // 180 minutes after the last SUCCESS
    log('ingest:fx-prices', '2026-10-12T13:20:00Z', 'SUCCESS', { completed_at: '2026-10-12T13:21:30Z' }),
    log('ingest:speeches', '2026-10-12T06:00:00Z', 'SUCCESS', {
      provider: 'ecb_press',
      data_type: 'OTHER',
      details: { skip_reasons: { TIME_NOT_EXACT: 4, OUTSIDE_WINDOW: 1 } },
    }),
    log('ingest:speeches', '2026-10-13T06:00:00Z', 'SUCCESS', {
      provider: 'ecb_press',
      data_type: 'OTHER',
      details: { skip_reasons: { TIME_NOT_EXACT: 2 } },
    }),
  ];

  it('finds intervals between successful runs longer than the fetch window', () => {
    const stats = analyzeFxSchedule(runs, ms('2026-10-12T14:00:00Z'));
    expect(stats.successfulRuns).toBe(3);
    expect(stats.longestIntervalMinutes).toBe(180);
    expect(stats.longestInterval).toEqual({ from: '2026-10-12T10:20:00.000Z', to: '2026-10-12T13:20:00.000Z' });
    // 10:20 → 13:20 − 120 min = 11:20: 60 market minutes no run fetched
    expect(stats.gapsOverWindow).toEqual([
      { from: '2026-10-12T10:20:00.000Z', to: '2026-10-12T13:20:00.000Z', minutes: 180, uncoveredMarketMinutes: 60 },
    ]);
    expect(stats.minutesSinceLastSuccess).toBe(40);
  });

  it('does not report schedule gaps when runs keep within the window', () => {
    const regular = Array.from({ length: 10 }, (_, i) =>
      log('ingest:fx-prices', iso(ms('2026-10-12T00:00:00Z') + i * 20 * MIN), 'SUCCESS'),
    );
    const stats = analyzeFxSchedule(regular, ms('2026-10-12T03:30:00Z'));
    expect(stats.longestIntervalMinutes).toBe(20);
    expect(stats.gapsOverWindow).toEqual([]);
  });

  it('counts runs per job, statuses, median duration and skip reasons', () => {
    const stats = summarizeRuns(runs);
    expect(stats.map((s) => s.job)).toEqual(['ingest:fx-prices', 'ingest:speeches']);
    expect(stats[0]).toMatchObject({ runs: 5, success: 3, partial: 1, failure: 1, medianDurationSeconds: 30 });
    expect(stats[1]!.skipReasons).toEqual({ TIME_NOT_EXACT: 6, OUTSIDE_WINDOW: 1 });
    expect(countSpeechTimeNotExact(runs)).toBe(6);
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('economic values', () => {
  it('agreement = VERIFIED / (VERIFIED + official mismatches)', () => {
    const stats = summarizeEconomicValues(
      [
        { verification_status: 'VERIFIED' },
        { verification_status: 'VERIFIED' },
        { verification_status: 'VERIFIED' },
        { verification_status: 'SINGLE_SOURCE' },
      ],
      [
        { verification_status: 'PENDING_REVIEW', reasons: ['OFFICIAL_MISMATCH'] },
        { verification_status: 'PENDING_REVIEW', reasons: ['REFERENCE_PERIOD_INFERRED'] },
        { verification_status: 'AWAITING_OFFICIAL', reasons: [] },
      ],
    );
    expect(stats.snapshots).toEqual({ VERIFIED: 3, SINGLE_SOURCE: 1 });
    expect(stats.staged).toEqual({ PENDING_REVIEW: 2, AWAITING_OFFICIAL: 1 });
    expect(stats.officialMismatches).toBe(1);
    expect(stats.agreementRate).toBeCloseTo(0.75);
    expect(stats.pendingReviewReasons).toEqual({ OFFICIAL_MISMATCH: 1, REFERENCE_PERIOD_INFERRED: 1 });
    expect(summarizeEconomicValues([], []).agreementRate).toBeNull();
  });
});

describe('reader paging', () => {
  it('requests 1000-row pages until a short page', async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllPages<number>((from, to) => {
      calls.push([from, to]);
      const size = from === 0 ? PAGE_SIZE : 3;
      return Promise.resolve({ data: Array.from({ length: size }, (_, i) => from + i), error: null });
    });
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(rows).toHaveLength(1003);
  });
});

/** Fixture used for the sample report in data-sources.md §12. */
function sampleReportInput() {
  const usdjpy = minuteRows('2026-10-12T12:00:00Z', '2026-10-12T14:00:00Z', {
    skip: ['2026-10-12T12:40:00Z', '2026-10-12T12:41:00Z', '2026-10-12T13:10:00Z'],
    status: (m) =>
      m === ms('2026-10-12T12:31:00Z')
        ? { verification_status: 'UNVERIFIED', cross_check_diff_pips: 6.2 }
        : { verification_status: 'VERIFIED', cross_check_diff_pips: 0.4 },
  });
  const eurusd = minuteRows('2026-10-12T12:00:00Z', '2026-10-12T14:00:00Z');
  return {
    now: new Date('2026-10-12T14:30:00Z'),
    period: { from: ms('2026-10-12T12:00:00Z'), to: ms('2026-10-12T14:00:00Z') },
    days: 1,
    pairs: [
      { symbol: 'USDJPY', rows: usdjpy },
      {
        symbol: 'EURUSD',
        rows: [
          ...eurusd,
          {
            timestamp: '2026-10-12T12:00:00.000Z',
            timeframe: '60m',
            verification_status: 'SINGLE_SOURCE',
            cross_check_diff_pips: null,
          },
        ] satisfies FxRowSample[],
      },
    ],
    releases: [{ kind: 'ECONOMIC', at: '2026-10-12T12:30:00Z', label: 'US_CPI' }] as const,
    logs: [
      log('ingest:fx-prices', '2026-10-12T09:00:00Z', 'SUCCESS'),
      log('ingest:fx-prices', '2026-10-12T12:20:00Z', 'SUCCESS'),
      log('ingest:fx-prices', '2026-10-12T12:40:00Z', 'PARTIAL'),
      log('ingest:fx-prices', '2026-10-12T14:00:00Z', 'SUCCESS'),
      log('ingest:speeches', '2026-10-12T06:00:00Z', 'SUCCESS', {
        provider: 'ecb_press',
        data_type: 'OTHER',
        details: { skip_reasons: { TIME_NOT_EXACT: 3 } },
      }),
    ],
    snapshots: [{ verification_status: 'VERIFIED' }, { verification_status: 'SINGLE_SOURCE' }],
    staged: [{ verification_status: 'PENDING_REVIEW' as const, reasons: ['OFFICIAL_MISMATCH'] }],
  };
}

describe('Markdown report', () => {
  it('renders every section in Japanese without anything secret', () => {
    const markdown = renderDataQualityMarkdown(buildDataQualityReport(sampleReportInput()));
    for (const heading of [
      '# データ品質レポート(直近1日)',
      '## 1. 為替1分足の取得率・欠損率',
      '## 2. 照合一致率(1分足)',
      '## 3. 集約足(5分〜60分)の作成率',
      '## 4. 発表・発言前後の1分足',
      '## 5. 取得ジョブの実行状況',
      '## 6. 時刻ずれ',
      '## 7. 経済指標の値',
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain('| USDJPY | 120 | 117 | 3 | 2.50% | 116 | 0 |');
    expect(markdown).toContain('| 経済指標 | 2026-10-12 12:30Z | US_CPI | USDJPY | 4 |');
    expect(markdown).toContain('取得範囲(120分)を超えた間隔: 1 件');
    expect(markdown).toContain('TIME_NOT_EXACT): 3 件');
    expect(markdown).toContain('公式統計との一致率: 50.00%');
    expect(markdown).not.toMatch(/https?:\/\/|apikey|service_role/i);
  });
});
