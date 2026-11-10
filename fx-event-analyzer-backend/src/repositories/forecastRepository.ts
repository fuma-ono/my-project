import type { SupabaseClient } from '@supabase/supabase-js';
import type { ForecastKind, ForecastRow } from '../domain/consensusForecasts.js';
import type { ForecastEvent, ForecastStore } from '../ingestion/pipelines/consensusForecasts.js';

/**
 * indicator_forecasts(migration 20261110000003)の読み書き。service_role だけ(anon・authenticated は権限なし)。
 * 行は足すだけ(更新は DB のトリガーで拒否される)。
 */
const COLUMNS =
  'event_id, indicator_code, reference_period, release_datetime, forecast_kind, forecast_value, unit, source, source_url, fetched_at';

const toRow = (row: Record<string, unknown>): ForecastRow => ({
  event_id: String(row.event_id),
  indicator_code: String(row.indicator_code),
  reference_period: String(row.reference_period),
  release_datetime: new Date(String(row.release_datetime)).toISOString(),
  forecast_kind: row.forecast_kind as ForecastKind,
  forecast_value: Number(row.forecast_value),
  unit: String(row.unit),
  source: String(row.source),
  source_url: String(row.source_url),
  fetched_at: new Date(String(row.fetched_at)).toISOString(),
});

export interface ForecastRepository extends ForecastStore {
  listForecasts(eventId: string): Promise<ForecastRow[]>;
  listFinalForecasts(eventId: string): Promise<ForecastRow[]>;
}

export function createForecastRepository(client: SupabaseClient): ForecastRepository {
  return {
    async listEventsForForecast(indicatorCodes, fromIso, toIso): Promise<ForecastEvent[]> {
      if (indicatorCodes.length === 0) return [];
      const { data, error } = await client
        .from('economic_events')
        .select('id, release_datetime, provider_event_id, economic_indicators!inner(code)')
        .in('economic_indicators.code', [...indicatorCodes])
        .gt('release_datetime', fromIso)
        .lte('release_datetime', toIso);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        indicator_code: (row.economic_indicators as { code: string }).code,
        release_datetime: new Date(String(row.release_datetime)).toISOString(),
        provider_event_id: (row.provider_event_id as string | null) ?? null,
      }));
    },

    async latestForecast(eventId, source, kind) {
      const { data, error } = await client
        .from('indicator_forecasts')
        .select(COLUMNS)
        .eq('event_id', eventId)
        .eq('source', source)
        .eq('forecast_kind', kind)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? toRow(data) : null;
    },

    async insertForecast(row) {
      const { error } = await client.from('indicator_forecasts').insert(row);
      if (error) throw error;
    },

    async listForecasts(eventId) {
      const { data, error } = await client
        .from('indicator_forecasts')
        .select(COLUMNS)
        .eq('event_id', eventId)
        .order('fetched_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toRow);
    },

    async listFinalForecasts(eventId) {
      const { data, error } = await client.from('indicator_forecast_finals').select(COLUMNS).eq('event_id', eventId);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toRow);
    },
  };
}
