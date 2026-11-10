import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ForecastRow } from '../../src/domain/consensusForecasts.js';
import { ingestConsensusForecasts } from '../../src/ingestion/pipelines/consensusForecasts.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { createForecastRepository } from '../../src/repositories/forecastRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * migration 20261110000003(indicator_forecasts)を本物の Postgres で確かめる(HQ指示 2026-11-10「市場予測値」)。
 * 2092 年の、このテスト専用の provider のイベントを使い、終わったら消す。
 */
describe.skipIf(!integration)('indicator_forecasts: append-only forecast history', () => {
  let ctx: IntegrationContext;
  const provider = `it_forecast_${Date.now()}`;
  const release = '2092-03-18T07:00:00.000Z';
  let eventId = '';
  const base = (): ForecastRow => ({
    event_id: eventId,
    indicator_code: 'GB_CPI',
    reference_period: '2092-02',
    release_datetime: release,
    forecast_kind: 'MARKET_CONSENSUS',
    forecast_value: 3.6,
    unit: '%',
    source: 'IT Consensus',
    source_url: 'https://example.org/it',
    fetched_at: '2092-03-17T12:00:00.000Z',
  });

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { data: indicator, error: e1 } = await ctx.serviceClient
      .from('economic_indicators')
      .select('id')
      .eq('code', 'GB_CPI')
      .single();
    if (e1) throw e1;
    const { data, error } = await ctx.serviceClient
      .from('economic_events')
      .insert({
        indicator_id: indicator.id,
        provider,
        provider_event_id: `${provider}:GB_CPI:2092-02`,
        release_datetime: release,
        release_datetime_precision: 'EXACT',
        importance: 'HIGH',
      })
      .select('id')
      .single();
    if (error) throw error;
    eventId = data.id;
  });

  afterAll(async () => {
    if (!ctx) return;
    if (eventId) await ctx.serviceClient.from('indicator_forecasts').delete().eq('event_id', eventId);
    await ctx.serviceClient.from('economic_events').delete().eq('provider', provider);
    await ctx.app.close();
  });

  it('keeps every fetch as history and the view returns the final pre-release forecast', async () => {
    const repo = createForecastRepository(ctx.serviceClient);
    await repo.insertForecast({ ...base(), forecast_value: 3.4, fetched_at: '2092-03-10T00:00:00.000Z' });
    await repo.insertForecast(base());
    await repo.insertForecast({
      ...base(),
      forecast_kind: 'OFFICIAL_PROJECTION',
      source: 'IT Bank',
      forecast_value: 3.0,
    });
    expect((await repo.listForecasts(eventId)).map((r) => r.forecast_value)).toEqual([3.4, 3.6, 3]);
    const finals = await repo.listFinalForecasts(eventId);
    expect(finals.map((f) => [f.forecast_kind, f.forecast_value]).sort()).toEqual([
      ['MARKET_CONSENSUS', 3.6],
      ['OFFICIAL_PROJECTION', 3],
    ]);
    expect((await repo.latestForecast(eventId, 'IT Consensus', 'MARKET_CONSENSUS'))?.forecast_value).toBe(3.6);
  });

  it('the DB rejects updates, post-release rows, another release time, blank unit/source and duplicates', async () => {
    const db = ctx.serviceClient.from('indicator_forecasts');
    const upd = await db.update({ forecast_value: 9 }).eq('event_id', eventId);
    expect(upd.error?.message).toMatch(/append-only/);
    const after = await ctx.serviceClient.from('indicator_forecasts').insert({ ...base(), fetched_at: release });
    expect(after.error).not.toBeNull();
    const otherRelease = await ctx.serviceClient
      .from('indicator_forecasts')
      .insert({ ...base(), release_datetime: '2092-03-19T07:00:00.000Z', fetched_at: '2092-03-11T00:00:00.000Z' });
    expect(otherRelease.error?.message).toMatch(/does not match the event/);
    const otherCode = await ctx.serviceClient
      .from('indicator_forecasts')
      .insert({ ...base(), indicator_code: 'US_CPI', fetched_at: '2092-03-11T00:00:00.000Z' });
    expect(otherCode.error?.message).toMatch(/does not match the event/);
    for (const bad of [
      { unit: ' ' },
      { source: '' },
      { source_url: 'http://example.org' },
      { reference_period: 'Oct' },
    ]) {
      const r = await ctx.serviceClient
        .from('indicator_forecasts')
        .insert({ ...base(), ...bad, fetched_at: '2092-03-12T00:00:00.000Z' });
      expect(r.error).not.toBeNull();
    }
    const dup = await ctx.serviceClient.from('indicator_forecasts').insert(base());
    expect(dup.error?.code).toBe('23505');
    const values = (await createForecastRepository(ctx.serviceClient).listForecasts(eventId)).map(
      (r) => r.forecast_value,
    );
    expect(values).toEqual([3.4, 3.6, 3]); // 何も変わっていない
  });

  it('the pipeline against the real table: re-run adds nothing, changed value adds a row', async () => {
    const repo = createForecastRepository(ctx.serviceClient);
    const sources = [{ source: 'IT Pipeline', kind: 'MARKET_CONSENSUS' as const, indicatorCodes: ['GB_CPI'] }];
    let value = 3.5;
    const adapters = [
      {
        source: 'IT Pipeline',
        sourceUrl: 'https://example.org/p',
        kind: 'MARKET_CONSENSUS' as const,
        fetch: () =>
          Promise.resolve([
            { indicatorCode: 'GB_CPI', referencePeriod: '2092-02', releaseDatetime: release, value, unit: '%' },
          ]),
      },
    ];
    const at = (iso: string) => () => new Date(iso);
    const horizonDays = 60;
    expect(
      (
        await ingestConsensusForecasts(
          { store: repo, adapters, sources, now: at('2092-03-01T00:00:00Z'), horizonDays },
          new JobCounters(),
        )
      ).inserted,
    ).toBe(1);
    expect(
      (
        await ingestConsensusForecasts(
          { store: repo, adapters, sources, now: at('2092-03-02T00:00:00Z'), horizonDays },
          new JobCounters(),
        )
      ).inserted,
    ).toBe(0);
    value = 3.7;
    expect(
      (
        await ingestConsensusForecasts(
          { store: repo, adapters, sources, now: at('2092-03-03T00:00:00Z'), horizonDays },
          new JobCounters(),
        )
      ).inserted,
    ).toBe(1);
    expect(
      (
        await ingestConsensusForecasts(
          { store: repo, adapters, sources, now: at(release), horizonDays },
          new JobCounters(),
        )
      ).inserted,
    ).toBe(0);
    const mine = (await repo.listForecasts(eventId))
      .filter((r) => r.source === 'IT Pipeline')
      .map((r) => r.forecast_value);
    expect(mine).toEqual([3.5, 3.7]);
  });

  it('anon / authenticated clients cannot read the table or the view', async () => {
    const anon = createClient(integration!.env.SUPABASE_URL, integration!.anonKey, { auth: { persistSession: false } });
    const t = await anon.from('indicator_forecasts').select('id').limit(1);
    expect(t.error?.code).toBe('42501');
    const v = await anon.from('indicator_forecast_finals').select('id').limit(1);
    expect(v.error?.code).toBe('42501');
  });
});
