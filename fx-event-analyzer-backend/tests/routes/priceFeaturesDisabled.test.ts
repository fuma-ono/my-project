import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * 価格由来の機能のフラグ(PRICE_FEATURES_ENABLED、オーナー決定 2026-11-24)が false のときの、API の挙動。
 * JWT の検証はモック(外部通信なし)。DB は fake で、読んだテーブル名を記録する:
 * 無効の間は fx_prices / event_price_reactions / rate_alerts / fx_pairs を一切読まないことを確かめる。
 */
const TOKEN = 'eyJ.price-features.sig';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const ID = '33333333-3333-3333-3333-333333333333';
const PRICE_TABLES = ['fx_prices', 'event_price_reactions', 'rate_alerts', 'fx_pairs'];

vi.mock('../../src/auth/jwt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/jwt.js')>();
  return {
    ...actual,
    verifySupabaseJwt: vi.fn((token: string | undefined) =>
      Promise.resolve(
        token === TOKEN
          ? { ok: true, payload: { sub: USER_ID, email: 'a@example.com', exp: 9_999_999_999 } }
          : { ok: false, reason: token ? 'invalid' : 'missing' },
      ),
    ),
  };
});

function recordingClient(tables: Record<string, unknown[]>): { client: SupabaseClient; reads: string[] } {
  const inner = fakeSupabaseClient(tables);
  const reads: string[] = [];
  const client = {
    from: (table: string) => {
      reads.push(table);
      return inner.from(table);
    },
  } as unknown as SupabaseClient;
  return { client, reads };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(enabled: boolean, tables: Record<string, unknown[]> = {}, purchases = false) {
  const { buildApp } = await import('../../src/app.js');
  const { client, reads } = recordingClient(tables);
  const app = buildApp({
    env: {
      ...loadEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' }),
      PRICE_FEATURES_ENABLED: enabled,
      PURCHASES_ENABLED: purchases,
    },
    supabase: client,
    logger: false,
  });
  apps.push(app);
  await app.ready();
  const get = (method: 'GET' | 'POST' | 'DELETE', url: string) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${TOKEN}` },
      ...(method === 'POST' ? { payload: { fx_pair_id: ID, direction: 'ABOVE', target_price: 150 } } : {}),
    });
  return { get, reads };
}

describe('flag off: price-only endpoints are 404 NOT_FOUND before any DB read', () => {
  const routes: ['GET' | 'POST' | 'DELETE', string][] = [
    ['GET', `/events/${ID}/reaction?fx_pair_id=${ID}`],
    ['GET', `/events/${ID}/reaction/chart?fx_pair_id=${ID}&timeframe=1m`],
    ['GET', `/events/${ID}/strategy-analysis`],
    ['GET', `/speeches/${ID}/reaction?fx_pair_id=${ID}`],
    ['GET', `/speeches/${ID}/reaction/chart?fx_pair_id=${ID}&timeframe=1m`],
    ['GET', '/rate-alerts'],
    ['POST', '/rate-alerts'],
    ['DELETE', `/rate-alerts/${ID}`],
  ];

  it.each(routes)('%s %s', async (method, url) => {
    const { get, reads } = await appWith(false);
    const response = await get(method, url);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(reads).toEqual([]);
  });

  it('flag on: the same routes get past the guard (they reach the DB)', async () => {
    for (const [method, url] of routes) {
      const { get, reads } = await appWith(true);
      await get(method, url);
      expect(reads.length, `${method} ${url}`).toBeGreaterThan(0);
    }
  });
});

describe('GET /entitlements', () => {
  it.each([false, true])(
    'returns price_features_enabled=%s at the top level, existing keys unchanged',
    async (enabled) => {
      const { get } = await appWith(enabled);
      const response = await get('GET', '/entitlements');
      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(body.price_features_enabled).toBe(enabled);
      expect(body.purchases_enabled).toBe(false);
      expect(body.technical_analysis_enabled).toBe(false);
      expect(body.event_reaction_analysis_enabled).toBe(false);
      expect(Object.keys(body).sort()).toEqual([
        'event_reaction_analysis_enabled',
        'features',
        'limits',
        'plan',
        'price_features_enabled',
        'purchases_enabled',
        'technical_analysis_enabled',
      ]);
    },
  );
});

describe('GET /entitlements purchases_enabled', () => {
  it.each([false, true])(
    'returns purchases_enabled=%s at the top level, independent of price_features_enabled',
    async (purchases) => {
      const { get } = await appWith(false, {}, purchases);
      const body = (await get('GET', '/entitlements')).json<Record<string, unknown>>();
      expect(body.purchases_enabled).toBe(purchases);
      expect(body.price_features_enabled).toBe(false);
    },
  );
});

describe('GET /home', () => {
  it('flag off: major_fx is [] and no price / pair / alert table is read', async () => {
    const { get, reads } = await appWith(false);
    const response = await get('GET', '/home?date=2026-11-24&timezone=UTC');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ major_fx: unknown }>().major_fx).toEqual([]);
    for (const table of PRICE_TABLES) expect(reads).not.toContain(table);
  });
});
