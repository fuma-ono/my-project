import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { assertDevTarget } from '../ingestion/devTarget.js';
import {
  buildIndicatorsDevReport,
  duplicateEvents,
  eventValues,
  existingEventsFingerprint,
  GB_AU_CA_CODES,
  type VerifyCreditRow,
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
      .select('id, indicator_id, provider, provider_event_id, status, data_status, release_datetime, created_at')
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
  const credits = await read<VerifyCreditRow>(
    'api_credit_usage',
    db
      .from('api_credit_usage')
      .select('provider, usage_date, job, run_id, mode, credits, cap, reserved_at')
      .eq('provider', 'bls')
      .order('reserved_at', { ascending: false })
      .range(0, 19),
  );
  const now = new Date();
  // 既存のイベントの指紋: この時刻より前に作られたイベント(実行の前後で同じになるはず。ワークフローの env で指定)
  const cutoff = process.env.VERIFY_EVENT_CUTOFF ?? now.toISOString();
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
    annotation('ind 5 existing events fingerprint', { cutoff, ...existingEventsFingerprint(events, cutoff) }),
    annotation('ind 6 duplicates', duplicateEvents(events)),
    annotation(
      'ind 7 bls credit ledger',
      credits.map((c) => [c.usage_date, c.job, c.run_id, c.mode, c.credits, c.cap, c.reserved_at]),
    ),
  ];
  // JOLTS と JP_CPI のイベント(日時と状態)。長いので、12件ずつに分ける
  const focus = ['US_JOLTS', 'JP_CPI'];
  const focusRows = eventValues(indicators, events, snapshots, focus, 80).map((r) => [r[0], r[1], r[2], r[3], r[4]]);
  for (let i = 0; i < focusRows.length; i += 12) {
    lines.push(annotation(`ind 8 jolts jpcpi events ${i / 12 + 1}`, focusRows.slice(i, i + 12)));
  }
  // 公表予定の取り込みの provider ごとの件数(GB/AU/CA と JP_CPI)
  const byProvider: Record<string, number> = {};
  for (const e of events) {
    const key = e.provider ?? '(none)';
    byProvider[key] = (byProvider[key] ?? 0) + 1;
  }
  lines.push(annotation('ind 9 events by provider', byProvider));
  for (const line of lines) console.log(line);
}

main().catch((error: unknown) => {
  console.log(annotation('ind error', { error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
  process.exitCode = 1;
});
