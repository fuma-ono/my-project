import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RetailSalesScheduleEntry } from '../../src/ingestion/mappings/retailSalesSchedule.js';
import {
  RETAIL_SALES_SCHEDULE_PROVIDER,
  ingestRetailSalesSchedule,
} from '../../src/ingestion/pipelines/retailSalesSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { IngestionStore } from '../../src/ingestion/store.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * US_RETAIL_SALES schedule ingestion against real Postgres (HQ承認 2026-11-05「US_RETAIL_SALES
 * 公式発表日程の自動取り込み実装」案A)。migration 20261105000001 で入る本物のUS_RETAIL_SALES行
 * ではなく、このテスト専用のLOW重要度の指標を使う(fomc-schedule.test.tsと同じ理由: トリガーが
 * 書くevent_schedule_changesの行を他のテストのユーザーに触れさせないため)。afterAllで削除する。
 */
describe.skipIf(!integration)('Retail sales schedule: real upsert + schedule-change triggers', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}`;
  const now = () => new Date('2031-01-01T00:00:00Z');
  const indicatorCode = `IT_RETAIL_${runId}`;
  let indicatorId: string;
  let store: IngestionStore;

  function entry(referencePeriod: string, releaseDate: string): RetailSalesScheduleEntry {
    return {
      referencePeriod,
      releaseDate,
      sources: ['https://www.census.gov/retail/release_schedule.html'],
      checkedAt: '2026-11-05',
    };
  }

  async function changesFor(targetId: string) {
    const { data, error } = await ctx.serviceClient
      .from('event_schedule_changes')
      .select('change_type, old_datetime, new_datetime')
      .eq('target_id', targetId);
    if (error) throw error;
    return data ?? [];
  }

  async function retailRow(providerEventId: string) {
    const { data, error } = await ctx.serviceClient
      .from('economic_events')
      .select('id, release_datetime, release_datetime_precision, status')
      .eq('provider', RETAIL_SALES_SCHEDULE_PROVIDER)
      .eq('provider_event_id', providerEventId)
      .single();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .insert({
        code: indicatorCode,
        name: `結合テスト用小売売上高 ${runId}`,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'LOW',
        frequency: 'MONTHLY',
        unit: '%',
        favorable_direction: 'HIGHER_IS_POSITIVE',
        is_active: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert test indicator: ${error.message}`);
    indicatorId = data.id;
    const repository = createIngestionRepository(ctx.serviceClient);
    // The pipeline looks up US_RETAIL_SALES; hand it the test indicator instead.
    store = {
      ...repository,
      findIndicatorsByCode: () =>
        Promise.resolve(
          new Map([
            [
              'US_RETAIL_SALES',
              { id: indicatorId, code: 'US_RETAIL_SALES', importance: 'LOW', favorable_direction: 'NEUTRAL' },
            ],
          ]),
        ),
    };
  });

  afterAll(async () => {
    if (!ctx) return;
    if (indicatorId) {
      const { data } = await ctx.serviceClient.from('economic_events').select('id').eq('indicator_id', indicatorId);
      const ids = (data ?? []).map((row: { id: string }) => row.id);
      if (ids.length > 0) {
        await ctx.serviceClient.from('event_schedule_changes').delete().in('target_id', ids);
        await ctx.serviceClient.from('economic_events').delete().in('id', ids);
      }
      await ctx.serviceClient.from('economic_indicators').delete().eq('id', indicatorId);
    }
    await ctx.app.close();
  });

  it('inserts a SCHEDULED row, is idempotent on re-run, and records RESCHEDULED only when the date actually changes', async () => {
    const first = entry('2031-02', '2031-03-17');
    const firstRun = await ingestRetailSalesSchedule({ store, entries: [first], now }, new JobCounters());
    expect(firstRun.inserted).toBe(1);
    const providerEventId = `${RETAIL_SALES_SCHEDULE_PROVIDER}:2031-02`;
    const inserted = await retailRow(providerEventId);
    expect(inserted).toMatchObject({ release_datetime_precision: 'EXACT', status: 'SCHEDULED' });
    expect(new Date(inserted.release_datetime).toISOString()).toBe('2031-03-17T12:30:00.000Z');

    // Re-run: idempotent, no duplicate row, no schedule change recorded.
    const rerun = await ingestRetailSalesSchedule({ store, entries: [first], now }, new JobCounters());
    expect(rerun).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(await changesFor(inserted.id)).toEqual([]);

    // A changed release date updates the same row (RESCHEDULED by the DB trigger).
    const moved = entry('2031-02', '2031-03-18');
    const movedRun = await ingestRetailSalesSchedule({ store, entries: [moved], now }, new JobCounters());
    expect(movedRun.updated).toBe(1);
    const after = await retailRow(providerEventId);
    expect(after.id).toBe(inserted.id);
    expect(new Date(after.release_datetime).toISOString()).toBe('2031-03-18T12:30:00.000Z');
    const changes = await changesFor(inserted.id);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.change_type).toBe('RESCHEDULED');
    expect(new Date(changes[0]!.old_datetime as string).toISOString()).toBe('2031-03-17T12:30:00.000Z');
    expect(new Date(changes[0]!.new_datetime as string).toISOString()).toBe('2031-03-18T12:30:00.000Z');
  });
});
