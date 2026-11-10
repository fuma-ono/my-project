import type { StrategyPairCandidate } from '../domain/eventStrategyAnalysis.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface HistoricalEventRow {
  event_id: string;
  release_datetime: string;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise: number | null;
  surprise_direction: string | null;
  /** HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要」: mapping.secondaryが設定された指標だけ埋まる(今は米国CPIのMOM_PCT)。 */
  secondary_value_kind: string | null;
  secondary_forecast: number | null;
  secondary_actual: number | null;
  secondary_previous: number | null;
}

/** RELEASE スナップショットの値。secondary_* は前月比など(v1.35。副指標が無い指標は null)。 */
export const SNAPSHOT_VALUE_COLUMNS =
  'forecast, actual, previous, surprise, surprise_direction, secondary_value_kind, secondary_forecast, secondary_actual, secondary_previous';

interface SnapshotValues {
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise: number | null;
  surprise_direction: string | null;
  secondary_value_kind: string | null;
  secondary_forecast: number | null;
  secondary_actual: number | null;
  secondary_previous: number | null;
}

/** The embedded RELEASE snapshot — PostgREST returns the one-to-many
 * `event_snapshots` embed as an array (unique is (event_id, snapshot_type),
 * not event_id alone), so accept both shapes. */
function releaseSnapshotOf(embedded: unknown): SnapshotValues {
  const snapshot = (Array.isArray(embedded) ? embedded[0] : embedded) as Partial<SnapshotValues> | undefined;
  return {
    forecast: snapshot?.forecast ?? null,
    actual: snapshot?.actual ?? null,
    previous: snapshot?.previous ?? null,
    surprise: snapshot?.surprise ?? null,
    surprise_direction: snapshot?.surprise_direction ?? null,
    secondary_value_kind: snapshot?.secondary_value_kind ?? null,
    secondary_forecast: snapshot?.secondary_forecast ?? null,
    secondary_actual: snapshot?.secondary_actual ?? null,
    secondary_previous: snapshot?.secondary_previous ?? null,
  };
}

/**
 * Both comparison queries below select the same rows in the same order
 * (HQ判断 2026-10-22): RELEASED events of the indicator that have a RELEASE
 * snapshot (inner join), release_datetime desc then id asc. So the id set the
 * stats use and the paginated `events` never disagree, and FREE never sees
 * more than history_events_max.
 */

/** RELEASED events for an indicator, most recent first, each paired with
 * its RELEASE snapshot. HQ決定(2026-11-10「取得日の表示 案a」): 各行に、その値を取得した日時(RELEASE スナップショットの
 * captured_at)も付ける。取得日は値ではないので、FREE でロックした行でも隠さない(RELEASE_VALUE_FIELDS に入っていない)。 */
export async function listReleasedEventsForIndicator(
  supabase: SupabaseClient,
  indicatorId: string,
  range: { from: number; to: number },
): Promise<{ rows: (HistoricalEventRow & { captured_at: string | null })[]; total: number }> {
  const { data, error, count } = await supabase
    .from('economic_events')
    .select(`id, release_datetime, event_snapshots!inner(${SNAPSHOT_VALUE_COLUMNS}, captured_at, snapshot_type)`, {
      count: 'exact',
    })
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .eq('event_snapshots.snapshot_type', 'RELEASE')
    .order('release_datetime', { ascending: false })
    .order('id', { ascending: true })
    .range(range.from, range.to);
  if (error) throw error;

  const rows = (data ?? []).map((row) => {
    const embedded = row.event_snapshots as unknown;
    const snapshot = (Array.isArray(embedded) ? embedded[0] : embedded) as { captured_at?: string | null } | undefined;
    return {
      event_id: row.id,
      release_datetime: row.release_datetime,
      ...releaseSnapshotOf(row.event_snapshots),
      captured_at: snapshot?.captured_at ?? null,
    };
  });

  return { rows, total: count ?? 0 };
}

export interface ReleasedEventIdRow {
  id: string;
}

/** The `limit` most recent RELEASED event ids (with a RELEASE snapshot,
 * same eligibility and order as listReleasedEventsForIndicator) — the set
 * Historical Comparison stats are computed over (capped per plan,
 * api-design.md §21 / §28.1). */
export async function listRecentReleasedEventIds(
  supabase: SupabaseClient,
  indicatorId: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('economic_events')
    .select('id, event_snapshots!inner(snapshot_type)')
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .eq('event_snapshots.snapshot_type', 'RELEASE')
    .order('release_datetime', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: ReleasedEventIdRow) => row.id);
}

export interface ComparisonReactionRow {
  event_id: string;
  timeframe: string;
  movement: number | null;
  pips: number | null;
}

/** Only `data_status = AVAILABLE` rows — incomplete data is never mixed
 * into statistics (db-design.md §10). */
export async function listAvailableReactionsForComparison(
  supabase: SupabaseClient,
  eventIds: string[],
  fxPairId: string,
  timeframes: string[],
): Promise<ComparisonReactionRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select('event_id, timeframe, movement, pips')
    .in('event_id', eventIds)
    .eq('fx_pair_id', fxPairId)
    .in('timeframe', timeframes)
    .eq('data_status', 'AVAILABLE');
  if (error) throw error;
  return data ?? [];
}

/**
 * Pro イベント別トレード戦略分析(api-design v1.48): `beforeIso` より前の、同じ指標の RELEASED の発表(RELEASE スナップショット
 * つき)を新しい順に `limit` 回まで。並びは listReleasedEventsForIndicator と同じ(release_datetime desc, id asc)。
 */
export async function listReleasedEventsBefore(
  supabase: SupabaseClient,
  indicatorId: string,
  beforeIso: string,
  limit: number,
): Promise<(HistoricalEventRow & { release_datetime_precision: string })[]> {
  const { data, error } = await supabase
    .from('economic_events')
    .select(
      `id, release_datetime, release_datetime_precision, event_snapshots!inner(${SNAPSHOT_VALUE_COLUMNS}, snapshot_type)`,
    )
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .eq('event_snapshots.snapshot_type', 'RELEASE')
    .lt('release_datetime', beforeIso)
    .order('release_datetime', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    event_id: row.id,
    release_datetime: row.release_datetime,
    release_datetime_precision: row.release_datetime_precision,
    ...releaseSnapshotOf(row.event_snapshots),
  }));
}

/**
 * 戦略分析の通貨ペアの候補(HQ指示 2026-11-09 P0): 指標の関連の通貨ペア(indicator_fx_pairs が有効なもの)を、ペアの
 * 有効・無効と通貨つきで返す。使えるかどうか・並び順は domain/eventStrategyAnalysis.ts の selectDefaultStrategyPair。
 */
export async function listStrategyPairCandidates(
  supabase: SupabaseClient,
  indicatorId: string,
): Promise<StrategyPairCandidate[]> {
  const { data, error } = await supabase
    .from('indicator_fx_pairs')
    .select('priority, fx_pairs!inner(id, symbol, base_currency, quote_currency, is_active)')
    .eq('indicator_id', indicatorId)
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const pair = row.fx_pairs as unknown as {
      id: string;
      symbol: string;
      base_currency: string;
      quote_currency: string;
      is_active: boolean;
    };
    return {
      fx_pair_id: pair.id,
      symbol: pair.symbol,
      base_currency: pair.base_currency,
      quote_currency: pair.quote_currency,
      is_active: pair.is_active,
      priority: Number(row.priority),
    };
  });
}

/** 指定された通貨ペア(?fx_pair_id)。有効・無効と通貨つき。無ければ null。 */
export async function getStrategyPair(
  supabase: SupabaseClient,
  fxPairId: string,
): Promise<Omit<StrategyPairCandidate, 'priority'> | null> {
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('id, symbol, base_currency, quote_currency, is_active')
    .eq('id', fxPairId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    fx_pair_id: data.id,
    symbol: data.symbol,
    base_currency: data.base_currency,
    quote_currency: data.quote_currency,
    is_active: data.is_active,
  };
}

export interface StrategyReactionRow {
  event_id: string;
  timeframe: string;
  pips: number | null;
  max_upward: number | null;
  max_downward: number | null;
  data_status: string;
}

/** 戦略分析に使う値動き(1分・15分・60分)。data_status も返す(AVAILABLE でないものは分析で使わない)。 */
export async function listStrategyReactions(
  supabase: SupabaseClient,
  eventIds: string[],
  fxPairId: string,
  timeframes: readonly string[],
): Promise<StrategyReactionRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select('event_id, timeframe, pips, max_upward, max_downward, data_status')
    .in('event_id', eventIds)
    .eq('fx_pair_id', fxPairId)
    .in('timeframe', [...timeframes]);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    event_id: row.event_id,
    timeframe: row.timeframe,
    pips: row.pips === null ? null : Number(row.pips),
    max_upward: row.max_upward === null ? null : Number(row.max_upward),
    max_downward: row.max_downward === null ? null : Number(row.max_downward),
    data_status: row.data_status,
  }));
}

export interface MinuteCandleCompleteness {
  /** 発表から15分の窓に1分足が15本すべてあり、どれもUNVERIFIEDでない。 */
  complete15m: boolean;
  /** 発表から60分の窓に1分足が60本すべてあり、どれもUNVERIFIEDでない。 */
  complete60m: boolean;
}

/**
 * Pro イベント別トレード戦略分析の高値・安値ブレイク判定用(HQ指示 2026-11-07「1分足欠損への対応」)。
 * event_price_reactions.data_status = AVAILABLE は窓の境界(発表直前・N分後)の価格が取れたことしか保証せず、
 * 窓の途中の1分足の欠損までは検出できないため、fx_prices を直接数えて確かめる。1分・5分判定(既存)には使わない。
 * 戻り値は event_id をキーにした Map(各 release について必ず1件、取得できなければ complete* は false)。
 */
export async function listMinuteCandleCompleteness(
  supabase: SupabaseClient,
  releases: readonly { event_id: string; release_datetime: string }[],
  fxPairId: string,
): Promise<Map<string, MinuteCandleCompleteness>> {
  const result = new Map<string, MinuteCandleCompleteness>();
  await Promise.all(
    releases.map(async (release) => {
      const startMs = Date.parse(release.release_datetime);
      const endMs = startMs + 60 * 60_000;
      const { data, error } = await supabase
        .from('fx_prices')
        .select('timestamp, verification_status')
        .eq('fx_pair_id', fxPairId)
        .eq('timeframe', '1m')
        .gte('timestamp', new Date(startMs).toISOString())
        .lt('timestamp', new Date(endMs).toISOString());
      if (error) throw error;
      const rows = (data ?? []) as { timestamp: string; verification_status: string }[];
      const within = (minutes: number) => {
        const cutoffMs = startMs + minutes * 60_000;
        return rows.filter((row) => Date.parse(row.timestamp) < cutoffMs);
      };
      const allVerified = (candles: readonly { verification_status: string }[]) =>
        candles.every((candle) => candle.verification_status !== 'UNVERIFIED');
      const window15 = within(15);
      const window60 = within(60);
      result.set(release.event_id, {
        complete15m: window15.length === 15 && allVerified(window15),
        complete60m: window60.length === 60 && allVerified(window60),
      });
    }),
  );
  return result;
}
