/**
 * HQ判断(2026-11-10「GB_UNEMPLOYMENT_RATE は提案方式を条件付きで採用」): ONS の公式 API の対象期間のラベルを使う。
 * API の更新日 = イベントの公表日、数値・単位・出典がそろったときだけ初回値として保存。それ以外・取得失敗は DATA_PENDING。
 * 応答の形は 2026-11-10 に MGSX(/timeseries/mgsx/lms/data)で取った本物と同じ(date は3か月の真ん中の月、label が期間)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ONS_SERIES,
  onsRollingPeriodFromLabel,
  onsRollingValueForPeriod,
  parseOnsRollingValueForRelease,
} from '../../src/ingestion/adapters/gbCaOfficialValues.js';
import { ONS_SCHEDULE, type OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const MGSX = ONS_SERIES.find((s) => s.cdid === 'MGSX')!;
const URL = 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data';
/** 英国の日付の 00:00(11月・12月は GMT)。ONS の releaseDate / updateDate の形。 */
const midnight = (date: string) => `${date}T00:00:00.000Z`;

type Row = [date: string, label: string, value: string, updatedOn: string];
function mgsx(rows: Row[], releasedOn: string, unit: string | null = '%') {
  return {
    description: { cdid: 'MGSX', unit: unit ?? undefined, releaseDate: midnight(releasedOn) },
    months: rows.map(([date, label, value, updatedOn]) => ({ date, label, value, updateDate: midnight(updatedOn) })),
  };
}
const OCT: Row[] = [
  ['2026 JUL', '2026 JUN-AUG', '4.7', '2026-10-20'],
  ['2026 AUG', '2026 JUL-SEP', '4.8', '2026-11-17'],
];

describe('ONS rolling 3-month period label', () => {
  it('reads the label year as the start month year (2024 DEC-FEB = 2024-12..2025-02)', () => {
    expect(onsRollingPeriodFromLabel('2026 JUN-AUG')).toBe('2026-06/2026-08');
    expect(onsRollingPeriodFromLabel('2024 DEC-FEB')).toBe('2024-12/2025-02');
    expect(onsRollingPeriodFromLabel('2024 NOV-JAN')).toBe('2024-11/2025-01');
    expect(onsRollingPeriodFromLabel('2026 JUN-JUL')).toBeNull(); // 3か月でない
    expect(onsRollingPeriodFromLabel('2026 AUG')).toBeNull();
    expect(onsRollingPeriodFromLabel(undefined)).toBeNull();
  });
});

describe('parseOnsRollingValueForRelease', () => {
  it('takes the last row when both the API release date and its update date are the release day', () => {
    expect(parseOnsRollingValueForRelease(MGSX, mgsx(OCT, '2026-11-17'), '2026-11-17')).toEqual({
      indicatorCode: 'GB_UNEMPLOYMENT_RATE',
      seriesId: 'MGSX',
      period: '2026-07/2026-09',
      value: 4.8,
      releasedOn: '2026-11-17',
      sourceUrl: URL,
    });
  });

  it('returns null — and so keeps DATA_PENDING — when any condition fails', () => {
    const bad: [string, unknown][] = [
      ['API still on the previous release', mgsx(OCT.slice(0, 1), '2026-10-20')],
      ['last row updated on another day', mgsx([['2026 AUG', '2026 JUL-SEP', '4.8', '2026-11-16']], '2026-11-17')],
      ['no unit', mgsx(OCT, '2026-11-17', null)],
      ['other unit', mgsx(OCT, '2026-11-17', 'Thousands')],
      ['label not a 3-month period', mgsx([['2026 AUG', '2026 AUG', '4.8', '2026-11-17']], '2026-11-17')],
      ['label does not fit the row month', mgsx([['2026 SEP', '2026 JUL-SEP', '4.8', '2026-11-17']], '2026-11-17')],
      ['blank value', mgsx([['2026 AUG', '2026 JUL-SEP', '', '2026-11-17']], '2026-11-17')],
      ['non-numeric value', mgsx([['2026 AUG', '2026 JUL-SEP', '..', '2026-11-17']], '2026-11-17')],
      [
        'another series',
        { ...mgsx(OCT, '2026-11-17'), description: { cdid: 'D7G7', unit: '%', releaseDate: midnight('2026-11-17') } },
      ],
    ];
    for (const [why, body] of bad) {
      expect(parseOnsRollingValueForRelease(MGSX, body, '2026-11-17'), why).toBeNull();
    }
  });

  it('finds a period by its label for the revision check', () => {
    expect(onsRollingValueForPeriod(MGSX, mgsx(OCT, '2026-11-17'), '2026-06/2026-08')).toBe(4.7);
    expect(onsRollingValueForPeriod(MGSX, mgsx(OCT, '2026-11-17'), '2026-05/2026-07')).toBeNull();
    expect(onsRollingValueForPeriod(MGSX, mgsx(OCT, '2026-11-17', null), '2026-06/2026-08')).toBeNull();
  });
});

class FakeFetcher {
  responses = new Map<string, unknown>();
  failing = new Set<string>();
  getJson(url: string): Promise<unknown> {
    if (this.failing.has(url)) return Promise.reject(new Error('HTTP 503'));
    return Promise.resolve(this.responses.get(url) ?? {});
  }
}

describe('ingestOfficialValues — GB_UNEMPLOYMENT_RATE', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'GB_UNEMPLOYMENT_RATE');
  const table: OfficialScheduleTable = {
    provider: 'ons_release_calendar',
    entries: ONS_SCHEDULE.entries.filter((e) => e.indicatorCode === 'GB_UNEMPLOYMENT_RATE'),
  };
  const AFTER = new Date('2026-11-17T09:00:00Z');
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-gb-u', code: 'GB_UNEMPLOYMENT_RATE', importance: 'MEDIUM', favorable_direction: 'LOWER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-nov',
        indicator_id: 'ind-gb-u',
        provider: 'ons_release_calendar',
        provider_event_id: 'ons_release_calendar:GB_UNEMPLOYMENT_RATE:2026-11',
        importance: 'MEDIUM',
        release_datetime: '2026-11-17T07:00:00.000Z',
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      },
    ];
  });
  const run = (now = AFTER) => {
    const counters = new JobCounters();
    return ingestOfficialValues({ store, fetcher, sources, tables: [table], now: () => now }, counters).then((r) => ({
      ...r,
      counters,
    }));
  };

  it('the schedule table still has no reference period for the labour market (the label is used instead)', () => {
    expect(table.entries.every((e) => e.referencePeriod === undefined)).toBe(true);
    expect(sources[0]!.periodFromOfficialLabel).toBe(true);
  });

  it('publishes the official label period and value as the first value, with unit and source', async () => {
    fetcher.responses.set(URL, mgsx(OCT, '2026-11-17'));
    const r = await run();
    expect(r.published).toBe(1);
    expect(store.snapshots).toEqual([
      expect.objectContaining({
        event_id: 'ev-nov',
        actual: 4.8,
        forecast: null,
        previous: null, // 前回値(4.7)を流用しない
        unit: '%',
        source: 'Office for National Statistics',
        source_url: URL,
        verification_status: 'VERIFIED',
        verification_source: 'MGSX@2026-07/2026-09',
        captured_at: AFTER.toISOString(),
      }),
    ]);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
  });

  it('before the API shows this release (update date mismatch) it stays DATA_PENDING', async () => {
    fetcher.responses.set(URL, mgsx(OCT.slice(0, 1), '2026-10-20'));
    const r = await run();
    expect(store.snapshots).toEqual([]);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    expect(r.counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1);
  });

  it('a fetch failure or a missing unit keeps DATA_PENDING', async () => {
    fetcher.failing.add(URL);
    expect((await run()).counters.skipReasons.FETCH_FAILED).toBe(1);
    fetcher.failing.clear();
    fetcher.responses.set(URL, mgsx(OCT, '2026-11-17', null));
    await run();
    expect(store.snapshots).toEqual([]);
    expect(store.events[0]!.status).toBe('SCHEDULED');
  });

  it('a re-run adds nothing; a later revision of the same period goes to event_revisions', async () => {
    fetcher.responses.set(URL, mgsx(OCT, '2026-11-17'));
    await run();
    expect((await run()).published).toBe(0);
    expect(store.snapshots).toHaveLength(1);
    // 12/15 の公表で JUL-SEP が 4.9 に改定、AUG-OCT が新しい行
    fetcher.responses.set(
      URL,
      mgsx(
        [
          ['2026 AUG', '2026 JUL-SEP', '4.9', '2026-12-15'],
          ['2026 SEP', '2026 AUG-OCT', '5.0', '2026-12-15'],
        ],
        '2026-12-15',
      ),
    );
    const r = await run(new Date('2026-12-15T09:00:00Z'));
    expect(r.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(4.8); // 初回値はそのまま
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: 'ev-nov', field_name: 'ACTUAL', old_value: 4.8, new_value: 4.9 }),
    ]);
  });
});
