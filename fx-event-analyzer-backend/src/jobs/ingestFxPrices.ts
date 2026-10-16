import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { PolygonAdapter } from '../ingestion/adapters/polygon.js';
import { TWELVE_DATA_PROVIDER, TwelveDataAdapter } from '../ingestion/adapters/twelveData.js';
import { API_CREDIT_CAPS, FX_FETCH_SETTINGS, loadIngestionEnv } from '../ingestion/config.js';
import { CreditGate } from '../ingestion/http.js';
import { FX_PAIR_MAPPINGS } from '../ingestion/mappings/fxPairs.js';
import { ingestFxWithGapRepair } from '../ingestion/pipelines/fxPrices.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * ③ (+ optional ⑤) FX candles → fx_prices (data-sources.md §6).
 *   - ③ Twelve Data 1m candles (TWELVE_DATA_API_KEY), ⑤ Polygon as the
 *     optional cross-check (POLYGON_API_KEY). 5m–60m are built from the
 *     stored 1m candles.
 *   - Gap repair (§6.4): every run checks the last 7 days for missing
 *     open-market minutes and re-fetches them (newest first, round-robin by
 *     pair) within the per-run cap (27) and the daily credit cap of the
 *     ledger (api_credit_usage): 700/day for scheduled runs, 800/day with
 *     --manual (workflow_dispatch). One credit is reserved before EVERY
 *     HTTP attempt, retries included; no reservation → not sent.
 *
 * HQ指示(2026-10-15)「まず無料枠で内部確認用に繋ぐ」: with a FREE /
 * personal Twelve Data key this is for internal dev-build checks ONLY —
 * free/personal plans do not allow showing the data to general users
 * (要件定義書 6.4). Switch to a licensed plan before public release.
 *
 *   npm run ingest:fx-prices                                   # scheduled (AUTOMATIC, 700/day)
 *   npm run ingest:fx-prices -- --manual --pairs USDJPY,EURUSD   # manual (800/day)
 *   npm run ingest:fx-prices -- --manual --minutes 600           # longer FORWARD window (≤ 4800)
 *
 * Normal run: 9 requests (one FORWARD window per pair; 0 while the market
 * is closed). Without TWELVE_DATA_API_KEY it does nothing and exits 0.
 * Exit 0 / 1.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const keys = loadIngestionEnv();
  if (!keys.TWELVE_DATA_API_KEY) {
    console.log(JSON.stringify({ job: 'ingest:fx-prices', skipped: 'TWELVE_DATA_API_KEY not set' }));
    return;
  }
  const rawMinutes = arg('minutes');
  const forwardMinutes = rawMinutes === undefined ? undefined : Number(rawMinutes);
  if (
    forwardMinutes !== undefined &&
    (!Number.isInteger(forwardMinutes) || forwardMinutes < 1 || forwardMinutes > FX_FETCH_SETTINGS.maxWindowMinutes)
  ) {
    throw new Error(
      `--minutes must be an integer between 1 and ${FX_FETCH_SETTINGS.maxWindowMinutes} (got ${String(rawMinutes)})`,
    );
  }
  const manual = process.argv.includes('--manual');
  const mode = manual ? 'MANUAL' : 'AUTOMATIC';
  const symbols = (arg('pairs') ?? FX_PAIR_MAPPINGS.map((m) => m.symbol).join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const now = new Date();
  const store = createIngestionRepository(createSupabaseClient(loadEnv()));
  const runId = `${process.env.GITHUB_RUN_ID ?? 'local'}:${randomUUID()}`;
  const gate = new CreditGate(store, {
    provider: TWELVE_DATA_PROVIDER,
    job: 'ingest:fx-prices',
    runId,
    mode,
    dailyCap: manual ? API_CREDIT_CAPS.twelvedata.manual : API_CREDIT_CAPS.twelvedata.automatic,
    runCap: FX_FETCH_SETTINGS.perRunRequestCap,
  });
  const primary = new TwelveDataAdapter(keys.TWELVE_DATA_API_KEY, { beforeAttempt: gate.beforeAttempt });
  const secondary = keys.POLYGON_API_KEY ? new PolygonAdapter(keys.POLYGON_API_KEY) : undefined;
  const result = await runIngestionJob(
    store,
    { provider: primary.name, dataType: 'FX_PRICE', job: 'ingest:fx-prices' },
    (counters) =>
      ingestFxWithGapRepair(
        { store, primary, ...(secondary ? { secondary } : {}), now: () => now, gate, mode },
        { symbols, ...(forwardMinutes !== undefined ? { forwardMinutes } : {}) },
        counters,
      ),
  );
  const details = result.counters.details;
  console.log(
    JSON.stringify({
      job: 'ingest:fx-prices',
      provider: primary.name,
      cross_check: secondary?.name ?? null,
      mode,
      status: result.status,
      api_requests: details.api_requests,
      budget: details.budget,
      fetched: result.counters.fetched,
      upserted: result.counters.success,
      unverified: result.counters.review,
      unrecovered_total: details.unrecovered_total,
      skipped: result.counters.skipReasons,
      errors: result.counters.errorMessages,
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:fx-prices', error: String(error) }));
  process.exit(1);
});
