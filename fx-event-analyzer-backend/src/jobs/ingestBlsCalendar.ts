import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { BlsAdapter } from '../ingestion/adapters/bls.js';
import { loadIngestionEnv } from '../ingestion/config.js';
import { ingestCalendarReleases } from '../ingestion/pipelines/economicCalendar.js';
import {
  buildBlsScheduleReleases,
  BLS_SCHEDULE_PROVIDER,
  createBlsNativeResolver,
  scheduleObservationRange,
} from '../ingestion/pipelines/blsCalendar.js';
import { BLS_SCHEDULE } from '../ingestion/mappings/blsSchedule.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 有料カレンダーに依存しない独立経路(HQ判断 2026-10-17): BLSの公式発表
 * スケジュール(mappings/blsSchedule.ts)と、BLS自身の実績値だけで
 * economic_events / event_snapshots を作る。対象は US_CPI・US_NFP のみ
 * (この2指標だけ economic_indicators に行があり、BLSの公式系列でまだ
 * 揃う)。詳しい設計は ingestion/pipelines/blsCalendar.ts を参照。
 *
 *   npm run ingest:official:bls-calendar
 *
 * BLS_API_KEY は不要(無ければ v1、25クエリ/日)。キー・契約なしで動く。
 * 既存の①(有料カレンダー、economicCalendar.ts)・②(ingest:official)は
 * 一切変更していない。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const keys = loadIngestionEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const bls = new BlsAdapter(keys.BLS_API_KEY);
  const resolverErrors: string[] = [];
  const official = createBlsNativeResolver(bls, scheduleObservationRange(BLS_SCHEDULE), (error) =>
    resolverErrors.push(error instanceof Error ? error.message : String(error)),
  );

  const result = await runIngestionJob(
    store,
    { provider: BLS_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:official:bls-calendar' },
    async (counters) => {
      const built = await buildBlsScheduleReleases({ official });
      counters.details.not_yet_available = built.notYetAvailable.length;
      counters.details.overdue = built.overdue.map((e) => `${e.indicatorCode}:${e.referencePeriod}`);
      counters.details.unmapped = built.unmapped.length;
      await ingestCalendarReleases(BLS_SCHEDULE_PROVIDER, built.releases, { store, official }, counters);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:official:bls-calendar',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      review: result.counters.review,
      skipped: result.counters.skipReasons,
      not_yet_available: result.counters.details.not_yet_available,
      overdue: result.counters.details.overdue,
      unmapped: result.counters.details.unmapped,
      errors: result.counters.errorMessages,
      resolver_errors: resolverErrors.slice(0, 10),
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:official:bls-calendar', error: String(error) }));
  process.exit(1);
});
