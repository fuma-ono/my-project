/**
 * HQ指示 2026-11-18(取り込み品質の確認)・C のレビュー対応: 品質レポートの第12章
 * 「発表の時刻を過ぎても SCHEDULED のままの発表(実績の登録の漏れ・状態の未更新)」。
 * 読み取りの条件は、実際のリーダー(createQualityReader)を、fakeSupabaseClient(条件を実際に適用する)で動かして確かめる。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { UNKNOWN_INDICATOR_CODE } from '../../src/ingestion/quality/metrics.js';
import { createQualityReader, PAGE_SIZE, type QualityReader } from '../../src/ingestion/quality/reader.js';
import {
  classifyOverdue,
  manualTargetHint,
  NO_INGEST_TARGET,
  OVERDUE_GRACE_HOURS,
  OVERDUE_LOOKBACK_DAYS,
  overdueWindow,
  renderOverdueEventsMarkdown,
  renderOverdueEventsUnavailableMarkdown,
} from '../../src/ingestion/quality/report.js';
import {
  buildQualityReport,
  buildQualityReportMarkdown,
  shouldFailOnUnavailable,
} from '../../src/ingestion/quality/run.js';
import { escapeWorkflowCommandData } from '../../src/ingestion/quality/run.js';
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

/**
 * fakeSupabaseClient は select の列を無視して、行をそのまま返す(列の指定漏れを検知できない)。
 * このテストでは、select('a, b, rel(c)') で指定した列(と結合名)だけを残すクライアントで包む。指定していない列は undefined になるので、
 * リーダーの SELECT から列(provider_event_id など)が抜ければ、テストが失敗する。
 */
export function columnAwareClient(tableData: Record<string, unknown[]>): SupabaseClient {
  const base = fakeSupabaseClient(tableData);
  const topLevelColumns = (cols: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of cols) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.map((c) => c.replace(/\(.*$/s, '').trim());
  };
  type Result = { data?: unknown; [k: string]: unknown };
  // 絞り込み・並び替えは全列で行い(実際の PostgREST と同じ。選ばない列でも絞り込める)、結果の行だけを、選んだ列に絞る
  const wrap = (chain: Record<string, unknown>, keep: string[]): unknown =>
    new Proxy(chain, {
      get(target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (r: Result) => unknown) =>
            (target.then as (f: (r: Result) => unknown) => unknown)((result) =>
              onFulfilled(
                keep.includes('*') || !Array.isArray(result.data)
                  ? result
                  : {
                      ...result,
                      data: (result.data as Record<string, unknown>[]).map((row) =>
                        Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]])),
                      ),
                    },
              ),
            );
        }
        const member = target[prop as string];
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          const out = (member as (...a: unknown[]) => unknown).apply(target, args);
          return out === target ? wrap(chain, keep) : out;
        };
      },
    });
  return {
    from: (table: string) => {
      const chain = base.from(table) as unknown as Record<string, unknown>;
      return {
        select: (cols: string, options?: unknown) => {
          const selected = (chain.select as (c: string, o?: unknown) => Record<string, unknown>)(cols, options);
          return wrap(selected, topLevelColumns(cols));
        },
      };
    },
  } as unknown as SupabaseClient;
}

const overdue = async (rows: unknown[], supabase?: SupabaseClient) => {
  const { fromIso, toIso } = overdueWindow(NOW);
  const reader = createQualityReader(supabase ?? columnAwareClient({ economic_events: rows }));
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

  it('splits the events into three categories: ingestable (注意) / no ingestion target (情報) / FOMC (separate)', () => {
    const md = renderOverdueEventsMarkdown(
      [
        { indicator_code: 'US_PPI', release_datetime: '2026-11-13T13:30:00Z' },
        { indicator_code: 'GB_CPI', release_datetime: '2026-11-18T07:00:00Z' },
        { indicator_code: 'CA_CPI', release_datetime: '2026-11-16T13:30:00Z' },
        { indicator_code: 'JP_CPI', release_datetime: '2026-11-17T23:30:00Z' },
        { indicator_code: 'EU_HICP', release_datetime: '2026-11-17T10:00:00Z' },
        { indicator_code: 'US_RETAIL_SALES', release_datetime: '2026-11-17T13:30:00Z' },
        { indicator_code: 'US_FOMC_MINUTES', release_datetime: '2026-11-18T01:00:00Z' },
      ],
      NOW,
    );
    expect(md).toContain('判定: 注意(取り込み手段あり 4 件)');
    expect(md).toContain('情報(判定に含めない): 取り込み手段なし 2 件・FOMC 議事要旨 1 件・FOMC の会合 0 件');
    const sections = md.split('### ');
    const actionable = sections.find((x) => x.startsWith('取り込み手段のある指標'))!;
    const noTarget = sections.find((x) => x.startsWith('取り込み手段のない指標'))!;
    const minutesFrame = sections.find((x) => x.startsWith('FOMC 議事要旨'))!;
    expect(actionable).toMatch(/US_PPI .*\| 115 \| official-bls/);
    expect(actionable).toMatch(/GB_CPI [^\n]*official-values/);
    expect(actionable).toMatch(/JP_CPI [^\n]*jp-cpi-values/);
    expect(actionable).toMatch(/EU_HICP [^\n]*official-eurostat/);
    // CA_CPI・US_RETAIL_SALES は、取り込みの漏れに数えない(情報の表)
    for (const code of ['CA_CPI', 'US_RETAIL_SALES']) {
      expect(noTarget, code).toContain(code);
      expect(actionable, code).not.toContain(code);
    }
    expect(noTarget).not.toContain('official-values');
    // 議事要旨は、通常の欄にも「手段なし」の欄にも残さず、別枠にだけ出す(RELEASED にならない仕様・値の取り込み手段なし)
    expect(minutesFrame).toContain('US_FOMC_MINUTES');
    expect(minutesFrame).toContain('RELEASED にならない仕様・値の取り込み手段なし');
    expect(actionable).not.toContain('US_FOMC_MINUTES');
    expect(noTarget).not.toContain('US_FOMC_MINUTES');
  });

  it('only no-target events → 正常 (they are shown as information, not counted as a miss)', () => {
    const md = renderOverdueEventsMarkdown(
      [{ indicator_code: 'CA_CPI', release_datetime: '2026-11-16T13:30:00Z' }],
      NOW,
    );
    expect(md).toContain('判定: 正常(未処理なし)');
    expect(md).toContain('情報(判定に含めない): 取り込み手段なし 1 件');
  });

  it('states that the scheduled run is not active before main integration, and the JP CPI cron stays disabled', () => {
    const md = renderOverdueEventsMarkdown([], NOW);
    expect(md).toContain('main に統合された後に、はじめて有効になる条件付き');
    expect(md).toContain('統合されるまで**動いていない**');
    expect(md).toContain('JP CPI の値の cron は、初回の公表の確認と HQ の承認まで無効');
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
      latestFomcPolicyRateRun: () => Promise.resolve(null),
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
    expect(md).toContain('判定: 注意(取り込み手段あり 1 件)');
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

describe('FOMC meetings and minutes: excluded from the normal overdue judgement; data-driven policy-rate status', () => {
  it('classifyOverdue: US_FOMC and US_FOMC_MINUTES are their own frames; retail sales / CA_CPI have no target; ingestable codes are actionable', () => {
    expect(classifyOverdue('US_FOMC')).toBe('FOMC');
    expect(classifyOverdue('US_FOMC_MINUTES')).toBe('FOMC_MINUTES');
    for (const code of ['US_RETAIL_SALES', 'CA_CPI']) expect(classifyOverdue(code), code).toBe('NO_TARGET');
    expect(classifyOverdue('(指標不明)')).toBe('UNKNOWN_INDICATOR');
    for (const code of ['US_PPI', 'GB_CPI', 'CA_UNEMPLOYMENT_RATE', 'JP_CPI', 'EU_HICP'])
      expect(classifyOverdue(code), code).toBe('ACTIONABLE');
  });

  it('an indicator that has an ingestion (every code official-values really ingests) is never classified as "no target"', () => {
    for (const source of OFFICIAL_VALUE_SOURCES)
      expect(classifyOverdue(source.indicatorCode), source.indicatorCode).toBe('ACTIONABLE');
  });

  const meeting = (id: string, releaseIso: string, recorded?: boolean) => ({
    indicator_code: 'US_FOMC',
    release_datetime: releaseIso,
    provider_event_id: id,
    ...(recorded === undefined ? {} : { policy_recorded: recorded }),
  });
  const run = (awaiting: string[] = [], unmatched: { provider_event_id: string; reason: string }[] = []) => ({
    started_at: '2026-11-18T05:00:00.000Z',
    status: 'SUCCESS',
    awaiting,
    unmatched,
  });
  const now = new Date('2026-11-18T09:00:00Z');

  it('US_FOMC is NOT counted in the normal overdue judgement — unrecorded or not, however old the meeting is', () => {
    const md = renderOverdueEventsMarkdown(
      [meeting('m1', '2026-10-28T18:00:00Z', false), meeting('m2', '2026-11-05T18:00:00Z', true)],
      now,
      run(),
    );
    expect(md).toContain('判定: 正常(未処理なし)');
    expect(md).toContain('FOMC の会合 2 件');
    expect(md).not.toContain('### 取り込み手段のある指標');
    expect(md).toContain('### FOMC の会合');
  });

  it('distinguishes recorded / awaiting / unmatched / not in the last run / no run record — using what the ingestion itself logged', () => {
    const md = renderOverdueEventsMarkdown(
      [
        meeting('rec', '2026-10-28T18:00:00Z', true),
        meeting('wait', '2026-11-17T18:00:00Z', false),
        meeting('unm', '2026-10-07T18:00:00Z', false),
        meeting('other', '2026-11-18T05:30:00Z', false),
      ],
      now,
      run(['wait'], [{ provider_event_id: 'unm', reason: 'NO_RECORD_IN_WINDOW' }]),
    );
    expect(md).toMatch(/2026-10-28[^\n]*記録済み/);
    expect(md).toMatch(/2026-11-17[^\n]*取り込み処理が待ち中: NY連銀の記録がまだ公開されていない/);
    expect(md).toMatch(/2026-10-07[^\n]*取り込み処理が結びつけられなかった: NO_RECORD_IN_WINDOW/);
    expect(md).toMatch(/2026-11-18[^\n]*「待ち」「結びつけ不能」のどちらにもない/);
    expect(md).toContain('待ち 1 件・結びつけ不能 1 件');
    const none = renderOverdueEventsMarkdown([meeting('x', '2026-10-28T18:00:00Z', false)], now, null);
    expect(none).toContain('最後の fomc-policy-rate の実行: 実行記録なし');
    expect(none).toContain('未記録(fomc-policy-rate の実行記録がない)');
  });

  it('notes that the meeting row stays SCHEDULED by design, and that no time of day is assumed for the NY Fed publication', () => {
    const md = renderOverdueEventsMarkdown([meeting('m', '2026-10-28T18:00:00Z', false)], now, run());
    expect(md).toContain('SCHEDULED のままになる');
    expect(md).toContain('発表の時刻からの経過では決めない');
    expect(md).not.toMatch(/9:00/);
  });

  it('the reader reports policy_recorded and provider_event_id for US_FOMC only (embedded row as an object, an array, or absent)', async () => {
    const day = NOW.getTime() - DAY;
    const row = (id: string, code: string, decision: unknown) => ({
      id,
      status: 'SCHEDULED',
      release_datetime: iso(day),
      provider_event_id: `p-${id}`,
      economic_indicators: { code },
      fomc_policy_decisions: decision,
    });
    const got = await overdue([
      row('a', 'US_FOMC', { event_id: 'a' }),
      row('b', 'US_FOMC', null),
      row('c', 'US_FOMC', [{ event_id: 'c' }]),
      row('d', 'US_FOMC', []),
      row('e', 'US_PPI', null),
    ]);
    const fomc = got.filter((e) => e.indicator_code === 'US_FOMC');
    expect(fomc.map((e) => [e.provider_event_id, e.policy_recorded]).sort()).toEqual([
      ['p-a', true],
      ['p-b', false],
      ['p-c', true],
      ['p-d', false],
    ]);
    expect(got.find((e) => e.indicator_code === 'US_PPI')).not.toHaveProperty('policy_recorded');
    expect(got.find((e) => e.indicator_code === 'US_PPI')).not.toHaveProperty('provider_event_id');
  });

  it('latestFomcPolicyRateRun: the newest ingest:fomc-policy-rate log, with awaiting / unmatched read from its details', async () => {
    const log = (started: string, details: unknown, job = 'ingest:fomc-policy-rate') => ({
      job,
      started_at: started,
      status: 'SUCCESS',
      details,
    });
    const client = fakeSupabaseClient({
      ingestion_logs: [
        log('2026-11-10T05:00:00.000Z', { awaiting: ['old'], unmatched: [] }),
        log('2026-11-18T05:00:00.000Z', {
          awaiting: ['m-new', 5, null],
          unmatched: [{ provider_event_id: 'm-x', reason: 'OUTSIDE_LOOKBACK' }, 'm-str', { reason: 'no id' }, null],
        }),
        log('2026-11-19T05:00:00.000Z', { awaiting: ['other-job'] }, 'ingest:fx-prices'),
      ],
    });
    const latest = await createQualityReader(client).latestFomcPolicyRateRun();
    expect(latest).toEqual({
      started_at: '2026-11-18T05:00:00.000Z',
      status: 'SUCCESS',
      awaiting: ['m-new'], // 文字列だけ
      unmatched: [{ provider_event_id: 'm-x', reason: 'OUTSIDE_LOOKBACK' }], // 実データの形(オブジェクト)だけ読む
      discarded: { awaiting: 2, unmatched: 3 }, // 読み捨てた数(awaiting の 5・null、unmatched の文字列・ID なし・null)
    });
    expect(await createQualityReader(fakeSupabaseClient({ ingestion_logs: [] })).latestFomcPolicyRateRun()).toBeNull();
    const odd = fakeSupabaseClient({ ingestion_logs: [log('2026-11-18T05:00:00.000Z', null)] });
    expect(await createQualityReader(odd).latestFomcPolicyRateRun()).toMatchObject({
      awaiting: [],
      unmatched: [],
      discarded: { awaiting: 0, unmatched: 0 },
    });
    // 配列でない値は、1 件の読み捨てとして数える
    const wrong = fakeSupabaseClient({
      ingestion_logs: [log('2026-11-18T05:00:00.000Z', { awaiting: 'm1', unmatched: { provider_event_id: 'x' } })],
    });
    expect(await createQualityReader(wrong).latestFomcPolicyRateRun()).toMatchObject({
      discarded: { awaiting: 1, unmatched: 1 },
    });
  });

  it('the report reads the last FOMC run only when an FOMC meeting is in the list', async () => {
    let reads = 0;
    const base = (events: { indicator_code: string; release_datetime: string }[]) =>
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
        listOverdueScheduledEvents: () => Promise.resolve(events),
        latestFomcPolicyRateRun: () => {
          reads += 1;
          return Promise.resolve(null);
        },
      }) as unknown as QualityReader;
    await buildQualityReportMarkdown(base([{ indicator_code: 'US_PPI', release_datetime: '2026-11-13T13:30:00Z' }]), {
      days: 1,
      now: NOW,
    });
    expect(reads).toBe(0);
    await buildQualityReportMarkdown(base([{ indicator_code: 'US_FOMC', release_datetime: '2026-11-04T19:00:00Z' }]), {
      days: 1,
      now: NOW,
    });
    expect(reads).toBe(1);
  });
});

describe('unavailable chapter 12: warning at the top, machine-readable status, optional failure flag', () => {
  const failing = (reader: ReturnType<typeof makeReader>) => buildQualityReport(reader, { days: 1, now: NOW });
  const makeReader = (fn: QualityReader['listOverdueScheduledEvents']) =>
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
      listOverdueScheduledEvents: fn,
      latestFomcPolicyRateRun: () => Promise.resolve(null),
    }) as unknown as QualityReader;

  it('PARTIAL: the warning is the first thing in the report, chapters 1–11 are still there, and the last line says PARTIAL', async () => {
    const result = await failing(
      makeReader(() => Promise.reject(new Error('overdue events: read 3 rows but the server counted 5'))),
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.chaptersUnavailable).toEqual([12]);
    expect(result.markdown.startsWith('> ⚠ **このレポートは不完全です**')).toBe(true);
    expect(result.markdown).toContain('第12章を取得できませんでした');
    expect(result.markdown).toContain('read 3 rows but the server counted 5');
    expect(result.markdown).toContain('## 11.');
    expect(result.markdown.trimEnd().endsWith('report_status: PARTIAL chapters_unavailable=12')).toBe(true);
    expect(result.markdown).not.toContain('正常(未処理なし)');
  });

  it('COMPLETE: no warning, and the last line says COMPLETE', async () => {
    const result = await failing(makeReader(() => Promise.resolve([])));
    expect(result.status).toBe('COMPLETE');
    expect(result.chaptersUnavailable).toEqual([]);
    expect(result.markdown).not.toContain('このレポートは不完全です');
    expect(result.markdown.trimEnd().endsWith('report_status: COMPLETE')).toBe(true);
  });

  it('buildQualityReportMarkdown (the HTTP route / existing callers) carries the same warning and status line', async () => {
    const md = await buildQualityReportMarkdown(
      makeReader(() => Promise.reject(new Error('x'))),
      { days: 1, now: NOW },
    );
    expect(md.startsWith('> ⚠')).toBe(true);
    expect(md).toContain('report_status: PARTIAL chapters_unavailable=12');
  });

  it('--fail-on-unavailable fails only a PARTIAL report; without the flag the exit code stays 0 (the daily workflow does not pass it)', () => {
    expect(shouldFailOnUnavailable('PARTIAL', true)).toBe(true);
    expect(shouldFailOnUnavailable('PARTIAL', false)).toBe(false);
    expect(shouldFailOnUnavailable('COMPLETE', true)).toBe(false);
    expect(shouldFailOnUnavailable('COMPLETE', false)).toBe(false);
  });

  it('the daily workflow does not pass --fail-on-unavailable', () => {
    const yml = readFileSync(
      join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-ingestion.yml'),
      'utf8',
    );
    expect(yml).toContain('report:data-quality -- --days 1');
    expect(yml).not.toContain('fail-on-unavailable');
  });
});

describe('rows whose indicator cannot be identified (HQ review N3)', () => {
  const unknownRow = { indicator_code: '(指標不明)', release_datetime: '2026-11-17T08:00:00Z' };

  it('are a warning (注意), not an "no ingestion target" information row', () => {
    const md = renderOverdueEventsMarkdown([unknownRow], NOW);
    expect(md).toContain('判定: 注意(取り込み手段あり 0 件・指標を特定できない 1 件)');
    expect(md).toContain('### 指標を特定できない行(注意');
    expect(md).not.toContain('判定: 正常');
    const info = md.split('\n').find((l) => l.startsWith('情報(判定に含めない)'))!;
    expect(info).toContain('取り込み手段なし 0 件');
    const noTargetSection = md.split('### ').find((x) => x.startsWith('取り込み手段のない指標'));
    expect(noTargetSection).toBeUndefined();
  });

  it('end to end: an event whose economic_indicators cannot be joined reaches the 注意 count', async () => {
    const rows = [
      { id: 'u', status: 'SCHEDULED', release_datetime: iso(NOW.getTime() - DAY), economic_indicators: null },
    ];
    const got = await overdue(rows);
    expect(classifyOverdue(got[0]!.indicator_code)).toBe('UNKNOWN_INDICATOR');
    expect(renderOverdueEventsMarkdown(got, NOW)).toContain('指標を特定できない 1 件');
  });
});

describe('reader SELECT columns are really needed (HQ review N2)', () => {
  it('the column-aware fake drops columns that the SELECT does not name', () => {
    const client = columnAwareClient({ t: [{ a: 1, b: 2, rel: { c: 3 } }] });
    return Promise.resolve(
      (client.from('t') as unknown as { select: (c: string) => PromiseLike<{ data: unknown[] }> }).select('a, rel(c)'),
    ).then((res) => {
      expect(res.data).toEqual([{ a: 1, rel: { c: 3 } }]);
    });
  });

  it('provider_event_id reaches the FOMC rows only because the reader selects it', async () => {
    const rows = [
      {
        id: 'x1',
        status: 'SCHEDULED',
        release_datetime: iso(NOW.getTime() - DAY),
        provider_event_id: 'fomc-2026-11',
        economic_indicators: { code: 'US_FOMC' },
        fomc_policy_decisions: null,
      },
    ];
    const got = await overdue(rows);
    expect(got[0]).toMatchObject({ provider_event_id: 'fomc-2026-11', policy_recorded: false });
  });
});

describe('GitHub Actions warning escaping (HQ review N5)', () => {
  it('escapes %, CR and LF (the % first, so the added % are not converted again)', () => {
    expect(escapeWorkflowCommandData('100% done')).toBe('100%25 done');
    expect(escapeWorkflowCommandData('a\r\nb\nc\rd')).toBe('a%0D%0Ab%0Ac%0Dd');
    expect(escapeWorkflowCommandData('%0A')).toBe('%250A');
    expect(escapeWorkflowCommandData('plain')).toBe('plain');
  });
});

describe('discarded run-record elements are visible in the report (HQ review)', () => {
  const meeting = {
    indicator_code: 'US_FOMC',
    release_datetime: '2026-10-28T18:00:00Z',
    provider_event_id: 'm',
    policy_recorded: false,
  };
  const base = { started_at: '2026-11-18T05:00:00.000Z', status: 'SUCCESS', awaiting: [], unmatched: [] };

  it('shows the number of discarded elements, and says nothing when none were discarded', () => {
    const withDiscard = renderOverdueEventsMarkdown([meeting], NOW, {
      ...base,
      discarded: { awaiting: 2, unmatched: 3 },
    });
    expect(withDiscard).toContain('読み捨てた要素 5 件');
    expect(withDiscard).toContain('待ち 2・結びつけ不能 3');
    const none = renderOverdueEventsMarkdown([meeting], NOW, { ...base, discarded: { awaiting: 0, unmatched: 0 } });
    expect(none).not.toContain('読み捨て');
  });
});

describe('quality/ module imports (static relative `./x.js` imports only): direction reader → metrics ← report', () => {
  const dir = join(__dirname, '../../src/ingestion/quality');
  const importsOf = (file: string) =>
    [...readFileSync(join(dir, file), 'utf8').matchAll(/from '(\.\/[^']+)\.js'/g)].map((m) => `${m[1]}.ts`);

  it('reader.ts does not import report.ts (the presentation layer); report.ts does not import reader.ts', () => {
    expect(importsOf('reader.ts')).not.toContain('./report.ts');
    expect(importsOf('report.ts')).not.toContain('./reader.ts');
    expect(importsOf('metrics.ts')).not.toContain('./report.ts');
    expect(importsOf('metrics.ts')).not.toContain('./reader.ts');
  });

  it('there is no cycle among the static `./x.js` imports of the files in quality/ (imports from other directories and dynamic imports are not inspected)', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const graph = new Map(files.map((f) => [f, importsOf(f).filter((i) => files.includes(i.slice(2)))]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (f: string, path: string[]): string[] | null => {
      if (visiting.has(f)) return [...path, f];
      if (done.has(f)) return null;
      visiting.add(f);
      for (const next of graph.get(f) ?? []) {
        const cycle = visit(next.slice(2), [...path, f]);
        if (cycle) return cycle;
      }
      visiting.delete(f);
      done.add(f);
      return null;
    };
    for (const f of files) expect(visit(f, []), f).toBeNull();
  });

  it('UNKNOWN_INDICATOR_CODE lives in metrics.ts and is the value the reader returns', () => {
    expect(UNKNOWN_INDICATOR_CODE).toBe('(指標不明)');
    expect(readFileSync(join(dir, 'metrics.ts'), 'utf8')).toContain(
      "export const UNKNOWN_INDICATOR_CODE = '(指標不明)'",
    );
    expect(readFileSync(join(dir, 'report.ts'), 'utf8')).not.toContain('export const UNKNOWN_INDICATOR_CODE');
  });
});
