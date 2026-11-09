import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQualityReader } from '../../src/ingestion/quality/reader.js';
import type { NewStagedValue } from '../../src/ingestion/store.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

/**
 * 取り込みの運用データの表 (migration 20261022000004_ingestion_tables_access.sql,
 * HQ判断 2026-10-22): anon / authenticated はどの操作も権限エラー(42501)。
 * Backend の取り込みジョブ(ingestionRepository)と品質レポート(quality/reader)は
 * service_role でこれまでどおり読み書きできる。
 *
 * Own indicator and a SCHEDULED 2097 event (staged values reference an event),
 * logs / staged values dated 2097-03-01, a unique official series id — no other
 * suite's date-based assertions see them. Everything is deleted afterwards.
 */
describe.skipIf(!integration)('Ingestion tables: no client access, service_role paths unchanged', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  const runId = `${Date.now()}`;
  const job = `integration-test-ingestion-access-${runId}`;
  const seriesId = `IT_ACCESS_${runId}`;
  const AT = '2097-03-01T00:00:00Z';
  const WINDOW = { from: '2097-02-28T00:00:00Z', to: '2097-03-02T00:00:00Z' };
  let indicatorId = '';
  let eventId = '';

  const TABLES = [
    { table: 'ingestion_logs', column: 'provider' },
    { table: 'ingestion_staged_values', column: 'provider' },
    { table: 'official_observations', column: 'series_id' },
  ] as const;

  function asUser(token: string): SupabaseClient {
    return createClient(ctx.supabaseUrl, ctx.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  function roles(): { label: string; client: SupabaseClient; deniedStatus: number }[] {
    return [
      {
        label: 'anon',
        client: createClient(ctx.supabaseUrl, ctx.anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        }),
        deniedStatus: 401,
      },
      { label: 'authenticated', client: asUser(user.accessToken), deniedStatus: 403 },
    ];
  }

  type Result = { data: unknown; error: { code?: string; message: string } | null; status: number };

  /** A privilege error (not "0 rows" from RLS, not the RLS write error). */
  function expectDenied(result: Result, table: string, deniedStatus: number, label: string): void {
    const detail = `${label}: ${JSON.stringify({ status: result.status, error: result.error, data: result.data })}`;
    expect(result.status, detail).toBe(deniedStatus);
    expect(result.error?.code, detail).toBe('42501');
    expect(result.error?.message, detail).toBe(`permission denied for table ${table}`);
    expect(result.data, detail).toBeNull();
  }

  function stagedValue(): NewStagedValue {
    return {
      event_id: eventId,
      kind: 'RELEASE',
      revision_field: null,
      provider: 'integration-test',
      provider_event_id: `ingestion-access-${runId}`,
      indicator_code: `IT_ACCESS_${runId}`,
      reference_period: '2097-02',
      forecast: 1.1,
      actual: 1.2,
      previous: 1.0,
      old_value: null,
      new_value: null,
      unit: '%',
      source: 'integration-test',
      source_url: null,
      release_status: 'UNKNOWN',
      fetched_at: AT,
      official_actual: null,
      official_source: null,
      verification_status: 'AWAITING_OFFICIAL',
      reasons: [],
    };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    user = await createTestUser(ctx);
    const indicator = await ctx.serviceClient
      .from('economic_indicators')
      .insert({
        code: `IT_INGESTION_ACCESS_${runId}`,
        name: `結合テスト用指標(取り込みの表の権限) ${runId}`,
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
    if (indicator.error) throw new Error(`indicator: ${indicator.error.message}`);
    indicatorId = indicator.data.id;
    const event = await ctx.serviceClient
      .from('economic_events')
      .insert({
        indicator_id: indicatorId,
        provider: 'integration-test',
        provider_event_id: `ingestion-access-${runId}`,
        release_datetime: AT,
        release_datetime_precision: 'EXACT',
        importance: 'LOW',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      })
      .select('id')
      .single();
    if (event.error) throw new Error(`event: ${event.error.message}`);
    eventId = event.data.id;
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('ingestion_logs').delete().eq('job', job);
    if (eventId) await ctx.serviceClient.from('ingestion_staged_values').delete().eq('event_id', eventId);
    await ctx.serviceClient.from('official_observations').delete().eq('series_id', seriesId);
    if (eventId) await ctx.serviceClient.from('economic_events').delete().eq('id', eventId);
    if (indicatorId) await ctx.serviceClient.from('economic_indicators').delete().eq('id', indicatorId);
    if (user) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('service_role: the ingestion repository writes and reads all three tables', async () => {
    const store = createIngestionRepository(ctx.serviceClient);

    await store.insertIngestionLog({
      provider: 'integration-test',
      data_type: 'OTHER',
      job,
      started_at: AT,
      completed_at: AT,
      status: 'SUCCESS',
      fetched_count: 1,
      success_count: 1,
      error_count: 0,
      skipped_count: 0,
      review_count: 0,
      error_message: null,
      details: { run: runId },
    });

    await store.insertStagedValue(stagedValue());
    const open = await store.findOpenStagedValue(eventId, 'RELEASE', null);
    expect(open).toMatchObject({ event_id: eventId, verification_status: 'AWAITING_OFFICIAL' });
    await store.updateStagedValue(open!.id, { verification_status: 'PENDING_REVIEW', reasons: ['IT_ACCESS'] });
    const pending = await store.listStagedValues('PENDING_REVIEW');
    expect(pending.find((row) => row.id === open!.id)).toMatchObject({
      reasons: ['IT_ACCESS'],
      release_datetime: expect.any(String),
    });

    const written = await store.upsertOfficialObservations([
      {
        source: 'FRED',
        series_id: seriesId,
        period_start: '2097-02-01',
        as_of_date: '2097-03-01',
        value: 1.25,
        release_status: 'UNKNOWN',
        fetched_at: AT,
      },
    ]);
    expect(written).toBe(1);
    const observations = await ctx.serviceClient
      .from('official_observations')
      .select('value')
      .eq('series_id', seriesId);
    expect(observations.error).toBeNull();
    expect(Number((observations.data ?? [])[0]?.value)).toBeCloseTo(1.25);
  });

  it('service_role: the quality report reader still reads ingestion_logs and ingestion_staged_values', async () => {
    const reader = createQualityReader(ctx.serviceClient);
    const logs = await reader.listLogs(WINDOW.from, WINDOW.to);
    expect(logs.some((log) => (log as { job?: string }).job === job)).toBe(true);
    const staged = await reader.listStaged(WINDOW.from, WINDOW.to);
    expect(staged.some((row) => row.indicator_code === `IT_ACCESS_${runId}`)).toBe(true);
  });

  it('anon / authenticated: SELECT, count-only, INSERT, UPDATE and DELETE all fail with 42501', async () => {
    for (const { label, client, deniedStatus } of roles()) {
      for (const { table, column } of TABLES) {
        expectDenied(await client.from(table).select('*').limit(5), table, deniedStatus, `${label} select ${table}`);

        const count = await client.from(table).select('*', { count: 'exact', head: true });
        expect(count.status, `${label} count ${table}`).toBe(deniedStatus);
        expect(count.error, `${label} count ${table}`).not.toBeNull();
        expect(count.count, `${label} count ${table}`).toBeNull();

        // The client has no generated DB types, so the row's type is not checked here.
        const row = { [column]: 'direct-write' } as never;
        expectDenied(await client.from(table).insert(row), table, deniedStatus, `${label} insert ${table}`);
        expectDenied(
          await client.from(table).update(row).eq(column, 'integration-test'),
          table,
          deniedStatus,
          `${label} update ${table}`,
        );
        expectDenied(
          await client.from(table).delete().eq(column, 'integration-test'),
          table,
          deniedStatus,
          `${label} delete ${table}`,
        );
      }
    }
    // Nothing was changed by the attempts.
    const log = await ctx.serviceClient.from('ingestion_logs').select('provider').eq('job', job);
    expect(log.data).toEqual([{ provider: 'integration-test' }]);
  });
});
