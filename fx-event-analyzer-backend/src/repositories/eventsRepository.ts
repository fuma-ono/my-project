import type { SupabaseClient } from '@supabase/supabase-js';

export interface EventRow {
  id: string;
  indicator_id: string;
  release_datetime: string;
  release_datetime_precision: string;
  importance: string;
  status: string;
  data_status: string;
  indicator_name: string;
  /** 一覧表示名(`economic_indicators.display_name`)。未登録はnull。 */
  indicator_display_name: string | null;
  country_code: string;
  currency_code: string;
  favorable_direction: string;
}

export async function getEventById(supabase: SupabaseClient, eventId: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('economic_events')
    .select(
      'id, indicator_id, release_datetime, release_datetime_precision, importance, status, data_status, economic_indicators!inner(name, display_name, country_code, currency_code, favorable_direction)',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const indicator = data.economic_indicators as unknown as {
    name: string;
    display_name?: string | null;
    country_code: string;
    currency_code: string;
    favorable_direction: string;
  };

  return {
    id: data.id,
    indicator_id: data.indicator_id,
    release_datetime: data.release_datetime,
    release_datetime_precision: data.release_datetime_precision,
    importance: data.importance,
    status: data.status,
    data_status: data.data_status,
    indicator_name: indicator.name,
    indicator_display_name: indicator.display_name ?? null,
    country_code: indicator.country_code,
    currency_code: indicator.currency_code,
    favorable_direction: indicator.favorable_direction,
  };
}

export interface SnapshotRow {
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  unit: string | null;
  source: string | null;
  source_url: string | null;
  captured_at: string;
  surprise: number | null;
  surprise_direction: string | null;
  /** HQ指示(2026-10-25)「結果/予想/前回も前年と前月が必要」: mapping.secondaryが設定された指標だけ埋まる(今は米国CPIのMOM_PCT)。 */
  secondary_value_kind: string | null;
  secondary_forecast: number | null;
  secondary_actual: number | null;
  secondary_previous: number | null;
}

export async function getReleaseSnapshot(supabase: SupabaseClient, eventId: string): Promise<SnapshotRow | null> {
  const { data, error } = await supabase
    .from('event_snapshots')
    .select(
      'forecast, actual, previous, unit, source, source_url, captured_at, surprise, surprise_direction, secondary_value_kind, secondary_forecast, secondary_actual, secondary_previous',
    )
    .eq('event_id', eventId)
    .eq('snapshot_type', 'RELEASE')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ExplanationRow {
  version: number;
  explanation_type: string;
  summary: string | null;
  source: string | null;
  source_url: string | null;
  published_at: string | null;
}

/** api-design.md §17: latest version = max(version) for the event. */
export async function getLatestExplanation(supabase: SupabaseClient, eventId: string): Promise<ExplanationRow | null> {
  const { data, error } = await supabase
    .from('event_explanations')
    .select('version, explanation_type, summary, source, source_url, published_at')
    .eq('event_id', eventId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function countRevisions(supabase: SupabaseClient, eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from('event_revisions')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  if (error) throw error;
  return count ?? 0;
}

export interface RevisionRow {
  field_name: string;
  old_value: number;
  new_value: number;
  effective_at: string;
  source: string | null;
  created_at: string;
}

export async function listRevisions(
  supabase: SupabaseClient,
  eventId: string,
  range: { from: number; to: number },
): Promise<{ rows: RevisionRow[]; total: number }> {
  const { data, error, count } = await supabase
    .from('event_revisions')
    .select('field_name, old_value, new_value, effective_at, source, created_at', { count: 'exact' })
    .eq('event_id', eventId)
    .order('effective_at', { ascending: false })
    .range(range.from, range.to);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}
