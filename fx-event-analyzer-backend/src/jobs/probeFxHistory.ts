import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { TwelveDataAdapter, TWELVE_DATA_PROVIDER } from '../ingestion/adapters/twelveData.js';
import { API_CREDIT_CAPS, loadIngestionEnv } from '../ingestion/config.js';
import { compareWithStored, summarizeProbeWindow } from '../ingestion/fxHistoryProbe.js';
import { CreditGate } from '../ingestion/http.js';
import { findFxPairMapping } from '../ingestion/mappings/fxPairs.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 過去の為替1分足の取得の試し(HQ判断 2026-10-27「相場反応のバックフィル」: 少数のリクエストで、2026年1月までの
 * 1分足を取れるか、日時・タイムゾーン・欠損・品質を確かめる)。**DB には何も書かない**(ingestion_logs にも)。
 *
 *   npm run probe:fx-history
 *
 * 送るリクエスト(既定で5回。すべて api_credit_ledger に MANUAL として予約してから送る。runCap 5):
 *   1. /earliest_timestamp(USD/JPY、1min) — いつからの1分足があるか
 *   2〜3. 2026-01-09 13:15〜14:30Z(1月の雇用統計の前後)の USD/JPY・EUR/USD
 *   4. 2026-10-14 12:15〜13:30Z(10月の CPI の前後。DEV の1分足が始まる 10/16 より前)の USD/JPY
 *   5. 2026-10-20 13:00〜14:00Z の USD/JPY を、DEV に保存済みの1分足(同じ取得元)と突き合わせる
 *      (日時・タイムゾーンが合っているかの確認)
 * Exit 0 / 1(台帳が予約を断ったら 1)。
 */
const PROBES: readonly { symbol: string; from: string; to: string; compareWithDb?: boolean }[] = [
  { symbol: 'USDJPY', from: '2026-01-09T13:15:00Z', to: '2026-01-09T14:30:00Z' },
  { symbol: 'EURUSD', from: '2026-01-09T13:15:00Z', to: '2026-01-09T14:30:00Z' },
  { symbol: 'USDJPY', from: '2026-10-14T12:15:00Z', to: '2026-10-14T13:30:00Z' },
  { symbol: 'USDJPY', from: '2026-10-20T13:00:00Z', to: '2026-10-20T14:00:00Z', compareWithDb: true },
];
const RUN_CAP = 1 + PROBES.length;

async function main(): Promise<void> {
  const env = loadEnv();
  const keys = loadIngestionEnv();
  if (!keys.TWELVE_DATA_API_KEY) throw new Error('TWELVE_DATA_API_KEY is not set');
  const store = createIngestionRepository(createSupabaseClient(env));
  const gate = new CreditGate(store, {
    provider: TWELVE_DATA_PROVIDER,
    job: 'probe:fx-history',
    runId: `${process.env.GITHUB_RUN_ID ?? 'local'}:${randomUUID()}`,
    mode: 'MANUAL',
    dailyCap: API_CREDIT_CAPS.twelvedata.manual,
    runCap: RUN_CAP,
  });
  const twelve = new TwelveDataAdapter(keys.TWELVE_DATA_API_KEY, { beforeAttempt: gate.beforeAttempt });

  const result: Record<string, unknown> = { job: 'probe:fx-history', requests_planned: RUN_CAP };
  try {
    result.earliest_usdjpy_1min = await twelve.fetchEarliestTimestamp('USDJPY');
  } catch (error) {
    result.earliest_usdjpy_1min = { error: error instanceof Error ? error.message : String(error) };
  }

  const pairs = await store.listFxPairs();
  const windows: unknown[] = [];
  for (const probe of PROBES) {
    try {
      const candles = await twelve.fetchOneMinuteCandles(probe.symbol, { from: probe.from, to: probe.to });
      const stats: Record<string, unknown> = { ...summarizeProbeWindow(probe.symbol, probe, candles) };
      if (probe.compareWithDb) {
        const pair = pairs.find((p) => p.symbol === probe.symbol);
        const pipSize = findFxPairMapping(probe.symbol)?.pipSize ?? 0.01;
        const stored = pair ? await store.listFxMinuteRows(pair.id, probe.from, probe.to) : [];
        stats.db_rows = stored.length;
        stats.compared_with_db = compareWithStored(candles, stored, pipSize / 10);
      }
      windows.push(stats);
    } catch (error) {
      windows.push({
        symbol: probe.symbol,
        from: probe.from,
        to: probe.to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  result.windows = windows;
  result.requests_sent = gate.reserved;
  result.credit_refusal = gate.refusal;
  result.at = new Date().toISOString();
  console.log(JSON.stringify(result));
  if (gate.refusal) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'probe:fx-history', error: String(error) }));
  process.exit(1);
});
