import { ESTAT_CPI_2025_STATS_DATA_ID, redactAppId } from '../ingestion/adapters/estatCpi.js';
import { HttpClient } from '../ingestion/http.js';
import { ingestJpCpiValues } from '../ingestion/pipelines/jpCpiValues.js';
import { JobCounters } from '../ingestion/runner.js';
import type { IngestionStore } from '../ingestion/store.js';

/**
 * JP_CPI の取り込みの予行演習(HQ指示 2026-11-13「11/20 の公表に向けて実行手順を検証」)。**DB に接続しない。**
 * 本物の e-Stat の API(ESTAT_APP_ID)と、取り込みの本物のコード(ingestJpCpiValues、dry-run)を、メモリ上の疑似のイベントで動かす:
 *   A. 2026年9月分(公表済み: 2026-10-23 08:30 JST)→ 公表の後の状態を再現 → PUBLISH と 2.1 になるはず
 *   B. 2026年10月分(公表前: 2026-11-20 08:30 JST)→ 公表日の朝を再現 → e-Stat に値が無ければ NOT_YET_AVAILABLE
 *      (11/20 以降にこれを流して PUBLISH になれば、本番の取り込みを流してよい、という印)
 *   C. 10月分で、e-Stat の更新が公表日より前(古い)場合の再現は単体テストで確認済み
 * 出力は注記(::notice)だけ。appId は出さない。使い方: ESTAT_APP_ID=... npm run rehearse:jp-cpi
 */
const appId = process.env.ESTAT_APP_ID?.trim();
if (!appId) {
  console.log('::notice title=jpcpi rehearsal::{"registered":false}');
  process.exit(0);
}

const note = (title: string, value: unknown) =>
  console.log(
    `::notice title=${title}::${redactAppId(JSON.stringify(value)).replace(/%/g, '%25').replace(/\n/g, '%0A')}`,
  );

function fakeStore(providerEventId: string, releaseIso: string): IngestionStore {
  return {
    findIndicatorsByCode: () =>
      Promise.resolve(
        new Map([
          [
            'JP_CPI',
            {
              id: 'rehearsal-indicator',
              code: 'JP_CPI',
              importance: 'HIGH',
              favorable_direction: 'HIGHER_IS_POSITIVE',
            },
          ],
        ]),
      ),
    listEventsByProvider: () =>
      Promise.resolve([
        {
          id: 'rehearsal-event',
          indicator_id: 'rehearsal-indicator',
          provider_event_id: providerEventId,
          release_datetime: releaseIso,
          release_datetime_precision: 'EXACT',
          status: 'SCHEDULED',
          data_status: 'PENDING',
          is_provisional: false,
        },
      ]),
    getReleaseSnapshot: () => Promise.resolve(null),
    latestRevisionValues: () => Promise.resolve({ ACTUAL: null, PREVIOUS: null }),
  } as unknown as IngestionStore;
}

async function scenario(label: string, period: string, releaseIso: string, nowIso: string): Promise<void> {
  const fetcher = new HttpClient('estat', { minIntervalMs: 2_000, timeoutMs: 20_000, maxRetries: 2, backoffMs: 2_000 });
  const counters = new JobCounters();
  const result = await ingestJpCpiValues(
    {
      store: fakeStore(`estat_cpi_schedule:${period}`, releaseIso),
      fetcher,
      appId: appId!,
      now: () => new Date(nowIso),
      dryRun: true,
    },
    counters,
  );
  note(`jpcpi rehearsal ${label}`, {
    table: ESTAT_CPI_2025_STATS_DATA_ID,
    period,
    now: nowIso,
    plan: result.plan,
    skipped: counters.skipReasons,
    errors: counters.errorMessages,
  });
}

async function main(): Promise<void> {
  await scenario('A published month', '2026-09', '2026-10-22T23:30:00.000Z', '2026-10-31T00:00:00.000Z');
  await scenario(
    'B release morning',
    '2026-10',
    '2026-11-19T23:30:00.000Z',
    new Date().toISOString() > '2026-11-19T23:30:00.000Z' ? new Date().toISOString() : '2026-11-20T03:00:00.000Z',
  );
}

main().catch((error: unknown) => {
  note('jpcpi rehearsal error', {
    error: redactAppId(error instanceof Error ? error.message : String(error)).slice(0, 300),
  });
  process.exitCode = 1;
});
