import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { extractBearerToken, verifySupabaseJwt } from './jwt.js';
import './types.js';

/**
 * Registers an onRequest hook, scoped to whatever Fastify context calls
 * this (routes/api.ts registers it inside the /api/v1 prefix so it never
 * applies to /health). Verifies the Supabase Auth JWT and sets
 * `request.user`; throws 401 on missing/invalid/expired token
 * (api-design.md §2.2, Phase 2 instruction §7).
 */
/**
 * Whether this process has already verified a token (HQ承認 2026-10-21
 * 「認証処理の所要時間と、そのプロセス内での初回かどうか」). The flag only
 * labels the timing line — verification itself is unchanged.
 *
 * `first_in_process: true` = the first request IN THIS PROCESS that carried a
 * Bearer token (set synchronously before the await, so exactly one request
 * gets it even when several arrive at once). It usually is the request that
 * triggers the JWKS fetch (`getSupabaseJwks`, jose `createRemoteJWKSet`), but not
 * always: requests arriving while that fetch is in flight wait for the same
 * fetch and are labelled false; a malformed token fails before any key fetch;
 * and jose fetches the JWKS again when its cache is older than 10 minutes
 * (jose's default `cacheMaxAge`) — that later fetch is also labelled false.
 *
 * `auth_ms` = from just before `verifySupabaseJwt()` to its result (token
 * signature/expiry check, plus any JWKS fetch it waits for). It does not
 * include Fastify's routing, other hooks, the route handler or sending.
 */
let authVerifiedInProcess = false;

export function registerAuth(app: FastifyInstance, supabaseUrl: string): void {
  app.addHook('onRequest', async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    // Without a token jwtVerify (and the JWKS fetch) never runs, so only a request with a token counts.
    const firstInProcess = token !== undefined && !authVerifiedInProcess;
    if (token !== undefined) authVerifiedInProcess = true;
    const startedAt = Date.now();
    const result = await verifySupabaseJwt(token, supabaseUrl);
    // Timing only: no token, header, user id or claims — just the duration, the
    // first-in-process flag and whether verification passed (reqId/time come from request.log).
    request.log.info(
      { event: 'auth_timing', auth_ms: Date.now() - startedAt, first_in_process: firstInProcess, auth_ok: result.ok },
      'auth timing',
    );

    if (!result.ok) {
      const message =
        result.reason === 'missing'
          ? 'Missing Authorization header.'
          : result.reason === 'expired'
            ? 'Access token has expired.'
            : 'Invalid access token.';
      throw ApiError.unauthorized(message);
    }

    request.user = { id: result.payload.sub };
  });
}
