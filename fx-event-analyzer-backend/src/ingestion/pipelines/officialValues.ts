/**
 * 公式機関の発表値 → RELEASE スナップショット(HQ決定 2026-11-10「公式経済指標の実績値取得・保存処理」)。
 *
 * 公式機関が発表した**初回公表値**を保存する。次の条件をすべて満たすときだけ RELEASED にする(1つでも欠ければ何も書かず、
 * イベントは SCHEDULED・PENDING(API では DATA_PENDING)のまま。推測・前回値の流用はしない):
 *   1. 公式機関のデータ(下の OFFICIAL_VALUE_SOURCES の系列だけ。利用条件は migration 20261110000002 の説明で確認済み)
 *   2. 発表日が一致する(API が示す公表日 = その回の公表日。adapters/gbCaOfficialValues.ts の parse*ForRelease。ABS は
 *      updatedAfter で公表日に更新された観測だけを見る — adapters/absOfficialValues.ts)
 *   3. 対象期間が一致する(API の値の対象月 = 公表予定の表の referencePeriod。表に referencePeriod が無い回は保存しない)
 *   4. 数値・単位が明確(数として読める値、単位はこの表で決めた '%')
 *   5. 出典(source・source_url)がある
 *
 * 保存のしかた:
 * - 初回値は、今ある publish の形と同じく、event_snapshots(RELEASE。DB のトリガーで更新・削除できない)と
 *   economic_events(RELEASED・AVAILABLE)。forecast・previous・surprise は入れない(予想・前回値はこの取得元に無い。前回値を
 *   流用しない)。verification_status = VERIFIED(公式機関の値そのもの)、verification_source = '<系列>@<対象月>'。
 * - 改定: RELEASED の回は、API の同じ対象月の今の値が、初回値(と最後の改定)と違うときだけ event_revisions に ACTUAL の
 *   改定として足す(初回値は変えない。同じ改定を二度足さない)。
 * - 取得に失敗したら、その系列は何も書かない(DATA_PENDING のまま。次の実行で取り直す)。
 */
import { calculateSurprise } from '../../domain/surprise.js';
import {
  ABS_SDMX_ACCEPT,
  ABS_SERIES,
  absReleaseUrl,
  absSeriesUrl,
  absValueForPeriod,
  parseAbsValueForRelease,
} from '../adapters/absOfficialValues.js';
import {
  ONS_SERIES,
  onsSeriesUrl,
  onsValueForPeriod,
  parseOnsValueForRelease,
  parseStatcanValueForRelease,
  STATCAN_SERIES,
  STATCAN_WDS_URL,
  statcanValueForPeriod,
  type OfficialValue,
} from '../adapters/gbCaOfficialValues.js';
import type { OfficialScheduleEntry, OfficialScheduleTable } from '../mappings/gbAuCaSchedule.js';
import { HttpError } from '../http.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import { officialScheduleProviderEventId } from './officialScheduleTable.js';

export interface OfficialValueSource {
  indicatorCode: string;
  /** 公表予定の表の provider(この指標のイベントを探す)。 */
  scheduleProvider: string;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  /** 取得の URL と本文(GET なら body なし)。改定の確認と、releaseRequest が無い取得元の発表値の読み取りに使う。 */
  request: { url: string; body?: unknown; headers?: Record<string, string> };
  /**
   * 公表日の照合に回ごとの問い合わせが要る取得元(ABS: updatedAfter)。返った本文を parseForRelease に渡す。
   * HTTP 404 は「まだ更新されていない」(何も書かない)。null = URL を作れない(保存しない)。
   */
  releaseRequest?: (entry: OfficialScheduleEntry) => { url: string; headers?: Record<string, string> } | null;
  /** 初回値として保存してよいのは、公表からこの日数の間だけ(次の回の公表の後に、改定された値を初回値としない)。 */
  maxDaysAfterRelease?: number;
  /** fullBody = request の応答(releaseRequest のある取得元で、単位・桁を読む)。 */
  parseForRelease(body: unknown, releaseDate: string, fullBody?: unknown): OfficialValue | null;
  valueForPeriod(body: unknown, period: string): number | null;
}

const ons = (indicatorCode: string): OfficialValueSource => {
  const series = ONS_SERIES.find((s) => s.indicatorCode === indicatorCode)!;
  return {
    indicatorCode,
    scheduleProvider: 'ons_release_calendar',
    unit: '%',
    sourceName: 'Office for National Statistics',
    sourceUrl: onsSeriesUrl(series),
    request: { url: onsSeriesUrl(series) },
    parseForRelease: (body, releaseDate) => parseOnsValueForRelease(series, body, releaseDate),
    valueForPeriod: (body, period) => onsValueForPeriod(series, body, period),
  };
};

const statcan = (indicatorCode: string): OfficialValueSource => {
  const series = STATCAN_SERIES.find((s) => s.indicatorCode === indicatorCode)!;
  return {
    indicatorCode,
    scheduleProvider: 'statcan_release_schedule',
    unit: '%',
    sourceName: 'Statistics Canada',
    sourceUrl: STATCAN_WDS_URL,
    request: { url: STATCAN_WDS_URL, body: [{ vectorId: series.vectorId, latestN: 13 }] },
    parseForRelease: (body, releaseDate) => parseStatcanValueForRelease(series, body, releaseDate),
    valueForPeriod: (body, period) => statcanValueForPeriod(series, body, period),
  };
};

const abs = (indicatorCode: string): OfficialValueSource => {
  const series = ABS_SERIES.find((s) => s.indicatorCode === indicatorCode)!;
  const headers = { accept: ABS_SDMX_ACCEPT };
  return {
    indicatorCode,
    scheduleProvider: 'abs_release_calendar',
    unit: '%',
    sourceName: 'Australian Bureau of Statistics',
    sourceUrl: absSeriesUrl(series),
    request: { url: absSeriesUrl(series), headers },
    releaseRequest: (entry) => {
      const url = absReleaseUrl(series, entry.releaseDate);
      return url ? { url, headers } : null;
    },
    maxDaysAfterRelease: 7, // ABS の同じ指標の公表の間隔は3週間以上
    parseForRelease: (body, releaseDate, fullBody) => parseAbsValueForRelease(series, body, releaseDate, fullBody),
    valueForPeriod: (body, period) => absValueForPeriod(series, body, period),
  };
};

/**
 * 実績値を取る指標(HQ決定の優先順)。GB_UNEMPLOYMENT_RATE は系列(MGSX)は読めるが、公表予定の表に公式の対象期間が無いので
 * 保存しない(下の referencePeriod の確認で止まる)。CA_CPI は公式の前年比の系列が無い(指数から計算しない)ため入れない。
 */
export const OFFICIAL_VALUE_SOURCES: readonly OfficialValueSource[] = [
  ons('GB_CPI'),
  ons('GB_CORE_CPI'),
  ons('GB_UNEMPLOYMENT_RATE'),
  statcan('CA_UNEMPLOYMENT_RATE'),
  abs('AU_CPI'),
  abs('AU_UNEMPLOYMENT_RATE'),
];

export interface OfficialValueFetcher {
  getJson(url: string, init?: RequestInit): Promise<unknown>;
}

export interface OfficialValuesResult {
  published: number;
  revisions: number;
  pending: number;
}

export async function ingestOfficialValues(
  deps: {
    store: IngestionStore;
    fetcher: OfficialValueFetcher;
    sources?: readonly OfficialValueSource[];
    tables: readonly OfficialScheduleTable[];
    now?: () => Date;
    /** 発表からこの日数までの回を見る(改定の確認も含む)。 */
    lookbackDays?: number;
  },
  counters: JobCounters,
): Promise<OfficialValuesResult> {
  const now = deps.now?.() ?? new Date();
  const lookbackMs = (deps.lookbackDays ?? 45) * 86_400_000;
  const result: OfficialValuesResult = { published: 0, revisions: 0, pending: 0 };
  const sources = deps.sources ?? OFFICIAL_VALUE_SOURCES;

  const indicators = await deps.store.findIndicatorsByCode(sources.map((s) => s.indicatorCode));
  for (const source of sources) {
    const table = deps.tables.find((t) => t.provider === source.scheduleProvider);
    const indicator = indicators.get(source.indicatorCode);
    if (!table || !indicator) {
      counters.error(`${source.indicatorCode}: no schedule table or indicator row`);
      continue;
    }
    if (!source.unit || !source.sourceName || !source.sourceUrl) {
      counters.skip('NO_UNIT_OR_SOURCE'); // 単位・出典の無いデータは RELEASED にしない
      continue;
    }
    const entryById = new Map<string, OfficialScheduleEntry>(
      table.entries
        .filter((e) => e.indicatorCode === source.indicatorCode)
        .map((e) => [officialScheduleProviderEventId(table.provider, e), e]),
    );
    const events = (await deps.store.listEventsByProvider(table.provider)).filter((event) => {
      if (!entryById.has(event.provider_event_id)) return false;
      const at = Date.parse(event.release_datetime);
      return at <= now.getTime() && at >= now.getTime() - lookbackMs;
    });
    if (events.length === 0) continue;

    let body: unknown;
    try {
      body = await deps.fetcher.getJson(
        source.request.url,
        source.request.body === undefined
          ? source.request.headers
            ? { headers: source.request.headers }
            : {}
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...source.request.headers },
              body: JSON.stringify(source.request.body),
            },
      );
    } catch (error) {
      counters.skip('FETCH_FAILED'); // 何も書かない(DATA_PENDING のまま)
      counters.note('fetch_failed', {
        indicator: source.indicatorCode,
        error: error instanceof Error ? error.message : String(error),
      });
      result.pending += events.filter((e) => e.status !== 'RELEASED').length;
      continue;
    }

    for (const event of events) {
      const entry = entryById.get(event.provider_event_id)!;
      if (!entry.referencePeriod) {
        counters.skip('NO_REFERENCE_PERIOD'); // 対象期間を照合できない回は保存しない
        if (event.status !== 'RELEASED') result.pending += 1;
        continue;
      }
      const snapshot = await deps.store.getReleaseSnapshot(event.id);
      if (event.status === 'RELEASED' || snapshot) {
        // 改定の確認だけ(初回値は変えない)
        if (!snapshot || snapshot.actual === null) continue;
        const current = source.valueForPeriod(body, entry.referencePeriod);
        if (current === null) continue;
        const latest = (await deps.store.latestRevisionValues(event.id)).ACTUAL ?? Number(snapshot.actual);
        if (current === latest) {
          counters.skip('UNCHANGED');
          continue;
        }
        await deps.store.insertRevision({
          event_id: event.id,
          field_name: 'ACTUAL',
          old_value: latest,
          new_value: current,
          effective_at: now.toISOString(),
          source: source.sourceName,
        });
        result.revisions += 1;
        counters.note('revised', { event_id: event.id, period: entry.referencePeriod, from: latest, to: current });
        continue;
      }

      if (
        source.maxDaysAfterRelease !== undefined &&
        now.getTime() - Date.parse(event.release_datetime) > source.maxDaysAfterRelease * 86_400_000
      ) {
        counters.skip('TOO_LATE_FOR_FIRST_RELEASE'); // 改定後の値を初回値として保存しない
        result.pending += 1;
        continue;
      }
      let releaseBody: unknown = body;
      if (source.releaseRequest) {
        const req = source.releaseRequest(entry);
        if (!req) {
          counters.skip('NOT_RELEASED_OR_DATE_MISMATCH');
          result.pending += 1;
          continue;
        }
        try {
          releaseBody = await deps.fetcher.getJson(req.url, req.headers ? { headers: req.headers } : {});
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            counters.skip('NOT_RELEASED_OR_DATE_MISMATCH'); // 公表日より後の更新が無い
          } else {
            counters.skip('FETCH_FAILED');
            counters.note('fetch_failed', {
              indicator: source.indicatorCode,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          result.pending += 1;
          continue;
        }
      }
      const value = source.parseForRelease(releaseBody, entry.releaseDate, body);
      if (!value) {
        counters.skip('NOT_RELEASED_OR_DATE_MISMATCH'); // 公表日が一致しない(前の回の値を使わない)
        result.pending += 1;
        continue;
      }
      if (value.period !== entry.referencePeriod) {
        counters.skip('PERIOD_MISMATCH');
        counters.note('period_mismatch', { event_id: event.id, expected: entry.referencePeriod, got: value.period });
        result.pending += 1;
        continue;
      }
      const surprise = calculateSurprise(null, value.value, indicator.favorable_direction);
      try {
        await deps.store.insertReleaseSnapshot({
          event_id: event.id,
          forecast: null,
          actual: value.value,
          previous: null,
          unit: source.unit,
          source: source.sourceName,
          source_url: value.sourceUrl,
          captured_at: now.toISOString(),
          surprise: surprise.surprise,
          surprise_direction: surprise.direction,
          verification_status: 'VERIFIED',
          verification_source: `${value.seriesId}@${value.period}`,
          official_actual: value.value,
          secondary_value_kind: null,
          secondary_actual: null,
          secondary_forecast: null,
          secondary_previous: null,
        });
        await deps.store.updateEvent(event.id, { status: 'RELEASED', data_status: 'AVAILABLE' });
        result.published += 1;
        counters.success += 1;
        counters.note('published', {
          event_id: event.id,
          indicator: source.indicatorCode,
          period: value.period,
          value: value.value,
        });
      } catch (error) {
        counters.error(`${event.provider_event_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  counters.details.published = result.published;
  counters.details.revisions = result.revisions;
  counters.details.pending = result.pending;
  return result;
}
