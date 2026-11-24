/**
 * カナダのコアCPI(CA_CPI_TRIM・CA_CPI_MEDIAN)の出典(attribution.notice に対象月を含める。A案)と value_decimals —
 * 設計書 ca-cpi-detailed-design.md §14.7・§16.5(N2〜N14、第1段階 G6)。ヘッドライン CA_CPI(N1・N4)は今回の範囲外で、
 * 既存の挙動が変わっていないことだけを確かめる。
 */
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  attributionForIndicator,
  STATCAN_ATTRIBUTION,
  STATCAN_CORE_CPI_ATTRIBUTION,
  STATCAN_LFS_ATTRIBUTION,
} from '../../src/domain/attribution.js';
import { buildCalendarItems, type CalendarIndicatorEvent } from '../../src/domain/calendar.js';
import { valueDecimalsForIndicator } from '../../src/domain/valueDecimals.js';
import type { EventRow } from '../../src/repositories/eventsRepository.js';
import { eventAttribution } from '../../src/routes/events.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

const TABLE =
  'Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions';
const AS_IS = 'Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.';
const notice = (month: string) => `Source: Statistics Canada, ${TABLE}, ${month}. ${AS_IS}`;
const BASE_NOTICE = `Source: Statistics Canada, ${TABLE}. ${AS_IS}`;
const RELEASE = '2026-11-16T13:30:00.000Z'; // 2026年10月分の公表日

const ctx = (code: string, key: string | null, extra: Record<string, unknown> = {}) => ({
  providerEventId: key === null ? null : `statcan_release_schedule:${code}:${key}`,
  releaseDatetime: RELEASE,
  ...extra,
});

describe('コアCPIの notice(対象月つき)', () => {
  it('N2・N3 TRIM・MEDIAN は Source: 形で、対象月(October 2026)を含む完全一致', () => {
    for (const code of ['CA_CPI_TRIM', 'CA_CPI_MEDIAN']) {
      const a = attributionForIndicator(code, ctx(code, '2026-10'));
      expect(a).toEqual({ ...STATCAN_CORE_CPI_ATTRIBUTION, notice: notice('October 2026') });
      expect(a?.source_url).toBe('https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810025601');
    }
  });

  it('N5 コア2指標は Source: で始まり、Adapted from を含まず、as is を含む', () => {
    for (const code of ['CA_CPI_TRIM', 'CA_CPI_MEDIAN']) {
      const n = attributionForIndicator(code, ctx(code, '2026-10'))!.notice!;
      expect(n.startsWith('Source: Statistics Canada, Table 18-10-0256-01')).toBe(true);
      expect(n).not.toContain('Adapted from');
      expect(n).toContain('as is');
    }
  });

  it('N6 公表日 2026-11-16・対象月 2026-10 は October 2026 で、November 2026 を含まない', () => {
    const n = attributionForIndicator('CA_CPI_TRIM', ctx('CA_CPI_TRIM', '2026-10'))!.notice!;
    expect(n).toContain('October 2026');
    expect(n).not.toContain('November 2026');
  });

  it('N9 予定のみ(スナップショットなし)でも、キーの対象月で出る。12か月の月名', () => {
    const names = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    names.forEach((name, i) => {
      const key = `2026-${String(i + 1).padStart(2, '0')}`;
      const a = attributionForIndicator('CA_CPI_TRIM', {
        providerEventId: `statcan_release_schedule:CA_CPI_TRIM:${key}`,
        releaseDatetime: '2026-12-31T13:30:00.000Z',
      });
      expect(a?.notice, key).toBe(notice(`${name} 2026`));
    });
  });

  it('N10 不正な対象月(2026-13・空・abc・null・スナップショットとの食い違い・未来の月)は、年月が入らない基本形。エラーを記録する', () => {
    const cases: [string, ReturnType<typeof ctx>][] = [
      ['2026-13', ctx('CA_CPI_TRIM', '2026-13')],
      ['empty', ctx('CA_CPI_TRIM', '')],
      ['abc', ctx('CA_CPI_TRIM', 'abc')],
      ['null', ctx('CA_CPI_TRIM', null)],
      ['mismatch', ctx('CA_CPI_TRIM', '2026-10', { snapshotVerificationSource: 'v108785715@2026-09' })],
      ['future', ctx('CA_CPI_TRIM', '2026-12')],
      ['year', ctx('CA_CPI_TRIM', '1999-10')],
    ];
    for (const [name, c] of cases) {
      const onInvalidReferencePeriod = vi.fn();
      const a = attributionForIndicator('CA_CPI_TRIM', { ...c, onInvalidReferencePeriod });
      expect(a?.notice, name).toBe(BASE_NOTICE);
      expect(a?.notice, name).not.toMatch(/\b(19|20)\d{2}\b/);
      expect(a?.notice, name).not.toMatch(
        /January|February|March|April|May|June|July|August|September|October|November|December/,
      );
      expect(onInvalidReferencePeriod, name).toHaveBeenCalledTimes(1);
      const reported = onInvalidReferencePeriod.mock.calls[0]![0] as { code: string };
      expect(reported.code).toBe('ATTRIBUTION_REFERENCE_PERIOD_INVALID');
      expect(JSON.stringify(onInvalidReferencePeriod.mock.calls[0]![0])).not.toContain('2026-13'); // 値は出さない
    }
    // 一致していれば通る
    expect(
      attributionForIndicator(
        'CA_CPI_TRIM',
        ctx('CA_CPI_TRIM', '2026-10', { snapshotVerificationSource: 'v108785715@2026-10' }),
      )?.notice,
    ).toBe(notice('October 2026'));
  });

  it('N11 GET /indicators(コンテキストなし)は対象月なしの基本形。形(source・source_url・notice)は同じ', () => {
    for (const code of ['CA_CPI_TRIM', 'CA_CPI_MEDIAN']) {
      const a = attributionForIndicator(code)!;
      expect(a).toEqual(STATCAN_CORE_CPI_ATTRIBUTION);
      expect(a.notice).toBe(BASE_NOTICE);
      expect(Object.keys(a).sort()).toEqual(['notice', 'source', 'source_url']);
    }
  });

  it('N13 ロケール・タイムゾーン・環境に依存しない(固定の月名の表。Intl を使わない)', () => {
    const source = readFileSync('src/domain/attribution.ts', 'utf8');
    expect(source).not.toMatch(/toLocale|Intl\./);
    const before = process.env.TZ;
    try {
      for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = tz;
        expect(attributionForIndicator('CA_CPI_MEDIAN', ctx('CA_CPI_MEDIAN', '2026-10'))?.notice).toBe(
          notice('October 2026'),
        );
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('N14・G11 CA_UNEMPLOYMENT_RATE とヘッドライン CA_CPI の出典は変わらない(コンテキストを渡しても同じ)', () => {
    expect(attributionForIndicator('CA_UNEMPLOYMENT_RATE')).toEqual(STATCAN_LFS_ATTRIBUTION);
    expect(attributionForIndicator('CA_UNEMPLOYMENT_RATE', ctx('CA_UNEMPLOYMENT_RATE', '2026-10'))).toEqual(
      STATCAN_LFS_ATTRIBUTION,
    );
    expect(attributionForIndicator('CA_CPI')).toEqual(STATCAN_ATTRIBUTION);
    expect(attributionForIndicator('CA_CPI', ctx('CA_CPI', '2026-10'))).toEqual(STATCAN_ATTRIBUTION);
    expect(STATCAN_ATTRIBUTION.notice).toBe(`Source: Statistics Canada. ${AS_IS}`);
  });

  it('コア2指標だけ value_decimals = 1。ヘッドライン CA_CPI・CA_UNEMPLOYMENT_RATE は null のまま(公開済みの応答を変えない)', () => {
    expect(valueDecimalsForIndicator('CA_CPI_TRIM')).toBe(1);
    expect(valueDecimalsForIndicator('CA_CPI_MEDIAN')).toBe(1);
    expect(valueDecimalsForIndicator('CA_CPI')).toBeNull();
    expect(valueDecimalsForIndicator('CA_UNEMPLOYMENT_RATE')).toBeNull();
    expect(valueDecimalsForIndicator('GB_CPI')).toBeNull();
    expect(valueDecimalsForIndicator('US_CPI')).toBe(1); // 既存(BLS)
  });
});

describe('GET /calendar(buildCalendarItems)', () => {
  const event = (code: string, key: string): CalendarIndicatorEvent => ({
    id: `ev-${code}`,
    indicator_id: `ind-${code}`,
    indicator_name: code,
    country_code: 'CA',
    currency_code: 'CAD',
    importance: 'MEDIUM',
    release_datetime: RELEASE,
    release_datetime_precision: 'EXACT',
    status: 'SCHEDULED',
    indicator_code: code,
    provider_event_id: `statcan_release_schedule:${code}:${key}`,
  });

  it('N9 予定のみの回でも、コア2指標の attribution はキーの対象月つき。ヘッドライン・失業率は従来どおり。応答の項目は増えない', () => {
    const items = buildCalendarItems(
      [
        event('CA_CPI', '2026-10'),
        event('CA_CPI_TRIM', '2026-10'),
        event('CA_CPI_MEDIAN', '2026-10'),
        event('CA_UNEMPLOYMENT_RATE', '2026-11'),
      ],
      [],
      {},
      new Date('2026-11-10T00:00:00Z'),
    );
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['ev-CA_CPI_TRIM']!.attribution?.notice).toBe(notice('October 2026'));
    expect(byId['ev-CA_CPI_MEDIAN']!.attribution?.notice).toBe(notice('October 2026'));
    expect(byId['ev-CA_CPI']!.attribution).toEqual(STATCAN_ATTRIBUTION);
    expect(byId['ev-CA_UNEMPLOYMENT_RATE']!.attribution).toEqual(STATCAN_LFS_ATTRIBUTION);
    for (const item of items) {
      expect(Object.keys(item)).not.toContain('reference_period');
      expect(Object.keys(item)).not.toContain('provider_event_id'); // N12: 公開の項目を増やさない
    }
  });

  it('キーが無い・不正な行は、対象月なしの基本形(推測しない)', () => {
    const bad = { ...event('CA_CPI_TRIM', '2026-10'), provider_event_id: null };
    const [item] = buildCalendarItems([bad], [], {}, new Date('2026-11-10T00:00:00Z'));
    expect(item!.attribution?.notice).toBe(BASE_NOTICE);
  });
});

describe('GET /events/{id}(eventAttribution。ロック中・通常の両方の経路が同じ関数を使う)', () => {
  const row = (key: string | null, code = 'CA_CPI_TRIM'): EventRow =>
    ({
      id: 'ev-1',
      indicator_code: code,
      release_datetime: RELEASE,
      provider_event_id: key === null ? null : `statcan_release_schedule:${code}:${key}`,
    }) as unknown as EventRow;
  const app = (snapshots: unknown[] = []) => {
    const error = vi.fn();
    return {
      app: {
        supabase: fakeSupabaseClient({ event_snapshots: snapshots }),
        log: { error },
      } as unknown as FastifyInstance,
      error,
    };
  };

  it('N7・N8 値の有無・プランにかかわらず、同じ notice(対象月つき)。スナップショットの verification_source と一致する', async () => {
    const withSnapshot = app([
      { event_id: 'ev-1', snapshot_type: 'RELEASE', verification_source: 'v108785715@2026-10' },
    ]);
    expect((await eventAttribution(withSnapshot.app, row('2026-10')))?.notice).toBe(notice('October 2026'));
    const scheduledOnly = app();
    expect((await eventAttribution(scheduledOnly.app, row('2026-10')))?.notice).toBe(notice('October 2026'));
    expect(withSnapshot.error).not.toHaveBeenCalled();
  });

  it('N10 キーとスナップショットの食い違い・キー欠落は基本形で、ATTRIBUTION_REFERENCE_PERIOD_INVALID をログに残す', async () => {
    const mismatch = app([{ event_id: 'ev-1', snapshot_type: 'RELEASE', verification_source: 'v108785715@2026-09' }]);
    expect((await eventAttribution(mismatch.app, row('2026-10')))?.notice).toBe(BASE_NOTICE);
    expect(mismatch.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ATTRIBUTION_REFERENCE_PERIOD_INVALID',
        event_id: 'ev-1',
        indicator: 'CA_CPI_TRIM',
      }),
      'ATTRIBUTION_REFERENCE_PERIOD_INVALID',
    );
    const missing = app();
    expect((await eventAttribution(missing.app, row(null)))?.notice).toBe(BASE_NOTICE);
    expect(missing.error).toHaveBeenCalledTimes(1);
  });

  it('N14 コア以外の指標は、スナップショットを読まず従来どおり', async () => {
    const { app: a } = app();
    expect(await eventAttribution(a, row('2026-11', 'CA_UNEMPLOYMENT_RATE'))).toEqual(STATCAN_LFS_ATTRIBUTION);
    expect(await eventAttribution(a, row('2026-10', 'US_CPI'))).toBeNull();
  });

  it('N12 公開 API のスキーマ・ルートに reference_period の項目は無い', () => {
    for (const file of [
      'src/routes/events.ts',
      'src/routes/calendar.ts',
      'src/routes/indicators.ts',
      'src/domain/calendar.ts',
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('reference_period');
    }
  });
});
