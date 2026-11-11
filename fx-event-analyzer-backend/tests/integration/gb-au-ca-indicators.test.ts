import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { ingestOfficialScheduleTables } from '../../src/ingestion/pipelines/officialScheduleTable.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

const CODES = [
  'GB_CPI',
  'GB_CORE_CPI',
  'GB_UNEMPLOYMENT_RATE',
  'AU_CPI',
  'AU_UNEMPLOYMENT_RATE',
  'CA_CPI',
  'CA_UNEMPLOYMENT_RATE',
];

/**
 * migration 20261110000002(英国・豪州・カナダの7指標と関連の通貨ペア)と、公表予定の表の取り込みを本物の Postgres で
 * 確かめる(HQ指示 2026-11-10)。取り込みは、このテスト専用の provider と 2091 年の日付で行い(ほかのテストの期間に
 * 入らない)、終わったら消す。
 */
describe.skipIf(!integration)('GB/AU/CA indicators: migration + schedule table ingestion', () => {
  let ctx: IntegrationContext;
  const provider = `it_official_schedule_${Date.now()}`;

  beforeAll(() => {
    ctx = buildIntegrationContext(integration!);
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('economic_events').delete().eq('provider', provider);
    await ctx.app.close();
  });

  it('the migration adds the 7 indicators (GB / AU / CA, display names, currencies) with their FX pairs', async () => {
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .select(
        'code, country_code, currency_code, display_name, importance, is_active, indicator_fx_pairs(priority, fx_pairs(symbol))',
      )
      .in('code', CODES)
      .order('code');
    if (error) throw error;
    const rows = (data ?? []) as unknown as {
      code: string;
      country_code: string;
      currency_code: string;
      display_name: string;
      importance: string;
      is_active: boolean;
      indicator_fx_pairs: { priority: number; fx_pairs: { symbol: string } }[];
    }[];
    expect(rows.map((r) => r.code).sort()).toEqual([...CODES].sort());
    const pairs = Object.fromEntries(
      rows.map((r) => [
        r.code,
        [...r.indicator_fx_pairs].sort((a, b) => a.priority - b.priority).map((p) => p.fx_pairs.symbol),
      ]),
    );
    expect(pairs).toEqual({
      AU_CPI: ['AUDUSD', 'AUDJPY'],
      AU_UNEMPLOYMENT_RATE: ['AUDUSD', 'AUDJPY'],
      CA_CPI: ['CADJPY'],
      CA_UNEMPLOYMENT_RATE: ['CADJPY'],
      GB_CORE_CPI: ['GBPUSD', 'GBPJPY'],
      GB_CPI: ['GBPUSD', 'GBPJPY'],
      GB_UNEMPLOYMENT_RATE: ['GBPUSD', 'GBPJPY'],
    });
    const gb = rows.find((r) => r.code === 'GB_CPI')!;
    expect(gb).toMatchObject({
      country_code: 'GB',
      currency_code: 'GBP',
      display_name: '消費者物価指数（CPI）',
      importance: 'HIGH',
      is_active: true,
    });
    expect(rows.find((r) => r.code === 'CA_UNEMPLOYMENT_RATE')).toMatchObject({
      country_code: 'CA',
      currency_code: 'CAD',
      display_name: '失業率',
    });
  });

  it('the schedule table writes SCHEDULED rows into economic_events; a re-run adds nothing', async () => {
    const table: OfficialScheduleTable = {
      provider,
      entries: [
        {
          indicatorCode: 'GB_CPI',
          key: '2091-10',
          releaseDate: '2091-11-14',
          time: '07:00',
          timeZone: 'Europe/London',
          sources: ['https://www.ons.gov.uk/releasecalendar'],
          checkedAt: '2026-11-10',
        },
        {
          indicatorCode: 'AU_CPI',
          key: '2091-11-28',
          releaseDate: '2091-11-28',
          time: '11:30',
          timeZone: 'Australia/Sydney',
          sources: ['https://www.abs.gov.au/release-calendar/future-releases'],
          checkedAt: '2026-11-10',
        },
        {
          indicatorCode: 'CA_CPI',
          key: '2091-10',
          releaseDate: '2091-11-20',
          time: '08:30',
          timeZone: 'America/Toronto',
          sources: ['https://www150.statcan.gc.ca'],
          checkedAt: '2026-11-10',
        },
      ],
    };
    const store = createIngestionRepository(ctx.serviceClient);
    const now = () => new Date('2026-11-10T06:00:00Z');
    const first = new JobCounters();
    const result = await ingestOfficialScheduleTables({ store, tables: [table], now }, first);
    expect(first.errorMessages).toEqual([]);
    expect(result.inserted).toBe(3);
    const second = new JobCounters();
    expect((await ingestOfficialScheduleTables({ store, tables: [table], now }, second)).unchanged).toBe(3);

    const { data, error } = await ctx.serviceClient
      .from('economic_events')
      .select('provider_event_id, release_datetime, status, data_status, release_datetime_precision')
      .eq('provider', provider)
      .order('provider_event_id');
    if (error) throw error;
    expect(data).toHaveLength(3);
    const at = Object.fromEntries((data ?? []).map((r) => [r.provider_event_id, Date.parse(r.release_datetime)]));
    expect(at[`${provider}:GB_CPI:2091-10`]).toBe(Date.parse('2091-11-14T07:00:00Z')); // GMT
    expect(at[`${provider}:AU_CPI:2091-11-28`]).toBe(Date.parse('2091-11-28T00:30:00Z')); // AEDT
    expect(at[`${provider}:CA_CPI:2091-10`]).toBe(Date.parse('2091-11-20T13:30:00Z')); // EST
    expect(
      (data ?? []).every(
        (r) => r.status === 'SCHEDULED' && r.data_status === 'PENDING' && r.release_datetime_precision === 'EXACT',
      ),
    ).toBe(true);
  });
});
