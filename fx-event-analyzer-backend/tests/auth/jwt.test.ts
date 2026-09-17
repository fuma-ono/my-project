import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { extractBearerToken, verifySupabaseJwt } from '../../src/auth/jwt.js';

const SECRET = 'test-jwt-secret-at-least-32-characters-long';
const USER_ID = '00000000-0000-0000-0000-000000000001';

function signToken(overrides: Partial<{ sub: string; role: string; expiresInSeconds: number; secret: string }> = {}) {
  const { sub = USER_ID, role = 'authenticated', expiresInSeconds = 3600, secret = SECRET } = overrides;
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', expiresIn: expiresInSeconds });
}

describe('verifySupabaseJwt', () => {
  it('rejects a missing token as "missing"', () => {
    expect(verifySupabaseJwt(undefined, SECRET)).toEqual({ ok: false, reason: 'missing' });
  });

  it('accepts a validly signed, unexpired token and returns its payload', () => {
    const token = signToken();
    const result = verifySupabaseJwt(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe(USER_ID);
      expect(result.payload.role).toBe('authenticated');
    }
  });

  it('rejects a token signed with the wrong secret as "invalid"', () => {
    const token = signToken({ secret: 'a-completely-different-secret-value' });
    expect(verifySupabaseJwt(token, SECRET)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a malformed token string as "invalid"', () => {
    expect(verifySupabaseJwt('not-a-real-jwt', SECRET)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects an expired token as "expired", distinct from "invalid"', () => {
    const token = signToken({ expiresInSeconds: -10 });
    expect(verifySupabaseJwt(token, SECRET)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token with no sub claim as "invalid"', () => {
    const token = jwt.sign({ role: 'authenticated' }, SECRET, { algorithm: 'HS256', expiresIn: 3600 });
    expect(verifySupabaseJwt(token, SECRET)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a token signed with a different algorithm (alg confusion) as "invalid"', () => {
    // verifySupabaseJwt pins algorithms: ['HS256'] — a token asserting a
    // different alg in its header must not be accepted even if some other
    // part of the signature happens to validate.
    const token = jwt.sign({ sub: USER_ID }, SECRET, { algorithm: 'HS384', expiresIn: 3600 });
    expect(verifySupabaseJwt(token, SECRET)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the "Bearer" scheme', () => {
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns undefined for a missing header', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it('returns undefined for a header without the Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeUndefined();
  });
});
