/**
 * HQ指示 2026-11-18(取り込み品質の確認): 品質レポートの第12章「発表の時刻を過ぎても SCHEDULED のままの発表」。
 */
import { describe, expect, it } from 'vitest';
import {
  manualTargetHint,
  OVERDUE_GRACE_HOURS,
  OVERDUE_LOOKBACK_DAYS,
  renderOverdueEventsMarkdown,
} from '../../src/ingestion/quality/report.js';
import { buildQualityReportMarkdown } from '../../src/ingestion/quality/run.js';
import type { QualityReader } from '../../src/ingestion/quality/reader.js';

const NOW = new Date('2026-11-18T09:00:00Z');

describe('chapter 12: overdue SCHEDULED events', () => {
  it('no overdue events → 正常, no table', () => {
    const md = renderOverdueEventsMarkdown([], NOW);
    expect(md).toContain('## 12.');
    expect(md).toContain('判定: 正常(未処理なし)');
    expect(md).not.toContain('| 発表(UTC)');
  });

  it('lists each overdue event with the elapsed hours and a manual-target hint, and warns', () => {
    const md = renderOverdueEventsMarkdown(
      [
        { indicator_code: 'US_PPI', release_datetime: '2026-11-13T13:30:00Z' },
        { indicator_code: 'CA_CPI', release_datetime: '2026-11-16T13:30:00Z' },
        { indicator_code: 'JP_CPI', release_datetime: '2026-11-17T23:30:00Z' },
        { indicator_code: 'EU_HICP', release_datetime: '2026-11-17T10:00:00Z' },
        { indicator_code: 'US_RETAIL_SALES', release_datetime: '2026-11-17T13:30:00Z' },
      ],
      NOW,
    );
    expect(md).toContain('判定: 注意(5 件が未処理)');
    expect(md).toMatch(/US_PPI .*\| 115 \| official-bls/);
    expect(md).toMatch(/CA_CPI .*\| official-values/);
    expect(md).toMatch(/JP_CPI .*\| jp-cpi-values/);
    expect(md).toMatch(/EU_HICP .*\| official-eurostat/);
    expect(md).toMatch(/US_RETAIL_SALES .*\| —/); // 目安が分からない指標は推測しない
  });

  it('manualTargetHint: the BLS codes and prefixes map as documented; unknown codes are not guessed', () => {
    for (const code of [
      'US_CPI',
      'US_CORE_CPI',
      'US_NFP',
      'US_UNEMPLOYMENT_RATE',
      'US_AVG_HOURLY_EARNINGS',
      'US_PPI',
      'US_CORE_PPI',
      'US_JOLTS',
    ]) {
      expect(manualTargetHint(code)).toBe('official-bls');
    }
    expect(manualTargetHint('GB_CPI')).toBe('official-values');
    expect(manualTargetHint('AU_WPI_QOQ')).toBe('official-values');
    expect(manualTargetHint('US_FOMC')).toBe('—');
    expect(manualTargetHint('(指標不明)')).toBe('—');
  });

  it('the report asks the reader for [now − 14 days, now − 3 hours) and appends chapter 12 at the end', async () => {
    const calls: [string, string][] = [];
    const reader = {
      listPairs: () => Promise.resolve([]),
      listFxRows: () => Promise.resolve([]),
      firstCandleAt: () => Promise.resolve(null),
      countEconomicEvents: () => Promise.resolve(0),
      listCreditUsage: () => Promise.resolve([]),
      listReleases: () => Promise.resolve([]),
      listLogs: () => Promise.resolve([]),
      listSnapshots: () => Promise.resolve([]),
      listStaged: () => Promise.resolve([]),
      listSpeechRuns: () => Promise.resolve([]),
      speechDbStatus: () => Promise.resolve({ latestAt: null, futureScheduled: 0, overdueScheduled: 0 }),
      listProvisionalEvents: () => Promise.resolve([]),
      speechPipelineStatus: () => Promise.resolve(null),
      listOverdueScheduledEvents: (from: string, to: string) => {
        calls.push([from, to]);
        return Promise.resolve([{ indicator_code: 'US_PPI', release_datetime: '2026-11-13T13:30:00Z' }]);
      },
    } as unknown as QualityReader;
    const md = await buildQualityReportMarkdown(reader, { days: 1, now: NOW });
    expect(calls).toEqual([
      [
        new Date(NOW.getTime() - OVERDUE_LOOKBACK_DAYS * 86_400_000).toISOString(),
        new Date(NOW.getTime() - OVERDUE_GRACE_HOURS * 3_600_000).toISOString(),
      ],
    ]);
    expect(md.indexOf('## 11.')).toBeLessThan(md.indexOf('## 12.'));
    expect(md).toContain('判定: 注意(1 件が未処理)');
  });
});
