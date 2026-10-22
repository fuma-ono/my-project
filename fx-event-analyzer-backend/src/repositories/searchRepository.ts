import type { SupabaseClient } from '@supabase/supabase-js';

function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, (char) => `\\${char}`);
}

export interface IndicatorSearchRow {
  id: string;
  code: string;
  name: string;
  display_name: string | null;
  country_code: string;
  currency_code: string;
}

export async function searchIndicators(
  supabase: SupabaseClient,
  q: string,
  limit: number,
): Promise<IndicatorSearchRow[]> {
  const escaped = escapeIlike(q);
  const { data, error } = await supabase
    .from('economic_indicators')
    .select('id, code, name, display_name, country_code, currency_code')
    .eq('is_active', true)
    .or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`)
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, display_name: row.display_name ?? null }));
}

export interface EventSearchRow {
  id: string;
  indicator_id: string;
  indicator_name: string;
  display_name: string | null;
  release_datetime: string;
  status: string;
}

/** 指標ごとの「次の予定」を探すときに読む、未来の行の上限(BLS・FOMC は1指標あたり十数件)。 */
const UPCOMING_SCAN_LIMIT = 500;

/** Event search is always Indicator-based (api-design.md §23.1, A-6):
 * find matching indicators, then return their events.
 *
 * 並び順(v1.31): 未来の予定が入ると、新しい順ではいちばん先の予定(翌年など)が先頭に並ぶため、
 * ① 各指標の次の予定(`release_datetime` が `now` 以降で最も早いもの、1指標1件)を近い順、
 * ② `now` より前の Event(発表済み・発表待ち・取りやめ)を新しい順、の順に返す。
 * 2件目以降の未来の予定は返さない。 */
export async function searchEventsByIndicator(
  supabase: SupabaseClient,
  q: string,
  limit: number,
  now: Date = new Date(),
): Promise<EventSearchRow[]> {
  const indicators = await searchIndicators(supabase, q, limit);
  if (indicators.length === 0) return [];

  const indicatorIds = indicators.map((indicator) => indicator.id);
  const nowIso = now.toISOString();
  const [upcoming, past] = await Promise.all([
    supabase
      .from('economic_events')
      .select('id, indicator_id, release_datetime, status')
      .in('indicator_id', indicatorIds)
      .eq('status', 'SCHEDULED')
      .gte('release_datetime', nowIso)
      .order('release_datetime', { ascending: true })
      .limit(UPCOMING_SCAN_LIMIT),
    supabase
      .from('economic_events')
      .select('id, indicator_id, release_datetime, status')
      .in('indicator_id', indicatorIds)
      .lt('release_datetime', nowIso)
      .order('release_datetime', { ascending: false })
      .limit(limit),
  ]);
  if (upcoming.error) throw upcoming.error;
  if (past.error) throw past.error;

  const nextByIndicator = new Map<string, (typeof upcoming.data)[number]>();
  for (const row of upcoming.data ?? []) {
    if (!nextByIndicator.has(row.indicator_id)) nextByIndicator.set(row.indicator_id, row);
  }
  const rows = [...nextByIndicator.values(), ...(past.data ?? [])].slice(0, limit);

  const indicatorById = new Map(indicators.map((indicator) => [indicator.id, indicator]));
  return rows.map((row) => ({
    id: row.id,
    indicator_id: row.indicator_id,
    indicator_name: indicatorById.get(row.indicator_id)?.name ?? '',
    display_name: indicatorById.get(row.indicator_id)?.display_name ?? null,
    release_datetime: row.release_datetime,
    status: row.status,
  }));
}

export interface FxPairSearchRow {
  id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
}

export async function searchFxPairs(supabase: SupabaseClient, q: string, limit: number): Promise<FxPairSearchRow[]> {
  const escaped = escapeIlike(q);
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('id, symbol, base_currency, quote_currency')
    .eq('is_active', true)
    .ilike('symbol', `%${escaped}%`)
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
