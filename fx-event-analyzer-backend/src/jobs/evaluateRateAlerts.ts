import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { evaluateAllRateAlerts } from '../repositories/rateAlertsRepository.js';

/**
 * Rate alert job (api-design.md §24.12, notification-inbox-spec.md §7):
 * compares every user's active rate alerts with the latest stored FX price
 * (fx_prices, the same price GET /home major_fx shows) and, for those that
 * crossed, inserts the RATE_ALERT inbox row and deactivates the alert.
 * GET /notifications does the same for the caller, so this only matters for
 * users who don't open the app; run it after each price ingestion (e.g.
 * every few minutes).
 *
 *   npm run jobs:evaluate-rate-alerts          # from source (tsx)
 *   node dist/jobs/evaluateRateAlerts.js       # after `npm run build`
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment (or
 * .env) like the server. Exit code 0 on success, 1 on failure — cron-friendly.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const result = await evaluateAllRateAlerts(createSupabaseClient(env), new Date());
  console.log(JSON.stringify({ job: 'evaluate-rate-alerts', ...result, at: new Date().toISOString() }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'evaluate-rate-alerts', error: String(error) }));
  process.exit(1);
});
