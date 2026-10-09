import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractBearerToken, verifyJwtWithKeys } from '../../src/auth/jwt.js';
import { tamperSignature } from '../helpers/tamperSignature.js';

const USER_ID = '00000000-0000-0000-0000-000000000001';

// Real jose crypto throughout: a genuine ES256 keypair generated for this
// test file (mirroring the ES256 signing Supabase Auth actually uses as of
// Supabase CLI 2.71.1+ — see src/auth/jwt.ts's doc comment), a genuine
// signature, and genuine verification via the same jwtVerify() call
// verifySupabaseJwt uses in production. Only the key *source* differs
// (createLocalJWKSet here vs. createRemoteJWKSet's live HTTP fetch in
// production) — that's exactly why verifyJwtWithKeys exists as a seam.
let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'ES256' }] });

  // A second, untrusted keypair — only its private key is used, to sign a
  // token that `keys` (above) must not accept.
  const otherPair = await generateKeyPair('ES256', { extractable: true });
  otherPrivateKey = otherPair.privateKey;
});

async function signToken(
  key: CryptoKey,
  overrides: Partial<{ sub: string; role: string; expiresInSeconds: number }> = {},
): Promise<string> {
  const { sub = USER_ID, role = 'authenticated', expiresInSeconds = 3600 } = overrides;
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(key);
}

describe('verifyJwtWithKeys', () => {
  it('rejects a missing token as "missing"', async () => {
    expect(await verifyJwtWithKeys(undefined, keys)).toEqual({ ok: false, reason: 'missing' });
  });

  it('accepts a validly signed, unexpired token and returns its payload', async () => {
    const token = await signToken(privateKey);
    const result = await verifyJwtWithKeys(token, keys);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe(USER_ID);
      expect(result.payload.role).toBe('authenticated');
    }
  });

  it('rejects a token signed with a key outside the trusted JWKS as "invalid"', async () => {
    const token = await signToken(otherPrivateKey);
    expect(await verifyJwtWithKeys(token, keys)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a malformed token string as "invalid"', async () => {
    expect(await verifyJwtWithKeys('not-a-real-jwt', keys)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects an expired token as "expired", distinct from "invalid"', async () => {
    const token = await signToken(privateKey, { expiresInSeconds: -10 });
    expect(await verifyJwtWithKeys(token, keys)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token with no sub claim as "invalid"', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(privateKey);
    expect(await verifyJwtWithKeys(token, keys)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a token whose signature has been tampered with as "invalid"', async () => {
    const token = await signToken(privateKey);
    expect(await verifyJwtWithKeys(tamperSignature(token), keys)).toEqual({
      ok: false,
      reason: 'invalid',
    });
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
