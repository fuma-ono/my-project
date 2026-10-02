import type { FastifyInstance } from 'fastify';
import { toSettingsResponse, toSettingsUpdate } from '../domain/userSettings.js';
import { getOrCreateUserSettings, updateUserSettings } from '../repositories/userSettingsRepository.js';
import { updateSettingsBodySchema } from '../schemas/settings.js';

/** GET/PATCH /settings (api-design.md §24.4/§24.5) — SCR-018/020/021.
 * Scoped to request.user.id exactly like /account. */
export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/settings', async (request) => {
    const row = await getOrCreateUserSettings(app.supabase, request.user!.id);
    return toSettingsResponse(row);
  });

  app.patch('/settings', async (request) => {
    const body = updateSettingsBodySchema.parse(request.body);
    const row = await updateUserSettings(app.supabase, request.user!.id, toSettingsUpdate(body));
    return toSettingsResponse(row);
  });
}
