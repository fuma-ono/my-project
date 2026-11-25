import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import {
  deleteUserAccount,
  ensureProfile,
  getAuthProviders,
  getProfile,
  updateProfile,
} from '../repositories/profilesRepository.js';
import { deleteAccountBodySchema, updateAccountBodySchema } from '../schemas/account.js';
import { revokeAppleAccess } from '../services/appleRevocation.js';

/**
 * GET/PATCH/DELETE /account — always scoped to request.user.id (set by the
 * auth hook from the verified JWT). No endpoint accepts a foreign user id,
 * so there is no separate "ownership check" to perform — a user can
 * structurally never address anyone else's Profile.
 */
export function registerAccountRoutes(app: FastifyInstance): void {
  // Profiles are created lazily (see ensureProfile), so a user who has never
  // written anything yet still gets a profile here instead of a 404 — the
  // first screen to read it is SCR-015, right after sign-up.
  app.get('/account', async (request) => {
    const userId = request.user!.id;
    await ensureProfile(app.supabase, userId);
    const profile = await getProfile(app.supabase, userId);
    if (!profile) {
      throw ApiError.notFound('Profile not found.');
    }
    return {
      user_id: profile.id,
      display_name: profile.display_name,
      birth_date: profile.birth_date,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    };
  });

  app.patch('/account', async (request) => {
    const userId = request.user!.id;
    const parsed = updateAccountBodySchema.parse(request.body);
    await ensureProfile(app.supabase, userId);
    const profile = await updateProfile(app.supabase, userId, parsed);
    return {
      user_id: profile.id,
      display_name: profile.display_name,
      birth_date: profile.birth_date,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    };
  });

  /** DELETE /account (api-design.md §24.3, SCR-026). Physical deletion of
   * the user and everything that cascades from it. The App Store
   * subscription itself is not cancellable from here (Apple owns it) — the
   * client tells the user to cancel it in their Apple ID settings first.
   *
   * Optional body { apple_authorization_code }: when present (and the user has
   * an Apple identity), the Sign in with Apple token is revoked first, best
   * effort — a failure never blocks the deletion. Old builds send no body. */
  app.delete('/account', async (request, reply) => {
    const userId = request.user!.id;
    const body = deleteAccountBodySchema.parse(request.body);
    const code = body?.apple_authorization_code;
    if (code) {
      // Providers are read before deletion (identities vanish with the user). If they
      // cannot be determined, the presence of the code is enough to try.
      const providers = await getAuthProviders(app.supabase, userId);
      if (providers === null || providers.includes('apple')) {
        await revokeAppleAccess({
          config: app.env,
          authorizationCode: code,
          logger: request.log,
          fetch: app.appleFetch,
        });
      } else {
        request.log.info({ event: 'siwa_revoke_skipped', reason: 'not_apple_user' }, 'Sign in with Apple revocation skipped');
      }
    } else {
      request.log.info({ event: 'siwa_revoke_skipped', reason: 'no_code' }, 'Sign in with Apple revocation skipped');
    }
    await deleteUserAccount(app.supabase, userId);
    return reply.status(204).send();
  });
}
