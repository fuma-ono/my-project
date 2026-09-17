import jwt from 'jsonwebtoken';

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
 * Verifies a Supabase Auth access token against the project's legacy
 * shared JWT secret (HS256). See .env.example for the note on switching to
 * JWKS-based verification if the project uses asymmetric signing keys
 * instead.
 */
export function verifySupabaseJwt(token: string | undefined, secret: string): VerifyJwtResult {
  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as SupabaseJwtPayload;
    if (!payload.sub) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, payload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

/** Extracts the bearer token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  return match?.[1];
}
