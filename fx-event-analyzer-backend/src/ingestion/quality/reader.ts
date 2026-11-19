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
  SpeechDbStatus,
  SpeechRunSample,
  StagedSample,
} from './metrics.js';
import { UNKNOWN_INDICATOR_CODE } from './metrics.js';
import { FOMC_POLICY_RATE_JOB } from '../pipelines/fomcPolicyRates.js';
import { getSpeechProviderDbStatus, listSpeechIngestionRuns } from '../../repositories/speechesRepository.js';
import {
  PENDING_STALE_HOURS,
  SPEECH_PIPELINE_WINDOW_DAYS,
  type SpeechPipelineJob,
  type SpeechPipelineStatus,
} from './speechPipeline.js';

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
  /**
   * 第9章(要人発言の鮮度): その取得元の ingest:speeches の最新2件と最後の SUCCESS。
   * 対象期間(days)に関係なく読む(18時間ルールは期間より前の SUCCESS も見るため)。
   */
  listSpeechRuns(provider: string): Promise<SpeechRunSample[]>;
  /** 第9章: その取得元の speech_events の最新 statement_datetime(状態問わず)と未来の SCHEDULED 件数。 */
  speechDbStatus(provider: string, nowIso: string): Promise<SpeechDbStatus>;
  /** 第10章: 暫定(is_provisional)のまま SCHEDULED の economic_events で、release_datetime が [from, to) のもの。 */
  listProvisionalEvents(fromIso: string, toIso: string): Promise<ProvisionalEventSample[]>;
  /**
   * 第11章(要人発言の本文と要約、HQ承認 2026-11-11): 最後の実行と、直近14日の発言済みの行の件数。READ-ONLY。
   * 読めなければ(列が無い = migration 20261112000001 の前など)null。
   */
  speechPipelineStatus(nowIso: string): Promise<SpeechPipelineStatus | null>;
  /**
   * 第12章(HQ指示 2026-11-18「取り込み品質の確認」): 発表の時刻が [from, to) で、まだ SCHEDULED のままの economic_events
   * (= 発表の時刻を過ぎたのに、実績の取り込みがまだ。取消し・発表済みは含まない)。READ-ONLY。
   */
  listOverdueScheduledEvents(fromIso: string, toIso: string): Promise<OverdueEventSample[]>;
  /**
   * 第12章: 最後の `ingest:fomc-policy-rate` の実行(ingestion_logs)。実行記録が無ければ null。READ-ONLY。
   * details の awaiting・unmatched は、取り込み処理自身が書いたもの(読み取るだけ)。
   */
  latestFomcPolicyRateRun(): Promise<FomcRunSample | null>;
}

/** 第12章: 最後の FOMC 政策金利の取り込みの実行。 */
export interface FomcRunSample {
  started_at: string;
  status: string;
  awaiting: string[];
  /** 取り込み処理が書く実際の形: { provider_event_id, reason }(reason は NO_RECORD_IN_WINDOW など)。 */
  unmatched: { provider_event_id: string; reason: string }[];
  /** 形式が合わず読み捨てた要素の数(awaiting・unmatched)。 */
  discarded: { awaiting: number; unmatched: number };
}

/** 第12章: 発表の時刻を過ぎても SCHEDULED のままの発表。 */
export interface OverdueEventSample {
  indicator_code: string;
  release_datetime: string;
  /** FOMC の会合(US_FOMC)だけ: 取り込みの実行記録(awaiting・unmatched)との突き合わせ用。 */
  provider_event_id?: string | null | undefined;
  /** FOMC の会合(US_FOMC)だけ: 政策金利の表(fomc_policy_decisions)に行があるか。それ以外は undefined。 */
  policy_recorded?: boolean | undefined;
}

/** 第10章(HQ判断 2026-10-27 案B): 暫定の予定は通知しないため、確定の作業の漏れを見つける。 */
export interface ProvisionalEventSample {
  provider_event_id: string | null;
  indicator_code: string;
  release_datetime: string;
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
          mode: string | null;
        }>((from, to) =>
          supabase
            .from('api_credit_usage')
            .select('id, provider, usage_date, job, mode, credits, cap')
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
          mode: row.mode ?? null,
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
          label: e.economic_indicators?.code ?? UNKNOWN_INDICATOR_CODE,
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
      const rows = await fetchAllPages<{
        verification_status: string;
        verification_source: string | null;
        economic_events: { provider: string } | null;
      }>((from, to) =>
        supabase
          .from('event_snapshots')
          .select('id, verification_status, verification_source, economic_events(provider)')
          .eq('snapshot_type', 'RELEASE')
          .gte('captured_at', fromIso)
          .lt('captured_at', toIso)
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => {
        const provider = row.economic_events?.provider;
        return {
          verification_status: row.verification_status,
          verification_source: row.verification_source,
          ...(provider !== undefined ? { provider } : {}),
        };
      });
    },

    async listStaged(fromIso, toIso) {
      const rows = await fetchAllPages<{
        verification_status: StagedSample['verification_status'];
        reasons: string[] | null;
        indicator_code: string;
        reference_period: string | null;
        provider: string;
        actual: number | string | null;
        new_value: number | string | null;
        official_actual: number | string | null;
      }>((from, to) =>
        supabase
          .from('ingestion_staged_values')
          .select(
            'id, verification_status, reasons, indicator_code, reference_period, provider, actual, new_value, official_actual',
          )
          .gte('fetched_at', fromIso)
          .lt('fetched_at', toIso)
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => ({
        verification_status: row.verification_status,
        reasons: row.reasons ?? [],
        indicator_code: row.indicator_code,
        reference_period: row.reference_period,
        provider: row.provider,
        actual: nullableNumber(row.actual),
        new_value: nullableNumber(row.new_value),
        official_actual: nullableNumber(row.official_actual),
      }));
    },

    async listSpeechRuns(provider) {
      return listSpeechIngestionRuns(supabase, provider);
    },

    async speechPipelineStatus(nowIso) {
      const nowMs = Date.parse(nowIso);
      const sinceIso = new Date(nowMs - SPEECH_PIPELINE_WINDOW_DAYS * 86_400_000).toISOString();
      const staleBeforeIso = new Date(nowMs - PENDING_STALE_HOURS * 3_600_000).toISOString();
      const delivered = () =>
        supabase
          .from('speech_events')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'DELIVERED')
          .gte('statement_datetime', sinceIso);
      try {
        const jobs: SpeechPipelineJob[] = ['ingest:speech-bodies', 'ingest:speech-summaries'];
        const lastRuns = await Promise.all(
          jobs.map(async (job) => {
            const { data, error } = await supabase
              .from('ingestion_logs')
              .select('started_at, status')
              .eq('job', job)
              .order('started_at', { ascending: false })
              .limit(1);
            if (error) throw error;
            const row = (data ?? [])[0] as { started_at: string; status: string } | undefined;
            return { job, startedAt: row?.started_at ?? null, status: row?.status ?? null };
          }),
        );
        const counts = await Promise.all([
          delivered()
            .eq('body_status', 'PENDING')
            .not('source_url', 'is', null)
            .lt('statement_datetime', staleBeforeIso),
          delivered().eq('body_status', 'FAILED').lt('body_attempts', 3),
          delivered().in('body_status', ['PENDING', 'FAILED']).gte('body_attempts', 3),
          delivered().not('summary_error', 'is', null),
          delivered().eq('body_status', 'FETCHED').is('summary', null).is('summary_error', null),
        ]);
        for (const c of counts) if (c.error) throw c.error;
        const [stale, retrying, atCap, summaryFailed, withoutSummary] = counts.map((c) => c.count ?? 0);
        return {
          lastRuns,
          pendingWithUrlStale: stale!,
          bodyFailedRetrying: retrying!,
          bodyAtCap: atCap!,
          summaryFailed: summaryFailed!,
          fetchedWithoutSummary: withoutSummary!,
        };
      } catch {
        return null; // 第11章は「読めなかった」と出す(ほかの章は変えない)
      }
    },

    async speechDbStatus(provider, nowIso) {
      return getSpeechProviderDbStatus(supabase, provider, nowIso);
    },

    async listProvisionalEvents(fromIso, toIso) {
      const rows = await fetchAllPages<{
        provider_event_id: string | null;
        release_datetime: string;
        economic_indicators: { code: string } | null;
      }>((from, to) =>
        supabase
          .from('economic_events')
          .select('id, provider_event_id, release_datetime, economic_indicators(code)')
          .eq('is_provisional', true)
          .eq('status', 'SCHEDULED')
          .gte('release_datetime', fromIso)
          .lt('release_datetime', toIso)
          .order('release_datetime', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => ({
        provider_event_id: row.provider_event_id,
        indicator_code: row.economic_indicators?.code ?? UNKNOWN_INDICATOR_CODE,
        release_datetime: row.release_datetime,
      }));
    },

    async listOverdueScheduledEvents(fromIso, toIso) {
      // 件数(count: 'exact')を一緒に読み、集めた行数と一致しなければ失敗にする(サーバー側の max_rows による打ち切りで、
      // 一部の行が黙って欠けることを防ぐ)。次のページの位置は、PAGE_SIZE ではなく、実際に返った行数で進める
      // (max_rows が PAGE_SIZE より小さくても、飛ばさない)。
      type Row = {
        release_datetime: string;
        provider_event_id?: string | null;
        economic_indicators: { code: string } | null;
        fomc_policy_decisions?: { event_id: string } | { event_id: string }[] | null;
      };
      const rows: Row[] = [];
      let expected: number;
      for (;;) {
        const { data, error, count } = await supabase
          .from('economic_events')
          .select(
            'id, release_datetime, provider_event_id, economic_indicators(code), fomc_policy_decisions(event_id)',
            {
              count: 'exact',
            },
          )
          .eq('status', 'SCHEDULED')
          .gte('release_datetime', fromIso)
          .lt('release_datetime', toIso)
          .order('release_datetime', { ascending: true })
          .order('id', { ascending: true })
          .range(rows.length, rows.length + PAGE_SIZE - 1);
        if (error) throw error;
        if (typeof count !== 'number') throw new Error('overdue events: the row count was not returned');
        expected = count;
        const chunk = (data ?? []) as unknown as Row[];
        rows.push(...chunk);
        if (rows.length >= expected || chunk.length === 0) break;
      }
      if (rows.length !== expected) {
        throw new Error(
          `overdue events: read ${rows.length} rows but the server counted ${expected} (truncated by max_rows?)`,
        );
      }
      return rows.map((row) => {
        const code = row.economic_indicators?.code ?? UNKNOWN_INDICATOR_CODE;
        const decision = row.fomc_policy_decisions;
        const recorded = Array.isArray(decision) ? decision.length > 0 : decision != null;
        return {
          indicator_code: code,
          release_datetime: row.release_datetime,
          ...(code === 'US_FOMC'
            ? { policy_recorded: recorded, provider_event_id: row.provider_event_id ?? null }
            : {}),
        };
      });
    },

    async latestFomcPolicyRateRun() {
      const { data, error } = await supabase
        .from('ingestion_logs')
        .select('started_at, status, details')
        .eq('job', FOMC_POLICY_RATE_JOB)
        .order('started_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as { started_at: string; status: string; details: unknown } | undefined;
      if (!row) return null;
      const details = (row.details ?? {}) as Record<string, unknown>;
      // 取り込み処理が書く形(awaiting = 文字列の配列、unmatched = {provider_event_id, reason} の配列)に合わない要素は読み捨てるが、
      // 黙って捨てない: 捨てた数を返し、レポートに出す(形式の変更・欠落に気づけるように)。配列でない値も 1 件の読み捨てとして数える。
      const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? (value as unknown[]) : null);
      const rawAwaiting = asArray(details.awaiting);
      const rawUnmatched = asArray(details.unmatched);
      const awaiting = (rawAwaiting ?? []).filter((v): v is string => typeof v === 'string');
      const unmatched: { provider_event_id: string; reason: string }[] = [];
      for (const item of rawUnmatched ?? []) {
        const o = (item ?? {}) as Record<string, unknown>;
        if (typeof o.provider_event_id === 'string')
          unmatched.push({
            provider_event_id: o.provider_event_id,
            reason: typeof o.reason === 'string' ? o.reason : 'UNKNOWN',
          });
      }
      const malformedContainer = (raw: unknown, parsed: unknown[] | null) =>
        parsed === null && raw !== undefined && raw !== null ? 1 : 0;
      return {
        started_at: new Date(row.started_at).toISOString(),
        status: row.status,
        awaiting,
        unmatched,
        discarded: {
          awaiting: (rawAwaiting?.length ?? 0) - awaiting.length + malformedContainer(details.awaiting, rawAwaiting),
          unmatched:
            (rawUnmatched?.length ?? 0) - unmatched.length + malformedContainer(details.unmatched, rawUnmatched),
        },
      };
    },
  };
}
