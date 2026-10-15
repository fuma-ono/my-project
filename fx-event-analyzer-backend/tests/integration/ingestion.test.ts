import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { findMappingByCode, type IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import { ingestCalendarReleases } from '../../src/ingestion/pipelines/economicCalendar.js';
import { runIngestionJob } from '../../src/ingestion/runner.js';
import type { NormalizedCalendarRelease } from '../../src/ingestion/types.js';
import type { OfficialValueResolver } from '../../src/ingestion/verification/official.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  grantEntitlement,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

/**
 * Ingestion Worker against a real local Supabase stack (data-sources.md §6):
 * upserts are idempotent, and a value held for review is NOT exposed by the
 * Read API (GET /events/{id} keeps DATA_PENDING with no snapshot).
 *
 * Uses its own inactive indicator and a 2031 release date so no other suite's
 * seed-based assertions see these rows. RELEASE snapshots are immutable (DB
 * trigger), so the published test event cannot be deleted afterwards; ids
 * are unique per run and CI recreates the database each run.
 */
describe.skipIf(!integration)('Ingestion: idempotent upsert + PENDING_REVIEW hidden from the Read API', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  const runId = `${Date.now()}`;
  const provider = 'tradingeconomics';
  const indicatorCode = `IT_INGEST_${runId}`;
  const job = `integration-test-${runId}`;
  const now = () => new Date('2031-01-15T00:00:00Z');
  let mapping: IndicatorMapping;

  const official: OfficialValueResolver = {
    resolve: (_mapping, period) =>
      Promise.resolve(period === '2030-12' ? { value: 3.7376, sourceRef: 'FRED:TEST@2031-01-14' } : null),
  };

  function release(id: string, actual: number): NormalizedCalendarRelease {
    return {
      provider,
      providerEventId: `it-${runId}-${id}`,
      providerIndicatorKey: `testland|test cpi ${runId}`,
      eventName: `Test CPI ${runId}`,
      // 08:30 EST
      releaseAt: '2031-01-14T13:30:00.000Z',
      releaseAtPrecision: 'EXACT',
      referencePeriod: '2030-12',
      actual: { value: actual, unit: '%' },
      forecast: { value: 3.6, unit: '%' },
      previous: { value: 3.4, unit: '%' },
      revisedPrevious: null,
      fetchedAt: '2031-01-15T00:00:00.000Z',
    };
  }

  async function ingest(releases: NormalizedCalendarRelease[]) {
    const store = createIngestionRepository(ctx.serviceClient);
    return runIngestionJob(
      store,
      { provider, dataType: 'ECONOMIC_EVENT', job },
      (counters) => ingestCalendarReleases(provider, releases, { store, official, mappings: [mapping], now }, counters),
      now,
    );
  }

  async function eventIdFor(id: string): Promise<string> {
    const { data, error } = await ctx.serviceClient
      .from('economic_events')
      .select('id')
      .eq('provider', provider)
      .eq('provider_event_id', `it-${runId}-${id}`);
    if (error) throw error;
    expect(data).toHaveLength(1);
    return (data[0] as { id: string }).id;
  }

  async function getEvent(eventId: string) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}`,
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const base = findMappingByCode('US_CPI')!;
    mapping = {
      ...base,
      code: indicatorCode,
      providers: { tradingeconomics: { country: 'Testland', event: `Test CPI ${runId}` } },
    };
    const { error } = await ctx.serviceClient.from('economic_indicators').insert({
      code: indicatorCode,
      name: `結合テスト用指標 ${runId}`,
      country_code: 'US',
      currency_code: 'USD',
      importance: 'HIGH',
      frequency: 'MONTHLY',
      unit: '%',
      favorable_direction: 'HIGHER_IS_POSITIVE',
      is_active: false,
    });
    if (error) throw new Error(`Failed to insert test indicator: ${error.message}`);
    user = await createTestUser(ctx);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('ingestion_staged_values').delete().eq('indicator_code', indicatorCode);
    await ctx.serviceClient.from('ingestion_logs').delete().eq('job', job);
    if (user) await deleteTestUser(ctx, user.id);
  });

  it('holds a mismatching actual as PENDING_REVIEW, idempotently, and the Read API shows DATA_PENDING', async () => {
    const first = await ingest([release('mismatch', 3.8)]);
    const second = await ingest([release('mismatch', 3.8)]);
    expect(first.counters.errorMessages).toEqual([]);
    expect(second.counters.errorMessages).toEqual([]);

    const eventId = await eventIdFor('mismatch');
    const staged = await ctx.serviceClient
      .from('ingestion_staged_values')
      .select('verification_status, reasons, actual, official_actual')
      .eq('event_id', eventId);
    expect(staged.data).toEqual([
      { verification_status: 'PENDING_REVIEW', reasons: ['OFFICIAL_MISMATCH'], actual: 3.8, official_actual: 3.7376 },
    ]);
    const snapshots = await ctx.serviceClient.from('event_snapshots').select('id').eq('event_id', eventId);
    expect(snapshots.data).toEqual([]);

    const { status, body } = await getEvent(eventId);
    expect(status).toBe(200);
    expect(body.event).toMatchObject({ status: 'RELEASED', data_status: 'DATA_PENDING' });
    expect(body.snapshot).toBeNull();
    expect(body.analysis).toEqual({ surprise: null, surprise_direction: null });
    expect(JSON.stringify(body)).not.toContain('3.8');
  });

  it('publishes a verified actual exactly once and the Read API returns it', async () => {
    await ingest([release('verified', 3.7)]);
    await ingest([release('verified', 3.7)]);
    const eventId = await eventIdFor('verified');

    const snapshots = await ctx.serviceClient
      .from('event_snapshots')
      .select('snapshot_type, actual, verification_status, verification_source')
      .eq('event_id', eventId);
    expect(snapshots.data).toEqual([
      {
        snapshot_type: 'RELEASE',
        actual: 3.7,
        verification_status: 'VERIFIED',
        verification_source: 'FRED:TEST@2031-01-14',
      },
    ]);

    const { body } = await getEvent(eventId);
    expect(body.event.data_status).toBe('READY');
    expect(body.snapshot).toMatchObject({ actual: 3.7, forecast: 3.6, previous: 3.4, unit: '%' });
    expect(body.analysis.surprise_direction).toBe('POSITIVE');
  });

  it('records every run in ingestion_logs', async () => {
    const { data, error } = await ctx.serviceClient
      .from('ingestion_logs')
      .select('provider, data_type, status, job')
      .eq('job', job);
    if (error) throw error;
    expect(data.length).toBeGreaterThanOrEqual(4);
    expect(data.every((row) => row.status === 'SUCCESS' && row.data_type === 'ECONOMIC_EVENT')).toBe(true);
  });
});
