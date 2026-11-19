/**
 * HQ指示 2026-11-18(取り込み品質の確認)・C のレビュー対応: 品質レポートの第12章
 * 「発表の時刻を過ぎても SCHEDULED のままの発表(実績の登録の漏れ・状態の未更新)」。
 * 読み取りの条件は、実際のリーダー(createQualityReader)を、fakeSupabaseClient(条件を実際に適用する)で動かして確かめる。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { createQualityReader, PAGE_SIZE, type QualityReader } from '../../src/ingestion/quality/reader.js';
import {
  manualTargetHint,
  NO_INGEST_TARGET,
  OVERDUE_GRACE_HOURS,
  OVERDUE_LOOKBACK_DAYS,
  overdueWindow,
  renderOverdueEventsMarkdown,
  renderOverdueEventsUnavailableMarkdown,
} from '../../src/ingestion/quality/report.js';
import { buildQualityReportMarkdown } from '../../src/ingestion/quality/run.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

const NOW = new Date('2026-11-18T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface EventRow {
  id: string;
  status: string;
  release_datetime: string;
  economic_indicators: { code: string } | null;
}
const event = (id: string, releaseMs: number, status = 'SCHEDULED', code: string | null = 'US_PPI'): EventRow => ({
  id,
  status,
  release_datetime: iso(releaseMs),
  economic_indicators: code === null ? null : { code },
});

const overdue = async (rows: EventRow[], supabase?: SupabaseClient) => {
  const { fromIso, toIso } = overdueWindow(NOW);
  const reader = createQualityReader(supabase ?? fakeSupabaseClient({ economic_events: rows }));
  return reader.listOverdueScheduledEvents(fromIso, toIso);
};

describe('chapter 12: the window [now − 14 days, now − 3 hours)', () => {
  it('overdueWindow: lower bound inclusive 14 days, upper bound 3 hours', () => {
    expect(overdueWindow(NOW)).toEqual({
      fromIso: iso(NOW.getTime() - OVERDUE_LOOKBACK_DAYS * DAY),
      toIso: iso(NOW.getTime() - OVERDUE_GRACE_HOURS * HOUR),
    });
  });

  it('14 days ago exactly is included; 1 ms older is excluded', async () => {
    const edge = NOW.getTime() - 14 * DAY;
    const got = await overdue([event('a', edge), event('b', edge - 1)]);
    expect(got.map((e) => e.release_datetime)).toEqual([iso(edge)]);
  });

  it('3 hours ago exactly is excluded ("3 hours を超えて"); 1 ms more than 3 hours is included', async () => {
    const edge = NOW.getTime() - 3 * HOUR;
    const got = await overdue([event('a', edge), event('b', edge - 1)]);
    expect(got.map((e) => e.release_datetime)).toEqual([iso(edge - 1)]);
  });

  it('only SCHEDULED rows: RELEASED, CANCELLED and future events are excluded', async () => {
    const past = NOW.getTime() - DAY;
    const got = await overdue([
      event('s', past, 'SCHEDULED'),
      event('r', past, 'RELEASED'),
      event('c', past, 'CANCELLED'),
      event('f1', NOW.getTime() + HOUR, 'SCHEDULED'),
      event('f2', NOW.getTime() + 30 * DAY, 'SCHEDULED'),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.release_datetime).toBe(iso(past));
  });

  it('an event whose indicator cannot be read is shown as (指標不明), never dropped', async () => {
    const got = await overdue([event('x', NOW.getTime() - DAY, 'SCHEDULED', null)]);
    expect(got).toEqual([{ indicator_code: '(指標不明)', release_datetime: iso(NOW.getTime() - DAY) }]);
    expect(renderOverdueEventsMarkdown(got, NOW)).toContain('(指標不明)');
  });
});

describe('chapter 12: pagination (more than 1,000 rows)', () => {
  const base = NOW.getTime() - 10 * DAY;
  const rows = Array.from({ length: 2500 }, (_, i) => event(`id-${String(i).padStart(5, '0')}`, base + i * 60_000));

  it('reads all 2,500 rows exactly once (no gap, no duplicate), in release order', async () => {
    const got = await overdue(rows);
    expect(got).toHaveLength(2500);
    expect(new Set(got.map((e) => e.release_datetime)).size).toBe(2500);
    expect(got.map((e) => e.release_datetime)).toEqual(rows.map((r) => r.release_datetime));
  });

  it('still complete when the server returns fewer rows per request than PAGE_SIZE (max_rows = 500)', async () => {
    const client = fakeSupabaseClient({ economic_events: rows });
    // 実際のサーバーの max_rows を模す: どの問い合わせも、最大 500 行しか返さない(件数 count は、全体の件数のまま)
    const originalFrom = (client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    const limited = {
      from: (table: string) => {
        const chain = originalFrom(table);
        const then = chain.then as (f: (r: { data: unknown[]; count?: number }) => unknown) => unknown;
        chain.then = (f: (r: { data: unknown[]; count?: number }) => unknown) =>
          then((result) => f({ ...result, data: result.data.slice(0, 500) }));
        return chain;
      },
    } as unknown as SupabaseClient;
    expect(PAGE_SIZE).toBeGreaterThan(500);
    const got = await overdue(rows, limited);
    expect(got).toHaveLength(2500);
    expect(new Set(got.map((e) => e.release_datetime)).size).toBe(2500);
  });

  it('fails explicitly (never a silent partial list) when the count and the rows read do not agree', async () => {
    const client = fakeSupabaseClient({ economic_events: rows.slice(0, 30) });
    const originalFrom = (client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    const lying = {
      from: (table: string) => {
        const chain = originalFrom(table);
        const then = chain.then as (f: (r: { data: unknown[]; count?: number }) => unknown) => unknown;
        chain.then = (f: (r: { data: unknown[]; count?: number }) => unknown) =>
          then((result) => f({ ...result, count: 31 })); // 実際は 30 行なのに、31 行と数える
        return chain;
      },
    } as unknown as SupabaseClient;
    await expect(overdue(rows.slice(0, 30), lying)).rejects.toThrow(/read 30 rows but the server counted 31/);
  });

  it('fails explicitly when the server does not return a count', async () => {
    const client = fakeSupabaseClient({ economic_events: rows.slice(0, 3) });
    const originalFrom = (client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    const noCount = {
      from: (table: string) => {
        const chain = originalFrom(table);
        const then = chain.then as (f: (r: { data: unknown[]; count?: number }) => unknown) => unknown;
        chain.then = (f: (r: { data: unknown[]; count?: number }) => unknown) =>
          then((result) => f({ data: result.data }));
        return chain;
      },
    } as unknown as SupabaseClient;
    await expect(overdue(rows.slice(0, 3), noCount)).rejects.toThrow(/row count was not returned/);
  });
});

describe('chapter 12: rendering', () => {
  it('no overdue events → 正常, no table; the wording is "3時間を超えて経過" and states what it does and does not detect', () => {
    const md = renderOverdueEventsMarkdown([], NOW);
    expect(md).toContain('## 12.');
    expect(md).toContain('判定: 正常(未処理なし)');
    expect(md).not.toContain('| 発表(UTC)');
    expect(md).toContain('3 時間を**超えて**経過');
    expect(md).not.toContain('3 時間以上');
    expect(md).toContain('実績の登録が済んでいない、または状態が未更新');
    expect(md).toContain('スナップショットがすでにあっても');
    expect(md).toContain('精度が EXACT でない発表(日付だけなど)は、保存されている時刻が目安');
    expect(md).toContain('stuck 行');
    expect(md).toContain('この章では検知しない');
  });

  it('lists each event with elapsed hours and the manual target; CA_CPI and other unsupported codes say 手段なし', () => {
    const md = renderOverdueEventsMarkdown(
      [
        { indicator_code: 'US_PPI', release_datetime: '2026-11-13T13:30:00Z' },
        { indicator_code: 'GB_CPI', release_datetime: '2026-11-18T07:00:00Z' },
        { indicator_code: 'CA_CPI', release_datetime: '2026-11-16T13:30:00Z' },
        { indicator_code: 'JP_CPI', release_datetime: '2026-11-17T23:30:00Z' },
        { indicator_code: 'EU_HICP', release_datetime: '2026-11-17T10:00:00Z' },
        { indicator_code: 'US_RETAIL_SALES', release_datetime: '2026-11-17T13:30:00Z' },
      ],
      NOW,
    );
    expect(md).toContain('判定: 注意(6 件が未処理)');
    expect(md).toMatch(/US_PPI .*\| 115 \| official-bls/);
    expect(md).toMatch(/GB_CPI .*\| official-values/);
    expect(md).toMatch(/CA_CPI [^\n]*手段なし/);
    expect(md).not.toMatch(/CA_CPI [^\n]*official-values/);
    expect(md).toMatch(/JP_CPI [^\n]*jp-cpi-values/);
    expect(md).toMatch(/EU_HICP [^\n]*official-eurostat/);
    expect(md).toMatch(/US_RETAIL_SALES [^\n]*手段なし/);
  });

  it('unavailable: explicit 取得不能, never a normal-looking result', () => {
    const md = renderOverdueEventsUnavailableMarkdown('read 1 rows but the server counted 2');
    expect(md).toContain('## 12.');
    expect(md).toContain('取得不能');
    expect(md).toContain('『未処理なし』ではない');
    expect(md).toContain('read 1 rows but the server counted 2');
    expect(md).not.toContain('正常');
  });
});

describe('manualTargetHint is decided by the indicator codes the ingestion really handles', () => {
  it('every code that official-values really ingests maps to official-values — and nothing else does', () => {
    const codes = OFFICIAL_VALUE_SOURCES.map((s) => s.indicatorCode);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(manualTargetHint(code), code).toBe('official-values');
  });

  it('CA_CPI (no ingestion) is NOT official-values; the same-country CA_UNEMPLOYMENT_RATE is', () => {
    expect(manualTargetHint('CA_CPI')).toBe(NO_INGEST_TARGET);
    expect(manualTargetHint('CA_UNEMPLOYMENT_RATE')).toBe('official-values');
    // 接頭辞(GB_・AU_・CA_)だけでは決めない: 取り込みの無い、同じ接頭辞の指標
    expect(manualTargetHint('GB_UNKNOWN_FUTURE_CODE')).toBe(NO_INGEST_TARGET);
    expect(manualTargetHint('AU_UNKNOWN_FUTURE_CODE')).toBe(NO_INGEST_TARGET);
  });

  it('the BLS, JP and Eurostat codes keep their targets; other codes are 手段なし', () => {
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
      expect(manualTargetHint(code), code).toBe('official-bls');
    }
    expect(manualTargetHint('JP_CPI')).toBe('jp-cpi-values');
    expect(manualTargetHint('EU_HICP')).toBe('official-eurostat');
    expect(manualTargetHint('EU_UNEMPLOYMENT_RATE')).toBe('official-eurostat');
    for (const code of ['US_FOMC', 'US_RETAIL_SALES', '(指標不明)', ''])
      expect(manualTargetHint(code), code).toBe(NO_INGEST_TARGET);
  });
});

describe('the report', () => {
  const reader = (overdueFn: QualityReader['listOverdueScheduledEvents']) =>
    ({
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
      listOverdueScheduledEvents: overdueFn,
    }) as unknown as QualityReader;

  it('asks the reader for [now − 14 days, now − 3 hours) and appends chapter 12 after chapter 11', async () => {
    const calls: [string, string][] = [];
    const md = await buildQualityReportMarkdown(
      reader((from, to) => {
        calls.push([from, to]);
        return Promise.resolve([{ indicator_code: 'US_PPI', release_datetime: '2026-11-13T13:30:00Z' }]);
      }),
      { days: 1, now: NOW },
    );
    const { fromIso, toIso } = overdueWindow(NOW);
    expect(calls).toEqual([[fromIso, toIso]]);
    expect(md.indexOf('## 11.')).toBeLessThan(md.indexOf('## 12.'));
    expect(md).toContain('判定: 注意(1 件が未処理)');
  });

  it('when chapter 12 cannot be read, chapters 1–11 are still output and chapter 12 says 取得不能 (not 正常)', async () => {
    const md = await buildQualityReportMarkdown(
      reader(() => Promise.reject(new Error('overdue events: read 3 rows but the server counted 5'))),
      { days: 1, now: NOW },
    );
    expect(md).toContain('## 11.');
    const chapter12 = md.slice(md.indexOf('## 12.'));
    expect(chapter12).toContain('取得不能');
    expect(chapter12).toContain('read 3 rows but the server counted 5');
    expect(chapter12).not.toContain('正常(未処理なし)');
  });
});
