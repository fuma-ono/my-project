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
export function registerAuth(app: FastifyInstance, jwtSecret: string): void {
  app.addHook('onRequest', (request) => {
    const token = extractBearerToken(request.headers.authorization);
    const result = verifySupabaseJwt(token, jwtSecret);

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
