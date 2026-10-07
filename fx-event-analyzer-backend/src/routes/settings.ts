import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { findUnknownFxPairSymbols } from '../repositories/fxPairsRepository.js';
import { toSettingsResponse, toSettingsUpdate } from '../domain/userSettings.js';
import { getOrCreateUserSettings, updateUserSettings } from '../repositories/userSettingsRepository.js';
import { updateSettingsBodySchema } from '../schemas/settings.js';

/** 422 unless every symbol is an active fx_pairs.symbol (null/undefined = nothing to check). */
async function assertKnownFxPairSymbols(
  app: FastifyInstance,
  field: string,
  symbols: readonly string[] | null | undefined,
): Promise<void> {
  if (!symbols) return;
  const unknown = await findUnknownFxPairSymbols(app.supabase, symbols);
  if (unknown.length > 0) {
    throw ApiError.validation(`${field}: unknown FX pair symbol ${unknown.join(', ')}`);
  }
}

/** GET/PATCH /settings (api-design.md §24.4/§24.5) — SCR-016 通知設定 / SCR-018/020/021.
 * Scoped to request.user.id exactly like /account. */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/settings', async (request) => {
    const row = await getOrCreateUserSettings(app.supabase, request.user!.id);
    return toSettingsResponse(row);
  });

  app.patch('/settings', async (request) => {
    const body = updateSettingsBodySchema.parse(request.body);
    // notify_fx_pair_symbols / home_fx_pairs are arrays, so unlike
    // chart.default_fx_pair_symbol there is no FK to catch an unknown symbol
    // — check them here instead.
    await assertKnownFxPairSymbols(app, 'notifications.fx_pairs', body.notifications?.fx_pairs);
    await assertKnownFxPairSymbols(app, 'home.fx_pairs', body.home?.fx_pairs);
    const row = await updateUserSettings(app.supabase, request.user!.id, toSettingsUpdate(body));
    return toSettingsResponse(row);
  });
}
