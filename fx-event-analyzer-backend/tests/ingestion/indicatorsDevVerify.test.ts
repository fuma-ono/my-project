/** HQ指示(2026-11-12「GB/AU 経済指標の DEV 検証」): 経済指標の読み取り専用の確認の集計。 */
import { describe, expect, it } from 'vitest';
import { READ_ONLY_TABLES } from '../../src/ingestion/verify/readOnlyDb.js';
import {
  buildIndicatorsDevReport,
  duplicateEvents,
  eventValues,
  existingEventsFingerprint,
  GB_AU_CA_CODES,
  type VerifyEventRow,
  type VerifyIndicatorRow,
  type VerifyPairRow,
} from '../../src/ingestion/verify/indicatorsDevReport.js';

const ind = (code: string, id: string, extra: Partial<VerifyIndicatorRow> = {}): VerifyIndicatorRow => ({
  id,
  code,
  name: code,
  country_code: code.slice(0, 2),
  currency_code: 'GBP',
  importance: 'HIGH',
  source: 'src',
  source_url: 'https://example.invalid',
  is_active: true,
  ...extra,
});

describe('buildIndicatorsDevReport', () => {
  const indicators = [
    ind('GB_CPI', 'i1', { display_name: '消費者物価指数（CPI）' }),
    ind('AU_CPI', 'i2'),
    ind('US_CPI', 'i3'),
  ];
  const pairs: VerifyPairRow[] = [
    { indicator_id: 'i1', is_active: true, fx_pairs: { symbol: 'GBPUSD' } },
    { indicator_id: 'i1', is_active: true, fx_pairs: { symbol: 'GBPJPY' } },
    { indicator_id: 'i1', is_active: false, fx_pairs: { symbol: 'EURGBP' } },
    { indicator_id: 'i2', is_active: true, fx_pairs: { symbol: 'AUDUSD' } },
  ];
  const events: VerifyEventRow[] = [
    {
      id: 'e1',
      indicator_id: 'i3',
      provider: 'bls_schedule',
      status: 'RELEASED',
      data_status: 'AVAILABLE',
      release_datetime: '2026-11-10T13:30:00Z',
    },
    {
      id: 'e2',
      indicator_id: 'i3',
      provider: 'bls_schedule',
      status: 'SCHEDULED',
      data_status: 'PENDING',
      release_datetime: '2026-12-10T13:30:00Z',
    },
    {
      id: 'e3',
      indicator_id: 'i1',
      provider: 'ons_release_calendar',
      status: 'RELEASED',
      data_status: 'AVAILABLE',
      release_datetime: '2026-10-21T06:00:00Z',
    },
  ];
  const snapshots = [
    { event_id: 'e1', actual: 3.1, previous: 3.0, source: 'BLS' },
    { event_id: 'e3', actual: 3.8, previous: 3.6, source: 'ONS' },
  ];
  const report = buildIndicatorsDevReport(indicators, pairs, events, snapshots, new Date('2026-11-12T10:00:00Z'));

  it('counts active pairs, events by status and snapshots with a value per indicator', () => {
    const gb = report.indicators.find((i) => i.code === 'GB_CPI')!;
    expect(gb).toMatchObject({
      display_name: '消費者物価指数（CPI）',
      pairs: ['GBPJPY', 'GBPUSD'],
      events_total: 1,
      snapshots_with_actual: 1,
    });
    expect(gb.events).toEqual({ 'RELEASED/AVAILABLE': 1 });
    const au = report.indicators.find((i) => i.code === 'AU_CPI')!;
    expect(au).toMatchObject({ pairs: ['AUDUSD'], events_total: 0, snapshots_with_actual: 0 });
    expect(report.eventsByProvider).toEqual({ bls_schedule: 2, ons_release_calendar: 1 });
  });

  it('lists the GB/AU/CA indicators that are missing from the DB', () => {
    expect(report.missing).toEqual(GB_AU_CA_CODES.filter((c) => c !== 'GB_CPI' && c !== 'AU_CPI'));
  });

  it('eventValues returns only the requested codes, ordered, with value and source', () => {
    expect(eventValues(indicators, events, snapshots, ['GB_CPI', 'AU_CPI'], 10)).toEqual([
      ['GB_CPI', '2026-10-21T06:00:00Z', 'RELEASED', 'AVAILABLE', 3.8, 3.6, 'ONS'],
    ]);
  });
});

describe('read-only tables', () => {
  it('allows only reading the tables needed for the checks', () => {
    expect([...READ_ONLY_TABLES]).toEqual([
      'speech_events',
      'ingestion_logs',
      'economic_indicators',
      'indicator_fx_pairs',
      'economic_events',
      'event_snapshots',
      'api_credit_usage',
    ]);
  });
});

describe('existingEventsFingerprint and duplicateEvents', () => {
  const ev = (id: string, createdAt: string, extra: Partial<VerifyEventRow> = {}): VerifyEventRow => ({
    id,
    indicator_id: 'i1',
    provider: 'bls_schedule',
    provider_event_id: `bls_schedule:${id}`,
    status: 'SCHEDULED',
    data_status: 'PENDING',
    release_datetime: `2026-12-0${id}T13:30:00Z`,
    created_at: createdAt,
    ...extra,
  });
  const before = [ev('1', '2026-11-01T00:00:00Z'), ev('2', '2026-11-02T00:00:00Z')];
  const CUT = '2026-11-13T03:00:00Z';

  it('is the same after new rows are added (created after the cutoff), different if an existing row changes', () => {
    const a = existingEventsFingerprint(before, CUT);
    const withNew = [...before, ev('3', '2026-11-13T05:00:00Z')];
    expect(existingEventsFingerprint(withNew, CUT)).toEqual(a);
    expect(a.n).toBe(2);
    const changed = [ev('1', '2026-11-01T00:00:00Z', { status: 'RELEASED' }), before[1]!];
    expect(existingEventsFingerprint(changed, CUT).fingerprint).not.toBe(a.fingerprint);
    expect(existingEventsFingerprint([before[1]!, before[0]!], CUT)).toEqual(a); // 並びに依らない
  });

  it('finds duplicates by provider_event_id and by indicator + time', () => {
    expect(duplicateEvents(before)).toEqual({ byProviderEventId: [], byIndicatorAndTime: [] });
    const dup = [
      ...before,
      ev('9', '2026-11-13T05:00:00Z', {
        provider_event_id: 'bls_schedule:1',
        release_datetime: '2026-12-01T13:30:00Z',
      }),
    ];
    const found = duplicateEvents(dup);
    expect(found.byProviderEventId).toEqual(['bls_schedule:bls_schedule:1 x2']);
    expect(found.byIndicatorAndTime).toEqual(['i1@2026-12-01T13:30:00Z x2']);
  });
});
