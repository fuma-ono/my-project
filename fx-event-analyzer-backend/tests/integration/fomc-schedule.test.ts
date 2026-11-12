import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FomcScheduleEntry } from '../../src/ingestion/mappings/fomcSchedule.js';
import { FOMC_SCHEDULE_PROVIDER, ingestFomcSchedule } from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { IngestionStore } from '../../src/ingestion/store.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

const PLAIN_EVENT_ID = '3f000000-0000-0000-0000-000000000001';

/**
 * Migration 20261022000002 (economic_events.is_provisional) and the FOMC schedule job against
 * real Postgres (HQ承認 2026-10-22 Task 3). The job runs against its own inactive LOW-importance
 * test indicator (standing in for US_FOMC) and 2031 dates, so the CALENDAR_UPDATE rows the
 * triggers write here never reach another suite's users (they keep the default HIGH / MEDIUM
 * importances — same reasoning as rate-alerts-calendar-updates.test.ts). Removed in afterAll.
 */
describe.skipIf(!integration)('FOMC schedule: is_provisional column and schedule-change triggers', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}`;
  const now = () => new Date('2031-01-01T00:00:00Z');
  const indicatorCode = `IT_FOMC_${runId}`;
  let indicatorId: string;
  let store: IngestionStore;

  function entry(meetingEnd: string, overrides: Partial<FomcScheduleEntry> = {}): FomcScheduleEntry {
    const start = new Date(Date.parse(`${meetingEnd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return {
      meetingStart: start,
      meetingEnd,
      announcement: { date: meetingEnd, time: '14:00', timeZone: 'America/New_York' },
      sep: false,
      provisional: true,
      eventKey: `it-${runId}-${meetingEnd}`,
      sources: ['https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'],
      checkedAt: '2026-10-22',
      ...overrides,
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

  async function fomcRow(providerEventId: string) {
    const { data, error } = await ctx.serviceClient
      .from('economic_events')
      .select('id, release_datetime, release_datetime_precision, status, is_provisional')
      .eq('provider', FOMC_SCHEDULE_PROVIDER)
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
        name: `結合テスト用FOMC ${runId}`,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'LOW',
        frequency: 'IRREGULAR',
        unit: '%',
        favorable_direction: 'HIGHER_IS_POSITIVE',
        is_active: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert test indicator: ${error.message}`);
    indicatorId = data.id;
    const repository = createIngestionRepository(ctx.serviceClient);
    // The job looks up US_FOMC; hand it the test indicator instead.
    store = {
      ...repository,
      findIndicatorsByCode: () =>
        Promise.resolve(
          new Map([
            ['US_FOMC', { id: indicatorId, code: 'US_FOMC', importance: 'LOW', favorable_direction: 'NEUTRAL' }],
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

  it('the column exists and defaults to false for rows inserted without it', async () => {
    const { error } = await ctx.serviceClient.from('economic_events').insert({
      id: PLAIN_EVENT_ID,
      indicator_id: indicatorId,
      provider: 'integration-test',
      provider_event_id: `fomc-default-${runId}`,
      release_datetime: '2031-03-19T18:00:00Z',
      release_datetime_precision: 'EXACT',
      importance: 'LOW',
      status: 'SCHEDULED',
    });
    if (error) throw error;
    const { data, error: readError } = await ctx.serviceClient
      .from('economic_events')
      .select('is_provisional')
      .eq('id', PLAIN_EVENT_ID)
      .single();
    if (readError) throw readError;
    expect(data.is_provisional).toBe(false);
  });

  it('changing release_datetime records RESCHEDULED; flipping only is_provisional records nothing', async () => {
    const first = entry('2031-03-19');
    const firstRun = await ingestFomcSchedule({ store, entries: [first], now }, new JobCounters());
    expect(firstRun.inserted).toBe(1);
    const providerEventId = `fomc_schedule:${first.eventKey}`;
    const inserted = await fomcRow(providerEventId);
    expect(inserted).toMatchObject({ release_datetime_precision: 'EXACT', status: 'SCHEDULED', is_provisional: true });
    expect(new Date(inserted.release_datetime).toISOString()).toBe('2031-03-19T18:00:00.000Z');

    // Re-run: idempotent.
    const rerun = await ingestFomcSchedule({ store, entries: [first], now }, new JobCounters());
    expect(rerun).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });

    // provisional → confirmed: only is_provisional changes, no schedule change.
    const confirmed = await ingestFomcSchedule(
      { store, entries: [{ ...first, provisional: false }], now },
      new JobCounters(),
    );
    expect(confirmed.updated).toBe(1);
    expect((await fomcRow(providerEventId)).is_provisional).toBe(false);
    expect(await changesFor(inserted.id)).toEqual([]);

    // Direct SQL-level flip as well (not through the job).
    await ctx.serviceClient.from('economic_events').update({ is_provisional: true }).eq('id', inserted.id);
    expect(await changesFor(inserted.id)).toEqual([]);

    // Time change → same row, RESCHEDULED.
    const moved = { ...first, announcement: { ...first.announcement, time: '14:30' } };
    const movedRun = await ingestFomcSchedule({ store, entries: [moved], now }, new JobCounters());
    expect(movedRun.updated).toBe(1);
    const after = await fomcRow(providerEventId);
    expect(after.id).toBe(inserted.id);
    expect(new Date(after.release_datetime).toISOString()).toBe('2031-03-19T18:30:00.000Z');
    const changes = await changesFor(inserted.id);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.change_type).toBe('RESCHEDULED');
    expect(new Date(changes[0]!.old_datetime as string).toISOString()).toBe('2031-03-19T18:00:00.000Z');
    expect(new Date(changes[0]!.new_datetime as string).toISOString()).toBe('2031-03-19T18:30:00.000Z');
  });
});
