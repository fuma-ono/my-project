/**
 * FOMC の政策決定(誘導目標レンジ)の取り込み(HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A)。
 * NY連銀の応答は偽物(下の record())。2026-09 の値は、2026-11-05 に実際の API で確かめた値と同じ形。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { NY_FED_SOURCE } from '../../src/domain/attribution.js';
import { nyFedEffrSearchUrl, parseNyFedTargetRanges } from '../../src/ingestion/adapters/nyFedRates.js';
import { ingestFomcPolicyRates } from '../../src/ingestion/pipelines/fomcPolicyRates.js';
import { FOMC_SCHEDULE_PROVIDER } from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

function record(effectiveDate: unknown, from: unknown, to: unknown, extra: Record<string, unknown> = {}) {
  return { effectiveDate, type: 'EFFR', percentRate: 3.88, targetRateFrom: from, targetRateTo: to, ...extra };
}

/** 2026-09-15〜16 の会合の前後(9/16 は旧レンジ、9/17 から新レンジ)と 10/27〜28(据え置き)。 */
const SEPT_OCT = {
  refRates: [
    record('2026-09-15', 3.5, 3.75),
    record('2026-09-16', 3.5, 3.75),
    record('2026-09-17', 3.75, 4.0),
    record('2026-09-18', 3.75, 4.0),
    record('2026-10-28', 3.75, 4.0),
    record('2026-10-29', 3.75, 4.0),
    record('2026-10-30', 3.75, 4.0),
  ],
};

describe('parseNyFedTargetRanges', () => {
  it('keeps targetRateFrom / targetRateTo as two separate values per effectiveDate, and never the EFFR itself', () => {
    const { ranges, skipped } = parseNyFedTargetRanges({
      refRates: [record('2026-09-17', 3.75, 4.0, { percentRate: 3.88 }), record('2026-09-16', 3.5, 3.75)],
    });
    expect(ranges).toEqual([
      { effectiveDate: '2026-09-16', lower: 3.5, upper: 3.75 },
      { effectiveDate: '2026-09-17', lower: 3.75, upper: 4.0 },
    ]);
    expect(Object.keys(ranges[0]!)).not.toContain('percentRate');
    expect(skipped).toEqual([]);
  });

  it('skips missing or invalid values and bad dates instead of filling them in', () => {
    const { ranges, skipped } = parseNyFedTargetRanges({
      refRates: [
        record('2026-09-17', null, 4.0),
        record('2026-09-18', 3.75, undefined),
        record('2026-09-21', '3.75', '4.00'),
        record('2026-09-22', 4.0, 3.75),
        record('2026-09-23', -0.25, 0),
        record('2026-09-24', 3.75, 30),
        record('2026-02-30', 3.75, 4.0),
        record(undefined, 3.75, 4.0),
        record('2026-09-25', 3.75, 4.0),
        { effectiveDate: '2026-09-25', type: 'OBFR', targetRateFrom: 1, targetRateTo: 2 }, // EFFR 以外は読まない
      ],
    });
    expect(ranges).toEqual([{ effectiveDate: '2026-09-25', lower: 3.75, upper: 4.0 }]);
    expect(skipped).toEqual([
      { effectiveDate: '2026-09-17', reason: 'RANGE_MISSING' },
      { effectiveDate: '2026-09-18', reason: 'RANGE_MISSING' },
      { effectiveDate: '2026-09-21', reason: 'RANGE_MISSING' },
      { effectiveDate: '2026-09-22', reason: 'RANGE_INVALID' },
      { effectiveDate: '2026-09-23', reason: 'RANGE_INVALID' },
      { effectiveDate: '2026-09-24', reason: 'RANGE_INVALID' },
      { effectiveDate: null, reason: 'DATE_INVALID' },
      { effectiveDate: null, reason: 'DATE_INVALID' },
    ]);
  });

  it('drops a date that appears twice with different ranges', () => {
    const { ranges, skipped } = parseNyFedTargetRanges({
      refRates: [record('2026-09-17', 3.75, 4.0), record('2026-09-17', 3.5, 3.75), record('2026-09-18', 3.75, 4.0)],
    });
    expect(ranges.map((r) => r.effectiveDate)).toEqual(['2026-09-18']);
    expect(skipped).toEqual([{ effectiveDate: '2026-09-17', reason: 'DUPLICATE_DATE' }]);
  });

  it('rejects a response without refRates (an unexpected shape)', () => {
    expect(() => parseNyFedTargetRanges({ error: 'x' })).toThrow();
  });
});

describe('ingestFomcPolicyRates', () => {
  let store: MemoryIngestionStore;
  const NOW = () => new Date('2026-11-05T15:00:00Z');

  function meeting(id: string, meetingEnd: string, releaseIso: string, status = 'SCHEDULED') {
    return {
      id,
      indicator_id: 'ind-fomc',
      provider: FOMC_SCHEDULE_PROVIDER,
      provider_event_id: `fomc_schedule:${meetingEnd}`,
      release_datetime: releaseIso,
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status,
      data_status: 'PENDING',
      is_provisional: false,
    };
  }

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [{ id: 'ind-fomc', code: 'US_FOMC', importance: 'HIGH', favorable_direction: 'NEUTRAL' }];
    store.events = [
      meeting('ev-sep', '2026-09-16', '2026-09-16T18:00:00.000Z'),
      meeting('ev-oct', '2026-10-28', '2026-10-28T18:00:00.000Z'),
      meeting('ev-dec', '2026-12-09', '2026-12-09T19:00:00.000Z'), // まだ先
    ] as typeof store.events;
  });

  const run = (body: unknown, now = NOW) => {
    const counters = new JobCounters();
    const calls: [string, string][] = [];
    const fetchRanges = (start: string, end: string) => {
      calls.push([start, end]);
      return Promise.resolve(parseNyFedTargetRanges(body));
    };
    return ingestFomcPolicyRates({ store, fetchRanges, now }, counters).then((result) => ({ result, counters, calls }));
  };

  it('records the range in effect on the first day after each announcement, lower and upper apart', async () => {
    const { result, counters, calls } = await run(SEPT_OCT);
    expect(calls).toEqual([['2026-09-17', '2026-11-05']]);
    expect(store.fomcPolicyDecisions).toEqual([
      {
        event_id: 'ev-sep',
        target_range_lower: 3.75, // 9/16 の旧レンジ(3.50〜3.75)ではなく、9/17 から有効な新レンジ
        target_range_upper: 4.0,
        announced_at: '2026-09-16T18:00:00.000Z',
        effective_date: '2026-09-17',
        source: NY_FED_SOURCE,
        source_url: nyFedEffrSearchUrl('2026-09-17', '2026-11-05'),
        fetched_at: '2026-11-05T15:00:00.000Z',
      },
      expect.objectContaining({
        event_id: 'ev-oct',
        target_range_lower: 3.75,
        target_range_upper: 4.0,
        effective_date: '2026-10-29',
      }),
    ]);
    expect(result).toMatchObject({ awaiting: [], unmatched: [], alreadyRecorded: 0 });
    expect(counters.details).toMatchObject({ source_status: 'OK', unreadable_records: 0 });
    expect(counters.errorMessages).toEqual([]);
  });

  it('does not record a meeting twice: a rerun only compares the records with the source and writes nothing', async () => {
    await run(SEPT_OCT);
    const again = await run(SEPT_OCT);
    // 記録済みの会合を NY連銀の今の値と突き合わせるため、同じ期間を1回だけ取る(HQ指示 2026-11-06「NY連銀の規約対応」)
    expect(again.calls).toEqual([['2026-09-17', '2026-11-05']]);
    expect(again.result).toMatchObject({ recorded: [], alreadyRecorded: 2, conflicts: [], unverified: [] });
    expect(again.counters.details).toMatchObject({ source_status: 'OK', conflicts_checked: true, verified: 2 });
    expect(store.fomcPolicyDecisions).toHaveLength(2);
  });

  it('keeps a meeting waiting (writes nothing) while the day after the announcement is not published yet', async () => {
    const { result, counters } = await run(
      { refRates: [...SEPT_OCT.refRates.slice(0, 5)] }, // 10/28 まで
      () => new Date('2026-10-29T12:00:00Z'), // 10/29 の値は 10/30 の朝に出る
    );
    expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-sep']);
    expect(result.awaiting).toEqual(['fomc_schedule:2026-10-28']);
    expect(counters.skipReasons).toEqual({ not_published_yet: 1 });
  });

  it('writes nothing and records an error when the API cannot be reached (no guessed value)', async () => {
    const counters = new JobCounters();
    const fetchRanges = () => Promise.reject(new Error('HTTP 503 from markets.newyorkfed.org'));
    const result = await ingestFomcPolicyRates({ store, fetchRanges, now: NOW }, counters);
    expect(store.fomcPolicyDecisions).toEqual([]);
    expect(result.awaiting).toEqual(['fomc_schedule:2026-09-16', 'fomc_schedule:2026-10-28']);
    expect(counters.errorMessages).toEqual(['NY Fed EFFR: HTTP 503 from markets.newyorkfed.org']);
    expect(counters.details).toMatchObject({ source_status: 'UNAVAILABLE', conflicts_checked: false, conflicts: [] });
  });

  it('a broken response is treated like a failed fetch', async () => {
    const counters = new JobCounters();
    const fetchRanges = () => Promise.resolve(parseNyFedTargetRanges({ unexpected: true }));
    await ingestFomcPolicyRates({ store, fetchRanges, now: NOW }, counters);
    expect(store.fomcPolicyDecisions).toEqual([]);
    expect(counters.details).toMatchObject({ source_status: 'UNAVAILABLE' });
  });

  it('does not skip over an unreadable first day to a later day', async () => {
    const { result } = await run({
      refRates: [record('2026-09-17', null, null), record('2026-09-18', 3.75, 4.0), ...SEPT_OCT.refRates.slice(4)],
    });
    expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-oct']);
    expect(result.unmatched).toEqual([
      { provider_event_id: 'fomc_schedule:2026-09-16', reason: 'FIRST_RECORD_UNREADABLE' },
    ]);
  });

  it('does not tie a record that is too far from the announcement, or after the next meeting', async () => {
    const { result } = await run({ refRates: [record('2026-09-28', 3.75, 4.0), record('2026-10-29', 3.75, 4.0)] });
    // 9/16 の会合: 最初の記録が 12日後 → 使わない。10/28 の会合: 10/29 → 記録する
    expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-oct']);
    expect(result.unmatched).toEqual([
      { provider_event_id: 'fomc_schedule:2026-09-16', reason: 'NO_RECORD_IN_WINDOW' },
    ]);

    store.fomcPolicyDecisions = [];
    store.events = store.events.filter((e) => e.id !== 'ev-oct');
    store.events.push(meeting('ev-sep2', '2026-09-18', '2026-09-18T18:00:00.000Z') as (typeof store.events)[number]);
    const next = await run({ refRates: [record('2026-09-21', 3.75, 4.0)] });
    // 9/16 の会合の最初の記録(9/21)は、次の会合(9/18)の後 → 使わない
    expect(next.result.unmatched).toContainEqual({
      provider_event_id: 'fomc_schedule:2026-09-16',
      reason: 'NO_RECORD_IN_WINDOW',
    });
  });

  it('ignores cancelled and future meetings, and other indicators', async () => {
    store.events.push(
      meeting('ev-cancel', '2026-07-29', '2026-07-29T18:00:00.000Z', 'CANCELLED') as (typeof store.events)[number],
      {
        ...meeting('ev-other', '2026-09-30', '2026-09-30T18:00:00.000Z'),
        indicator_id: 'ind-other',
      } as (typeof store.events)[number],
    );
    await run(SEPT_OCT);
    expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-sep', 'ev-oct']);
  });

  it('does not change economic_events or event_snapshots', async () => {
    const before = JSON.stringify(store.events);
    await run(SEPT_OCT);
    expect(JSON.stringify(store.events)).toBe(before);
    expect(store.snapshots).toEqual([]);
  });

  it('reports an error and writes nothing without a US_FOMC indicator row', async () => {
    store.indicators = [];
    const { counters } = await run(SEPT_OCT);
    expect(counters.errorMessages).toEqual(['economic_indicators has no US_FOMC row']);
    expect(store.fomcPolicyDecisions).toEqual([]);
  });

  it('an insert error (e.g. the unique key) is recorded and the other meetings still go in', async () => {
    const insert = store.insertFomcPolicyDecision.bind(store);
    store.insertFomcPolicyDecision = (row) =>
      row.event_id === 'ev-sep'
        ? Promise.reject(new Error('duplicate key fomc_policy_decisions (event_id)'))
        : insert(row);
    const { counters } = await run(SEPT_OCT);
    expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-oct']);
    expect(counters.errorMessages).toEqual([
      'fomc_schedule:2026-09-16: duplicate key fomc_policy_decisions (event_id)',
    ]);
  });
  // HQ指示(2026-11-06「NY連銀の規約対応」修正案2): 記録済みの会合を NY連銀の今の値と突き合わせ、違いは conflicts に記録する
  // だけ(記録した値・会合への結びつけは変えない)。
  describe('detecting corrections in the source', () => {
    const decisionsSnapshot = () => JSON.parse(JSON.stringify(store.fomcPolicyDecisions)) as unknown;

    it('reports no conflict when the records and the source agree', async () => {
      await run(SEPT_OCT);
      const { result, counters } = await run(SEPT_OCT);
      expect(result.conflicts).toEqual([]);
      expect(counters.details).toMatchObject({ conflicts: [], conflicts_checked: true });
    });

    it('reports VALUE_DIFFERS when the source corrected the range of the recorded day, and keeps the record', async () => {
      await run(SEPT_OCT);
      const before = decisionsSnapshot();
      const corrected = {
        refRates: SEPT_OCT.refRates.map((r) =>
          r.effectiveDate === '2026-09-17' ? record('2026-09-17', 3.5, 3.75) : r,
        ),
      };
      const { result, counters } = await run(corrected);
      expect(result.conflicts).toEqual([
        {
          provider_event_id: 'fomc_schedule:2026-09-16',
          differences: ['VALUE_DIFFERS'],
          stored: { lower: 3.75, upper: 4.0, effective_date: '2026-09-17' },
          source: { lower: 3.5, upper: 3.75, effective_date: '2026-09-17' },
          source_url: nyFedEffrSearchUrl('2026-09-17', '2026-11-05'),
        },
      ]);
      expect(counters.details.conflicts).toEqual(result.conflicts);
      expect(counters.errorMessages).toEqual([]); // 取得の失敗ではない
      expect(decisionsSnapshot()).toEqual(before); // 記録は変えない
    });

    it('reports EFFECTIVE_DATE_DIFFERS when the same rule now picks another day, and keeps the meeting link', async () => {
      await run(SEPT_OCT);
      const before = decisionsSnapshot();
      // 10/28 の会合: 記録は 10/29。NY連銀に 10/28 より後の、もっと早い記録は無いので、10/29 を消して 10/30 だけにする
      const shifted = { refRates: SEPT_OCT.refRates.filter((r) => r.effectiveDate !== '2026-10-29') };
      const { result } = await run(shifted);
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          provider_event_id: 'fomc_schedule:2026-10-28',
          differences: ['EFFECTIVE_DATE_DIFFERS'],
          stored: { lower: 3.75, upper: 4.0, effective_date: '2026-10-29' },
          source: { lower: 3.75, upper: 4.0, effective_date: '2026-10-30' },
        }),
      ]);
      // 記録した日の値が API に無いので、値は比べられない(conflicts とは別に記録)
      expect(result.unverified).toEqual([
        { provider_event_id: 'fomc_schedule:2026-10-28', reason: 'MISSING_IN_SOURCE' },
      ]);
      expect(decisionsSnapshot()).toEqual(before);
    });

    it('records the same difference once per run, and the same once again on a rerun (not more)', async () => {
      await run(SEPT_OCT);
      const corrected = {
        refRates: SEPT_OCT.refRates.map((r) =>
          r.effectiveDate === '2026-09-17' ? record('2026-09-17', 3.5, 3.75) : r,
        ),
      };
      const first = await run(corrected);
      const second = await run(corrected);
      const third = await run(corrected);
      for (const { result, counters } of [first, second, third]) {
        expect(result.conflicts).toHaveLength(1);
        expect(counters.details.conflicts).toHaveLength(1);
      }
      expect(store.fomcPolicyDecisions).toHaveLength(2);
    });

    it('still records a new meeting normally while comparing the recorded ones', async () => {
      // 9/16 の会合だけ記録済み(10/28 はまだ)
      await run({ refRates: SEPT_OCT.refRates.slice(0, 4) }, () => new Date('2026-10-01T15:00:00Z'));
      expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-sep']);
      const { result, calls } = await run(SEPT_OCT);
      expect(calls).toEqual([['2026-09-17', '2026-11-05']]);
      expect(result.recorded.map((r) => r.provider_event_id)).toEqual(['fomc_schedule:2026-10-28']);
      expect(result.conflicts).toEqual([]);
      expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-sep', 'ev-oct']);
    });

    it('does not report conflicts when the source cannot be fetched (that is a fetch error, not a correction)', async () => {
      await run(SEPT_OCT);
      const before = decisionsSnapshot();
      const counters = new JobCounters();
      const fetchRanges = () => Promise.reject(new Error('HTTP 503 from markets.newyorkfed.org'));
      const result = await ingestFomcPolicyRates({ store, fetchRanges, now: NOW }, counters);
      expect(result.conflicts).toEqual([]);
      expect(counters.details).toMatchObject({ source_status: 'UNAVAILABLE', conflicts_checked: false, conflicts: [] });
      expect(counters.errorMessages).toEqual(['NY Fed EFFR: HTTP 503 from markets.newyorkfed.org']);
      expect(decisionsSnapshot()).toEqual(before);
    });

    it('does not compare records older than the lookback (they are not in the fetched period)', async () => {
      await run(SEPT_OCT);
      const later = () => new Date('2027-05-01T15:00:00Z'); // 9/16 と 10/28 の発表から 180 日より後
      const { result, calls, counters } = await run(SEPT_OCT, later);
      // 取得の期間は、まだ記録の無い 12/9 の会合の翌日から(記録済みの 9/16・10/28 は入れない)
      expect(calls).toEqual([['2026-12-10', '2027-05-01']]);
      expect(result).toMatchObject({ alreadyRecorded: 2, conflicts: [], unverified: [] });
      expect(counters.details).toMatchObject({ verified: 0 });
    });
  });
});
