import type { FastifyInstance } from 'fastify';
import { listEntitlements } from '../repositories/entitlementsRepository.js';

function isActive(row: { enabled: boolean; expires_at: string | null }): boolean {
  if (!row.enabled) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

/** GET /entitlements — api-design.md §27: "現在ユーザーが利用可能な
 * Featureを取得する". Returns the user's currently-active feature_codes
 * only (expired/disabled rows are filtered out here, not left for the
 * client to interpret). */
export function registerEntitlementsRoutes(app: FastifyInstance): void {
  app.get('/entitlements', async (request) => {
    const userId = request.user!.id;
    const rows = await listEntitlements(app.supabase, userId);
    const features = rows.filter(isActive).map((row) => row.feature_code);
    return { features };
  });
}
