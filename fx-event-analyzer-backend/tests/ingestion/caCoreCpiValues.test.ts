/**
 * カナダのコアCPI(CA_CPI_TRIM・CA_CPI_MEDIAN)の初回値の取り込み — 設計書 ca-cpi-detailed-design.md §16.15.1 第1段階の
 * G1〜G5・G8・G9・G12(と §15.2 の期限・§15.3 の same_day_diff・§16.6 の期限間近の警告)。
 * WDS へは通信しない。固定のレスポンス(実データの形: §16.1)で検証する。
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { GB_AU_CA_SCHEDULES } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { HttpError } from '../../src/ingestion/http.js';
import {
  caCoreAnnotations,
  ingestCaCoreCpiValues,
  type CaCoreCpiResult,
} from '../../src/ingestion/pipelines/caCoreCpiValues.js';
import { readOnlyIngestionStore } from '../../src/ingestion/pipelines/blsCalendar.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const TRIM = 108785715;
const MEDIAN = 108785714;
const RELEASE = '2026-12-14T13:30:00.000Z'; // 2026-12-14 08:30 ET
const SAME_DAY = new Date('2026-12-14T15:00:00Z');
const NEXT_DAY = new Date('2026-12-15T15:00:00Z');

type PointOverrides = Record<string, unknown>;
const point = (refPer: string, value: unknown, releaseTime: string, overrides: PointOverrides = {}) => ({
  refPer,
  refPer2: '',
  refPerRaw: refPer,
  refPerRaw2: '',
  value,
  decimals: 1,
  scalarFactorCode: 0,
  symbolCode: 0,
  statusCode: 0,
  securityLevelCode: 0,
  releaseTime,
  frequencyCode: 6,
  ...overrides,
});
const wds = (vectorId: number | undefined, points: unknown[], status = 'SUCCESS') => [
  { status, object: { responseStatusCode: 0, productId: 18100256, vectorId, vectorDataPoint: points } },
];

/** 実データの形(§16.1): 全点の releaseTime が「直近の公表」の時刻で同一。2026-02〜2026-11 の10点 */
const TRIM_VALUES = [2.3, 2.2, 2.0, 2.0, 1.9, 1.9, 1.9, 1.8, 1.8, 1.7];
const MEDIAN_VALUES = [2.3, 2.3, 2.1, 2.1, 1.9, 2.0, 2.0, 1.9, 1.9, 1.8];
const MONTHS = ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map((m) => `2026-${m}-01`);
const series = (
  values: (number | string)[],
  releaseTime = '2026-12-14T08:30',
  overrides: Record<number, PointOverrides> = {},
) => MONTHS.map((refPer, i) => point(refPer, values[i], releaseTime, overrides[i]));

class FakeFetcher {
  responses = new Map<number, unknown>();
  failing = new Map<number, Error>();
  calls: { vectorId: number; latestN: number; method?: string | undefined }[] = [];
  getJson(_url: string, init?: RequestInit): Promise<unknown> {
    const [req] = JSON.parse(init?.body as string) as [{ vectorId: number; latestN: number }];
    this.calls.push({ ...req, method: init?.method });
    const failure = this.failing.get(req.vectorId);
    if (failure) return Promise.reject(failure);
    return Promise.resolve(this.responses.get(req.vectorId));
  }
}

describe('ingestCaCoreCpiValues(第1段階)', () => {
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;

  const setHealthy = () => {
    fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES)));
    fetcher.responses.set(MEDIAN, wds(MEDIAN, series(MEDIAN_VALUES)));
  };

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-trim', code: 'CA_CPI_TRIM', importance: 'MEDIUM', favorable_direction: 'NEUTRAL' },
      { id: 'ind-median', code: 'CA_CPI_MEDIAN', importance: 'MEDIUM', favorable_direction: 'NEUTRAL' },
    ];
    store.events = ['TRIM', 'MEDIAN'].map((name) => ({
      id: `ev-${name.toLowerCase()}`,
      indicator_id: `ind-${name.toLowerCase()}`,
      provider: 'statcan_release_schedule',
      provider_event_id: `statcan_release_schedule:CA_CPI_${name}:2026-11`,
      importance: 'MEDIUM',
      release_datetime: RELEASE,
      release_datetime_precision: 'EXACT',
      status: 'SCHEDULED',
      data_status: 'PENDING',
    }));
    setHealthy();
  });

  const run = async (now = SAME_DAY, opts: { dryRun?: boolean; store?: MemoryIngestionStore } = {}) => {
    const counters = new JobCounters();
    const result = await ingestCaCoreCpiValues(
      {
        store: opts.store ?? store,
        fetcher,
        tables: GB_AU_CA_SCHEDULES,
        now: () => now,
        ...(opts.dryRun ? { dryRun: true } : {}),
      },
      counters,
    );
    return { result, counters };
  };
  const event = (name: 'trim' | 'median') => store.events.find((e) => e.id === `ev-${name}`)!;
  const snap = (name: 'trim' | 'median') => store.snapshots.find((s) => s.event_id === `ev-${name}`);

  describe('G2: 公表日に初回値を保存(2系列は独立)', () => {
    it('公式の前年同月比(%)の最新点を、そのまま保存する(計算・丸めなし)。リクエストは系列ごとに1回・latestN 49', async () => {
      const { result, counters } = await run();
      expect(result.published).toBe(2);
      expect(snap('trim')).toMatchObject({
        actual: 1.7,
        forecast: null,
        previous: null,
        unit: '%',
        source: 'Statistics Canada',
        source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810025601',
        captured_at: SAME_DAY.toISOString(),
        verification_status: 'VERIFIED',
        verification_source: `v${TRIM}@2026-11`,
        official_actual: 1.7,
      });
      expect(snap('median')).toMatchObject({ actual: 1.8, verification_source: `v${MEDIAN}@2026-11` });
      expect(event('trim')).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
      expect(event('median')).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
      expect(fetcher.calls).toEqual([
        { vectorId: TRIM, latestN: 49, method: 'POST' },
        { vectorId: MEDIAN, latestN: 49, method: 'POST' },
      ]);
      expect(counters.errors).toBe(0);
      expect(store.revisions).toHaveLength(0);
    });

    it('値が数字の文字列で来ても、小数第1位の公表値として読む。再実行しても増えない(冪等)', async () => {
      fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES.map(String))));
      await run();
      expect(snap('trim')?.actual).toBe(1.7);
      const again = await run(NEXT_DAY);
      expect(store.snapshots).toHaveLength(2);
      expect(again.result.published).toBe(0);
      expect(store.revisions).toHaveLength(0);
    });

    it('trim だけが公表済みで median が未反映でも、trim は保存される(独立)', async () => {
      fetcher.responses.set(MEDIAN, wds(MEDIAN, series(MEDIAN_VALUES, '2026-11-16T08:30').slice(0, 9))); // median の最新点は 2026-10(前の公表)
      const { result } = await run();
      expect(result.published).toBe(1);
      expect(snap('trim')).toBeDefined();
      expect(snap('median')).toBeUndefined();
      expect(event('median')).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    });

    it('dry-run は読むだけ。PUBLISH が plan に出て、何も書かない', async () => {
      const before = JSON.stringify(store.events);
      const { result } = await run(SAME_DAY, { dryRun: true, store: store });
      expect(result.published).toBe(2);
      expect(result.plan.filter((p) => p.action === 'PUBLISH')).toHaveLength(2);
      expect(store.snapshots).toHaveLength(0);
      expect(JSON.stringify(store.events)).toBe(before);
      const ro = await run(SAME_DAY, { dryRun: true, store: readOnlyIngestionStore(store) as MemoryIngestionStore });
      expect(ro.result.published).toBe(2); // 読み取り専用のストアでも動く(書き込みメソッドを呼ばない)
    });
  });

  describe('経路 A の照合(§4.3)', () => {
    it('R3 最新点の公表日 = 公表予定日、対象月 = 表の対象月なら保存する(過去点の releaseTime は見ない)', async () => {
      fetcher.responses.set(
        TRIM,
        wds(TRIM, [
          ...series(TRIM_VALUES, '2026-11-16T08:30').slice(0, 9), // 過去点は前の公表日でもよい
          point('2026-11-01', 1.7, '2026-12-14T08:30'),
        ]),
      );
      await run();
      expect(snap('trim')?.actual).toBe(1.7);
    });

    it('R4 次の公表の後(全点の releaseTime が次の公表の日)は、改定後の値を初回値にしない', async () => {
      fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES, '2027-01-18T08:30')));
      const { result, counters } = await run(new Date('2026-12-15T15:00:00Z'));
      expect(snap('trim')).toBeUndefined();
      expect(result.plan.find((p) => p.indicator === 'CA_CPI_TRIM')).toMatchObject({
        action: 'PENDING',
        reason: 'NOT_RELEASED_OR_DATE_MISMATCH',
      });
      expect(counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1);
    });

    it('WDS が未反映(最新点がまだ前の月)なら PENDING のまま。前回値・現在値で補完しない(F8)', async () => {
      fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES, '2026-11-16T08:30').slice(0, 9)));
      const { result } = await run();
      expect(snap('trim')).toBeUndefined();
      expect(result.plan.find((p) => p.indicator === 'CA_CPI_TRIM')?.reason).toBe('NOT_RELEASED_OR_DATE_MISMATCH');
      // 最新点の公表日は合っているが、対象月が違う(次の月に進んだ形ではなく前の月)
      fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES, '2026-12-14T08:30').slice(0, 9)));
      const second = await run();
      expect(second.result.plan.find((p) => p.indicator === 'CA_CPI_TRIM')?.reason).toBe('PERIOD_MISMATCH');
      expect(snap('trim')).toBeUndefined();
      expect(snap('median')).toBeDefined(); // もう一方は通常どおり
    });

    it('値が null・非数・小数第2位・statusCode / symbolCode が 0 以外なら保存しない(INVALID_VALUE)', async () => {
      const last = MONTHS.length - 1;
      const bad: unknown[] = [
        { value: null },
        { value: 'x' },
        { value: 1.75 },
        { value: Number.NaN },
        { statusCode: 1 },
        { symbolCode: 2 },
      ];
      for (const override of bad as PointOverrides[]) {
        fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES, '2026-12-14T08:30', { [last]: override })));
        const { result } = await run();
        expect(snap('trim'), JSON.stringify(override)).toBeUndefined();
        expect(result.plan.find((p) => p.indicator === 'CA_CPI_TRIM')?.reason).toBe('INVALID_VALUE');
      }
    });
  });

  describe('G5: 系列単位の部分失敗(F1〜F9。F10〜F12 はヘッドライン・改定停止が対象で第1段階のコア2指標には無い)', () => {
    it('F1 trim だけ HTTP 失敗 → trim は書かない。median は通常', async () => {
      fetcher.failing.set(TRIM, new HttpError('HTTP 503', 503, true));
      const { result, counters } = await run();
      expect(snap('trim')).toBeUndefined();
      expect(snap('median')).toBeDefined();
      expect(result.plan.find((p) => p.indicator === 'CA_CPI_TRIM')).toMatchObject({
        action: 'PENDING',
        reason: 'FETCH_FAILED',
      });
      expect(counters.skipReasons.FETCH_FAILED).toBe(1);
      expect(counters.errors).toBe(0);
    });

    it('F2 median の status が SUCCESS でない → median のみ停止', async () => {
      fetcher.responses.set(MEDIAN, wds(MEDIAN, series(MEDIAN_VALUES), 'FAILED'));
      const { counters } = await run();
      expect(snap('median')).toBeUndefined();
      expect(snap('trim')).toBeDefined();
      expect(counters.skipReasons.FETCH_FAILED).toBe(1);
    });

    it('F3 trim の応答の vectorId が median のもの → trim のみ停止(SERIES_MISMATCH)。trim の値を median に入れない', async () => {
      fetcher.responses.set(TRIM, wds(MEDIAN, series(MEDIAN_VALUES)));
      const { counters } = await run();
      expect(snap('trim')).toBeUndefined();
      expect(snap('median')).toMatchObject({ actual: 1.8, verification_source: `v${MEDIAN}@2026-11` });
      expect(counters.errors).toBe(1);
      expect(counters.errorMessages[0]).toContain('SERIES_MISMATCH');
    });

    it('F4 2系列とも vectorId が入れ替わっている → 2系列とも停止。何も書かない', async () => {
      fetcher.responses.set(TRIM, wds(MEDIAN, series(MEDIAN_VALUES)));
      fetcher.responses.set(MEDIAN, wds(TRIM, series(TRIM_VALUES)));
      const { counters } = await run();
      expect(store.snapshots).toHaveLength(0);
      expect(counters.errors).toBe(2);
      expect(counters.errorMessages.every((m) => m.includes('SERIES_MISMATCH'))).toBe(true);
    });

    it('F5 応答が JSON でない → コア2系列すべて停止(RESPONSE_UNPARSABLE)', async () => {
      fetcher.failing.set(TRIM, new HttpError('response is not JSON', null, false, 'PARSE'));
      const { counters, result } = await run();
      expect(store.snapshots).toHaveLength(0);
      expect(counters.errorMessages.some((m) => m.includes('RESPONSE_UNPARSABLE'))).toBe(true);
      expect(result.plan.map((p) => p.reason)).toEqual(['RESPONSE_UNPARSABLE', 'RESPONSE_UNPARSABLE']);
    });

    it('F6 median の応答が空配列・オブジェクト → コア2系列すべて停止(RESPONSE_UNPARSABLE)', async () => {
      for (const body of [[], {}, 'x', [null]]) {
        fetcher.responses.set(MEDIAN, body);
        const { counters } = await run();
        expect(store.snapshots, JSON.stringify(body)).toHaveLength(0);
        expect(counters.errorMessages.some((m) => m.includes('RESPONSE_UNPARSABLE'))).toBe(true);
      }
    });

    it('F7 trim の応答に vectorId が無い(SUCCESS)→ 2系列すべて停止(SERIES_UNIDENTIFIABLE)', async () => {
      fetcher.responses.set(TRIM, wds(undefined, series(TRIM_VALUES)));
      const { counters } = await run();
      expect(store.snapshots).toHaveLength(0);
      expect(counters.errorMessages.some((m) => m.includes('SERIES_UNIDENTIFIABLE'))).toBe(true);
    });

    it('F9 median の過去点の1点だけ statusCode = 1 → その点だけ除外。初回値は通常に保存される', async () => {
      fetcher.responses.set(MEDIAN, wds(MEDIAN, series(MEDIAN_VALUES, '2026-12-14T08:30', { 3: { statusCode: 1 } })));
      const { counters } = await run();
      expect(snap('median')?.actual).toBe(1.8);
      expect(counters.errors).toBe(0);
    });
  });

  describe('G8: 取得失敗 → 期限内の再実行は保存、期限切れは保存しない', () => {
    it('失敗した実行は何も書かず、同じ日・翌日(期限内)の再実行で保存される', async () => {
      fetcher.failing.set(TRIM, new HttpError('HTTP 503', 503, true));
      fetcher.failing.set(MEDIAN, new HttpError('timeout', null, true, 'TIMEOUT'));
      const first = await run();
      expect(store.snapshots).toHaveLength(0);
      expect(first.result.pending).toBe(2);
      fetcher.failing.clear();
      const retry = await run(new Date('2026-12-21T14:00:00Z')); // D+7(Toronto 12/21 09:00)
      expect(retry.result.published).toBe(2);
      expect(store.snapshots).toHaveLength(2);
    });

    it('D+7 の 23:59:59 Toronto までは保存、D+8 の 00:00 からは保存しない(TOO_LATE_FOR_FIRST_RELEASE)。自動では救済しない', async () => {
      const lastOk = await run(new Date('2026-12-22T04:59:59Z'));
      expect(lastOk.result.published).toBe(2);

      store.snapshots.length = 0;
      for (const e of store.events) Object.assign(e, { status: 'SCHEDULED', data_status: 'PENDING' });
      for (const now of ['2026-12-22T05:00:00Z', '2026-12-23T14:00:00Z']) {
        const late = await run(new Date(now));
        expect(late.result.published, now).toBe(0);
        expect(
          late.result.plan.map((p) => p.reason),
          now,
        ).toEqual(['TOO_LATE_FOR_FIRST_RELEASE', 'TOO_LATE_FOR_FIRST_RELEASE']);
        expect(late.counters.skipReasons.TOO_LATE_FOR_FIRST_RELEASE).toBe(2);
        expect(store.snapshots).toHaveLength(0);
        expect(event('trim')).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
      }
    });

    it('O4・O5・O6 期限間近の警告: D+4 は無し、D+5〜D+7 は deadline_warnings(終了コードは変えない)、D+8 は期限切れ', async () => {
      fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES.slice(0, 9)).slice(0, 9))); // 未反映のまま
      fetcher.responses.set(MEDIAN, wds(MEDIAN, series(MEDIAN_VALUES.slice(0, 9)).slice(0, 9)));
      const at = (day: string) => new Date(`${day}T15:00:00Z`);
      const none = await run(at('2026-12-18')); // D+4
      expect(none.result.deadline_warnings).toEqual([]);
      for (const [day, n] of [
        ['2026-12-19', 5],
        ['2026-12-20', 6],
        ['2026-12-21', 7],
      ] as const) {
        const r = await run(at(day));
        expect(r.result.deadline_warnings, day).toHaveLength(2);
        expect(r.result.deadline_warnings[0]).toEqual({
          indicator: 'CA_CPI_TRIM',
          provider_event_id: 'statcan_release_schedule:CA_CPI_TRIM:2026-11',
          daysAfter: n,
          deadline_local_date: '2026-12-21',
        });
        expect(r.counters.errors).toBe(0);
        expect(
          caCoreAnnotations(r.result).some((l) => l.startsWith(`::warning::FIRST_VALUE_DEADLINE (${7 - n} days left)`)),
        ).toBe(true);
      }
      const late = await run(at('2026-12-22')); // D+8
      expect(late.result.deadline_warnings).toEqual([]);
      expect(late.result.plan.every((p) => p.reason === 'TOO_LATE_FOR_FIRST_RELEASE')).toBe(true);
    });
  });

  describe('G1・G3: 改定の検知・書き込みはしない(DISABLED_STAGE1)', () => {
    const publishThenRevise = async () => {
      await run(SAME_DAY); // 12/14 に初回値(trim 1.7 / median 1.8)を保存
      const before = JSON.stringify(store.snapshots);
      // 後日の WDS: trim の 2026-11 と過去の2か月、median の 2026-11 と過去の2か月が違う
      fetcher.responses.set(
        TRIM,
        wds(TRIM, series([2.3, 2.2, 2.0, 2.0, 1.9, 1.9, 2.0, 1.8, 1.9, 1.8], '2026-12-15T08:30')),
      );
      fetcher.responses.set(
        MEDIAN,
        wds(MEDIAN, series([2.3, 2.3, 2.1, 2.1, 1.9, 2.0, 2.0, 1.9, 1.9, 1.7], '2026-12-15T08:30')),
      );
      return { ...(await run(NEXT_DAY)), before };
    };

    it('G1 値が違っても event_revisions に1行も書かない。revision_observations に出るだけ(スナップショットも不変)', async () => {
      const { result, counters, before } = await publishThenRevise();
      expect(store.revisions).toHaveLength(0);
      expect(JSON.stringify(store.snapshots)).toBe(before);
      expect(result.revision_observations).toEqual([
        {
          indicator: 'CA_CPI_TRIM',
          provider_event_id: 'statcan_release_schedule:CA_CPI_TRIM:2026-11',
          period: '2026-11',
          stored: 1.7,
          observed: 1.8,
        },
        {
          indicator: 'CA_CPI_MEDIAN',
          provider_event_id: 'statcan_release_schedule:CA_CPI_MEDIAN:2026-11',
          period: '2026-11',
          stored: 1.8,
          observed: 1.7,
        },
      ]);
      expect(result.same_day_diff).toEqual([]);
      expect(counters.errors).toBe(0);
    });

    it('G1 同日の差は same_day_diff に記録するだけ(§15.3)。revision_observations・event_revisions には出ない', async () => {
      await run(SAME_DAY);
      fetcher.responses.set(TRIM, wds(TRIM, series([...TRIM_VALUES.slice(0, 9), 1.9], '2026-12-14T08:30')));
      const { result, counters } = await run(new Date('2026-12-14T20:00:03.000Z'));
      expect(result.revision_observations).toEqual([]);
      expect(store.revisions).toHaveLength(0);
      expect(result.same_day_diff).toHaveLength(1);
      expect(result.same_day_diff[0]).toEqual({
        event: 'same_day_diff',
        indicator: 'CA_CPI_TRIM',
        provider_event_id: 'statcan_release_schedule:CA_CPI_TRIM:2026-11',
        event_id: 'ev-trim',
        period: '2026-11',
        series: `v${TRIM}`,
        snapshot_actual: 1.7,
        observed: 1.9,
        snapshot_captured_at: SAME_DAY.toISOString(),
        observed_at: '2026-12-14T20:00:03.000Z',
        local_date: '2026-12-14',
        action: 'NONE',
      });
      expect(counters.details.same_day_diff).toHaveLength(1);
      expect(JSON.stringify(result)).not.toMatch(/@|token|secret|password/i);
    });

    it('G1 参考情報の値が不正(null・statusCode 1)なら、差として出さない(取得失敗を差にしない)', async () => {
      await run(SAME_DAY);
      fetcher.responses.set(TRIM, wds(TRIM, series(TRIM_VALUES, '2026-12-15T08:30', { 9: { value: null } })));
      const { result } = await run(NEXT_DAY);
      expect(result.revision_observations).toEqual([]);
      expect(result.same_day_diff).toEqual([]);
    });

    it('G3 revision_detection は DISABLED_STAGE1。終了コード 0 相当(errors 0)。REVISION_BURST_STOP は出ない。注記は notice(警告ではない)', async () => {
      const { result, counters } = await publishThenRevise();
      expect(result.revision_detection).toEqual({ mode: 'DISABLED_STAGE1' });
      expect(counters.errors).toBe(0);
      expect(JSON.stringify({ result, details: counters.details })).not.toContain('REVISION_BURST_STOP');
      const lines = caCoreAnnotations(result);
      expect(lines[0]).toMatch(/^::notice::.*DISABLED_STAGE1/);
      expect(lines.some((l) => l.startsWith('::warning::'))).toBe(false);
    });

    it('G3 6件以上の差があっても、停止も書き込みもしない(N の判定をしない)', async () => {
      await run(SAME_DAY);
      // 保存済みは 2026-11 の1点だけだが、全点が違う応答でも何も起きない
      fetcher.responses.set(
        TRIM,
        wds(
          TRIM,
          series(
            TRIM_VALUES.map((v) => v + 0.3),
            '2026-12-15T08:30',
          ),
        ),
      );
      const { result, counters } = await run(NEXT_DAY);
      expect(store.revisions).toHaveLength(0);
      expect(counters.errors).toBe(0);
      expect(result.revision_observations).toHaveLength(1);
    });
  });

  describe('G4・G9・G12: 固定記録に依存しない・静的検査', () => {
    it('G4 第1段階の実行が使うストアのメソッドは、既存の初回値の取り込みと同じ範囲だけ(固定記録への問い合わせが無い)', async () => {
      const used = new Set<string>();
      const spy = new Proxy(store, {
        get(target, prop, receiver) {
          const value: unknown = Reflect.get(target, prop, receiver);
          if (typeof value === 'function' && typeof prop === 'string') {
            used.add(prop);
            return (value as (...a: unknown[]) => unknown).bind(target);
          }
          return value;
        },
      });
      await run(SAME_DAY, { store: spy });
      await run(NEXT_DAY, { store: spy });
      expect([...used].sort()).toEqual(
        [
          'findIndicatorsByCode',
          'getReleaseSnapshot',
          'insertReleaseSnapshot',
          'listEventsByProvider',
          'updateEvent',
        ].sort(),
      );
    });

    const STAGE1_FILES = [
      'src/ingestion/pipelines/caCoreCpiValues.ts',
      'src/ingestion/pipelines/caCoreRevisionObservation.ts',
      'src/ingestion/adapters/caCoreCpi.ts',
      'src/ingestion/firstValueWindow.ts',
      'src/jobs/ingestOfficialValues.ts',
    ];

    it('G9 第1段階のコードは、固定記録・追記専用ログ・承認のモジュールを import しない', () => {
      for (const file of STAGE1_FILES) {
        const source = readFileSync(file, 'utf8');
        const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
        for (const spec of specifiers) {
          expect(spec, `${file} imports ${spec}`).not.toMatch(
            /fixed|record|ledger|append|decision|approv|revisionBurst/i,
          );
        }
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code, file).not.toMatch(/insertRevision|latestRevisionValues|REVISION_BURST_STOP/);
      }
    });

    it('G12 経路 B(過去点の確認)のソースは、公表時刻の項目(releaseTime)を参照しない', () => {
      expect(readFileSync('src/ingestion/pipelines/caCoreRevisionObservation.ts', 'utf8')).not.toMatch(/releaseTime/);
    });
  });

  describe('G11: 既存の取得元は変えない', () => {
    it('コア2指標は OFFICIAL_VALUE_SOURCES(既存の取得元の表)に入れていない。ヘッドライン CA_CPI も入れていない', async () => {
      const { OFFICIAL_VALUE_SOURCES } = await import('../../src/ingestion/pipelines/officialValues.js');
      expect(OFFICIAL_VALUE_SOURCES.map((s) => s.indicatorCode)).toEqual([
        'GB_CPI',
        'GB_CORE_CPI',
        'GB_UNEMPLOYMENT_RATE',
        'GB_GDP_MOM',
        'GB_RETAIL_SALES_MOM',
        'CA_UNEMPLOYMENT_RATE',
        'AU_CPI',
        'AU_UNEMPLOYMENT_RATE',
        'AU_WPI_QOQ',
      ]);
    });
  });

  it('結果の型: CaCoreCpiResult の項目', async () => {
    const { result } = await run();
    const keys: (keyof CaCoreCpiResult)[] = [
      'published',
      'pending',
      'plan',
      'revision_detection',
      'revision_observations',
      'same_day_diff',
      'deadline_warnings',
    ];
    expect(Object.keys(result).sort()).toEqual([...keys].sort());
  });
});
