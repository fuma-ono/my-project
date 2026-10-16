import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { PolygonAdapter } from '../ingestion/adapters/polygon.js';
import { TwelveDataAdapter } from '../ingestion/adapters/twelveData.js';
import { loadIngestionEnv } from '../ingestion/config.js';
import { FX_PAIR_MAPPINGS } from '../ingestion/mappings/fxPairs.js';
import { ingestFxCandles } from '../ingestion/pipelines/fxPrices.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * ③ (+ optional ⑤) FX candles → fx_prices (data-sources.md §6).
 *   - ③ Twelve Data 1m candles (TWELVE_DATA_API_KEY), ⑤ Polygon as the
 *     optional cross-check (POLYGON_API_KEY). 5m–60m are built from the
 *     same 1m candles, so one request per pair per run.
 *
 * HQ指示(2026-10-15)「まず無料枠で内部確認用に繋ぐ」: with a FREE /
 * personal Twelve Data key this is for internal dev-build checks ONLY —
 * free/personal plans do not allow showing the data to general users
 * (要件定義書 6.4). Switch to a licensed plan before public release.
 *
 *   npm run ingest:fx-prices                       # last 120 minutes, every mapped pair
 *   npm run ingest:fx-prices -- --minutes 180 --pairs USDJPY,EURUSD
 *
 * Free tier (8 requests/min, 800/day) with 9 pairs: run every 20 minutes
 * (9 × 72 = 648 requests/day). The 120-minute window overlaps earlier runs
 * (upsert is idempotent) and always contains a full hour for 60m.
 * Without TWELVE_DATA_API_KEY it does nothing and exits 0. Exit 0 / 1.
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
  const minutes = Number(arg('minutes') ?? '120');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 4_000) {
    throw new Error(`--minutes must be an integer between 1 and 4000 (got ${String(arg('minutes'))})`);
  }
  const symbols = (arg('pairs') ?? FX_PAIR_MAPPINGS.map((m) => m.symbol).join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const now = new Date();
  const to = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const range = { from: new Date(to.getTime() - minutes * 60_000).toISOString(), to: to.toISOString() };

  const store = createIngestionRepository(createSupabaseClient(loadEnv()));
  const primary = new TwelveDataAdapter(keys.TWELVE_DATA_API_KEY);
  const secondary = keys.POLYGON_API_KEY ? new PolygonAdapter(keys.POLYGON_API_KEY) : undefined;
  const result = await runIngestionJob(
    store,
    { provider: primary.name, dataType: 'FX_PRICE', job: 'ingest:fx-prices' },
    (counters) => {
      counters.note('range', range);
      return ingestFxCandles(
        { store, primary, ...(secondary ? { secondary } : {}), now: () => now },
        symbols,
        range,
        counters,
      );
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:fx-prices',
      provider: primary.name,
      cross_check: secondary?.name ?? null,
      range,
      status: result.status,
      fetched: result.counters.fetched,
      upserted: result.counters.success,
      unverified: result.counters.review,
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
