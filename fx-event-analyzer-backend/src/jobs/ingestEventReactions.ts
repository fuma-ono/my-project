import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { FX_FETCH_SETTINGS } from '../ingestion/config.js';
import { ingestEventPriceReactions } from '../ingestion/pipelines/eventReactions.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 経済指標の価格反応(event_price_reactions)を計算して書き込むジョブ
 * (HQ決定 2026-10-18「経済指標の価格反応実装と異常系テストを進める」)。
 * 外部APIは呼ばない(既存のfx_prices/economic_eventsを読むだけ)。追加費用0円。
 * 本番DBには接続しない(接続先はSUPABASE_URLの設定による。社内確認用DBのみを想定)。
 *
 *   npm run ingest:event-reactions
 *   npm run ingest:event-reactions -- --from 2026-01-01T00:00:00Z --to 2026-10-16T00:00:00Z   # 期間を指定して計算し直す
 *
 * HQ指示(2026-10-27): --from / --to を付けると、直近7日の代わりにその期間の RELEASED の発表を計算し直す
 * (過去の発表のバックフィル。外部 API は呼ばない)。どちらの場合も、値も状態も同じ行は書かず、値のある行
 * (AVAILABLE)を値の無い行で上書きしない。為替の1分足が無い発表は UNAVAILABLE のまま(値を作らない)。
 *
 * 詳細設計: src/ingestion/pipelines/eventReactions.ts。
 * Exit code 0 on success, 1 on failure — cron-friendly。
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const env = loadEnv();
  const from = arg('from');
  const to = arg('to');
  if (
    (from === undefined) !== (to === undefined) ||
    (from && (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to!))))
  ) {
    throw new Error('--from and --to must be given together as ISO 8601 datetimes');
  }
  if (from && Date.parse(from) >= Date.parse(to!)) throw new Error('--from must be before --to');
  const range = from && to ? { fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString() } : undefined;
  const store = createIngestionRepository(createSupabaseClient(env));

  const result = await runIngestionJob(
    store,
    { provider: 'internal', dataType: 'EVENT_REACTION', job: 'ingest:event-reactions' },
    async (counters) => {
      await ingestEventPriceReactions(
        store,
        { horizonDays: FX_FETCH_SETTINGS.repairHorizonDays, ...(range ? { range } : {}) },
        new Date(),
        counters,
      );
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:event-reactions',
      range: range ?? null,
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      skipped: result.counters.skipReasons,
      events: result.counters.details.events,
      errors: result.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:event-reactions', error: String(error) }));
  process.exit(1);
});
