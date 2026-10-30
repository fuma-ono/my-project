import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { EurostatAdapter } from '../ingestion/adapters/eurostat.js';
import { ingestCalendarReleases } from '../ingestion/pipelines/economicCalendar.js';
import { planBlsScheduleWrites, readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import {
  buildEurostatScheduleReleases,
  createEurostatNativeResolver,
  createEurostatSeriesCache,
  eurostatObservationRange,
  eurostatScheduleEventId,
  eurostatScheduleSeriesIds,
  EUROSTAT_SCHEDULE_PROVIDER,
  type EurostatScheduleReleaseResult,
} from '../ingestion/pipelines/eurostatCalendar.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import type { IngestionStore } from '../ingestion/store.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * ユーロ圏の経済指標(HQ承認 2026-10-30「ユーロ圏経済指標 第1弾」: EU_HICP 速報値・EU_UNEMPLOYMENT_RATE)。
 * Eurostat の公表日程(mappings/eurostatSchedule.ts)と Eurostat 自身の値だけで economic_events /
 * event_snapshots を作る。設計は ingestion/pipelines/eurostatCalendar.ts。
 *
 *   npm run ingest:official:eurostat-calendar
 *   npm run ingest:official:eurostat-calendar -- --dry-run   # 書き込まずに、何をするはずかだけ出す
 *
 * - Eurostat への HTTP は系列ごとに1回(今は3系列)。キー・登録・契約は不要。台帳(api_credit_ledger)は使わない
 *   (Eurostat に回数の上限の公表は無い。1回の実行で3回だけ)
 * - --dry-run: 書き込む関数を断るストア(readOnlyIngestionStore)で読むだけ。ingestion_logs にも書かない
 * - 失業率(LATEST_ONLY)で、発表から FIRST_RELEASE_WINDOW_HOURS を過ぎてもまだ RELEASED でない行は、
 *   値を入れずに details.first_release_missed に出す(後から改定後の値で埋めない、HQ判断 2026-10-30 1)
 * - 定期実行(GitHub Actions)はまだ無い(main のワークフローの変更は別の承認)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const fetchErrors: string[] = [];
  const series = createEurostatSeriesCache(new EurostatAdapter(), eurostatObservationRange(), (seriesId, error) =>
    fetchErrors.push(`${seriesId}: ${error instanceof Error ? error.message : String(error)}`),
  );
  const official = createEurostatNativeResolver(series);
  // 系列を先にすべて取る(取得の失敗をこの実行の結果に必ず入れるため)。
  await Promise.all(eurostatScheduleSeriesIds().map((id) => series(id)));

  if (process.argv.includes('--dry-run')) {
    const readOnly = readOnlyIngestionStore(store);
    const counters = new JobCounters();
    const built = await buildEurostatScheduleReleases({ series });
    const plan = await planBlsScheduleWrites(readOnly, built.releases, counters, EUROSTAT_SCHEDULE_PROVIDER);
    const missed = await firstReleaseMissed(readOnly, built);
    console.log(
      JSON.stringify({
        job: 'ingest:official:eurostat-calendar',
        dry_run: true,
        ...summary(built),
        first_release_missed: missed,
        plan,
        notes: counters.details,
        errors: counters.errorMessages,
        fetch_errors: fetchErrors,
        at: new Date().toISOString(),
      }),
    );
    if (counters.errors > 0 || fetchErrors.length > 0) process.exitCode = 1;
    return;
  }

  const result = await runIngestionJob(
    store,
    { provider: EUROSTAT_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:official:eurostat-calendar' },
    async (counters) => {
      const built = await buildEurostatScheduleReleases({ series });
      Object.assign(counters.details, summary(built));
      counters.details.first_release_missed = await firstReleaseMissed(store, built);
      counters.details.plan = await planBlsScheduleWrites(store, built.releases, counters, EUROSTAT_SCHEDULE_PROVIDER);
      await ingestCalendarReleases(EUROSTAT_SCHEDULE_PROVIDER, built.releases, { store, official }, counters);
      for (const message of fetchErrors) counters.error(`fetch ${message}`);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:official:eurostat-calendar',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      review: result.counters.review,
      skipped: result.counters.skipReasons,
      details: result.counters.details,
      errors: result.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (result.status !== 'SUCCESS') process.exitCode = 1;
}

function summary(built: EurostatScheduleReleaseResult) {
  const ids = (entries: EurostatScheduleReleaseResult['notYetAvailable']) => entries.map(eurostatScheduleEventId);
  return {
    releases_built: built.releases.length,
    not_yet_available: ids(built.notYetAvailable),
    overdue: ids(built.overdue),
    unmapped: ids(built.unmapped),
  };
}

/** LATEST_ONLY entries past the window whose row is still not RELEASED (missing, or SCHEDULED). Reads only. */
async function firstReleaseMissed(
  store: Pick<IngestionStore, 'findEventByProviderId'>,
  built: EurostatScheduleReleaseResult,
): Promise<string[]> {
  const missed: string[] = [];
  for (const entry of built.outsideFirstReleaseWindow) {
    const id = eurostatScheduleEventId(entry);
    const row = await store.findEventByProviderId(EUROSTAT_SCHEDULE_PROVIDER, id);
    if (row?.status !== 'RELEASED' && row?.status !== 'CANCELLED') missed.push(id);
  }
  return missed;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:official:eurostat-calendar', error: String(error) }));
  process.exit(1);
});
