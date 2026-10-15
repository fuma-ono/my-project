import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { BlsAdapter } from '../ingestion/adapters/bls.js';
import { FredAdapter } from '../ingestion/adapters/fred.js';
import { loadIngestionEnv } from '../ingestion/config.js';
import { reverifyAwaitingOfficial } from '../ingestion/pipelines/economicCalendar.js';
import {
  createLiveOfficialResolver,
  ingestOfficialObservations,
  type OfficialProviders,
} from '../ingestion/pipelines/officialStats.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * ② Official statistics (data-sources.md §4, §8):
 *   1. stores recent observations of every mapped FRED / BLS series in
 *      official_observations;
 *   2. re-verifies calendar values waiting for an official number
 *      (ingestion_staged_values AWAITING_OFFICIAL): match → published as the
 *      RELEASE snapshot / revision, mismatch → PENDING_REVIEW.
 *
 *   npm run ingest:official
 *
 * Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; FRED_API_KEY (FRED is
 * skipped without it) and optionally BLS_API_KEY (BLS v1 without it,
 * 25 queries/day). One ingestion_logs row per step. Exit 0 / 1 — cron-friendly.
 * Not scheduled automatically (suggested schedule: data-sources.md §8).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const keys = loadIngestionEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const providers: OfficialProviders = { BLS: new BlsAdapter(keys.BLS_API_KEY) };
  if (keys.FRED_API_KEY) providers.FRED = new FredAdapter(keys.FRED_API_KEY);
  else console.log(JSON.stringify({ job: 'ingest:official', note: 'FRED_API_KEY is not set — FRED skipped' }));

  const observations = await runIngestionJob(
    store,
    { provider: 'official', dataType: 'OTHER', job: 'ingest:official' },
    (counters) => ingestOfficialObservations({ store, providers }, counters),
  );
  const resolverErrors: string[] = [];
  const reverify = await runIngestionJob(
    store,
    { provider: 'official', dataType: 'ECONOMIC_EVENT', job: 'ingest:official:reverify' },
    (counters) =>
      reverifyAwaitingOfficial(
        {
          store,
          official: createLiveOfficialResolver(providers, (ref, error) =>
            resolverErrors.push(
              `${ref.source}:${ref.seriesId}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ),
        },
        counters,
      ),
  );
  console.log(
    JSON.stringify({
      job: 'ingest:official',
      observations: {
        status: observations.status,
        fetched: observations.counters.fetched,
        stored: observations.counters.success,
        errors: observations.counters.errorMessages,
      },
      reverify: {
        status: reverify.status,
        published: reverify.counters.success,
        pending_review: reverify.counters.review,
        skipped: reverify.counters.skipReasons,
      },
      resolver_errors: resolverErrors.slice(0, 10),
      at: new Date().toISOString(),
    }),
  );
  if (observations.status === 'FAILURE' || reverify.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:official', error: String(error) }));
  process.exit(1);
});
