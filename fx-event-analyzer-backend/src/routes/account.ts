import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { getProfile, updateProfile } from '../repositories/profilesRepository.js';
import { updateAccountBodySchema } from '../schemas/account.js';

/**
 * GET/PATCH /account — always scoped to request.user.id (set by the auth
 * hook from the verified JWT). No endpoint accepts a foreign user id, so
 * there is no separate "ownership check" to perform — a user can
 * structurally never address anyone else's Profile.
 */
export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/account', async (request) => {
    const userId = request.user!.id;
    const profile = await getProfile(app.supabase, userId);
    if (!profile) {
      throw ApiError.notFound('Profile not found.');
    }
    return {
      user_id: profile.id,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    };
  });

  app.patch('/account', async (request) => {
    const userId = request.user!.id;
    const parsed = updateAccountBodySchema.parse(request.body);
    const profile = await updateProfile(app.supabase, userId, parsed);
    return {
      user_id: profile.id,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    };
  });
}
