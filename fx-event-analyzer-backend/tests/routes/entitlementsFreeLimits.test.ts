import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * 1.0 は無料のみ・購入なし(オーナー決定 2026-11-25)。GET /entitlements の limits が、FREE の上限を外した値で返ること
 * (FREE_LIMITS_ENFORCED 未設定 = 既定)と、true で従来の上限に戻ること。JWT の検証はモック、DB は fake。
 */
const TOKEN = 'eyJ.free-limits.sig';
const USER_ID = '11111111-2222-3333-4444-555555555555';

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

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function entitlements(enforced: string | undefined) {
  const { buildApp } = await import('../../src/app.js');
  const app = buildApp({
    env: loadEnv({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ...(enforced === undefined ? {} : { FREE_LIMITS_ENFORCED: enforced }),
    }),
    supabase: fakeSupabaseClient({
      entitlements: [],
      default_entitlements: [{ feature_code: 'VIEW_BASIC_EVENT' }],
    }),
    logger: false,
  });
  apps.push(app);
  await app.ready();
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/entitlements?timezone=UTC',
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  return response.json<{ plan: string; limits: Record<string, unknown> }>();
}

describe('GET /entitlements limits for FREE', () => {
  it('FREE_LIMITS_ENFORCED unset (1.0 default): every limit is unbounded', async () => {
    const body = await entitlements(undefined);
    expect(body.plan).toBe('FREE');
    expect(body.limits).toMatchObject({
      calendar_earliest_from: null,
      favorites_max: null,
      notification_importances: ['HIGH', 'MEDIUM', 'LOW'],
      notification_fx_pairs_max: null,
      history_events_max: null,
      past_releases_max: null,
    });
    expect(typeof body.limits.calendar_latest_to).toBe('string');
  });

  it.each(['false', '', '1', 'TRUE'])(
    'FREE_LIMITS_ENFORCED=%j does not re-enable limits (only "true" does)',
    async (value) => {
      const body = await entitlements(value);
      expect(body.limits).toMatchObject({ favorites_max: null, past_releases_max: null, history_events_max: null });
    },
  );

  it('FREE_LIMITS_ENFORCED=true (1.1 restore switch): the previous FREE limits are restored', async () => {
    const body = await entitlements('true');
    expect(body.plan).toBe('FREE');
    expect(body.limits).toMatchObject({
      favorites_max: 3,
      notification_importances: ['HIGH'],
      notification_fx_pairs_max: 1,
      history_events_max: 3,
      past_releases_max: 3,
    });
    expect(typeof body.limits.calendar_earliest_from).toBe('string');
  });
});
