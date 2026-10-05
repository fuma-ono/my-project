import type { FastifyInstance } from 'fastify';
import { listActiveFxPairs } from '../repositories/fxPairsRepository.js';

/** GET /fx-pairs (api-design.md §13.5) — FX pair master for the SCR-016
 * 対象通貨ペア picker. Master data like /indicators: authenticated, no
 * feature_code (§27.1). */
export function registerFxPairRoutes(app: FastifyInstance): void {
  app.get('/fx-pairs', async () => {
    return { data: await listActiveFxPairs(app.supabase) };
  });
}
