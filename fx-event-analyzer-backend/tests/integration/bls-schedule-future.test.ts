import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BlsScheduleEntry } from '../../src/ingestion/mappings/blsSchedule.js';
import { findMappingByCode, type IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import { BLS_SCHEDULE_PROVIDER, syncBlsScheduledEvents } from '../../src/ingestion/pipelines/blsCalendar.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * BLS future schedule rows (HQ承認 Task 2) against a real local Supabase
 * stack: the job only writes economic_events, and the DB trigger
 * trg_economic_events_schedule_change (migration 20261015000002) is what
 * records RESCHEDULED / CANCELLED in event_schedule_changes — the in-memory
 * store only imitates it, so this suite checks the real trigger.
 *
 * Uses its own inactive indicator (unique per run) and 2031 dates so no
 * other suite sees these rows; everything it creates is deleted afterwards.
 */
describe.skipIf(!integration)('BLS schedule: future SCHEDULED rows + DB schedule-change trigger', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}`;
  const indicatorCode = `IT_BLS_${runId}`;
  const now = () => new Date('2030-12-01T00:00:00Z');
  let mappings: IndicatorMapping[];
  const eventIds: string[] = [];

  function entry(
    referencePeriod: string,
    releaseDate: string,
    extra: Partial<BlsScheduleEntry> = {},
  ): BlsScheduleEntry {
    return { indicatorCode, referencePeriod, releaseDate, ...extra } as unknown as BlsScheduleEntry;
  }

  async function sync(entries: BlsScheduleEntry[]) {
    const counters = new JobCounters();
    const store = createIngestionRepository(ctx.serviceClient);
    const counts = await syncBlsScheduledEvents({ store, entries, mappings, now }, counters);
    expect(counters.errorMessages).toEqual([]);
    return counts;
  }

  async function row(referencePeriod: string) {
    const { data, error } = await ctx.serviceClient
      .from('economic_events')
      .select('id, status, data_status, release_datetime, release_datetime_precision')
      .eq('provider', BLS_SCHEDULE_PROVIDER)
      .eq('provider_event_id', `${BLS_SCHEDULE_PROVIDER}:${indicatorCode}:${referencePeriod}`);
    if (error) throw error;
    expect(data).toHaveLength(1);
    const found = data[0] as {
      id: string;
      status: string;
      data_status: string;
      release_datetime: string;
      release_datetime_precision: string;
    };
    if (!eventIds.includes(found.id)) eventIds.push(found.id);
    return found;
  }

  async function changes(targetId: string) {
    const { data, error } = await ctx.serviceClient
      .from('event_schedule_changes')
      .select('change_type, old_datetime, new_datetime')
      .eq('target_id', targetId)
      .order('changed_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((c: { change_type: string; old_datetime: string; new_datetime: string | null }) => ({
      change_type: c.change_type,
      old_datetime: Date.parse(c.old_datetime),
      new_datetime: c.new_datetime === null ? null : Date.parse(c.new_datetime),
    }));
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const base = findMappingByCode('US_CPI')!;
    mappings = [{ ...base, code: indicatorCode, providers: { bls_schedule: { country: 'US', event: indicatorCode } } }];
    const { error } = await ctx.serviceClient.from('economic_indicators').insert({
      code: indicatorCode,
      name: `結合テスト用BLS予定 ${runId}`,
      country_code: 'US',
      currency_code: 'USD',
      importance: 'HIGH',
      frequency: 'MONTHLY',
      unit: '%',
      favorable_direction: 'HIGHER_IS_POSITIVE',
      is_active: false,
    });
    if (error) throw new Error(`Failed to insert test indicator: ${error.message}`);
  });

  afterAll(async () => {
    if (!ctx) return;
    if (eventIds.length > 0) {
      await ctx.serviceClient.from('event_schedule_changes').delete().in('target_id', eventIds);
      await ctx.serviceClient.from('economic_events').delete().in('id', eventIds);
    }
    await ctx.serviceClient.from('economic_indicators').delete().eq('code', indicatorCode);
  });

  it('inserts a SCHEDULED row once; a table date change updates the same row and the trigger records RESCHEDULED', async () => {
    // 2031-01-10 08:30 EST → 13:30Z
    expect(await sync([entry('2030-12', '2031-01-10')])).toMatchObject({ scheduled_inserted: 1 });
    expect(await sync([entry('2030-12', '2031-01-10')])).toMatchObject({
      scheduled_inserted: 0,
      scheduled_unchanged: 1,
    });
    const before = await row('2030-12');
    expect(before).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING', release_datetime_precision: 'EXACT' });
    expect(Date.parse(before.release_datetime)).toBe(Date.parse('2031-01-10T13:30:00Z'));
    expect(await changes(before.id)).toEqual([]);

    expect(await sync([entry('2030-12', '2031-01-17')])).toMatchObject({ scheduled_updated: 1 });
    const after = await row('2030-12');
    expect(after.id).toBe(before.id);
    expect(Date.parse(after.release_datetime)).toBe(Date.parse('2031-01-17T13:30:00Z'));
    expect(await changes(after.id)).toEqual([
      {
        change_type: 'RESCHEDULED',
        old_datetime: Date.parse('2031-01-10T13:30:00Z'),
        new_datetime: Date.parse('2031-01-17T13:30:00Z'),
      },
    ]);
  });

  it('a cancelled entry turns the SCHEDULED row CANCELLED and the trigger records CANCELLED', async () => {
    expect(await sync([entry('2031-01', '2031-02-07')])).toMatchObject({ scheduled_inserted: 1 });
    const scheduled = await row('2031-01');
    const cancelled = entry('2031-01', '2031-02-07', { cancelled: true, cancelledNote: 'integration test' });
    expect(await sync([cancelled])).toMatchObject({ cancelled: 1 });
    expect(await row('2031-01')).toMatchObject({ id: scheduled.id, status: 'CANCELLED', data_status: 'UNAVAILABLE' });
    expect(await changes(scheduled.id)).toEqual([
      { change_type: 'CANCELLED', old_datetime: Date.parse('2031-02-07T13:30:00Z'), new_datetime: null },
    ]);
    expect(await sync([cancelled])).toMatchObject({ cancelled: 0, cancelled_unchanged: 1 });
    expect(await changes(scheduled.id)).toHaveLength(1);
  });
});
