/**
 * US_RETAIL_SALES schedule → economic_events (HQ承認 2026-11-05「US_RETAIL_SALES 公式発表
 * 日程の自動取り込み実装」、案A: mappings/fomcSchedule.ts と同じ、人が確認した表方式)。表
 * (mappings/retailSalesSchedule.ts)の各行から、US_RETAIL_SALESのSCHEDULED行を1つ作る。
 * 値(小売売上高の結果)は入れない — 値の照合元(Census APIの利用条件・鍵)はまだ確認していない
 * (data-sources.md §13.1)。
 *
 * - provider 'census_retail_schedule'、provider_event_id `census_retail_schedule:<referencePeriod>`
 * - release_datetime = releaseDate 08:30 America/New_York を zonedWallTimeToUtc で UTC に変換(夏時間考慮)
 * - 冪等: 同じ表を何度流しても変わらない。表の日付が変わったら同じ行のrelease_datetimeを更新する
 *   (既存のDBトリガーがRESCHEDULEDを記録する、FOMC表と同じ仕組み)
 * - 発表時刻を過ぎた回は作らない。既にある過去の行は変えない。RELEASEDの行も変えない
 * - 表から消えた回(DBにあり、未来・SCHEDULED)はログに出すだけで、消さない
 * - 外部へのアクセスは無い(表を読むだけ)。ライブのHTML取得・解析は行わない
 */
import {
  RETAIL_SALES_ANNOUNCEMENT_TIME,
  RETAIL_SALES_SCHEDULE,
  RETAIL_SALES_TIME_ZONE,
  type RetailSalesScheduleEntry,
} from '../mappings/retailSalesSchedule.js';
import type { JobCounters } from '../runner.js';
import type { EventPatch, IngestionStore, ProviderEventRow } from '../store.js';
import { zonedWallTimeToUtc } from '../time.js';

export const RETAIL_SALES_SCHEDULE_PROVIDER = 'census_retail_schedule';
export const RETAIL_SALES_INDICATOR_CODE = 'US_RETAIL_SALES';

export function retailSalesProviderEventId(entry: RetailSalesScheduleEntry): string {
  return `${RETAIL_SALES_SCHEDULE_PROVIDER}:${entry.referencePeriod}`;
}

/** The announcement instant (UTC), or null when releaseDate is malformed / does not exist. */
export function retailSalesAnnouncementUtc(entry: RetailSalesScheduleEntry): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.releaseDate);
  if (!date) return null;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const [hour, minute] = RETAIL_SALES_ANNOUNCEMENT_TIME.split(':').map(Number) as [number, number];
  return zonedWallTimeToUtc(year, month, day, hour, minute, RETAIL_SALES_TIME_ZONE);
}

export interface RetailSalesScheduleResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Entries whose announcement is already past (nothing created or changed). */
  past: number;
  /** provider_event_ids in the DB (future, not cancelled) that the table no longer has — logged only. */
  removed: string[];
}

/**
 * Applies `entries` (default: RETAIL_SALES_SCHEDULE) to economic_events. Counts go to
 * `counters` (fetched = entries, success = rows inserted/updated/unchanged, details = the
 * RetailSalesScheduleResult numbers).
 */
export async function ingestRetailSalesSchedule(
  deps: {
    store: IngestionStore;
    entries?: readonly RetailSalesScheduleEntry[];
    now?: () => Date;
  },
  counters: JobCounters,
): Promise<RetailSalesScheduleResult> {
  const entries = deps.entries ?? RETAIL_SALES_SCHEDULE;
  const now = (deps.now?.() ?? new Date()).getTime();
  const result: RetailSalesScheduleResult = { inserted: 0, updated: 0, unchanged: 0, past: 0, removed: [] };
  const writeDetails = () => {
    counters.details.inserted = result.inserted;
    counters.details.updated = result.updated;
    counters.details.unchanged = result.unchanged;
    counters.details.past = result.past;
    counters.details.removed = result.removed;
  };
  counters.fetched += entries.length;

  const indicator = (await deps.store.findIndicatorsByCode([RETAIL_SALES_INDICATOR_CODE])).get(
    RETAIL_SALES_INDICATOR_CODE,
  );
  if (!indicator) {
    counters.error(`economic_indicators has no ${RETAIL_SALES_INDICATOR_CODE} row`);
    writeDetails();
    return result;
  }

  const existing = new Map<string, ProviderEventRow>();
  for (const row of await deps.store.listEventsByProvider(RETAIL_SALES_SCHEDULE_PROVIDER)) {
    existing.set(row.provider_event_id, row);
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const providerEventId = retailSalesProviderEventId(entry);
    if (seen.has(providerEventId)) {
      counters.error(`duplicate retail sales schedule entry ${providerEventId}`);
      continue;
    }
    seen.add(providerEventId);
    const releaseAt = retailSalesAnnouncementUtc(entry);
    if (!releaseAt) {
      counters.error(`invalid retail sales release date ${entry.releaseDate}`);
      continue;
    }
    const row = existing.get(providerEventId);

    if (releaseAt.getTime() <= now || (row && Date.parse(row.release_datetime) <= now)) {
      result.past += 1;
      counters.skip('past_release');
      continue;
    }
    if (row?.status === 'RELEASED') {
      counters.skip('already_released');
      continue;
    }

    try {
      if (!row) {
        await deps.store.insertEvent({
          indicator_id: indicator.id,
          provider: RETAIL_SALES_SCHEDULE_PROVIDER,
          provider_event_id: providerEventId,
          release_datetime: releaseAt.toISOString(),
          release_datetime_precision: 'EXACT',
          importance: indicator.importance,
          status: 'SCHEDULED',
          data_status: 'PENDING',
        });
        result.inserted += 1;
        counters.success += 1;
        continue;
      }

      const patch: EventPatch = {};
      if (Date.parse(row.release_datetime) !== releaseAt.getTime()) patch.release_datetime = releaseAt.toISOString();
      if (row.release_datetime_precision !== 'EXACT') patch.release_datetime_precision = 'EXACT';
      if (row.status === 'CANCELLED') patch.status = 'SCHEDULED';
      if (Object.keys(patch).length === 0) {
        result.unchanged += 1;
      } else {
        await deps.store.updateEvent(row.id, patch);
        result.updated += 1;
        if (patch.release_datetime) {
          counters.note('rescheduled', {
            provider_event_id: providerEventId,
            from: row.release_datetime,
            to: patch.release_datetime,
          });
        }
      }
      counters.success += 1;
    } catch (error) {
      counters.error(`${providerEventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const [providerEventId, row] of existing) {
    if (seen.has(providerEventId)) continue;
    if (row.status !== 'SCHEDULED' || Date.parse(row.release_datetime) <= now) continue;
    result.removed.push(providerEventId);
  }
  result.removed.sort();
  writeDetails();
  return result;
}
