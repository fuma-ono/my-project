import { describe, expect, it } from 'vitest';
import { parseFmpCalendar } from '../../src/ingestion/adapters/fmp.js';
import { parsePolygonAggregates } from '../../src/ingestion/adapters/polygon.js';
import { parseTradingEconomicsCalendar } from '../../src/ingestion/adapters/tradingEconomics.js';
import { parseTwelveDataSeries } from '../../src/ingestion/adapters/twelveData.js';
import {
  checkAgainstFredReleaseDates,
  compareCalendarProvider,
  compareFxSeries,
  compareReleaseTimesAcrossProviders,
  renderMarkdownReport,
  type ProviderEvalReport,
} from '../../src/ingestion/eval/providerComparison.js';
import { INDICATOR_MAPPINGS, type IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import type { OfficialValueResolver } from '../../src/ingestion/verification/official.js';
import { jsonFixture } from '../helpers/memoryIngestionStore.js';

const official: OfficialValueResolver = {
  resolve(mapping: IndicatorMapping, period: string) {
    const values: Record<string, number> = {
      'US_CPI|2026-09': 3.7376847,
      'US_CORE_CPI|2026-09': 2.5643584,
      'US_NFP|2026-09': 29,
      'US_UNEMPLOYMENT_RATE|2026-09': 4.2,
    };
    const value = values[`${mapping.code}|${period}`];
    return Promise.resolve(value === undefined ? null : { value, sourceRef: 'BLS:test' });
  },
};

const FETCHED_AT = '2026-10-15T09:00:00.000Z';

describe('provider comparison report', () => {
  it('reports official mismatches, missing forecasts and release-time issues per provider', async () => {
    const te = await compareCalendarProvider(
      'tradingeconomics',
      parseTradingEconomicsCalendar(await jsonFixture('tradingeconomics-calendar.json'), FETCHED_AT),
      INDICATOR_MAPPINGS,
      official,
    );
    expect(te.summary).toMatchObject({
      withActual: 4,
      officialCompared: 4,
      officialMismatches: 0,
      missingForecasts: 0,
    });
    expect(te.unmappedKeys).toEqual(['united states|initial jobless claims (Initial Jobless Claims)']);

    const fmp = await compareCalendarProvider(
      'fmp',
      parseFmpCalendar(await jsonFixture('fmp-economic-calendar.json'), FETCHED_AT),
      INDICATOR_MAPPINGS,
      official,
    );
    expect(fmp.summary).toMatchObject({
      withActual: 3,
      officialMismatches: 1,
      missingForecasts: 1,
      releaseTimeIssues: 1,
    });
    const cpi = fmp.rows.find((row) => row.indicator === 'US_CPI')!;
    expect(cpi).toMatchObject({
      actual: 3.8,
      official: 3.7,
      officialMatch: false,
      difference: 0.1,
      periodInferred: true,
      period: '2026-09',
    });

    const diffs = compareReleaseTimesAcrossProviders([te, fmp]);
    expect(diffs[0]).toMatchObject({ indicator: 'US_UNEMPLOYMENT_RATE', period: '2026-09', maxDiffMinutes: 1 });

    const fred = checkAgainstFredReleaseDates([te], INDICATOR_MAPPINGS, new Map([[10, new Set(['2026-10-14'])]]));
    expect(fred.filter((c) => c.indicator === 'US_CPI')).toEqual([
      { indicator: 'US_CPI', provider: 'tradingeconomics', providerDate: '2026-10-14', inFredReleaseDates: true },
    ]);

    const report: ProviderEvalReport = {
      generatedAt: FETCHED_AT,
      range: { from: '2026-09-01', to: '2026-10-15' },
      officialSources: ['BLS'],
      calendar: [te, fmp],
      crossProviderReleaseTimes: diffs,
      fredReleaseDates: fred,
      fredReleaseIdChecks: [{ seriesId: 'CPIAUCNS', expected: 10, actual: 10 }],
      fx: [],
      fxSingleSource: [],
      errors: [],
    };
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain('### fmp');
    expect(markdown).toContain('**NG**');
    expect(markdown).toContain('CPIAUCNS: expected 10, FRED says 10 OK');
  });

  it('computes FX minute close differences in pips', async () => {
    const td = parseTwelveDataSeries(await jsonFixture('twelvedata-usdjpy-1min-utc.json'), 'USDJPY');
    const polygon = parsePolygonAggregates(await jsonFixture('polygon-usdjpy-1min.json'), 'USDJPY').candles;
    const fx = compareFxSeries('USDJPY', 0.01, td, polygon, 3);
    expect(fx).toMatchObject({
      primary: 'twelvedata',
      secondary: 'polygon',
      matchedMinutes: 3,
      onlyInPrimary: 0,
      overThreshold: 1,
    });
    expect(fx.absDiffPips.max).toBe(6);
    expect(fx.worstMinutes[0]).toMatchObject({ minute: '2026-10-15T08:30:00.000Z', diffPips: -6 });
  });
});
