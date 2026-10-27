import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { EcbPressAdapter } from '../ingestion/adapters/ecbPress.js';
import { FrbCalendarAdapter } from '../ingestion/adapters/frbCalendar.js';
import { ingestSpeeches } from '../ingestion/pipelines/speeches.js';
import type { SpeechScheduleProvider } from '../ingestion/providers.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * ④ Central-bank speech schedules → speech_events (data-sources.md §5, §8).
 *   - FRB: federalreserve.gov calendar JSON (scheduled times, US Eastern).
 *   - ECB: press RSS (publication times only → skipped by default and
 *     logged as TIME_NOT_EXACT; kept so the log shows what was seen).
 * Unknown speakers are skipped and listed in the ingestion log.
 *
 *   npm run ingest:speeches
 *
 * Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY only (no API keys).
 * FRB: FOMC の記者会見(type "FOMC" の "FOMC Press Conference")も、議長の発言として取り込む(HQ判断 2026-10-27)。
 * Exit 0 / 1. 定時実行: 1日2回(fx-event-analyzer-ingestion.yml の cron 15 21,9 * * *)。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const frb = new FrbCalendarAdapter();
  const sources: SpeechScheduleProvider[] = [frb, new EcbPressAdapter()];
  let failed = false;
  for (const source of sources) {
    const result = await runIngestionJob(
      store,
      { provider: source.name, dataType: 'OTHER', job: 'ingest:speeches' },
      async (counters) => {
        const speeches = await source.fetchSpeeches();
        if (source === frb && frb.lastSkipped.length > 0) {
          for (const skipped of frb.lastSkipped) counters.skip(`FEED_${skipped.reason}`);
        }
        await ingestSpeeches(source.name, speeches, { store }, counters);
      },
    );
    console.log(
      JSON.stringify({
        job: 'ingest:speeches',
        provider: source.name,
        status: result.status,
        fetched: result.counters.fetched,
        upserted: result.counters.success,
        skipped: result.counters.skipReasons,
        unknown_speakers: result.counters.details.unknown_speakers ?? [],
        errors: result.counters.errorMessages,
      }),
    );
    if (result.status === 'FAILURE') failed = true;
  }
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:speeches', error: String(error) }));
  process.exit(1);
});
