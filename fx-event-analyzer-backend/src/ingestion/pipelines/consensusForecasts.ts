/**
 * 予測値の取得 → indicator_forecasts(HQ指示 2026-11-10「経済指標の市場予測値（コンセンサス）取得」)。
 *
 * 取得元ごとの adapter が返した予想を、次の条件をすべて満たすときだけ1行足す(満たさなければ何も書かない):
 *   1. adapter が CONSENSUS_SOURCES に載っている(条件を確認した取得元だけ)
 *   2. 数値が有限・単位・出典(source・https の source_url)がある
 *   3. 同じ指標・同じ発表時刻のイベントがある(発表時刻が違う回の予想を入れない)
 *   4. 対象期間が一致する(イベントの provider_event_id の末尾の 'YYYY-MM' と同じ。照合できない回は入れない)
 *   5. まだ発表の前(発表の後に取った値は予想ではない)
 *   6. 同じ取得元・種類の直前の値と違う(同じ値を何度も足さない。違えば新しい行を足し、前の行は残す)
 * 取得に失敗した取得元は何も書かない(予想は DATA_PREPARING のまま)。
 *
 * 2026-11-10 時点で条件を満たす取得元は無いので、adapter は1つも無い(この処理は空で終わる)。
 */
import { CONSENSUS_SOURCES, type ForecastKind, type ForecastRow } from '../../domain/consensusForecasts.js';
import type { JobCounters } from '../runner.js';

export interface RawForecast {
  indicatorCode: string;
  referencePeriod: string;
  releaseDatetime: string;
  value: number;
  unit: string;
}

export interface ConsensusAdapter {
  source: string;
  sourceUrl: string;
  kind: ForecastKind;
  fetch(): Promise<RawForecast[]>;
}

export interface ForecastEvent {
  id: string;
  indicator_code: string;
  release_datetime: string;
  provider_event_id: string | null;
}

export interface ForecastStore {
  listEventsForForecast(indicatorCodes: readonly string[], fromIso: string, toIso: string): Promise<ForecastEvent[]>;
  latestForecast(eventId: string, source: string, kind: ForecastKind): Promise<ForecastRow | null>;
  insertForecast(row: ForecastRow): Promise<void>;
}

/** provider_event_id の末尾の対象月('…:2026-10')。無ければ null(対象期間を推測しない)。 */
export function eventReferencePeriod(providerEventId: string | null): string | null {
  const match = /:(\d{4}-\d{2})$/.exec(providerEventId ?? '');
  return match ? match[1]! : null;
}

export async function ingestConsensusForecasts(
  deps: {
    store: ForecastStore;
    adapters: readonly ConsensusAdapter[];
    sources?: typeof CONSENSUS_SOURCES;
    now?: () => Date;
    /** この日数先までの回を見る。 */
    horizonDays?: number;
  },
  counters: JobCounters,
): Promise<{ inserted: number }> {
  const now = deps.now?.() ?? new Date();
  const sources = deps.sources ?? CONSENSUS_SOURCES;
  let inserted = 0;

  for (const adapter of deps.adapters) {
    const registered = sources.find((s) => s.source === adapter.source && s.kind === adapter.kind);
    if (!registered) {
      counters.skip('SOURCE_NOT_APPROVED');
      continue;
    }
    if (!/^https:\/\//.test(adapter.sourceUrl)) {
      counters.skip('NO_SOURCE_URL');
      continue;
    }
    let raws: RawForecast[];
    try {
      raws = await adapter.fetch();
    } catch (error) {
      counters.skip('FETCH_FAILED');
      counters.note('fetch_failed', {
        source: adapter.source,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const codes = registered.indicatorCodes;
    const horizon = new Date(now.getTime() + (deps.horizonDays ?? 45) * 86_400_000);
    const events = await deps.store.listEventsForForecast(codes, now.toISOString(), horizon.toISOString());

    for (const raw of raws) {
      if (!codes.includes(raw.indicatorCode)) {
        counters.skip('INDICATOR_NOT_COVERED');
        continue;
      }
      if (!Number.isFinite(raw.value) || !raw.unit?.trim()) {
        counters.skip('NO_VALUE_OR_UNIT');
        continue;
      }
      const releaseAt = Date.parse(raw.releaseDatetime);
      if (!Number.isFinite(releaseAt)) {
        counters.skip('NO_RELEASE_TIME');
        continue;
      }
      if (releaseAt <= now.getTime()) {
        counters.skip('AFTER_RELEASE');
        continue;
      }
      const event = events.find(
        (e) => e.indicator_code === raw.indicatorCode && Date.parse(e.release_datetime) === releaseAt,
      );
      if (!event) {
        counters.skip('EVENT_MISMATCH');
        continue;
      }
      const period = eventReferencePeriod(event.provider_event_id);
      if (period === null) {
        counters.skip('PERIOD_UNVERIFIED');
        continue;
      }
      if (period !== raw.referencePeriod) {
        counters.skip('PERIOD_MISMATCH');
        continue;
      }
      const latest = await deps.store.latestForecast(event.id, adapter.source, adapter.kind);
      if (latest && latest.forecast_value === raw.value && latest.unit === raw.unit) {
        counters.skip('UNCHANGED');
        continue;
      }
      await deps.store.insertForecast({
        event_id: event.id,
        indicator_code: raw.indicatorCode,
        reference_period: period,
        release_datetime: event.release_datetime,
        forecast_kind: adapter.kind,
        forecast_value: raw.value,
        unit: raw.unit,
        source: adapter.source,
        source_url: adapter.sourceUrl,
        fetched_at: now.toISOString(),
      });
      inserted += 1;
      counters.success += 1;
    }
  }
  counters.details.inserted = inserted;
  return { inserted };
}
