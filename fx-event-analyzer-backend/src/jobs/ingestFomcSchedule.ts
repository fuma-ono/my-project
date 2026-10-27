import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import {
  FOMC_MINUTES_TARGET,
  FOMC_SCHEDULE_PROVIDER,
  ingestFomcSchedule,
} from '../ingestion/pipelines/fomcSchedule.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * FOMCの会合日程(HQ承認 2026-10-22 Task 3): コードレビュー済みの表
 * (ingestion/mappings/fomcSchedule.ts)から、指標 US_FOMC の政策発表の予定を
 * economic_events に入れる。外部へのアクセスは無い(表を読むだけ)。値は入れない。
 *
 *   npm run ingest:fomc-schedule
 *
 * HQ指示(2026-10-27): 同じ実行で、FOMC 議事要旨の公表予定(FOMC_MINUTES_SCHEDULE)も、会合とは別の
 * 指標 US_FOMC_MINUTES(provider 'fomc_minutes_schedule')として入れる。結果は details.minutes。
 * 議事要旨の指標の行(migration 20261027000004)が無い DB では、議事要旨だけエラーになる(会合は入る)。
 *
 * 定期実行には登録していない(表を直したときに手動で動かす)。
 * 前提: migration 20261022000002(economic_events.is_provisional)が適用済み。
 * Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const result = await runIngestionJob(
    store,
    { provider: FOMC_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:fomc-schedule' },
    async (counters) => {
      await ingestFomcSchedule({ store }, counters);
      const minutesCounters = new JobCounters();
      const minutes = await ingestFomcSchedule({ store, target: FOMC_MINUTES_TARGET }, minutesCounters);
      counters.fetched += minutesCounters.fetched;
      counters.success += minutesCounters.success;
      for (const message of minutesCounters.errorMessages) counters.error(`minutes: ${message}`);
      counters.details.minutes = { ...minutes, skipped: minutesCounters.skipReasons };
    },
  );
  const d = result.counters.details;
  console.log(
    JSON.stringify({
      job: 'ingest:fomc-schedule',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      inserted: d.inserted,
      updated: d.updated,
      unchanged: d.unchanged,
      cancelled: d.cancelled,
      provisional: d.provisional,
      past: d.past,
      removed: d.removed,
      minutes: d.minutes,
      skipped: result.counters.skipReasons,
      errors: result.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:fomc-schedule', error: String(error) }));
  process.exit(1);
});
