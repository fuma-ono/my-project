/**
 * READ-ONLY Supabase (service_role) queries for the data-quality report
 * (src/jobs/reportDataQuality.ts). Never writes. PostgREST returns at most
 * 1000 rows per request, so every list is paged with .range() in a stable
 * order.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreditUsageSample,
  IngestionLogSample,
  ReleaseInstant,
  FxRowSample,
  SnapshotSample,
  StagedSample,
} from './metrics.js';

export const PAGE_SIZE = 1000;

interface PageResult {
  data: unknown[] | null;
  error: Error | null;
}

/** Calls `page(from, to)` (inclusive row offsets) until a short page comes back. */
export async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

export interface QualityPair {
  id: string;
  symbol: string;
}

export interface QualityReader {
  listPairs(symbols: readonly string[] | null): Promise<QualityPair[]>;
  listFxRows(pairId: string, fromIso: string, toIso: string): Promise<FxRowSample[]>;
  /** ISO open time of the earliest stored 1m candle of the pair (= ingestion start), null = none. */
  firstCandleAt(pairId: string): Promise<string | null>;
  /** economic_events rows (any status) with release_datetime in [from, to). */
  countEconomicEvents(fromIso: string, toIso: string): Promise<number>;
  /** api_credit_usage rows with usage_date in [fromDate, toDate] (UTC dates); null = table missing or unreadable. */
  listCreditUsage(fromDate: string, toDate: string): Promise<CreditUsageSample[] | null>;
  listReleases(fromIso: string, toIso: string): Promise<ReleaseInstant[]>;
  listLogs(fromIso: string, toIso: string): Promise<IngestionLogSample[]>;
  listSnapshots(fromIso: string, toIso: string): Promise<SnapshotSample[]>;
  listStaged(fromIso: string, toIso: string): Promise<StagedSample[]>;
}

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export function createQualityReader(supabase: SupabaseClient): QualityReader {
  return {
    async listPairs(symbols) {
      let query = supabase.from('fx_pairs').select('id, symbol').eq('is_active', true).order('symbol');
      if (symbols) query = query.in('symbol', [...symbols]);
      const { data, error }: PageResult = await query;
      if (error) throw error;
      return (data ?? []) as QualityPair[];
    },

    async listFxRows(pairId, fromIso, toIso) {
      const rows = await fetchAllPages<FxRowSample>((from, to) =>
        supabase
          .from('fx_prices')
          .select('timestamp, timeframe, verification_status, cross_check_diff_pips')
          .eq('fx_pair_id', pairId)
          .gte('timestamp', fromIso)
          .lt('timestamp', toIso)
          .order('timestamp', { ascending: true })
          .order('timeframe', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => ({ ...row, cross_check_diff_pips: nullableNumber(row.cross_check_diff_pips) }));
    },

    async firstCandleAt(pairId) {
      const { data, error }: PageResult = await supabase
        .from('fx_prices')
        .select('timestamp')
        .eq('fx_pair_id', pairId)
        .eq('timeframe', '1m')
        .order('timestamp', { ascending: true })
        .limit(1);
      if (error) throw error;
      const first = (data ?? [])[0] as { timestamp: string } | undefined;
      return first?.timestamp ?? null;
    },

    async countEconomicEvents(fromIso, toIso) {
      const { count, error } = await supabase
        .from('economic_events')
        .select('id', { count: 'exact', head: true })
        .gte('release_datetime', fromIso)
        .lt('release_datetime', toIso);
      if (error) throw error;
      return count ?? 0;
    },

    async listCreditUsage(fromDate, toDate) {
      try {
        const rows = await fetchAllPages<{
          provider: string;
          usage_date: string;
          job: string | null;
          credits: number | string;
          cap: number | string | null;
        }>((from, to) =>
          supabase
            .from('api_credit_usage')
            .select('id, provider, usage_date, job, credits, cap')
            .gte('usage_date', fromDate)
            .lte('usage_date', toDate)
            .order('usage_date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        );
        return rows.map((row) => ({
          provider: row.provider,
          usage_date: row.usage_date,
          job: row.job,
          credits: Number(row.credits),
          cap: row.cap === null || row.cap === undefined ? null : Number(row.cap),
        }));
      } catch {
        // The table is added by a later migration; before it exists the report shows 「—(クレジット記録なし)」.
        return null;
      }
    },

    async listReleases(fromIso, toIso) {
      const events = await fetchAllPages<{ release_datetime: string; economic_indicators: { code: string } | null }>(
        (from, to) =>
          supabase
            .from('economic_events')
            .select('id, release_datetime, economic_indicators(code)')
            .eq('status', 'RELEASED')
            .gte('release_datetime', fromIso)
            .lt('release_datetime', toIso)
            .order('release_datetime', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
      );
      const speeches = await fetchAllPages<{ statement_datetime: string; title: string }>((from, to) =>
        supabase
          .from('speech_events')
          .select('id, statement_datetime, title')
          .eq('status', 'DELIVERED')
          .gte('statement_datetime', fromIso)
          .lt('statement_datetime', toIso)
          .order('statement_datetime', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return [
        ...events.map((e): ReleaseInstant => ({
          kind: 'ECONOMIC',
          at: e.release_datetime,
          label: e.economic_indicators?.code ?? '(指標不明)',
        })),
        ...speeches.map((s): ReleaseInstant => ({ kind: 'SPEECH', at: s.statement_datetime, label: s.title })),
      ];
    },

    async listLogs(fromIso, toIso) {
      return fetchAllPages<IngestionLogSample>((from, to) =>
        supabase
          .from('ingestion_logs')
          .select('id, job, provider, data_type, started_at, completed_at, status, details')
          .gte('started_at', fromIso)
          .lt('started_at', toIso)
          .order('started_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
    },

    async listSnapshots(fromIso, toIso) {
      return fetchAllPages<SnapshotSample>((from, to) =>
        supabase
          .from('event_snapshots')
          .select('id, verification_status')
          .eq('snapshot_type', 'RELEASE')
          .gte('captured_at', fromIso)
          .lt('captured_at', toIso)
          .order('id', { ascending: true })
          .range(from, to),
      );
    },

    async listStaged(fromIso, toIso) {
      const rows = await fetchAllPages<{
        verification_status: StagedSample['verification_status'];
        reasons: string[] | null;
      }>((from, to) =>
        supabase
          .from('ingestion_staged_values')
          .select('id, verification_status, reasons')
          .gte('fetched_at', fromIso)
          .lt('fetched_at', toIso)
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => ({ verification_status: row.verification_status, reasons: row.reasons ?? [] }));
    },
  };
}
