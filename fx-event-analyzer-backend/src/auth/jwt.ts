import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Minimal shape of a Supabase Auth JWT payload this Backend relies on. */
export interface SupabaseJwtPayload {
  sub: string;
  role?: string;
  exp: number;
  [key: string]: unknown;
}

export type VerifyJwtResult =
  { ok: true; payload: SupabaseJwtPayload } | { ok: false; reason: 'missing' | 'invalid' | 'expired' };

/**
 * Verified for real against a local Supabase stack (Phase 2 integration
 * tests): as of Supabase CLI 2.71.1+, `supabase start` issues access
 * tokens signed ES256 by default, not the legacy shared-secret HS256 this
 * module originally verified — every authenticated request came back 401.
 * Supabase's JWKS endpoint publishes both the ES256 public key and (when a
 * project still has one) the legacy HS256 secret as a symmetric JWK, so
 * fetching it here handles either signing mode without the Backend having
 * to know which one a given project uses, and needs no shared secret at
 * all — only SUPABASE_URL.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();

export function getSupabaseJwks(supabaseUrl: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(supabaseUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
    jwksCache.set(supabaseUrl, jwks);
  }
  return jwks;
}

/** Verifies a token against an already-resolved key source. Split out from
 * {@link verifySupabaseJwt} so tests can supply a `createLocalJWKSet`
 * (real jose verification, generated test keys, no network) instead of
 * `createRemoteJWKSet`'s live HTTP fetch. */
export async function verifyJwtWithKeys(token: string | undefined, keys: JWTVerifyGetKey): Promise<VerifyJwtResult> {
  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  try {
    const { payload } = await jwtVerify(token, keys);
    if (!payload.sub) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, payload: payload as SupabaseJwtPayload };
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

/** Verifies a Supabase Auth access token against the project's real JWKS
 * (fetched from `${supabaseUrl}/auth/v1/.well-known/jwks.json`, cached and
 * refreshed by jose's `createRemoteJWKSet`). */
export function verifySupabaseJwt(token: string | undefined, supabaseUrl: string): Promise<VerifyJwtResult> {
  return verifyJwtWithKeys(token, getSupabaseJwks(supabaseUrl));
}

/** Extracts the bearer token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  return match?.[1];
}
