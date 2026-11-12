import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { assertDevTarget } from '../ingestion/devTarget.js';
import {
  buildIndicatorsDevReport,
  eventValues,
  GB_AU_CA_CODES,
  type VerifyEventRow,
  type VerifyIndicatorRow,
  type VerifyPairRow,
  type VerifySnapshotRow,
} from '../ingestion/verify/indicatorsDevReport.js';
import { readOnly } from '../ingestion/verify/readOnlyDb.js';
import { annotation } from '../ingestion/verify/speechDevReport.js';

/**
 * DEV の経済指標の読み取り専用の確認(HQ指示 2026-11-12「GB/AU 経済指標の DEV 検証」)。ワークフロー
 * fx-event-analyzer-dev-verify.yml から動かす。接続先が DEV でなければ止まる。DB は select だけの入口で読む。
 * 出力は、指標・ペア・イベントの件数と状態・値・公表日時だけ(鍵・接続情報・ユーザーの情報は出さない)。
 */
async function main(): Promise<void> {
  const { ref } = assertDevTarget(process.env);
  const db = readOnly(createSupabaseClient(loadEnv()));
  const read = async <T>(
    label: string,
    query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<T[]> => {
    const { data, error } = await query;
    if (error) throw new Error(`${label}: ${error.message}`);
    return (data ?? []) as T[];
  };
  const indicators = await read<VerifyIndicatorRow>(
    'economic_indicators',
    db
      .from('economic_indicators')
      .select('id, code, name, country_code, currency_code, importance, source, source_url, is_active, display_name')
      .range(0, 999),
  );
  const pairs = await read<VerifyPairRow>(
    'indicator_fx_pairs',
    db.from('indicator_fx_pairs').select('indicator_id, is_active, fx_pairs(symbol)').range(0, 4999),
  );
  const events = await read<VerifyEventRow>(
    'economic_events',
    db
      .from('economic_events')
      .select('id, indicator_id, provider, status, data_status, release_datetime')
      .order('release_datetime', { ascending: true })
      .range(0, 4999),
  );
  const snapshots = await read<VerifySnapshotRow>(
    'event_snapshots',
    db
      .from('event_snapshots')
      .select('event_id, actual, previous, source, verification_status')
      .eq('snapshot_type', 'RELEASE')
      .range(0, 4999),
  );
  const now = new Date();
  const report = buildIndicatorsDevReport(indicators, pairs, events, snapshots, now);
  const codes = [...GB_AU_CA_CODES];
  const lines = [
    annotation('ind 1 overview', {
      dev: ref,
      at: report.at,
      indicators: report.indicators.length,
      missing_gb_au_ca: report.missing,
      events: events.length,
      events_by_provider: report.eventsByProvider,
      snapshots: report.snapshotsTotal,
      events_without_indicator: report.unknownIndicators.length,
    }),
    annotation(
      'ind 2 gb au ca',
      report.indicators
        .filter((i) => codes.includes(i.code as never))
        .map((i) => [
          i.code,
          i.display_name,
          i.country,
          i.importance,
          i.active,
          i.source,
          i.has_source_url,
          i.pairs.join('+'),
          i.events_total,
          i.events,
          i.snapshots_with_actual,
        ]),
    ),
    annotation(
      'ind 3 others',
      report.indicators
        .filter((i) => !codes.includes(i.code as never))
        .map((i) => [i.code, i.country, i.importance, i.pairs.length, i.events_total, i.snapshots_with_actual]),
    ),
    annotation('ind 4 gb au ca events', eventValues(indicators, events, snapshots, codes, 40)),
  ];
  for (const line of lines) console.log(line);
}

main().catch((error: unknown) => {
  console.log(annotation('ind error', { error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
  process.exitCode = 1;
});
