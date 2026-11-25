import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { deleteAccountBodySchema } from '../../src/schemas/account.js';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'jwt-token';
const CODE = 'apple-code-SECRET';

vi.mock('../../src/auth/jwt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/jwt.js')>();
  return {
    ...actual,
    verifySupabaseJwt: vi.fn((token: string | undefined) =>
      Promise.resolve(
        token === 'jwt-token'
          ? { ok: true, payload: { sub: '11111111-2222-3333-4444-555555555555', exp: 9_999_999_999 } }
          : { ok: false, reason: 'missing' },
      ),
    ),
  };
});

let pem: string;
beforeAll(async () => {
  pem = await exportPKCS8((await generateKeyPair('ES256', { extractable: true })).privateKey);
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeSupabase(providers: string[] | 'error', deleted: string[]): SupabaseClient {
  return {
    auth: {
      admin: {
        getUserById: () =>
          providers === 'error'
            ? Promise.resolve({ data: { user: null }, error: new Error('lookup failed') })
            : Promise.resolve({
                data: {
                  user: { id: USER_ID, identities: providers.map((provider) => ({ provider })), app_metadata: {} },
                },
                error: null,
              }),
        deleteUser: (id: string) => {
          deleted.push(id);
          return Promise.resolve({ data: {}, error: null });
        },
      },
    },
  } as unknown as SupabaseClient;
}

describe('DELETE /api/v1/account with Sign in with Apple revocation', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function run(opts: {
    providers?: string[] | 'error';
    withEnv?: boolean;
    body?: unknown;
    fetchFn?: (url: string) => Promise<Response>;
  }) {
    const deleted: string[] = [];
    const fetchFn = vi.fn(
      opts.fetchFn ??
        ((url: string) =>
          Promise.resolve(url.endsWith('/auth/token') ? json(200, { refresh_token: 'r' }) : json(200, {}))),
    );
    app = buildApp({
      env: loadEnv({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
        ...(opts.withEnv === false
          ? {}
          : {
              APPLE_TEAM_ID: 'TEAM123456',
              APPLE_KEY_ID: 'KEY1234567',
              APPLE_PRIVATE_KEY: pem,
              APPLE_CLIENT_ID: 'com.fumaono.fxeventanalyzer',
            }),
      }),
      supabase: fakeSupabase(opts.providers ?? ['apple'], deleted),
      appleFetch: fetchFn as unknown as typeof fetch,
      logger: false,
    });
    await app.ready();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${TOKEN}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      ...(opts.body ? { payload: JSON.stringify(opts.body) } : {}),
    });
    return { response, deleted, fetchFn };
  }

  it('no body (old iOS build): deletes, no Apple call', async () => {
    const { response, deleted, fetchFn } = await run({});
    expect(response.statusCode).toBe(204);
    expect(deleted).toEqual([USER_ID]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('Apple user with code: revokes (token then revoke) and deletes', async () => {
    const { response, deleted, fetchFn } = await run({ body: { apple_authorization_code: CODE } });
    expect(response.statusCode).toBe(204);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      'https://appleid.apple.com/auth/token',
      'https://appleid.apple.com/auth/revoke',
    ]);
    expect(deleted).toEqual([USER_ID]);
  });

  it('APPLE_* unset: revocation skipped, deletion proceeds as today', async () => {
    const { response, deleted, fetchFn } = await run({ withEnv: false, body: { apple_authorization_code: CODE } });
    expect(response.statusCode).toBe(204);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deleted).toEqual([USER_ID]);
  });

  it('exchange fails: deletion still happens with 204', async () => {
    const { response, deleted } = await run({
      body: { apple_authorization_code: CODE },
      fetchFn: () => Promise.resolve(json(400, { error: 'invalid_grant' })),
    });
    expect(response.statusCode).toBe(204);
    expect(deleted).toEqual([USER_ID]);
  });

  it('Google-only user with a code: no Apple call, deletes', async () => {
    const { response, deleted, fetchFn } = await run({
      providers: ['google'],
      body: { apple_authorization_code: CODE },
    });
    expect(response.statusCode).toBe(204);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deleted).toEqual([USER_ID]);
  });

  it('provider lookup fails: falls back to the presence of the code', async () => {
    const { response, deleted, fetchFn } = await run({ providers: 'error', body: { apple_authorization_code: CODE } });
    expect(response.statusCode).toBe(204);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual([USER_ID]);
  });
});

describe('deleteAccountBodySchema (backward compatibility)', () => {
  const ok = (body: unknown) => deleteAccountBodySchema.safeParse(body).success;
  it('accepts no body, null, an empty object, the code, and ignores unknown fields', () => {
    expect(ok(undefined)).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ apple_authorization_code: 'abc' })).toBe(true);
    expect(ok({ other: 1 })).toBe(true);
  });
  it('rejects an empty or non-string code', () => {
    expect(ok({ apple_authorization_code: '' })).toBe(false);
    expect(ok({ apple_authorization_code: 5 })).toBe(false);
  });
});
