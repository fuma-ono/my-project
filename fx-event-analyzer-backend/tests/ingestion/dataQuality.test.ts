import { describe, expect, it } from 'vitest';
import {
  analyzeFxSchedule,
  buildDataQualityReport,
  checkReleaseWindows,
  classifySnapshotMatch,
  computeFxCompleteness,
  classifyMissingMinute,
  countSpeechTimeNotExact,
  extractAnomalyDetails,
  extractMissingCauses,
  findGaps,
  median,
  summarizeApiUsage,
  summarizeCreditUsage,
  summarizeEconomicValues,
  summarizeRuns,
  usableMinuteSet,
  type DataQualityInput,
  type FxRowSample,
  type IngestionLogSample,
} from '../../src/ingestion/quality/metrics.js';
import { isFxMarketOpen, marketMinutes } from '../../src/ingestion/marketHours.js';
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

describe('market-open minutes (shared marketHours.ts)', () => {
  it('uses the New York 17:00 rule, not a fixed UTC hour', () => {
    expect(isFxMarketOpen(ms('2026-10-09T20:59:00Z'))).toBe(true); // Fri, EDT
    expect(isFxMarketOpen(ms('2026-10-09T21:00:00Z'))).toBe(false);
    expect(isFxMarketOpen(ms('2026-11-13T21:30:00Z'))).toBe(true); // Fri, EST: open until 22:00 UTC
    expect(isFxMarketOpen(ms('2026-11-08T21:30:00Z'))).toBe(false); // Sun, EST: opens 22:00 UTC
  });

  it('counts only open minutes across a weekend', () => {
    // Fri 20:00 → Sun 22:00 (EDT): Fri 20:00–21:00 + Sun 21:00–22:00
    expect(marketMinutes(ms('2026-10-09T20:00:00Z'), ms('2026-10-11T22:00:00Z'))).toHaveLength(120);
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
    // (b) all 12 buckets are open-market time after ingestion start; 10:05, 10:10, 10:15 exist
    expect(fiveMinute).toEqual({
      timeframe: '5m',
      eligibleBuckets: 9,
      presentBuckets: 2,
      successRate: 2 / 9,
      expectedBuckets: 12,
      presentExpectedBuckets: 3,
      coverageRate: 3 / 12,
    });
    const sixty = computeFxCompleteness('USDJPY', rows, period).aggregates.find((a) => a.timeframe === '60m')!;
    expect(sixty.eligibleBuckets).toBe(0);
    expect(sixty.successRate).toBeNull();
    expect(sixty.expectedBuckets).toBe(1);
    expect(sixty.coverageRate).toBe(0);
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
      instants: 1,
      evaluatedInstants: 1,
      windows: 2,
      complete: 1,
      incomplete: 1,
      outsideMarket: 0,
      outsidePeriod: 0,
      beforeIngestionStart: 0,
    });
    expect(summary.pairs).toBe(2);
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
      instants: 2,
      evaluatedInstants: 0,
      windows: 0,
      complete: 0,
      incomplete: 0,
      outsideMarket: 2,
      outsidePeriod: 2,
      beforeIngestionStart: 0,
    });
  });

  it('does not judge windows that start before the ingestion start of the pair (or pairs without data)', () => {
    const summary = checkReleaseWindows(
      [{ kind: 'ECONOMIC', at: '2026-10-12T12:30:00Z', label: 'US_CPI' }],
      usable,
      period,
      new Map([
        ['USDJPY', ms('2026-10-12T12:26:00Z')],
        ['EURUSD', null],
      ]),
    );
    expect(summary.byKind.ECONOMIC).toMatchObject({ instants: 1, evaluatedInstants: 0, beforeIngestionStart: 2 });
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

describe('anomaly details (UNVERIFIED minutes from the logs)', () => {
  const period = { from: ms('2026-10-12T12:00:00Z'), to: ms('2026-10-12T14:00:00Z') };

  it('reads symbol, minute, diff, reference source and notes from unverified_minutes', () => {
    const logs = [
      log('ingest:fx-prices', '2026-10-12T12:40:00Z', 'SUCCESS', {
        details: {
          skip_reasons: {},
          unverified_minutes: [
            {
              symbol: 'USDJPY',
              minute: '2026-10-12T12:31:00Z',
              diff_pips: 6.2,
              cross_check_source: 'polygon',
              notes: ['CROSS_CHECK_DIFF'],
            },
            {
              symbol: 'EURUSD',
              minute: '2026-10-12T12:35:00Z',
              diff_pips: null,
              cross_check_source: null,
              notes: ['PRICE_JUMP'],
            },
          ],
        },
      }),
    ];
    const details = extractAnomalyDetails(logs, period);
    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({
      symbol: 'EURUSD',
      minute: '2026-10-12T12:35:00Z',
      diffPips: null,
      referenceSource: null,
      notes: ['PRICE_JUMP'],
      loggedAt: '2026-10-12T12:40:00Z',
    });
    expect(details[1]).toEqual({
      symbol: 'USDJPY',
      minute: '2026-10-12T12:31:00Z',
      diffPips: 6.2,
      referenceSource: 'polygon',
      notes: ['CROSS_CHECK_DIFF'],
      loggedAt: '2026-10-12T12:40:00Z',
    });
  });

  it('drops entries outside the period, keeps the latest run for a repeated minute, and ignores malformed entries', () => {
    const logs = [
      log('ingest:fx-prices', '2026-10-12T12:20:00Z', 'SUCCESS', {
        details: {
          skip_reasons: {},
          unverified_minutes: [
            { symbol: 'USDJPY', minute: '2026-10-12T12:10:00Z', diff_pips: 5, notes: ['CROSS_CHECK_DIFF'] },
            { symbol: 'USDJPY', minute: '2026-10-12T11:00:00Z', diff_pips: 9, notes: ['PRICE_JUMP'] }, // before period
            { symbol: 'USDJPY' }, // no minute
          ],
        },
      }),
      log('ingest:fx-prices', '2026-10-12T12:40:00Z', 'SUCCESS', {
        details: {
          skip_reasons: {},
          // the same minute, re-logged by a later run with a different note: the later run wins
          unverified_minutes: [{ symbol: 'USDJPY', minute: '2026-10-12T12:10:00Z', diff_pips: 1, notes: [] }],
        },
      }),
      log('ingest:speeches', '2026-10-12T12:30:00Z', 'SUCCESS', {
        provider: 'ecb_press',
        data_type: 'OTHER',
        details: { skip_reasons: {}, unverified_minutes: [{ symbol: 'USDJPY', minute: '2026-10-12T12:11:00Z' }] },
      }),
    ];
    const details = extractAnomalyDetails(logs, period);
    expect(details).toEqual([
      {
        symbol: 'USDJPY',
        minute: '2026-10-12T12:10:00Z',
        diffPips: 1,
        referenceSource: null,
        notes: [],
        loggedAt: '2026-10-12T12:40:00Z',
      },
    ]);
  });

  it('renders the list in the Markdown report, newest first, and shows the empty state otherwise', () => {
    const input = sampleReportInput();
    const withDetail = renderDataQualityMarkdown(
      buildDataQualityReport({
        ...input,
        logs: [
          ...input.logs,
          log('ingest:fx-prices', '2026-10-12T12:35:00Z', 'SUCCESS', {
            details: {
              skip_reasons: {},
              unverified_minutes: [
                {
                  symbol: 'USDJPY',
                  minute: '2026-10-12T12:31:00Z',
                  diff_pips: 6.2,
                  cross_check_source: 'polygon',
                  notes: ['CROSS_CHECK_DIFF'],
                },
              ],
            },
          }),
        ],
      }),
    );
    expect(withDetail).toContain('### 個別の異常値・差異の一覧(最大20件、新しい順)');
    expect(withDetail).toContain(
      '| USDJPY | 2026-10-12 12:31Z | 6.20 | polygon | CROSS_CHECK_DIFF | 2026-10-12 12:35Z |',
    );

    const withoutDetail = renderDataQualityMarkdown(buildDataQualityReport(input));
    expect(withoutDetail).toContain('—(この期間にUNVERIFIEDの足なし)');
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

  // HQ判断(2026-10-17): 自己一致(同じ取得元・同じデータでの一致)は独立照合に
  // 数えない。classifySnapshotMatch / summarizeEconomicValues の分類をテストする。

  it('classifies a BLS-schedule snapshot (same fetch compared with itself) as a self-match, not independent', () => {
    const sample: Parameters<typeof classifySnapshotMatch>[0] = {
      verification_status: 'VERIFIED',
      provider: 'bls_schedule',
      verification_source: 'BLS:CUUR0000SA0@2026-10-14',
    };
    expect(classifySnapshotMatch(sample)).toBe('SELF_MATCH');

    const stats = summarizeEconomicValues([sample], []);
    expect(stats.selfMatched).toBe(1);
    expect(stats.independentlyVerified).toBe(0);
    // The self-match must not inflate the independent rate: nothing to compare independently.
    expect(stats.independentAgreementRate).toBeNull();
    // ...but it still counts toward the (compat) blended rate, same as before this change.
    expect(stats.agreementRate).toBe(1);
  });

  it('classifies a paid-calendar snapshot matched against BLS as independently verified', () => {
    const sample: Parameters<typeof classifySnapshotMatch>[0] = {
      verification_status: 'VERIFIED',
      provider: 'tradingeconomics',
      verification_source: 'BLS:CUUR0000SA0@2026-10-14',
    };
    expect(classifySnapshotMatch(sample)).toBe('INDEPENDENT');

    const stats = summarizeEconomicValues([sample], []);
    expect(stats.independentlyVerified).toBe(1);
    expect(stats.selfMatched).toBe(0);
    expect(stats.independentAgreementRate).toBe(1);
  });

  it('counts a genuine independent mismatch, with indicator/period/provider/value detail', () => {
    const stats = summarizeEconomicValues(
      [
        {
          verification_status: 'VERIFIED',
          provider: 'tradingeconomics',
          verification_source: 'BLS:CUUR0000SA0@2026-10-14',
        },
      ],
      [
        {
          verification_status: 'PENDING_REVIEW',
          reasons: ['OFFICIAL_MISMATCH'],
          indicator_code: 'US_CPI',
          reference_period: '2026-09',
          provider: 'tradingeconomics',
          actual: 3.9,
          official_actual: 3.8,
        },
      ],
    );
    expect(stats.officialMismatches).toBe(1);
    // 1 independent match, 1 independent mismatch → 50%, excluding the mismatch from neither side.
    expect(stats.independentAgreementRate).toBeCloseTo(0.5);
    expect(stats.mismatches).toEqual([
      {
        indicatorCode: 'US_CPI',
        referencePeriod: '2026-09',
        provider: 'tradingeconomics',
        actual: 3.9,
        officialActual: 3.8,
      },
    ]);
  });

  it('classifies SINGLE_SOURCE (no official source available/required) as its own bucket, not a match', () => {
    const sample: Parameters<typeof classifySnapshotMatch>[0] = {
      verification_status: 'SINGLE_SOURCE',
      provider: 'tradingeconomics',
      verification_source: null,
    };
    expect(classifySnapshotMatch(sample)).toBe('SINGLE_SOURCE');

    const stats = summarizeEconomicValues([sample], []);
    expect(stats.singleSource).toBe(1);
    expect(stats.independentlyVerified).toBe(0);
    expect(stats.selfMatched).toBe(0);
  });

  it('counts AWAITING_OFFICIAL staged values as 未発表・確認待ち, separate from a true mismatch', () => {
    const stats = summarizeEconomicValues(
      [],
      [
        { verification_status: 'AWAITING_OFFICIAL', reasons: [] },
        { verification_status: 'AWAITING_OFFICIAL', reasons: [] },
        { verification_status: 'PENDING_REVIEW', reasons: ['OFFICIAL_MISMATCH'] },
      ],
    );
    expect(stats.awaitingOfficial).toBe(2);
    expect(stats.officialMismatches).toBe(1);
  });

  it('treats pre-existing snapshots with no provider/verification_source as independent (report compatibility)', () => {
    // Exactly the shape used before this field existed — must classify the same
    // way it was always counted (nothing was self-sourced before bls_schedule).
    const stats = summarizeEconomicValues(
      [
        { verification_status: 'VERIFIED' },
        { verification_status: 'VERIFIED' },
        { verification_status: 'SINGLE_SOURCE' },
      ],
      [{ verification_status: 'PENDING_REVIEW', reasons: ['OFFICIAL_MISMATCH'] }],
    );
    expect(stats.independentlyVerified).toBe(2);
    expect(stats.selfMatched).toBe(0);
    expect(stats.singleSource).toBe(1);
    // Old and new rates agree exactly when nothing is self-sourced.
    expect(stats.independentAgreementRate).toBe(stats.agreementRate);
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
function sampleReportInput(): DataQualityInput {
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

const SECRET = /https?:\/\/|http|apikey|api_key|service_role/i;

describe('Markdown report', () => {
  it('renders every section in Japanese without anything secret', () => {
    const markdown = renderDataQualityMarkdown(buildDataQualityReport(sampleReportInput()));
    for (const heading of [
      '# データ品質レポート(直近1日)',
      '## 1. 為替1分足の取得率・欠損率',
      '## 2. 照合一致率(1分足)',
      '## 3. 集約足(5分〜60分)',
      '### (a) 作成可能区間での成功率',
      '### (b) 評価期間全体に対するカバレッジ',
      '## 4. 発表・発言前後の1分足',
      '## 5. 取得ジョブの実行状況',
      '## 6. API 利用量と取り込み件数の照合',
      '## 7. 時刻ずれ',
      '## 8. 経済指標の値',
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain('| USDJPY | 2026-10-12 12:00Z | 0 | 120 | 117 | 3 | 2.50% | 116 | 0 |');
    expect(markdown).toContain('| 経済指標 | 2026-10-12 12:30Z | US_CPI | USDJPY | 4 |');
    expect(markdown).toContain('経済指標(RELEASED): 1件 × 2ペア = 2判定');
    expect(markdown).toContain('取得範囲(120分)を超えた間隔: 1 件');
    expect(markdown).toContain('TIME_NOT_EXACT): 3 件');
    // the sample has no ingest:official run → not verified, no rate printed
    expect(markdown).toContain('未検証(照合処理未実行)');
    expect(markdown).not.toContain('公式統計との一致率');
    expect(markdown).not.toMatch(SECRET);
  });

  it('states the market-hours rule and its limitation in the header', () => {
    const markdown = renderDataQualityMarkdown(buildDataQualityReport(sampleReportInput()));
    expect(markdown).toContain('ニューヨーク時間の日曜 17:00 〜 金曜 17:00(米国の夏時間に連動');
    expect(markdown).toContain(
      '休場は 12/25・1/1 のみを扱う。その他の祝日・短縮取引(例: 12/24・12/31 の早い終了)は考慮していないため、その日の欠損は過大になる場合がある',
    );
    expect(markdown).not.toContain('上限値');
  });
});

// ---------------------------------------------------------------------------
// 2026-10-16 HQ investigation: the first real report
// ---------------------------------------------------------------------------

const NINE_PAIRS = ['AUDUSD', 'EURJPY', 'EURUSD', 'GBPJPY', 'GBPUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY'];

/** 5m–60m rows for every bucket whose 1m minutes are all in `minutes` (what the pipeline builds). */
function aggregateRows(minutes: ReadonlySet<number>): FxRowSample[] {
  const rows: FxRowSample[] = [];
  const sorted = [...minutes].sort((a, b) => a - b);
  for (const size of [5, 15, 30, 60] as const) {
    const bucket = size * MIN;
    const starts = new Set(sorted.map((m) => Math.floor(m / bucket) * bucket));
    for (const start of starts) {
      let complete = true;
      for (let m = start; m < start + bucket; m += MIN) if (!minutes.has(m)) complete = false;
      if (complete) {
        rows.push({
          timestamp: iso(start),
          timeframe: `${size}m`,
          verification_status: 'SINGLE_SOURCE',
          cross_check_diff_pips: null,
        });
      }
    }
  }
  return rows;
}

/** The 2026-10-16 case: 9 pairs, candles 03:04–05:03 and 08:44–10:16, runs at 05:04 and 10:44:49. */
function reproductionInput(): DataQualityInput {
  const oneMinute = [
    ...minuteRows('2026-10-16T03:04:00Z', '2026-10-16T05:04:00Z'),
    ...minuteRows('2026-10-16T08:44:00Z', '2026-10-16T10:17:00Z'),
  ];
  const rows = [...oneMinute, ...aggregateRows(new Set(oneMinute.map((r) => ms(r.timestamp))))];
  return {
    now: new Date('2026-10-16T10:47:00Z'),
    period: { from: ms('2026-10-15T10:47:00Z'), to: ms('2026-10-16T10:17:00Z') },
    days: 1,
    pairs: NINE_PAIRS.map((symbol) => ({ symbol, rows, firstCandleAt: '2026-10-16T03:04:00Z' })),
    releases: [{ kind: 'SPEECH', at: '2026-10-16T09:00:00Z', label: 'ECB speech' }],
    // runs of the old job: no api_requests / unrecovered / reconciliation keys
    logs: [
      log('ingest:fx-prices', '2026-10-16T05:04:00Z', 'SUCCESS'),
      log('ingest:fx-prices', '2026-10-16T10:44:49Z', 'SUCCESS'),
    ],
    snapshots: [],
    staged: [],
    economicEventCount: 0,
    creditUsage: null,
  };
}

describe('2026-10-16 reproduction (period 2026-10-15 10:47Z → 2026-10-16 10:17Z)', () => {
  const report = buildDataQualityReport(reproductionInput());
  const markdown = renderDataQualityMarkdown(report);

  it('separates the minutes before ingestion start from real gaps', () => {
    for (const f of report.fx) {
      // 10-15 10:47 → 10-16 03:04 = 977 open minutes before the first candle (Thu/Fri, market open throughout)
      expect(f).toMatchObject({
        state: 'OK',
        ingestionStart: '2026-10-16T03:04:00.000Z',
        beforeStartMinutes: 977,
        expectedMinutes: 433, // 03:04 → 10:17
        presentMinutes: 213, // 120 (03:04–05:03) + 93 (08:44–10:16)
        missingMinutes: 220, // 05:04–08:43
      });
      expect(f.missingRate).toBeCloseTo(220 / 433, 10);
      expect(f.longestGaps).toEqual([{ start: '2026-10-16T05:04:00.000Z', minutes: 220 }]);
      // old-style logs: no evidence for the cause
      expect(f.missingBreakdown.UNKNOWN).toBe(220);
    }
    expect(report.fxTotals).toMatchObject({
      beforeStartMinutes: 977 * 9,
      expectedMinutes: 433 * 9,
      presentMinutes: 213 * 9,
      missingMinutes: 220 * 9,
    });
    expect(markdown).toContain('| USDJPY | 2026-10-16 03:04Z | 977 | 433 | 213 | 220 | 50.81% | 213 | 0 |');
    expect(markdown).toContain(
      '全通貨ペア合計: 取り込み開始前(対象外) 8793 分 / 想定 3897 分 / 取得 1917 分 / 欠損 1980 分(取得率 49.19%、欠損率 50.81%)',
    );
    expect(markdown).toContain('全通貨ペア合計: 未取得(原因未特定) 1980');
    // the figures of the first real report must not come back
    expect(markdown).not.toContain('84.89%');
    expect(markdown).not.toContain('15.11%');
  });

  it('reports aggregates as success rate over buildable buckets AND coverage over the whole period', () => {
    const byTf = Object.fromEntries(report.fx[0]!.aggregates.map((a) => [a.timeframe, a]));
    // 5m: buildable 03:05–04:55 (23) + 08:45–10:10 (18) = 41; whole period 03:05–10:10 = 86
    expect(byTf['5m']).toMatchObject({ eligibleBuckets: 41, presentBuckets: 41, expectedBuckets: 86 });
    expect(byTf['5m']!.successRate).toBe(1);
    expect(byTf['5m']!.coverageRate).toBeCloseTo(41 / 86, 10);
    expect(byTf['15m']).toMatchObject({ eligibleBuckets: 13, presentBuckets: 13, expectedBuckets: 28 });
    expect(byTf['30m']).toMatchObject({ eligibleBuckets: 5, presentBuckets: 5, expectedBuckets: 13 });
    expect(byTf['60m']).toMatchObject({ eligibleBuckets: 2, presentBuckets: 2, expectedBuckets: 6 });
    expect(markdown).toContain('| USDJPY | 41/41 (100.00%) | 13/13 (100.00%) | 5/5 (100.00%) | 2/2 (100.00%) |');
    expect(markdown).toContain('| USDJPY | 41/86 (47.67%) | 13/28 (46.43%) | 5/13 (38.46%) | 2/6 (33.33%) |');
  });

  it('counts speeches and per-pair judgements separately', () => {
    expect(report.releaseWindows.byKind.SPEECH).toMatchObject({
      instants: 1,
      evaluatedInstants: 1,
      windows: 9,
      complete: 9,
    });
    expect(markdown).toContain('要人発言(DELIVERED): 1件 × 9ペア = 9判定(完全 9、欠けあり 0)');
    expect(markdown).toContain('経済指標(RELEASED): —(期間内に発表済みの経済指標データなし)');
  });

  it('shows economic values as not verified instead of 0', () => {
    expect(report.economic.state).toBe('NO_DATA');
    expect(markdown).toContain('状態: 未検証(経済指標データ未取得)');
    expect(markdown).not.toContain('公式統計との一致率');
  });

  it('explains the schedule gap and the missing log fields', () => {
    // 05:04 → 10:44:49: 05:04 … (10:44 − 120 min = 08:44) was fetched by no run = the 220 missing minutes
    expect(report.fxSchedule.gapsOverWindow).toEqual([
      { from: '2026-10-16T05:04:00.000Z', to: '2026-10-16T10:44:49.000Z', minutes: 341, uncoveredMarketMinutes: 220 },
    ]);
    expect(markdown).toContain('—(ログに API リクエスト数の記録なし: 期間内の 2 回はすべて古い形式の実行)');
    expect(markdown).toContain('—(クレジット記録なし)');
    expect(markdown).toContain('—(ログに照合件数の記録なし: 古い形式の実行のみ)');
    expect(markdown).not.toMatch(SECRET);
  });
});

// ---------------------------------------------------------------------------
// Market hours inside the report (DST, weekend, Dec 25, Jan 1)
// ---------------------------------------------------------------------------

describe('expected minutes follow the New York market hours', () => {
  /** One stored candle at period.from, so the whole period is after ingestion start. */
  const expectedFor = (fromIso: string, toIso: string): number =>
    computeFxCompleteness('USDJPY', minuteRows(fromIso, iso(ms(fromIso) + MIN)), { from: ms(fromIso), to: ms(toIso) })
      .expectedMinutes;

  it('DST end 2026-11-01: Fri closes 21:00 UTC (EDT), Sun opens 22:00 UTC (EST)', () => {
    // Fri 20:00–21:00 (60) + Sun 22:00–24:00 (120)
    expect(expectedFor('2026-10-30T20:00:00Z', '2026-11-02T00:00:00Z')).toBe(180);
  });

  it('DST start 2026-03-08: Fri closes 22:00 UTC (EST), Sun opens 21:00 UTC (EDT)', () => {
    // Fri 21:00–22:00 (60) + Sun 21:00–24:00 (180)
    expect(expectedFor('2026-03-06T21:00:00Z', '2026-03-09T00:00:00Z')).toBe(240);
  });

  it('winter week (Nov 2026): Sun 22:00 → Fri 22:00 UTC = 7200 minutes', () => {
    expect(expectedFor('2026-11-08T00:00:00Z', '2026-11-15T00:00:00Z')).toBe(7200);
    expect(expectedFor('2026-11-08T21:00:00Z', '2026-11-08T23:00:00Z')).toBe(60);
  });

  it('a weekend alone has nothing to judge (rate —, not 0 % or 100 %)', () => {
    const f = computeFxCompleteness('USDJPY', minuteRows('2026-10-16T20:00:00Z', '2026-10-16T21:00:00Z'), {
      from: ms('2026-10-16T21:00:00Z'),
      to: ms('2026-10-18T21:00:00Z'),
    });
    expect(f).toMatchObject({ expectedMinutes: 0, missingMinutes: 0, missingRate: null });
  });

  it('Dec 25 (New York date) is closed for the whole day', () => {
    // Thu 12-24 00:00 UTC → Fri 12-25 05:00 UTC (= 00:00 New York) = 29 h; Sun 12-27 22:00–24:00 = 2 h
    expect(expectedFor('2026-12-24T00:00:00Z', '2026-12-28T00:00:00Z')).toBe(29 * 60 + 120);
  });

  it('2026-12-31 → 2027-01-01: Jan 1 (New York date) is closed', () => {
    // Thu 12-31 00:00 UTC → Fri 01-01 05:00 UTC = 29 h; the rest of Jan 1 (New York) is closed
    expect(expectedFor('2026-12-31T00:00:00Z', '2027-01-02T00:00:00Z')).toBe(29 * 60);
  });

  it('candles on a closed day are counted as outside market hours, not as present', () => {
    const f = computeFxCompleteness('USDJPY', minuteRows('2026-12-25T12:00:00Z', '2026-12-25T12:10:00Z'), {
      from: ms('2026-12-25T12:00:00Z'),
      to: ms('2026-12-25T13:00:00Z'),
    });
    expect(f).toMatchObject({ presentMinutes: 0, outsideMarketRows: 10, expectedMinutes: 0 });
  });
});

describe('pairs without data', () => {
  it('reports データなし(取り込み未開始) instead of 100 % missing', () => {
    const input: DataQualityInput = {
      ...sampleReportInput(),
      pairs: [
        ...sampleReportInput().pairs,
        { symbol: 'CHFJPY', rows: [], firstCandleAt: null },
        { symbol: 'NZDJPY', rows: minuteRows('2026-10-12T15:00:00Z', '2026-10-12T15:10:00Z') },
      ],
    };
    const report = buildDataQualityReport(input);
    const chf = report.fx.find((f) => f.symbol === 'CHFJPY')!;
    expect(chf).toMatchObject({ state: 'NO_DATA', beforeStartMinutes: 120, expectedMinutes: 0, missingRate: null });
    const nzd = report.fx.find((f) => f.symbol === 'NZDJPY')!;
    expect(nzd).toMatchObject({ state: 'STARTED_AFTER_PERIOD', beforeStartMinutes: 120, expectedMinutes: 0 });
    expect(report.fxTotals.pairsWithoutData).toEqual(['CHFJPY']);
    // the US_CPI window starts before CHFJPY / NZDJPY have any data
    expect(report.releaseWindows.byKind.ECONOMIC).toMatchObject({ windows: 2, beforeIngestionStart: 2 });
    const markdown = renderDataQualityMarkdown(report);
    expect(markdown).toContain(
      '| CHFJPY | データなし(取り込み未開始) | 120 | — | — | — | データなし(取り込み未開始) | — | 0 |',
    );
    expect(markdown).toContain('| NZDJPY | 2026-10-12 15:00Z | 120 | — | — | — | —(取り込み開始が期間後) | — | 0 |');
    expect(markdown).toContain('データなし(取り込み未開始): CHFJPY');
    expect(markdown).toContain('CHFJPY データなし');
  });
});

// ---------------------------------------------------------------------------
// Causes of missing minutes from ingest:fx-prices logs
// ---------------------------------------------------------------------------

describe('missing-minute classification from the ingestion logs', () => {
  const period = { from: ms('2026-10-12T00:00:00Z'), to: ms('2026-10-12T06:00:00Z') }; // Monday
  const skipRun = (startIso: string, minutes: number): string[] =>
    Array.from({ length: minutes }, (_, i) => iso(ms(startIso) + i * MIN));
  const rows = minuteRows('2026-10-12T00:00:00Z', '2026-10-12T06:00:00Z', {
    skip: [
      ...skipRun('2026-10-12T01:00:00Z', 30),
      ...skipRun('2026-10-12T02:00:00Z', 20),
      ...skipRun('2026-10-12T03:00:00Z', 10),
      ...skipRun('2026-10-12T04:00:00Z', 5),
    ],
  });
  const logs: IngestionLogSample[] = [
    log('ingest:fx-prices', '2026-10-12T05:00:00Z', 'SUCCESS', {
      details: {
        // shape written by pipelines/fxPrices.ts: { SYMBOL: [{ from, to, minutes, attempt }] }
        no_data_unconfirmed: {
          USDJPY: [{ from: '2026-10-12T01:00:00.000Z', to: '2026-10-12T01:10:00.000Z', minutes: 10, attempt: 3 }],
        },
        // superseded by the newer run below
        unrecovered: [
          { symbol: 'USDJPY', from: '2026-10-12T04:00:00Z', to: '2026-10-12T04:05:00Z', reason: 'TIMEOUT' },
        ],
      },
    }),
    log('ingest:fx-prices', '2026-10-12T05:20:00Z', 'PARTIAL', {
      details: {
        unrecovered: [
          { symbol: 'USDJPY', from: '2026-10-12T01:00:00Z', to: '2026-10-12T01:30:00Z', reason: 'BEYOND_HORIZON' },
          { symbol: 'USDJPY', from: '2026-10-12T02:00:00Z', to: '2026-10-12T02:20:00Z', reason: 'BUDGET' },
          { symbol: 'USDJPY', from: '2026-10-12T03:00:00Z', to: '2026-10-12T03:05:00Z', reason: 'RATE_LIMITED' },
          { symbol: 'EURUSD', from: '2026-10-12T04:00:00Z', to: '2026-10-12T04:05:00Z', reason: 'API_ERROR' },
          { symbol: 'USDJPY', from: 'not a time', to: '2026-10-12T04:05:00Z', reason: 'API_ERROR' },
        ],
        unrecovered_total: 75,
      },
    }),
    // the newest run has no details (failed early): the 05:20 run stays the latest with `unrecovered`
    log('ingest:fx-prices', '2026-10-12T05:40:00Z', 'FAILURE', { details: null }),
  ];

  it('no_data_unconfirmed first, then the latest unrecovered reasons, the rest is 原因未特定', () => {
    const causes = extractMissingCauses(logs).get('USDJPY')!;
    expect(classifyMissingMinute(ms('2026-10-12T01:05:00Z'), causes)).toBe('NO_DATA_UNCONFIRMED');
    expect(classifyMissingMinute(ms('2026-10-12T01:10:00Z'), causes)).toBe('BEYOND_HORIZON');
    expect(classifyMissingMinute(ms('2026-10-12T04:00:00Z'), causes)).toBe('UNKNOWN');
    const f = computeFxCompleteness('USDJPY', rows, period, { causes });
    expect(f.missingMinutes).toBe(65);
    expect(f.missingBreakdown).toEqual({
      NO_DATA_UNCONFIRMED: 10,
      BEYOND_HORIZON: 20,
      BUDGET: 20,
      RATE_LIMITED: 5,
      TIMEOUT: 0,
      API_ERROR: 0,
      UNKNOWN: 10, // 03:05–03:09 + 04:00–04:04
    });
  });

  it('renders the HQ labels (never 回収不能)', () => {
    const markdown = renderDataQualityMarkdown(
      buildDataQualityReport({
        now: new Date('2026-10-12T06:30:00Z'),
        period,
        days: 1,
        pairs: [{ symbol: 'USDJPY', rows }],
        releases: [],
        logs,
        snapshots: [],
        staged: [],
      }),
    );
    expect(markdown).toContain(
      '| USDJPY | 65 | 取得元にデータなしの可能性(未確認) 10, 未回収(回収期間外・7日超) 20, 未回収(クレジット上限) 20, 未回収(レート制限) 5, 未取得(原因未特定) 10 |',
    );
    expect(markdown).toContain(
      '最新の実行(2026-10-12 05:20Z)の未回収: 未回収(回収期間外・7日超) 30分, 未回収(クレジット上限) 20分, 未回収(レート制限) 5分, 未回収(APIエラー) 5分(unrecovered_total 75)',
    );
    expect(markdown).not.toContain('回収不能');
    expect(markdown).not.toMatch(SECRET);
  });

  it('reads the older provider_empty key like no_data_unconfirmed', () => {
    const causes = extractMissingCauses([
      log('ingest:fx-prices', '2026-10-12T05:00:00Z', 'SUCCESS', {
        details: {
          provider_empty: [{ symbol: 'USDJPY', from: '2026-10-12T04:00:00Z', to: '2026-10-12T04:05:00Z' }],
        },
      }),
    ]);
    const f = computeFxCompleteness('USDJPY', rows, period, { causes: causes.get('USDJPY') });
    expect(f.missingBreakdown).toMatchObject({ NO_DATA_UNCONFIRMED: 5, UNKNOWN: 60 });
  });
});

// ---------------------------------------------------------------------------
// API usage, credits, reconciliation
// ---------------------------------------------------------------------------

describe('API usage and reconciliation', () => {
  const run = (startedAt: string, details: Record<string, unknown>) =>
    log('ingest:fx-prices', startedAt, 'SUCCESS', { details });
  const reconciliation = (
    fetched: number,
    accepted: number,
    rejected: Record<string, number>,
    upserted1m = accepted,
  ) => ({
    fetched,
    accepted,
    rejected_by_reason: rejected,
    upserted_1m: upserted1m,
    upserted_aggregated: 30,
    corrected: 1,
    failed_requests: 0,
  });
  const logs = [
    run('2026-10-15T23:40:00Z', { api_requests: 9, reconciliation: reconciliation(1080, 1080, {}) }),
    run('2026-10-16T00:00:00Z', {
      api_requests: 9,
      budget: { daily: 700, used_before_run: 0, left_after_run: 691 },
      reconciliation: reconciliation(1080, 1078, { OHLC_INVALID: 2 }),
    }),
    run('2026-10-16T00:20:00Z', {
      api_requests: 27,
      budget: { daily: 700, used_before_run: 9, left_after_run: 664 },
      // fetched 1080 ≠ 1070 + 5 → mismatch
      reconciliation: reconciliation(1080, 1070, { OHLC_INVALID: 5 }),
    }),
    log('ingest:fx-prices', '2026-10-16T00:40:00Z', 'FAILURE', { details: null }),
  ];

  it('sums api_requests per UTC day and finds the largest run', () => {
    const usage = summarizeApiUsage(logs);
    expect(usage).toMatchObject({ fxRuns: 4, runsWithCount: 3, totalRequests: 45, dailyLimit: 800, dailyBudget: 700 });
    expect(usage.maxPerRun).toEqual({ requests: 27, startedAt: '2026-10-16T00:20:00Z' });
    expect(usage.perDay).toEqual([
      { date: '2026-10-15', requests: 9, runs: 1 },
      { date: '2026-10-16', requests: 36, runs: 2 },
    ]);
    expect(usage.latestBudget).toEqual({
      startedAt: '2026-10-16T00:20:00Z',
      daily: 700,
      usedBeforeRun: 9,
      leftAfterRun: 664,
    });
  });

  it('sums the reconciliation counts and flags a mismatch', () => {
    const r = summarizeApiUsage(logs).reconciliation!;
    expect(r).toMatchObject({
      runs: 3,
      fetched: 3240,
      accepted: 3228,
      rejected: 7,
      rejectedByReason: { OHLC_INVALID: 7 },
      upserted1m: 3228,
      upsertedAggregated: 90,
      corrected: 3,
      failedRequests: 0,
      mismatchRuns: 1,
      sumMismatch: true,
    });
    expect(summarizeApiUsage(logs.slice(0, 2)).reconciliation).toMatchObject({ mismatchRuns: 0, sumMismatch: false });
    // upserted_1m ≠ accepted is a mismatch too
    const upsertOnly = summarizeApiUsage([
      run('2026-10-16T01:00:00Z', { reconciliation: reconciliation(10, 10, {}, 8) }),
    ]);
    expect(upsertOnly.reconciliation).toMatchObject({ mismatchRuns: 1, sumMismatch: true });
  });

  it('renders usage per day, the reconciliation table and the flag', () => {
    const markdown = renderDataQualityMarkdown(
      buildDataQualityReport({ ...sampleReportInput(), logs: [...sampleReportInput().logs, ...logs] }),
    );
    expect(markdown).toContain('| 2026-10-16 | 36 | 2 | 4.50% | 5.14% |');
    expect(markdown).toContain('1回の実行の最大: 27 リクエスト(2026-10-16 00:20Z)');
    expect(markdown).toContain('| rejected(除外) | 7(OHLC_INVALID: 7) |');
    expect(markdown).toContain('| upserted_aggregated | 90 |');
    expect(markdown).toContain('| failed_requests(失敗したリクエスト) | 0 |');
    expect(markdown).toContain('件数の整合: **不一致あり**');
    const consistent = renderDataQualityMarkdown(
      buildDataQualityReport({ ...sampleReportInput(), logs: logs.slice(0, 2) }),
    );
    expect(consistent).toContain('件数の整合: 一致');
    expect(markdown).not.toMatch(SECRET);
  });

  it('summarizes api_credit_usage per UTC day and job kind against the caps', () => {
    const credits = summarizeCreditUsage([
      ...Array.from({ length: 701 }, () => ({
        provider: 'twelvedata',
        usage_date: '2026-10-16',
        job: 'ingest:fx-prices',
        credits: 1,
      })),
      { provider: 'twelvedata', usage_date: '2026-10-16', job: 'ingest:fx-prices', credits: 90, cap: 800 },
      { provider: 'twelvedata', usage_date: '2026-10-16', job: 'eval:providers', credits: 20 },
      { provider: 'twelvedata', usage_date: '2026-10-15', job: 'ingest:fx-prices', credits: 300 },
    ])!;
    expect(credits.days).toEqual([
      {
        provider: 'twelvedata',
        date: '2026-10-15',
        auto: 300,
        manual: 0,
        eval: 0,
        total: 300,
        overAutoCap: false,
        overManualCap: false,
        overPlan: false,
      },
      {
        provider: 'twelvedata',
        date: '2026-10-16',
        auto: 701,
        manual: 90,
        eval: 20,
        total: 811,
        overAutoCap: true,
        overManualCap: false,
        overPlan: true,
      },
    ]);
    expect(credits.manualJobs).toEqual(['ingest:fx-prices (--manual)']);
    expect(summarizeCreditUsage(null)).toBeNull();
    const markdown = renderDataQualityMarkdown(
      buildDataQualityReport({
        ...sampleReportInput(),
        creditUsage: [{ provider: 'twelvedata', usage_date: '2026-10-12', job: 'ingest:fx-prices', credits: 63 }],
      }),
    );
    expect(markdown).toContain('| 2026-10-12 | twelvedata | 63 | 0 | 0 | 63 | なし |');
    expect(markdown).toContain('契約プランは未確認(Basic 前提)');
    expect(markdown).toContain('失敗・再試行がクレジットを消費するかは未確認のため、試行ごとに予約して数えている');
    const empty = renderDataQualityMarkdown(buildDataQualityReport({ ...sampleReportInput(), creditUsage: [] }));
    expect(empty).toContain('—(期間内のクレジット記録なし)');
  });
});

// ---------------------------------------------------------------------------
// Zero denominators: 「—(理由)」, never 0 % / 0件 as a result
// ---------------------------------------------------------------------------

describe('zero-denominator labels', () => {
  const emptyInput = (): DataQualityInput => ({
    now: new Date('2026-10-12T14:30:00Z'),
    period: { from: ms('2026-10-12T12:00:00Z'), to: ms('2026-10-12T14:00:00Z') },
    days: 1,
    pairs: [{ symbol: 'USDJPY', rows: minuteRows('2026-10-12T12:00:00Z', '2026-10-12T14:00:00Z') }],
    releases: [],
    logs: [],
    snapshots: [],
    staged: [],
  });

  it('labels why a metric has no denominator', () => {
    const markdown = renderDataQualityMarkdown(buildDataQualityReport(emptyInput()));
    expect(markdown).toContain('—(照合未実行: 照合元未設定)');
    expect(markdown).toContain('経済指標(RELEASED): —(期間内に発表済みの経済指標データなし)');
    expect(markdown).toContain('要人発言(DELIVERED): —(期間内に要人発言データなし)');
    expect(markdown).toContain(
      '| 要人発言(DELIVERED) | 0 | — | — | — | — | —(期間内に要人発言データなし) | — | — | — |',
    );
    expect(markdown).toContain('(TIME_NOT_EXACT): —(期間内に ingest:speeches の実行なし)');
    expect(markdown).toContain('—(期間内の ingestion_logs なし: どのジョブも実行されていない)');
    expect(markdown).toContain('成功した実行の最長間隔: —(成功した実行が2回未満)');
    expect(markdown).toContain('最後の成功からの経過: —(成功した実行なし)');
    expect(markdown).toContain('—(期間内に ingest:fx-prices の実行なし)');
    expect(markdown).toContain('—(クレジット記録なし)');
    expect(markdown).toContain('状態: 未検証(経済指標データ未取得)');
    expect(markdown).not.toMatch(/NaN|Infinity|undefined|null/);
    expect(markdown).not.toMatch(SECRET);
  });

  it('distinguishes 照合処理未実行 from 照合済み with nothing to compare', () => {
    const notRun = buildDataQualityReport({ ...emptyInput(), economicEventCount: 3 });
    expect(notRun.economic.state).toBe('NOT_RUN');
    const notRunMd = renderDataQualityMarkdown(notRun);
    expect(notRunMd).toContain('状態: 未検証(照合処理未実行)');
    expect(notRunMd).not.toContain('一致率:');

    const officialRun = log('ingest:official', '2026-10-12T13:00:00Z', 'SUCCESS', {
      provider: 'official',
      data_type: 'OTHER',
    });
    const ran = buildDataQualityReport({
      ...emptyInput(),
      economicEventCount: 3,
      logs: [officialRun],
      staged: [{ verification_status: 'AWAITING_OFFICIAL', reasons: [] }],
    });
    expect(ran.economic.state).toBe('MEASURED');
    expect(renderDataQualityMarkdown(ran)).toContain('公式統計との一致率: —(公式値と照合できた値なし)');

    const measured = renderDataQualityMarkdown(
      buildDataQualityReport({ ...sampleReportInput(), logs: [...sampleReportInput().logs, officialRun] }),
    );
    expect(measured).toContain('状態: 照合済み');
    expect(measured).toContain('公式統計との一致率: 50.00%');
  });

  it('renders 自己一致・独立照合・差異あり as distinct rows, and shows mismatch detail (HQ判断 2026-10-17)', () => {
    const officialRun = log('ingest:official', '2026-10-12T13:00:00Z', 'SUCCESS', {
      provider: 'official',
      data_type: 'OTHER',
    });
    const markdown = renderDataQualityMarkdown(
      buildDataQualityReport({
        ...emptyInput(),
        economicEventCount: 3,
        logs: [officialRun],
        snapshots: [
          {
            verification_status: 'VERIFIED',
            provider: 'bls_schedule',
            verification_source: 'BLS:CES0000000001@2026-10-02',
          },
          {
            verification_status: 'VERIFIED',
            provider: 'tradingeconomics',
            verification_source: 'BLS:CUUR0000SA0@2026-10-14',
          },
          { verification_status: 'SINGLE_SOURCE', provider: 'fmp', verification_source: null },
        ],
        staged: [
          { verification_status: 'AWAITING_OFFICIAL', reasons: [] },
          {
            verification_status: 'PENDING_REVIEW',
            reasons: ['OFFICIAL_MISMATCH'],
            indicator_code: 'US_NFP',
            reference_period: '2026-09',
            provider: 'finnhub',
            actual: 35,
            official_actual: 29,
          },
        ],
      }),
    );
    expect(markdown).toContain('### 検証の内訳(自己一致は独立照合に数えない、HQ判断 2026-10-17)');
    expect(markdown).toContain('| 独立照合済み | 1 |');
    expect(markdown).toContain('| 自己一致 | 1 |');
    expect(markdown).toContain('| 単一ソース・未照合 | 1 |');
    expect(markdown).toContain('| 差異あり | 1 |');
    expect(markdown).toContain('| 未発表・確認待ち | 1 |');
    expect(markdown).toContain('独立照合の一致率(自己一致を除く): 50.00%');
    expect(markdown).toContain('### 差異あり の一覧(最大20件)');
    expect(markdown).toContain('| US_NFP | 2026-09 | finnhub | 35 | 29 |');
    expect(markdown).not.toMatch(SECRET);
  });
});
