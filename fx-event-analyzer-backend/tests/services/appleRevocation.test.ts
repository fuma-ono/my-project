import { exportPKCS8, generateKeyPair, decodeProtectedHeader, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildClientSecret, revokeAppleAccess } from '../../src/services/appleRevocation.js';

/** 使い捨てテスト鍵のみ。実際の Apple 鍵・通信は一切使わない。 */
const CODE = 'c-authorization-code-SECRET';
const REFRESH = 'r-refresh-token-SECRET';

let privateKeyPem: string;
let publicKey: CryptoKey;
let config: { APPLE_TEAM_ID: string; APPLE_KEY_ID: string; APPLE_PRIVATE_KEY: string; APPLE_CLIENT_ID: string };

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKeyPem = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey as CryptoKey;
  config = {
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: privateKeyPem,
    APPLE_CLIENT_ID: 'com.fumaono.fxeventanalyzer',
  };
});

function makeLogger() {
  const lines: unknown[] = [];
  return {
    lines,
    info: (obj: Record<string, unknown>, msg?: string) => lines.push({ obj, msg }),
    warn: (obj: Record<string, unknown>, msg?: string) => lines.push({ obj, msg }),
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const asFetch = (fn: unknown) => fn as typeof fetch;

describe('buildClientSecret', () => {
  it('signs an ES256 JWT with kid, iss, sub, aud and a short exp', async () => {
    const now = 1_800_000_000;
    const jwt = await buildClientSecret(config, now);
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    const { payload } = await jwtVerify(jwt, publicKey, { currentDate: new Date((now + 1) * 1000) });
    expect(payload).toMatchObject({
      iss: 'TEAM123456',
      sub: 'com.fumaono.fxeventanalyzer',
      aud: 'https://appleid.apple.com',
      iat: now,
    });
    expect(payload.exp! - now).toBeLessThanOrEqual(300);
  });

  it('accepts the private key with literal backslash-n sequences', async () => {
    const escaped = privateKeyPem.trim().split('\n').join('\\n');
    const jwt = await buildClientSecret({ ...config, APPLE_PRIVATE_KEY: escaped });
    expect(jwt.split('.')).toHaveLength(3);
  });
});

describe('revokeAppleAccess', () => {
  it('skips (no network) when any Apple env is unset', async () => {
    const fetchFn = vi.fn();
    const logger = makeLogger();
    for (const key of Object.keys(config) as (keyof typeof config)[]) {
      const partial = { ...config, [key]: undefined };
      const result = await revokeAppleAccess({
        config: partial,
        authorizationCode: CODE,
        logger,
        fetch: asFetch(fetchFn),
      });
      expect(result).toBe('skipped');
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.lines)).toContain('siwa_revoke_skipped');
  });

  it('exchanges the code then revokes the refresh token, in order, with form bodies', async () => {
    const calls: { url: string; form: URLSearchParams }[] = [];
    const fetchFn = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, form: new URLSearchParams(String(init.body)) });
      return Promise.resolve(url.endsWith('/auth/token') ? json(200, { refresh_token: REFRESH }) : json(200, {}));
    });
    const logger = makeLogger();
    const result = await revokeAppleAccess({ config, authorizationCode: CODE, logger, fetch: asFetch(fetchFn) });
    expect(result).toBe('revoked');
    expect(calls.map((c) => c.url)).toEqual([
      'https://appleid.apple.com/auth/token',
      'https://appleid.apple.com/auth/revoke',
    ]);
    expect(calls[0]!.form.get('grant_type')).toBe('authorization_code');
    expect(calls[0]!.form.get('code')).toBe(CODE);
    expect(calls[0]!.form.get('client_id')).toBe('com.fumaono.fxeventanalyzer');
    expect(calls[1]!.form.get('token')).toBe(REFRESH);
    expect(calls[1]!.form.get('token_type_hint')).toBe('refresh_token');
    const secret = calls[0]!.form.get('client_secret')!;
    expect(secret.split('.')).toHaveLength(3);

    const logged = JSON.stringify(logger.lines);
    for (const forbidden of [CODE, REFRESH, secret, privateKeyPem.slice(30, 60)]) {
      expect(logged).not.toContain(forbidden);
    }
  });

  it('returns failed (no throw) when the exchange fails, without calling revoke or leaking secrets', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json(400, { error: 'invalid_grant', error_description: CODE })));
    const logger = makeLogger();
    const result = await revokeAppleAccess({ config, authorizationCode: CODE, logger, fetch: asFetch(fetchFn) });
    expect(result).toBe('failed');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logger.lines);
    expect(logged).toContain('siwa_revoke_failed');
    expect(logged).toContain('invalid_grant');
    expect(logged).not.toContain(CODE);
  });

  it('returns failed when revoke fails, on network errors and on a bad private key', async () => {
    const revoke400 = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/auth/token') ? json(200, { refresh_token: REFRESH }) : json(400, { error: 'invalid_client' }),
      ),
    );
    expect(
      await revokeAppleAccess({ config, authorizationCode: CODE, logger: makeLogger(), fetch: asFetch(revoke400) }),
    ).toBe('failed');
    const boom = vi.fn(() => Promise.reject(new Error('socket hang up')));
    expect(
      await revokeAppleAccess({ config, authorizationCode: CODE, logger: makeLogger(), fetch: asFetch(boom) }),
    ).toBe('failed');
    const noFetch = vi.fn();
    expect(
      await revokeAppleAccess({
        config: { ...config, APPLE_PRIVATE_KEY: 'not a key' },
        authorizationCode: CODE,
        logger: makeLogger(),
        fetch: asFetch(noFetch),
      }),
    ).toBe('failed');
    expect(noFetch).not.toHaveBeenCalled();
  });
});
