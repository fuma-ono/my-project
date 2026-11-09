import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { fetchFrbFomcMinutes } from '../ingestion/adapters/frbCalendar.js';
import {
  FOMC_SCHEDULE_PROVIDER,
  ingestFomcMinutesSchedule,
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
 * HQ指示(2026-11-05「公式スケジュール自動更新」): 議事要旨は、実行のたびに FRB の公式カレンダー
 * (https://www.federalreserve.gov/json/calendar.json、1回だけ取得)を読み、表に無い会合の議事要旨が
 * 載っていればその日付で足す(会合の日から日付を作らない。表の行・既にある行の日時は変えない)。
 * 取れなければ表だけで入れる。足した分・食い違い・取得元は details.minutes.official_feed。
 * 会合(US_FOMC)の予定は、今までどおり表だけから入れる(外部へのアクセスは無い)。
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
      const minutes = await ingestFomcMinutesSchedule(
        { store, fetchMinutes: () => fetchFrbFomcMinutes() },
        minutesCounters,
      );
      counters.fetched += minutesCounters.fetched;
      counters.success += minutesCounters.success;
      for (const message of minutesCounters.errorMessages) counters.error(`minutes: ${message}`);
      counters.details.minutes = {
        ...minutes,
        skipped: minutesCounters.skipReasons,
        official_feed: minutesCounters.details.official_feed,
        official_feed_conflicts: minutesCounters.details.official_feed_conflicts ?? [],
      };
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
