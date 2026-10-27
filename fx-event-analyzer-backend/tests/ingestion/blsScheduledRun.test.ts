/**
 * HQ指示(2026-10-27「BLS定時実行」): 定期実行(--if-due)が BLS を呼ぶのは、発表時刻を過ぎたのに
 * まだ RELEASED でないエントリがあるときだけ。失敗して SCHEDULED のまま残ったものは次の実行で取り直す。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BlsScheduleEntry } from '../../src/ingestion/mappings/blsSchedule.js';
import { API_CREDIT_CAPS } from '../../src/ingestion/config.js';
import {
  BLS_SCHEDULE_PROVIDER,
  blsScheduleReleaseAt,
  findDueBlsEntries,
} from '../../src/ingestion/pipelines/blsCalendar.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const NFP_NOV: BlsScheduleEntry = { indicatorCode: 'US_NFP', referencePeriod: '2026-10', releaseDate: '2026-11-06' };
const UNEMP_NOV: BlsScheduleEntry = {
  indicatorCode: 'US_UNEMPLOYMENT_RATE',
  referencePeriod: '2026-10',
  releaseDate: '2026-11-06',
};
const CPI_NOV: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' };
const CPI_SEP: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-08', releaseDate: '2026-09-11' };
const ENTRIES = [NFP_NOV, UNEMP_NOV, CPI_NOV, CPI_SEP];

describe('blsScheduleReleaseAt', () => {
  it('is 08:30 New York in UTC across the DST change (EDT 12:30Z / EST 13:30Z)', () => {
    expect(blsScheduleReleaseAt(CPI_SEP)?.toISOString()).toBe('2026-09-11T12:30:00.000Z');
    expect(blsScheduleReleaseAt(NFP_NOV)?.toISOString()).toBe('2026-11-06T13:30:00.000Z');
  });
});

describe('findDueBlsEntries (--if-due)', () => {
  let store: MemoryIngestionStore;

  beforeEach(() => {
    store = new MemoryIngestionStore();
  });

  function row(entry: BlsScheduleEntry, status: 'SCHEDULED' | 'RELEASED' | 'CANCELLED') {
    store.events.push({
      id: `ev-${entry.indicatorCode}-${entry.referencePeriod}`,
      indicator_id: 'ind',
      provider: BLS_SCHEDULE_PROVIDER,
      provider_event_id: `${BLS_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`,
      release_datetime: blsScheduleReleaseAt(entry)!.toISOString(),
      status,
    } as never);
  }

  it('has nothing due before the release time (no BLS call on a quiet day)', async () => {
    [NFP_NOV, UNEMP_NOV, CPI_NOV].forEach((e) => row(e, 'SCHEDULED'));
    row(CPI_SEP, 'RELEASED');
    const due = await findDueBlsEntries(store, new Date('2026-11-06T13:29:00Z'), { entries: ENTRIES });
    expect(due).toEqual([]);
  });

  it('is due right after the release while the rows are still SCHEDULED', async () => {
    [NFP_NOV, UNEMP_NOV, CPI_NOV].forEach((e) => row(e, 'SCHEDULED'));
    row(CPI_SEP, 'RELEASED');
    const due = await findDueBlsEntries(store, new Date('2026-11-06T14:45:00Z'), { entries: ENTRIES });
    expect(due).toEqual([NFP_NOV, UNEMP_NOV]);
  });

  it('stays due after a failed run (row still SCHEDULED or missing), so the next run retries', async () => {
    row(NFP_NOV, 'SCHEDULED');
    const due = await findDueBlsEntries(store, new Date('2026-11-07T18:00:00Z'), { entries: [NFP_NOV, UNEMP_NOV] });
    expect(due).toEqual([NFP_NOV, UNEMP_NOV]);
  });

  it('is not due once RELEASED (or CANCELLED / cancelled in the table)', async () => {
    row(NFP_NOV, 'RELEASED');
    row(UNEMP_NOV, 'CANCELLED');
    const cancelled = { ...CPI_NOV, cancelled: true, cancelledNote: 'test' } as BlsScheduleEntry;
    const due = await findDueBlsEntries(store, new Date('2026-11-11T18:00:00Z'), {
      entries: [NFP_NOV, UNEMP_NOV, cancelled],
    });
    expect(due).toEqual([]);
  });

  it('stops retrying after the overdue window (45 days) — a human checks the table', async () => {
    row(CPI_SEP, 'SCHEDULED');
    expect(await findDueBlsEntries(store, new Date('2026-10-20T00:00:00Z'), { entries: [CPI_SEP] })).toEqual([CPI_SEP]);
    expect(await findDueBlsEntries(store, new Date('2026-10-27T00:00:00Z'), { entries: [CPI_SEP] })).toEqual([]);
  });

  it('reads only (never writes)', async () => {
    row(NFP_NOV, 'SCHEDULED');
    const before = JSON.stringify(store.events);
    await findDueBlsEntries(store, new Date('2026-11-06T14:45:00Z'), { entries: [NFP_NOV] });
    expect(JSON.stringify(store.events)).toBe(before);
  });
});

describe('BLS credit planning (API_CREDIT_CAPS.bls)', () => {
  it('keeps two scheduled runs + one manual run within BLS v1 (25/day)', () => {
    // 1回の実行は全系列をまとめた1回の HTTP(createBlsBatchProvider)。再試行を含めても runCap まで。
    const perRun = API_CREDIT_CAPS.bls.runCap;
    expect(API_CREDIT_CAPS.bls.automatic).toBeLessThanOrEqual(2 * perRun);
    expect(API_CREDIT_CAPS.bls.manual).toBeLessThan(25);
    expect(API_CREDIT_CAPS.bls.manual - API_CREDIT_CAPS.bls.automatic).toBeGreaterThanOrEqual(3);
  });
});
