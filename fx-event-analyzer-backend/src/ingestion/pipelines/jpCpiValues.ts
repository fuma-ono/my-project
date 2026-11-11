/**
 * JP_CPI(日本の消費者物価指数、全国・総合・前年同月比)の初回の公表値 → RELEASE スナップショット(HQ指示 2026-11-11
 * 「JP_CPI: ESTAT_APP_ID を利用する取得処理」)。値は e-Stat の API(adapters/estatCpi.ts、2025年基準 0004052037)。
 *
 * 初回の値として保存するのは、次をすべて満たすときだけ(1つでも欠ければ何も書かない。イベントは SCHEDULED・PENDING のまま。
 * 推測・前回値の流用はしない — pipelines/officialValues.ts と同じ決まり):
 *   1. 公表予定の表(mappings/jpCpiSchedule.ts)の回で、公表の時刻を過ぎ、公表から maxDaysAfterRelease 日以内
 *   2. 対象月の全国・総合・前年同月比の値が、e-Stat の API にちょうど1件、数値である(公表前は値が無い — 2026-11-11 に
 *      2026年10月分で確認)
 *   3. 統計表の更新日(TABLE_INF.UPDATED_DATE)が、その回の公表日以降(前の回の値を新しい回の値としない)
 *   4. 分類(表章項目・地域・品目)をメタ情報の code と名前で特定できた
 * e-Stat の値には公表日が付いていないため、2 と 3 で公表を確かめる。e-Stat のデータベースへの反映は公表から数日遅れることが
 * ある(2025年基準の表は、全国の9月分の公表 10/23 の後、10/30 に公開)ので、maxDaysAfterRelease は14日。
 * 改定: RELEASED の回は、同じ対象月の今の値が初回値(と最後の改定)と違うときだけ event_revisions に足す(初回値は変えない)。
 * appId は URL にしか入れず、エラー・出力の文では redactAppId で伏せる。
 */
import { calculateSurprise } from '../../domain/surprise.js';
import {
  ESTAT_CPI_2025_STATS_DATA_ID,
  ESTAT_CPI_DBVIEW_URL,
  metaInfoUrl,
  parseJpCpiYoY,
  redactAppId,
  resolveJpCpiDimensions,
  statsDataUrl,
  tableUpdatedDate,
} from '../adapters/estatCpi.js';
import { JP_CPI_SCHEDULE, type JpCpiScheduleEntry } from '../mappings/jpCpiSchedule.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import {
  jpCpiAnnouncementUtc,
  jpCpiProviderEventId,
  JP_CPI_INDICATOR_CODE,
  JP_CPI_SCHEDULE_PROVIDER,
} from './jpCpiSchedule.js';

export const JP_CPI_SOURCE_NAME = '総務省統計局（e-Stat）';
export const JP_CPI_UNIT = '%';
export const JP_CPI_MAX_DAYS_AFTER_RELEASE = 14;

export interface JpCpiFetcher {
  getJson(url: string): Promise<unknown>;
}

export type JpCpiAction = 'PUBLISH' | 'REVISE' | 'UNCHANGED' | 'NOT_YET_AVAILABLE' | 'TOO_LATE_FOR_FIRST_RELEASE';

export interface JpCpiPlanItem {
  event_id: string;
  reference_period: string;
  release_date: string;
  action: JpCpiAction;
  value: number | null;
  table_updated: string | null;
}

export interface JpCpiValuesResult {
  published: number;
  revisions: number;
  pending: number;
  plan: JpCpiPlanItem[];
}

export async function ingestJpCpiValues(
  deps: {
    store: IngestionStore;
    fetcher: JpCpiFetcher;
    appId: string;
    schedule?: readonly JpCpiScheduleEntry[];
    now?: () => Date;
    lookbackDays?: number;
    /** true = 書かない(何をするはずかだけ返す) */
    dryRun?: boolean;
  },
  counters: JobCounters,
): Promise<JpCpiValuesResult> {
  const now = deps.now?.() ?? new Date();
  const lookbackMs = (deps.lookbackDays ?? 45) * 86_400_000;
  const result: JpCpiValuesResult = { published: 0, revisions: 0, pending: 0, plan: [] };
  const schedule = deps.schedule ?? JP_CPI_SCHEDULE;

  const indicator = (await deps.store.findIndicatorsByCode([JP_CPI_INDICATOR_CODE])).get(JP_CPI_INDICATOR_CODE);
  if (!indicator) {
    counters.error(`${JP_CPI_INDICATOR_CODE}: no indicator row`);
    return result;
  }
  const entryById = new Map(schedule.map((e) => [jpCpiProviderEventId(e), e]));
  const events = (await deps.store.listEventsByProvider(JP_CPI_SCHEDULE_PROVIDER)).filter((event) => {
    const entry = entryById.get(event.provider_event_id);
    const at = entry ? jpCpiAnnouncementUtc(entry)?.getTime() : undefined;
    return at !== undefined && at <= now.getTime() && at >= now.getTime() - lookbackMs;
  });
  counters.fetched += events.length;
  if (events.length === 0) return result;

  let dims;
  let body: unknown;
  const periods = [...new Set(events.map((e) => entryById.get(e.provider_event_id)!.referencePeriod))];
  try {
    dims = resolveJpCpiDimensions(await deps.fetcher.getJson(metaInfoUrl(deps.appId)));
    if (!dims) {
      counters.error('e-Stat: the classes (前年同月比 / 全国 / 総合) were not found in the metadata');
      return result;
    }
    const url = statsDataUrl(deps.appId, dims, periods);
    if (!url) throw new Error('bad reference period');
    body = await deps.fetcher.getJson(url);
  } catch (error) {
    counters.skip('FETCH_FAILED'); // 何も書かない(PENDING のまま。次の実行で取り直す)
    counters.note('fetch_failed', { error: redactAppId(error instanceof Error ? error.message : String(error)) });
    result.pending += events.filter((e) => e.status !== 'RELEASED').length;
    return result;
  }
  const updated = tableUpdatedDate(body);

  for (const event of events) {
    const entry = entryById.get(event.provider_event_id)!;
    const value = parseJpCpiYoY(body, dims, entry.referencePeriod);
    const plan = (action: JpCpiAction) =>
      result.plan.push({
        event_id: event.id,
        reference_period: entry.referencePeriod,
        release_date: entry.releaseDate,
        action,
        value,
        table_updated: updated,
      });
    const snapshot = await deps.store.getReleaseSnapshot(event.id);

    if (event.status === 'RELEASED' || snapshot) {
      if (!snapshot || snapshot.actual === null || value === null) continue;
      const latest = (await deps.store.latestRevisionValues(event.id)).ACTUAL ?? Number(snapshot.actual);
      if (value === latest) {
        counters.skip('UNCHANGED');
        plan('UNCHANGED');
        continue;
      }
      plan('REVISE');
      if (deps.dryRun) continue;
      await deps.store.insertRevision({
        event_id: event.id,
        field_name: 'ACTUAL',
        old_value: latest,
        new_value: value,
        effective_at: now.toISOString(),
        source: JP_CPI_SOURCE_NAME,
      });
      result.revisions += 1;
      counters.note('revised', { event_id: event.id, period: entry.referencePeriod, from: latest, to: value });
      continue;
    }

    const releasedAt = jpCpiAnnouncementUtc(entry)!.getTime();
    if (now.getTime() - releasedAt > JP_CPI_MAX_DAYS_AFTER_RELEASE * 86_400_000) {
      counters.skip('TOO_LATE_FOR_FIRST_RELEASE'); // 改定後の値を初回値としない
      plan('TOO_LATE_FOR_FIRST_RELEASE');
      result.pending += 1;
      continue;
    }
    if (value === null || updated === null || updated < entry.releaseDate) {
      counters.skip('NOT_YET_AVAILABLE'); // e-Stat にまだ反映されていない
      plan('NOT_YET_AVAILABLE');
      result.pending += 1;
      continue;
    }
    plan('PUBLISH');
    if (deps.dryRun) continue;
    const surprise = calculateSurprise(null, value, indicator.favorable_direction);
    await deps.store.insertReleaseSnapshot({
      event_id: event.id,
      forecast: null,
      actual: value,
      previous: null,
      unit: JP_CPI_UNIT,
      source: JP_CPI_SOURCE_NAME,
      source_url: ESTAT_CPI_DBVIEW_URL,
      captured_at: now.toISOString(),
      surprise: surprise.surprise,
      surprise_direction: surprise.direction,
      verification_status: 'VERIFIED',
      verification_source: `estat:${ESTAT_CPI_2025_STATS_DATA_ID}:${dims.item.code}@${entry.referencePeriod}`,
      official_actual: value,
      secondary_value_kind: null,
      secondary_actual: null,
      secondary_forecast: null,
      secondary_previous: null,
    });
    await deps.store.updateEvent(event.id, { status: 'RELEASED', data_status: 'AVAILABLE' });
    result.published += 1;
    counters.success += 1;
    counters.note('published', { event_id: event.id, period: entry.referencePeriod, value });
  }
  counters.details.published = result.published;
  counters.details.revisions = result.revisions;
  counters.details.pending = result.pending;
  return result;
}
