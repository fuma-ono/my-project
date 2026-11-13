/**
 * HQ承認 2026-11-13「AU Reference period」: ABS の公表カレンダーの「Reference period」の読み取り規則と、
 * 公表予定の表(ABS_SCHEDULE)の対象月が一致すること。既存のイベントの識別子(provider_event_id)が変わらず、
 * 反映済みの DB に対して重複 INSERT にならないこと。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAbsCalendarReferencePeriods } from '../../src/ingestion/mappings/absCalendarReferencePeriods.js';
import { ABS_SCHEDULE, GB_AU_CA_SCHEDULES, absCalendarMonthUrl } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import {
  ingestOfficialScheduleTables,
  officialScheduleProviderEventId,
} from '../../src/ingestion/pipelines/officialScheduleTable.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'abs-release-calendar-2026-11-13.json'), 'utf8'),
) as { pages: Record<string, string> };
const NOW = new Date('2026-11-10T06:00:00Z');

const parsedAll = Object.values(fixture.pages).flatMap(parseAbsCalendarReferencePeriods);

describe('parseAbsCalendarReferencePeriods (the rule that reads "Reference period")', () => {
  it('restores the data month of all 12 releases (the 6 already registered + the 6 added), nothing else', () => {
    expect(parsedAll.map((p) => `${p.indicatorCode} ${p.releaseDate} ${p.referencePeriod}`)).toEqual([
      'AU_UNEMPLOYMENT_RATE 2026-11-19 2026-10',
      'AU_CPI 2026-11-25 2026-10',
      'AU_UNEMPLOYMENT_RATE 2026-12-17 2026-11',
      'AU_CPI 2027-01-06 2026-11',
      'AU_UNEMPLOYMENT_RATE 2027-01-21 2026-12',
      'AU_CPI 2027-01-27 2026-12',
      'AU_UNEMPLOYMENT_RATE 2027-02-18 2027-01',
      'AU_CPI 2027-02-24 2027-01',
      'AU_CPI 2027-03-24 2027-02',
      'AU_UNEMPLOYMENT_RATE 2027-03-25 2027-02',
      'AU_UNEMPLOYMENT_RATE 2027-04-15 2027-03',
      'AU_CPI 2027-04-28 2027-03',
    ]);
  });

  it("takes the period that follows the release title, not the one that precedes it (the previous release's tail)", () => {
    const text =
      'Reference period June 2027 View current release Wednesday 28 April 2027 11:30am AEST Consumer Price Index, Australia ' +
      'The Consumer Price Index (CPI) measures price inflation. Reference period March 2027 View current release';
    expect(parseAbsCalendarReferencePeriods(text)).toEqual([
      { indicatorCode: 'AU_CPI', releaseDate: '2027-04-28', referencePeriod: '2027-03' },
    ]);
  });

  it('does not read across "View current release" (no borrowed period) and ignores quarter periods', () => {
    const noOwn =
      'Thursday 18 February 2027 11:30am AEDT Labour Force, Australia text View current release ' +
      'Friday 19 February 2027 11:30am AEDT Other release Reference period January 2027 View current release';
    expect(parseAbsCalendarReferencePeriods(noOwn)).toEqual([]);
    const quarter =
      'Thursday 18 February 2027 11:30am AEDT Labour Force, Australia text Reference period December Quarter 2026 View current release';
    expect(parseAbsCalendarReferencePeriods(quarter)).toEqual([]);
  });
});

describe('ABS_SCHEDULE agrees with the official calendar', () => {
  it("every entry's referencePeriod equals the one read from the calendar for the same indicator and release date", () => {
    expect(ABS_SCHEDULE.entries).toHaveLength(12);
    for (const e of ABS_SCHEDULE.entries) {
      const found = parsedAll.filter((p) => p.indicatorCode === e.indicatorCode && p.releaseDate === e.releaseDate);
      expect(found, `${e.indicatorCode} ${e.releaseDate}`).toHaveLength(1);
      expect(e.referencePeriod).toBe(found[0]!.referencePeriod);
    }
  });

  it('the added entries cite the calendar month page and carry the new check date; the older ones keep theirs', () => {
    const added = ABS_SCHEDULE.entries.filter((e) => e.releaseDate >= '2027-02');
    expect(added).toHaveLength(6);
    for (const e of added) {
      expect(e.sources).toContain(absCalendarMonthUrl(e.releaseDate));
      expect(e.checkedAt).toBe('2026-11-13');
    }
    expect(absCalendarMonthUrl('2027-02-24')).toBe(
      'https://www.abs.gov.au/release-calendar/future-releases/202702/all',
    );
    for (const e of ABS_SCHEDULE.entries.filter((x) => x.releaseDate < '2027-02'))
      expect(e.checkedAt).toBe('2026-11-10');
  });
});

describe('provider_event_id and the rows already applied to DEV', () => {
  it('the 12 provider_event_ids are the release-date keys applied to DEV on 2026-11-13 (unchanged)', () => {
    const ids = ABS_SCHEDULE.entries.map((e) => officialScheduleProviderEventId(ABS_SCHEDULE.provider, e));
    expect(ids).toEqual([
      'abs_release_calendar:AU_CPI:2026-11-25',
      'abs_release_calendar:AU_CPI:2027-01-06',
      'abs_release_calendar:AU_CPI:2027-01-27',
      'abs_release_calendar:AU_CPI:2027-02-24',
      'abs_release_calendar:AU_CPI:2027-03-24',
      'abs_release_calendar:AU_CPI:2027-04-28',
      'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2026-11-19',
      'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2026-12-17',
      'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2027-01-21',
      'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2027-02-18',
      'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2027-03-25',
      'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2027-04-15',
    ]);
  });

  it('a DB holding the rows written from the old table (no periods for 2027-02..04): a dry run plans no INSERT, all UNCHANGED', async () => {
    const store = new MemoryIngestionStore();
    store.indicators = ['AU_CPI', 'AU_UNEMPLOYMENT_RATE'].map((code, i) => ({
      id: `ind-${i}`,
      code,
      importance: 'HIGH',
      favorable_direction: 'HIGHER_IS_POSITIVE',
    }));
    const applied = {
      ...ABS_SCHEDULE,
      entries: ABS_SCHEDULE.entries.map((e) => {
        if (e.releaseDate < '2027-02') return e;
        const { referencePeriod: _unused, ...rest } = e;
        return rest;
      }),
    };
    await ingestOfficialScheduleTables({ store, tables: [applied], now: () => NOW }, new JobCounters());
    expect(store.events).toHaveLength(12);
    const before = JSON.stringify(store.events);
    const dry = await ingestOfficialScheduleTables(
      { store, tables: [ABS_SCHEDULE], now: () => NOW, dryRun: true },
      new JobCounters(),
    );
    expect(dry.plan).toHaveLength(12);
    expect(dry.plan.every((p) => p.action === 'UNCHANGED')).toBe(true);
    expect(dry.inserted).toBe(0);
    // 実際に流しても、行は増えず、中身も変わらない(対象月は DB の events には入らない)
    await ingestOfficialScheduleTables({ store, tables: [ABS_SCHEDULE], now: () => NOW }, new JobCounters());
    expect(store.events).toHaveLength(12);
    expect(JSON.stringify(store.events)).toBe(before);
  });

  it('the three tables together still hold 27 entries (GB/AU/CA)', () => {
    expect(GB_AU_CA_SCHEDULES.flatMap((t) => t.entries)).toHaveLength(27);
  });
});
