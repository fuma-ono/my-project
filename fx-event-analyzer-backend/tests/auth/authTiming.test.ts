import Fastify, { type FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 認証の時間の記録(HQ承認 2026-10-21): auth_ms と「そのプロセスで初回か」だけを出し、
 * トークン・Authorization・ユーザーID・メール・クレームは出さない。認証の結果(401/通過)は変えない。
 * verifySupabaseJwt はモック(JWKS の取得=外部通信をしない)。
 */
const TOKEN = 'eyJ.secret-token-value.sig';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'someone@example.com';

vi.mock('../../src/auth/jwt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/jwt.js')>();
  return {
    ...actual,
    verifySupabaseJwt: vi.fn((token: string | undefined) =>
      Promise.resolve(
        token === TOKEN
          ? { ok: true, payload: { sub: USER_ID, email: EMAIL, exp: 9_999_999_999 } }
          : { ok: false, reason: token ? 'invalid' : 'missing' },
      ),
    ),
  };
});

async function buildApp(): Promise<{ app: FastifyInstance; lines: string[] }> {
  vi.resetModules(); // a fresh plugin module = a fresh "process" for first_in_process
  const { registerAuth } = await import('../../src/auth/plugin.js');
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  const app = Fastify({ logger: { level: 'info', stream } });
  app.register((scope, _opts, done) => {
    registerAuth(scope, 'https://example.invalid');
    scope.get('/me', (request) => ({ ok: request.user?.id === USER_ID }));
    done();
  });
  await app.ready();
  return { app, lines };
}

const authLines = (lines: string[]) =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((l) => l.event === 'auth_timing');

describe('auth timing log', () => {
  let app: FastifyInstance;
  let lines: string[];
  beforeEach(async () => ({ app, lines } = await buildApp()));
  afterEach(async () => app.close());

  it('logs auth_ms, first_in_process and auth_ok with the request reqId — and nothing identifying', async () => {
    const first = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${TOKEN}` } });
    const second = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(first.json()).toEqual({ ok: true });
    expect(second.statusCode).toBe(200);

    const timing = authLines(lines);
    expect(timing).toHaveLength(2);
    expect(timing[0]).toMatchObject({
      event: 'auth_timing',
      first_in_process: true,
      auth_ok: true,
      msg: 'auth timing',
    });
    expect(timing[1]).toMatchObject({ first_in_process: false, auth_ok: true });
    for (const line of timing) {
      expect(typeof line.auth_ms).toBe('number');
      expect(typeof line.reqId).toBe('string');
      expect(Object.keys(line).sort()).toEqual(
        ['auth_ms', 'auth_ok', 'event', 'first_in_process', 'hostname', 'level', 'msg', 'pid', 'reqId', 'time'].sort(),
      );
    }
    const all = lines.join('\n');
    for (const secret of [TOKEN, 'secret-token-value', USER_ID, EMAIL, 'Bearer']) expect(all).not.toContain(secret);
    expect(all.toLowerCase()).not.toContain('"authorization"');
  });

  it('does not change the 401 for a missing / invalid token, and a missing token does not use up "first"', async () => {
    const missing = await app.inject({ method: 'GET', url: '/me' });
    const invalid = await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer nope' } });
    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    const timing = authLines(lines);
    expect(timing.map((l) => [l.first_in_process, l.auth_ok])).toEqual([
      [false, false], // no token: jwtVerify / JWKS never ran
      [true, false], // first request with a token in this process
    ]);
    expect(lines.join('\n')).not.toContain('nope');
  });

  it('marks exactly one request as first_in_process when several arrive at once, each with its own reqId', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${TOKEN}` } }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    const timing = authLines(lines);
    expect(timing).toHaveLength(5);
    expect(timing.filter((l) => l.first_in_process === true)).toHaveLength(1);
    expect(new Set(timing.map((l) => l.reqId)).size).toBe(5);
    // Each auth_timing line shares its reqId with that request's own Fastify lines.
    const completed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.msg === 'request completed');
    expect(new Set(completed.map((l) => l.reqId))).toEqual(new Set(timing.map((l) => l.reqId)));
  });
});
