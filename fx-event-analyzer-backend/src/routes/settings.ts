import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { findUnknownFxPairSymbols } from '../repositories/fxPairsRepository.js';
import { toSettingsResponse, toSettingsUpdate } from '../domain/userSettings.js';
import { getOrCreateUserSettings, updateUserSettings } from '../repositories/userSettingsRepository.js';
import { updateSettingsBodySchema } from '../schemas/settings.js';

/** GET/PATCH /settings (api-design.md §24.4/§24.5) — SCR-016 通知設定 / SCR-018/020/021.
 * Scoped to request.user.id exactly like /account. */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/settings', async (request) => {
    const row = await getOrCreateUserSettings(app.supabase, request.user!.id);
    return toSettingsResponse(row);
  });

  app.patch('/settings', async (request) => {
    const body = updateSettingsBodySchema.parse(request.body);
    // notify_fx_pair_symbols is an array, so unlike chart.default_fx_pair_symbol
    // there is no FK to catch an unknown symbol — check it here instead.
    const fxPairs = body.notifications?.fx_pairs;
    if (fxPairs) {
      const unknown = await findUnknownFxPairSymbols(app.supabase, fxPairs);
      if (unknown.length > 0) {
        throw ApiError.validation(`notifications.fx_pairs: unknown FX pair symbol ${unknown.join(', ')}`);
      }
    }
    const row = await updateUserSettings(app.supabase, request.user!.id, toSettingsUpdate(body));
    return toSettingsResponse(row);
  });
}
