/**
 * FRB の読めない項目の記録(HQ判断 2026-10-29 R-1・R-2)。
 * - R-1: 題名(200文字まで)・理由・現地の日付だけを、最大20件記録する。期間の外は記録しない
 * - R-2: 取り込みの期間(直近14日)より古い項目で題名が読めないものは、題名の解析の前に期間の外として数える
 */
import { describe, expect, it } from 'vitest';
import {
  FRB_SKIP_LOG_LIMIT,
  FRB_SKIP_TITLE_MAX,
  frbSkipLogEntries,
  parseFrbCalendar,
} from '../../src/ingestion/adapters/frbCalendar.js';

const NOW = new Date('2026-10-29T06:00:00Z');
const event = (
  title: string,
  month: string,
  days: string,
  time = '10:00 a.m.',
  extra: Record<string, string> = {},
) => ({
  title,
  description: 'Economic Outlook',
  time,
  month,
  days,
  type: 'Speeches',
  ...extra,
});

describe('FRB calendar: unparseable items (R-1・R-2)', () => {
  it('R-2: an old item with an unparseable title is OUTSIDE_WINDOW, not TITLE_UNPARSEABLE (the 2018 Quarles item)', () => {
    const { skipped } = parseFrbCalendar(
      { events: [event('Vice Chairman Randal K. Quarles', '2018-10', '18', '12:15 p.m.')] },
      { now: NOW },
    );
    expect(skipped).toEqual([
      { title: 'Vice Chairman Randal K. Quarles', reason: 'OUTSIDE_WINDOW', date: '2018-10-18' },
    ]);
    expect(frbSkipLogEntries(skipped)).toEqual([]); // 期間の外は記録しない
  });

  it('R-2: a recent item with an unparseable title is still TITLE_UNPARSEABLE (and logged)', () => {
    const { skipped } = parseFrbCalendar(
      { events: [event('Governor Christopher J. Waller', '2026-10', '28')] },
      { now: NOW },
    );
    expect(skipped).toEqual([
      { title: 'Governor Christopher J. Waller', reason: 'TITLE_UNPARSEABLE', date: '2026-10-28' },
    ]);
    expect(frbSkipLogEntries(skipped)).toEqual(skipped);
  });

  it('R-2: the window edge is on the safe side (an item whose day may still be in the window stays TITLE_UNPARSEABLE)', () => {
    // 10/15(現地)の終わり = 10/16 05:00Z。now − 14日 = 10/15 06:00Z より後なので、期間の外とは言い切れない
    const { skipped } = parseFrbCalendar(
      { events: [event('Governor Michelle W. Bowman', '2026-10', '15')] },
      { now: NOW },
    );
    expect(skipped[0]!.reason).toBe('TITLE_UNPARSEABLE');
    const { skipped: older } = parseFrbCalendar(
      { events: [event('Governor Michelle W. Bowman', '2026-10', '13')] },
      { now: NOW },
    );
    expect(older[0]!.reason).toBe('OUTSIDE_WINDOW');
  });

  it('R-2: old items with a readable title are still returned (the pipeline counts them OUTSIDE_WINDOW — unchanged)', () => {
    const { speeches, skipped } = parseFrbCalendar(
      { events: [event('Speech - Governor Christopher J. Waller', '2018-10', '18')] },
      { now: NOW },
    );
    expect(speeches).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('R-1: only title (max 200 chars), reason and date are kept — no description or other fields', () => {
    const long = `Governor ${'X'.repeat(300)}`;
    const { skipped } = parseFrbCalendar(
      { events: [event(long, '2026-10', '28', '10:00 a.m.', { location: 'Washington, D.C.' })] },
      { now: NOW },
    );
    expect(skipped[0]!.title).toHaveLength(FRB_SKIP_TITLE_MAX);
    expect(Object.keys(skipped[0]!).sort()).toEqual(['date', 'reason', 'title']);
  });

  it('R-1: other skip reasons carry the date too, and the log is capped at 20 entries', () => {
    const { skipped } = parseFrbCalendar(
      {
        events: [
          event('Speech - Governor Christopher J. Waller', '2026-10', '28', 'TBA'),
          ...Array.from({ length: 25 }, (_, i) => event(`Governor Number ${i}`, '2026-10', '28')),
        ],
      },
      { now: NOW },
    );
    expect(skipped[0]).toEqual({
      title: 'Speech - Governor Christopher J. Waller',
      reason: 'TIME_MISSING',
      date: '2026-10-28',
    });
    expect(skipped).toHaveLength(26);
    expect(frbSkipLogEntries(skipped)).toHaveLength(FRB_SKIP_LOG_LIMIT);
    expect(FRB_SKIP_LOG_LIMIT).toBe(20);
  });

  it('a multi-day item has no date (it cannot be placed on one day) and keeps its reason', () => {
    const { skipped } = parseFrbCalendar(
      { events: [event('Testimony -- Chair Kevin Warsh', '2026-10', '28-29', '10:00 a.m.', { type: 'Testimony' })] },
      { now: NOW },
    );
    expect(skipped).toEqual([{ title: 'Testimony -- Chair Kevin Warsh', reason: 'DATE_NOT_SINGLE_DAY' }]);
  });
});
