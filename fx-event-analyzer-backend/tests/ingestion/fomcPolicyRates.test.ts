/**
 * FOMC の政策決定(誘導目標レンジ)の取り込み(HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A)。
 * NY連銀の応答は偽物(下の record())。2026-09 の値は、2026-11-05 に実際の API で確かめた値と同じ形。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { NY_FED_SOURCE } from '../../src/domain/attribution.js';
import { nyFedEffrSearchUrl, parseNyFedTargetRanges } from '../../src/ingestion/adapters/nyFedRates.js';
import {
  conflictKey,
  FOMC_POLICY_RATE_JOB,
  FOMC_POLICY_RATE_LOG_PROVIDER,
  ingestFomcPolicyRates,
} from '../../src/ingestion/pipelines/fomcPolicyRates.js';
import { FOMC_SCHEDULE_PROVIDER } from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters, runIngestionJob } from '../../src/ingestion/runner.js';
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

  /** 本物のジョブと同じく runIngestionJob を通す(1回の実行で ingestion_logs に1行。前回の状態はそこから読む)。 */
  const run = async (body: unknown, now = NOW) => {
    const calls: [string, string][] = [];
    const fetchRanges = (start: string, end: string) => {
      calls.push([start, end]);
      return body instanceof Error ? Promise.reject(body) : Promise.resolve(parseNyFedTargetRanges(body));
    };
    let result: Awaited<ReturnType<typeof ingestFomcPolicyRates>> | undefined;
    const job = await runIngestionJob(
      store,
      { provider: FOMC_POLICY_RATE_LOG_PROVIDER, dataType: 'ECONOMIC_EVENT', job: FOMC_POLICY_RATE_JOB },
      async (counters) => {
        result = await ingestFomcPolicyRates({ store, fetchRanges, now }, counters);
      },
      now,
    );
    return { result: result!, counters: job.counters, calls };
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
  // HQ指示(2026-11-06「NY連銀の規約対応」修正案2・「NY Fed 食い違いログの重複防止」): 記録済みの会合を NY連銀の今の値と
  // 突き合わせる。違いは記録するだけ(記録した値・会合への結びつけは変えない)。実行をまたいで、新しく出た・解消した
  // 食い違いだけを詳細つきで出し、続いているものは件数だけにする(前回の状態はこのジョブのログの open_conflicts)。
  describe('detecting corrections in the source', () => {
    const decisionsSnapshot = () => JSON.parse(JSON.stringify(store.fomcPolicyDecisions)) as unknown;
    /** 9/17 の値を NY連銀が訂正した(3.75〜4.00 → 3.50〜3.75)。 */
    const SEP_CORRECTED = {
      refRates: SEPT_OCT.refRates.map((r) => (r.effectiveDate === '2026-09-17' ? record('2026-09-17', 3.5, 3.75) : r)),
    };
    /** 10/29 の記録が消え、10/28 の会合に同じ決まりを当てはめると 10/30 になる。 */
    const OCT_SHIFTED = { refRates: SEPT_OCT.refRates.filter((r) => r.effectiveDate !== '2026-10-29') };
    const SEP_KEY = conflictKey(
      'fomc_schedule:2026-09-16',
      'VALUE_DIFFERS',
      { lower: 3.75, upper: 4, effective_date: '2026-09-17' },
      { lower: 3.5, upper: 3.75, effective_date: '2026-09-17' },
    );
    const OCT_KEY = conflictKey(
      'fomc_schedule:2026-10-28',
      'EFFECTIVE_DATE_DIFFERS',
      { lower: 3.75, upper: 4, effective_date: '2026-10-29' },
      { lower: 3.75, upper: 4, effective_date: '2026-10-30' },
    );
    const policyLogs = () => store.logs.filter((log) => log.job === FOMC_POLICY_RATE_JOB);

    it('reports no conflict when the records and the source agree', async () => {
      await run(SEPT_OCT);
      const { result, counters } = await run(SEPT_OCT);
      expect(result.conflicts).toEqual([]);
      expect(counters.details).toMatchObject({
        conflicts: [],
        continuing_conflicts: 0,
        resolved_conflicts: [],
        open_conflicts: [],
        conflicts_checked: true,
      });
    });

    it('reports VALUE_DIFFERS once with the details, and keeps the record', async () => {
      await run(SEPT_OCT);
      const before = decisionsSnapshot();
      const { result, counters } = await run(SEP_CORRECTED);
      expect(result.conflicts).toEqual([
        {
          key: SEP_KEY,
          provider_event_id: 'fomc_schedule:2026-09-16',
          difference: 'VALUE_DIFFERS',
          stored: { lower: 3.75, upper: 4.0, effective_date: '2026-09-17' },
          source: { lower: 3.5, upper: 3.75, effective_date: '2026-09-17' },
          source_url: nyFedEffrSearchUrl('2026-09-17', '2026-11-05'),
        },
      ]);
      expect(counters.details.open_conflicts).toEqual([SEP_KEY]);
      expect(counters.errorMessages).toEqual([]); // 取得の失敗ではない
      expect(decisionsSnapshot()).toEqual(before); // 記録は変えない
    });

    it('reports EFFECTIVE_DATE_DIFFERS without changing the meeting link', async () => {
      await run(SEPT_OCT);
      const before = decisionsSnapshot();
      const { result } = await run(OCT_SHIFTED);
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          key: OCT_KEY,
          difference: 'EFFECTIVE_DATE_DIFFERS',
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

    it('records a continuing conflict in detail only once over 4 runs, one log row per run', async () => {
      await run(SEPT_OCT);
      const before = decisionsSnapshot();
      const runs = [];
      for (let i = 0; i < 4; i += 1) runs.push(await run(SEP_CORRECTED));
      expect(runs.map((r) => r.result.conflicts.map((c) => c.key))).toEqual([[SEP_KEY], [], [], []]);
      expect(runs.map((r) => r.counters.details.continuing_conflicts)).toEqual([0, 1, 1, 1]);
      expect(runs.map((r) => r.counters.details.open_conflicts)).toEqual([[SEP_KEY], [SEP_KEY], [SEP_KEY], [SEP_KEY]]);
      // 詳細(stored・source)が出るのは、全部のログを通して1回だけ
      const detailed = policyLogs().flatMap((log) => log.details.conflicts as unknown[]);
      expect(detailed).toHaveLength(1);
      expect(policyLogs()).toHaveLength(5); // 実行1回 = ログ1行のまま
      expect(decisionsSnapshot()).toEqual(before);
    });

    it('records the resolution once, and a recurrence as a new occurrence', async () => {
      await run(SEPT_OCT);
      await run(SEP_CORRECTED);
      await run(SEP_CORRECTED);
      const resolved = await run(SEPT_OCT); // NY連銀の値が元に戻った
      expect(resolved.result.resolvedConflicts).toEqual([
        { key: SEP_KEY, provider_event_id: 'fomc_schedule:2026-09-16', difference: 'VALUE_DIFFERS' },
      ]);
      expect(resolved.counters.details.open_conflicts).toEqual([]);
      const after = await run(SEPT_OCT);
      expect(after.result.resolvedConflicts).toEqual([]); // 解消の記録は1回だけ
      const again = await run(SEP_CORRECTED); // 再発
      expect(again.result.conflicts.map((c) => c.key)).toEqual([SEP_KEY]);
      expect(again.counters.details.continuing_conflicts).toBe(0);
    });

    it('keeps the open conflicts through a failed fetch (not resolved), and does not report them again afterwards', async () => {
      await run(SEPT_OCT);
      await run(SEP_CORRECTED);
      const before = decisionsSnapshot();
      const failed = await run(new Error('HTTP 503 from markets.newyorkfed.org'));
      expect(failed.result).toMatchObject({ conflicts: [], resolvedConflicts: [], openConflicts: null });
      expect(failed.counters.details).toMatchObject({
        source_status: 'UNAVAILABLE',
        conflicts_checked: false,
        conflicts: [],
      });
      expect(failed.counters.details.open_conflicts).toBeUndefined(); // 前回の状態にならない
      expect(failed.counters.errorMessages).toEqual(['NY Fed EFFR: HTTP 503 from markets.newyorkfed.org']);
      const next = await run(SEP_CORRECTED);
      expect(next.result.conflicts).toEqual([]); // 失敗の前から続いている(新しい発生ではない)
      expect(next.result.resolvedConflicts).toEqual([]);
      expect(next.counters.details).toMatchObject({ continuing_conflicts: 1, open_conflicts: [SEP_KEY] });
      expect(decisionsSnapshot()).toEqual(before);
    });

    it('keeps an open conflict when that comparison could not be made this time (not resolved)', async () => {
      await run(SEPT_OCT);
      await run(SEP_CORRECTED);
      // 9/17 の記録が API から消えた: 値は比べられない(unverified)。前回の VALUE_DIFFERS は解消としない
      const missing = { refRates: SEPT_OCT.refRates.filter((r) => r.effectiveDate !== '2026-09-17') };
      const { result, counters } = await run(missing);
      expect(result.unverified).toContainEqual({
        provider_event_id: 'fomc_schedule:2026-09-16',
        reason: 'MISSING_IN_SOURCE',
      });
      expect(result.resolvedConflicts).toEqual([]);
      expect(counters.details.open_conflicts).toContain(SEP_KEY);
    });

    it('identifies several meetings and differences separately', async () => {
      await run(SEPT_OCT);
      const both = { refRates: SEP_CORRECTED.refRates.filter((r) => r.effectiveDate !== '2026-10-29') };
      const first = await run(both);
      expect(first.result.conflicts.map((c) => c.key).sort()).toEqual([SEP_KEY, OCT_KEY].sort());
      // 9/16 の会合の訂正だけが戻った: 9/16 は解消、10/28 は続いている
      const sepFixed = await run(OCT_SHIFTED);
      expect(sepFixed.result.conflicts).toEqual([]);
      expect(sepFixed.result.resolvedConflicts.map((c) => c.key)).toEqual([SEP_KEY]);
      expect(sepFixed.counters.details).toMatchObject({ continuing_conflicts: 1, open_conflicts: [OCT_KEY] });
      // 同じ会合でも、NY連銀の値が別の値に訂正されたら別の食い違い(前のものは解消)
      const corrected2 = {
        refRates: SEPT_OCT.refRates.map((r) =>
          r.effectiveDate === '2026-09-17' ? record('2026-09-17', 3.25, 3.5) : r,
        ),
      };
      await run(SEP_CORRECTED);
      const changed = await run(corrected2);
      expect(changed.result.conflicts.map((c) => c.difference)).toEqual(['VALUE_DIFFERS']);
      expect(changed.result.conflicts[0]!.source).toEqual({ lower: 3.25, upper: 3.5, effective_date: '2026-09-17' });
      expect(changed.result.resolvedConflicts.map((c) => c.key)).toEqual([SEP_KEY]);
    });

    it('does not read the logs of other jobs (or other providers) as its previous state', async () => {
      await run(SEPT_OCT);
      const foreign = (job: string, provider: string) =>
        store.logs.push({
          provider,
          data_type: 'ECONOMIC_EVENT',
          job,
          started_at: '2026-11-05T14:00:00.000Z',
          completed_at: '2026-11-05T14:00:01.000Z',
          status: 'SUCCESS',
          fetched_count: 0,
          success_count: 0,
          error_count: 0,
          skipped_count: 0,
          review_count: 0,
          error_message: null,
          details: { conflicts_checked: true, open_conflicts: [SEP_KEY] },
        });
      foreign('ingest:fomc-schedule', FOMC_POLICY_RATE_LOG_PROVIDER);
      foreign(FOMC_POLICY_RATE_JOB, 'fomc_schedule');
      const { result } = await run(SEP_CORRECTED);
      expect(result.conflicts.map((c) => c.key)).toEqual([SEP_KEY]); // 他のログの状態を使っていれば「続いている」になっていた
    });

    it('still records a new meeting normally while comparing the recorded ones', async () => {
      await run({ refRates: SEPT_OCT.refRates.slice(0, 4) }, () => new Date('2026-10-01T15:00:00Z'));
      expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-sep']);
      const { result, calls } = await run(SEPT_OCT);
      expect(calls).toEqual([['2026-09-17', '2026-11-05']]);
      expect(result.recorded.map((r) => r.provider_event_id)).toEqual(['fomc_schedule:2026-10-28']);
      expect(result.conflicts).toEqual([]);
      expect(store.fomcPolicyDecisions.map((d) => d.event_id)).toEqual(['ev-sep', 'ev-oct']);
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
