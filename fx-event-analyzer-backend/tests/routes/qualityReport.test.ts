import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import type { QualityReader } from '../../src/ingestion/quality/reader.js';

/** A reader with no data anywhere — enough to exercise the route without a real DB. */
const EMPTY_READER: QualityReader = {
  listPairs: () => Promise.resolve([]),
  listFxRows: () => Promise.resolve([]),
  firstCandleAt: () => Promise.resolve(null),
  countEconomicEvents: () => Promise.resolve(0),
  listCreditUsage: () => Promise.resolve(null),
  listReleases: () => Promise.resolve([]),
  listLogs: () => Promise.resolve([]),
  listSnapshots: () => Promise.resolve([]),
  listStaged: () => Promise.resolve([]),
  listSpeechRuns: () => Promise.resolve([]),
  speechDbStatus: () => Promise.resolve({ latestAt: null, futureScheduled: 0 }),
  listProvisionalEvents: () => Promise.resolve([]),
};

function buildTestApp(envOverrides: Record<string, string> = {}): FastifyInstance {
  return buildApp({
    env: loadEnv({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ...envOverrides,
    }),
    supabase: {} as SupabaseClient, // the route never touches it — qualityReader is injected below
    qualityReader: EMPTY_READER,
    logger: false,
  });
}

/** GET /api/v1/quality-report (HQ判断 2026-10-17: 実機テスト中に見られる品質レポート) */
describe('GET /api/v1/quality-report', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('404s when INTERNAL_REPORT_TOKEN is unset (disabled by default)', async () => {
    app = buildTestApp();
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/v1/quality-report?token=anything' });
    expect(response.statusCode).toBe(404);
  });

  it('404s a wrong or missing token even when the feature is configured', async () => {
    app = buildTestApp({ INTERNAL_REPORT_TOKEN: 'secret-token' });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/v1/quality-report' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/quality-report?token=wrong' })).statusCode).toBe(404);
  });

  it('renders the Markdown report as HTML when the token matches', async () => {
    app = buildTestApp({ INTERNAL_REPORT_TOKEN: 'secret-token' });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/v1/quality-report?token=secret-token' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('<meta name="viewport"');
    expect(response.body).toContain('# データ品質レポート(直近7日)');
    expect(response.body).toContain('## 1. 為替1分足の取得率・欠損率');
    expect(response.body).toContain('## 9. 要人発言の鮮度');
  });

  it('rejects an out-of-range days parameter', async () => {
    app = buildTestApp({ INTERNAL_REPORT_TOKEN: 'secret-token' });
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/quality-report?token=secret-token&days=0',
    });
    expect(response.statusCode).toBe(422);
  });

  it('escapes HTML in the rendered report so nothing injects markup', async () => {
    const reader: QualityReader = {
      ...EMPTY_READER,
      listPairs: () => Promise.resolve([{ id: 'p1', symbol: '<script>alert(1)</script>' }]),
    };
    app = buildApp({
      env: loadEnv({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        INTERNAL_REPORT_TOKEN: 'secret-token',
      }),
      supabase: {} as SupabaseClient,
      qualityReader: reader,
      logger: false,
    });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/v1/quality-report?token=secret-token' });
    expect(response.body).not.toContain('<script>');
    expect(response.body).toContain('&lt;script&gt;');
  });
});
