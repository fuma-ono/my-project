import type { SupabaseClient } from '@supabase/supabase-js';
import { rangeFor, type PaginationParams } from '../utils/pagination.js';
import {
  EMPTY_RELEASE_SUMMARY,
  buildReleaseSummaries,
  compareByNextRelease,
  normalizeKeyPoints,
  type IndicatorReleaseSummary,
} from '../domain/indicators.js';

export interface IndicatorRow {
  id: string;
  code: string;
  name: string;
  /** 一覧画面の表示名 (HQの表示名ルール、例: `消費者物価指数（CPI）`)。未登録はnull。 */
  display_name: string | null;
  /** SCR-006 英語名 (例: `Consumer Price Index`)。未登録はnull。 */
  name_en: string | null;
  country_code: string;
  currency_code: string;
  importance: string;
  /** SCR-006 概要 (日本語1〜2文)。 */
  description: string | null;
  /** SCR-006 注目される理由。DBのNULL(未登録)は `[]` で返す。 */
  key_points: string[];
  frequency: string;
  unit: string | null;
  source: string | null;
  source_url: string | null;
  favorable_direction: string;
  /** SCR-008 結果が予想を上回ったときの一般的な見方 (人が書いた定型文)。未登録はnull。 */
  market_view_above: string | null;
  /** SCR-008 結果が予想を下回ったときの一般的な見方 (人が書いた定型文)。未登録はnull。 */
  market_view_below: string | null;
}

type IndicatorDbRow = Omit<IndicatorRow, 'key_points'> & { key_points: string[] | null };

const INDICATOR_COLUMNS =
  'id, code, name, display_name, name_en, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below';

function toIndicatorRow(row: IndicatorDbRow): IndicatorRow {
  return { ...row, display_name: row.display_name ?? null, key_points: normalizeKeyPoints(row.key_points) };
}

export interface ListIndicatorsFilters {
  q?: string | undefined;
  countryCode?: string | undefined;
  currencyCode?: string | undefined;
  importance?: string | undefined;
  sort: 'name' | 'importance' | 'created_at' | 'next_release';
}

/** §13.1 list item: the indicator plus its next / latest release (v1.20). */
export type IndicatorListRow = IndicatorRow & IndicatorReleaseSummary;

export async function listIndicators(
  supabase: SupabaseClient,
  filters: ListIndicatorsFilters,
  pagination: PaginationParams,
  now: Date = new Date(),
): Promise<{ rows: IndicatorListRow[]; total: number }> {
  let query = supabase.from('economic_indicators').select(INDICATOR_COLUMNS, { count: 'exact' }).eq('is_active', true);

  if (filters.q) {
    const escaped = filters.q.replace(/[%_]/g, (char) => `\\${char}`);
    query = query.or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`);
  }
  if (filters.countryCode) query = query.eq('country_code', filters.countryCode);
  if (filters.currencyCode) query = query.eq('currency_code', filters.currencyCode);
  if (filters.importance) query = query.eq('importance', filters.importance);

  const { from, to } = rangeFor(pagination.page, pagination.limit);

  if (filters.sort === 'next_release') {
    // The sort key lives on economic_events, not economic_indicators, so the
    // whole (filtered, active) indicator set is fetched, summarised, sorted
    // and then paged here. The active indicator master is small (tens of
    // rows), so this stays 1 + 2 queries regardless of page.
    const { data, error, count } = await query.order('name', { ascending: true });
    if (error) throw error;
    const indicators = ((data ?? []) as IndicatorDbRow[]).map(toIndicatorRow);
    const summaries = await getIndicatorReleaseSummaries(
      supabase,
      indicators.map((row) => row.id),
      now,
    );
    const rows = withSummaries(indicators, summaries).sort(compareByNextRelease);
    return { rows: rows.slice(from, to + 1), total: count ?? rows.length };
  }

  const { data, error, count } = await query.order(filters.sort, { ascending: true }).range(from, to);
  if (error) throw error;

  const indicators = ((data ?? []) as IndicatorDbRow[]).map(toIndicatorRow);
  const summaries = await getIndicatorReleaseSummaries(
    supabase,
    indicators.map((row) => row.id),
    now,
  );
  return { rows: withSummaries(indicators, summaries), total: count ?? 0 };
}

function withSummaries(
  indicators: IndicatorRow[],
  summaries: Map<string, IndicatorReleaseSummary>,
): IndicatorListRow[] {
  return indicators.map((row) => ({ ...row, ...(summaries.get(row.id) ?? EMPTY_RELEASE_SUMMARY) }));
}

/** PostgREST `in.(...)` goes in the URL — keep each request's id list short. */
const RELEASE_SUMMARY_ID_CHUNK = 100;

/**
 * SCR-005 指標一覧 (§13.1 / §13.2, v1.20): next SCHEDULED release (at/after
 * `now`) and latest RELEASED release per indicator, for a whole page in two
 * queries (one per status) — never one query per indicator.
 */
export async function getIndicatorReleaseSummaries(
  supabase: SupabaseClient,
  indicatorIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, IndicatorReleaseSummary>> {
  if (indicatorIds.length === 0) return new Map();

  const chunks: string[][] = [];
  for (let index = 0; index < indicatorIds.length; index += RELEASE_SUMMARY_ID_CHUNK) {
    chunks.push(indicatorIds.slice(index, index + RELEASE_SUMMARY_ID_CHUNK));
  }

  const [scheduled, released] = await Promise.all([
    Promise.all(
      chunks.map(async (ids) => {
        const { data, error } = await supabase
          .from('economic_events')
          .select('id, indicator_id, release_datetime')
          .in('indicator_id', ids)
          .eq('status', 'SCHEDULED')
          .gte('release_datetime', now.toISOString())
          .order('release_datetime', { ascending: true });
        if (error) throw error;
        return data ?? [];
      }),
    ),
    Promise.all(
      chunks.map(async (ids) => {
        const { data, error } = await supabase
          .from('economic_events')
          .select('id, indicator_id, release_datetime')
          .in('indicator_id', ids)
          .eq('status', 'RELEASED')
          .order('release_datetime', { ascending: false });
        if (error) throw error;
        return data ?? [];
      }),
    ),
  ]);

  return buildReleaseSummaries(indicatorIds, scheduled.flat(), released.flat(), now);
}

export async function getIndicatorById(supabase: SupabaseClient, indicatorId: string): Promise<IndicatorRow | null> {
  const { data, error } = await supabase
    .from('economic_indicators')
    .select(INDICATOR_COLUMNS)
    .eq('id', indicatorId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data ? toIndicatorRow(data) : null;
}

export interface RelatedFxPairRow {
  fx_pair_id: string;
  symbol: string;
  priority: number;
}

export async function listRelatedFxPairs(supabase: SupabaseClient, indicatorId: string): Promise<RelatedFxPairRow[]> {
  const { data, error } = await supabase
    .from('indicator_fx_pairs')
    .select('priority, fx_pairs!inner(id, symbol)')
    .eq('indicator_id', indicatorId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const fxPair = row.fx_pairs as unknown as { id: string; symbol: string };
    return { fx_pair_id: fxPair.id, symbol: fxPair.symbol, priority: row.priority };
  });
}

export interface IndicatorEventRow {
  id: string;
  release_datetime: string;
  release_datetime_precision: string;
  importance: string;
  status: string;
  data_status: string;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise: number | null;
  surprise_direction: string | null;
}

export interface ListIndicatorEventsFilters {
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
}

/** api-design.md §13.3 — past/future Event list for one Indicator.
 * `from` is inclusive, `to` is exclusive (§6). */
export async function listEventsForIndicator(
  supabase: SupabaseClient,
  indicatorId: string,
  filters: ListIndicatorEventsFilters,
  pagination: PaginationParams,
): Promise<{ rows: IndicatorEventRow[]; total: number }> {
  let query = supabase
    .from('economic_events')
    .select(
      'id, release_datetime, release_datetime_precision, importance, status, data_status, event_snapshots(forecast, actual, previous, surprise, surprise_direction, snapshot_type)',
      { count: 'exact' },
    )
    .eq('indicator_id', indicatorId);

  if (filters.from) query = query.gte('release_datetime', filters.from);
  if (filters.to) query = query.lt('release_datetime', filters.to);
  if (filters.status) query = query.eq('status', filters.status);

  const { from, to } = rangeFor(pagination.page, pagination.limit);
  const { data, error, count } = await query.order('release_datetime', { ascending: false }).range(from, to);
  if (error) throw error;

  const rows: IndicatorEventRow[] = (data ?? []).map((row) => {
    const snapshots = row.event_snapshots as unknown as Array<{
      forecast: number | null;
      actual: number | null;
      previous: number | null;
      surprise: number | null;
      surprise_direction: string | null;
      snapshot_type: string;
    }>;
    const snapshot = snapshots?.find((entry) => entry.snapshot_type === 'RELEASE') ?? null;
    return {
      id: row.id,
      release_datetime: row.release_datetime,
      release_datetime_precision: row.release_datetime_precision,
      importance: row.importance,
      status: row.status,
      data_status: row.data_status,
      forecast: snapshot?.forecast ?? null,
      actual: snapshot?.actual ?? null,
      previous: snapshot?.previous ?? null,
      surprise: snapshot?.surprise ?? null,
      surprise_direction: snapshot?.surprise_direction ?? null,
    };
  });

  return { rows, total: count ?? 0 };
}

export interface LatestEventRow {
  id: string;
  release_datetime: string;
  status: string;
}

export async function getLatestEvent(supabase: SupabaseClient, indicatorId: string): Promise<LatestEventRow | null> {
  const { data, error } = await supabase
    .from('economic_events')
    .select('id, release_datetime, status')
    .eq('indicator_id', indicatorId)
    .order('release_datetime', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
