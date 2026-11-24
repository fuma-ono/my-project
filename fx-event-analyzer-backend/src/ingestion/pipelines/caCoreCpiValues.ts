/**
 * カナダのコアCPI(CA_CPI_TRIM・CA_CPI_MEDIAN)の初回値の取り込み — 設計書 ca-cpi-detailed-design.md §16.15.1「第1段階」。
 * (HQ承認: CA_CPI のコア2指標の実装開始。範囲はブランチ上の実装・テスト。)
 *
 * 第1段階の範囲:
 * - 公表日(最初は 2026-12-14 08:30 ET)に、StatCan WDS の前年同月比(%)の系列(公表値そのまま。自前計算なし)から、初回値だけを
 *   event_snapshots(RELEASE)と economic_events(RELEASED・AVAILABLE)に保存する。経路 A(adapters/caCoreCpi.ts の evaluateFirstValue)。
 * - 受付期間は firstValueWindow = 公表日から Toronto の暦日で7日(§15.2・§16.7)。超えたら TOO_LATE_FOR_FIRST_RELEASE で書かず
 *   PENDING のまま(自動では救済しない)。5〜7日目は deadline_warnings(終了コードは変えない)。
 * - 系列単位の部分失敗(§16.3): 通信・status・vectorId の不一致・対象月の不一致・値の不正は、その系列(その回)だけ止める。応答全体が
 *   解析不能・系列を識別できないときは、コア2系列すべてを止める(何も書かない)。
 * - **改定の検知・書き込みはしない**(revisionMode = DISABLED。event_revisions には書かない。N の判定・REVISION_BURST_STOP もしない。
 *   固定記録・追記専用ログ・承認の仕組みは第2段階。このファイルは読み込まない)。参考情報として、保存済みの初回値と今の WDS の値が
 *   違う月を revision_observations に出す(書かない・数えない・停止の根拠にしない)。
 * - 取得に失敗・未反映のときは、推測値・前回値・WDS の現在値で補完しない(何も書かず PENDING のまま。期限内なら再実行してよい)。
 *
 * ヘッドライン CA_CPI(指数からの計算。§4.1)は、このファイルの対象外(今回は実装しない。既存の挙動を変えない)。
 */
import { calculateSurprise } from '../../domain/surprise.js';
import {
  CA_CORE_LATEST_N,
  CA_CORE_SERIES,
  CA_CORE_TABLE_URL,
  CA_CORE_WDS_URL,
  classifyCoreResponse,
  evaluateFirstValue,
  type CaCoreSeries,
  type CorePoint,
} from '../adapters/caCoreCpi.js';
import {
  addCalendarDays,
  CA_FIRST_VALUE_WINDOW,
  isFirstValueWindowExpired,
  localCalendarDay,
  localDaysAfter,
  validateFirstValueWindows,
  type FirstValueWindow,
} from '../firstValueWindow.js';
import { HttpError } from '../http.js';
import type { OfficialScheduleEntry, OfficialScheduleTable } from '../mappings/gbAuCaSchedule.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import { observeStoredValue, type RevisionObservation, type SameDayDiff } from './caCoreRevisionObservation.js';
import { officialScheduleProviderEventId } from './officialScheduleTable.js';
import { needsReleasedStateRepair } from './releaseRecovery.js';
import type { OfficialValueFetcher, OfficialValuesPlanItem } from './officialValues.js';

/** 第1段階で使える改定のモード。他の値にすると、固定記録の保存先が使えない限り起動時に止まる(第2段階の有効化の条件) */
export type CaCoreRevisionMode = 'DISABLED';

export interface CaCoreSource {
  indicatorCode: CaCoreSeries['indicatorCode'];
  series: CaCoreSeries;
  scheduleProvider: string;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  firstValueWindow?: FirstValueWindow | undefined;
  revisionMode: CaCoreRevisionMode;
}

export const CA_CORE_SOURCES: readonly CaCoreSource[] = CA_CORE_SERIES.map((series) => ({
  indicatorCode: series.indicatorCode,
  series,
  scheduleProvider: 'statcan_release_schedule',
  unit: '%',
  sourceName: 'Statistics Canada',
  sourceUrl: CA_CORE_TABLE_URL,
  firstValueWindow: CA_FIRST_VALUE_WINDOW,
  revisionMode: 'DISABLED' as const,
}));

export class CaCoreConfigError extends Error {
  constructor(
    readonly code: 'REVISION_MODE_NOT_SUPPORTED_STAGE1',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'CaCoreConfigError';
  }
}

/** 起動時の検証(取得・書き込みの前)。受付期間の設定漏れ・改定モードが DISABLED 以外のものは例外 */
export function validateCaCoreSources(sources: readonly CaCoreSource[] = CA_CORE_SOURCES): void {
  validateFirstValueWindows(sources, []); // コアの系列は免除なし
  for (const source of sources) {
    if ((source.revisionMode as string) !== 'DISABLED') {
      throw new CaCoreConfigError(
        'REVISION_MODE_NOT_SUPPORTED_STAGE1',
        `${source.indicatorCode}: revisionMode must be DISABLED (no fixed-record store in stage 1)`,
      );
    }
  }
}

export interface DeadlineWarning {
  indicator: string;
  provider_event_id: string;
  daysAfter: number;
  deadline_local_date: string;
}

export interface CaCoreCpiResult {
  published: number;
  pending: number;
  plan: OfficialValuesPlanItem[];
  revision_detection: { mode: 'DISABLED_STAGE1' };
  revision_observations: RevisionObservation[];
  same_day_diff: SameDayDiff[];
  deadline_warnings: DeadlineWarning[];
}

const DEADLINE_WARNING_DAYS = [5, 6, 7];

type Fetched =
  { source: CaCoreSource; kind: 'OK'; points: CorePoint[] } | { source: CaCoreSource; kind: 'FAILED'; reason: string };

export async function ingestCaCoreCpiValues(
  deps: {
    store: IngestionStore;
    fetcher: OfficialValueFetcher;
    sources?: readonly CaCoreSource[];
    tables: readonly OfficialScheduleTable[];
    now?: () => Date;
    /** 初回値を見る範囲(公表からの日数)。既定 45 日(officialValues と同じ) */
    lookbackDays?: number;
    dryRun?: boolean;
  },
  counters: JobCounters,
): Promise<CaCoreCpiResult> {
  const sources = deps.sources ?? CA_CORE_SOURCES;
  validateCaCoreSources(sources); // 取得・書き込みの前に止める
  const now = deps.now?.() ?? new Date();
  const lookbackMs = (deps.lookbackDays ?? 45) * 86_400_000;
  const dryRun = deps.dryRun === true;
  const result: CaCoreCpiResult = {
    published: 0,
    pending: 0,
    plan: [],
    revision_detection: { mode: 'DISABLED_STAGE1' },
    revision_observations: [],
    same_day_diff: [],
    deadline_warnings: [],
  };

  const indicators = await deps.store.findIndicatorsByCode(sources.map((s) => s.indicatorCode));

  interface Prepared {
    source: CaCoreSource;
    table: OfficialScheduleTable;
    indicator: NonNullable<ReturnType<typeof indicators.get>>;
    entryById: Map<string, OfficialScheduleEntry>;
    events: Awaited<ReturnType<IngestionStore['listEventsByProvider']>>;
  }
  const prepared: Prepared[] = [];
  for (const source of sources) {
    const table = deps.tables.find((t) => t.provider === source.scheduleProvider);
    const indicator = indicators.get(source.indicatorCode);
    if (!table || !indicator) {
      counters.error(`${source.indicatorCode}: no schedule table or indicator row`);
      continue;
    }
    const entryById = new Map<string, OfficialScheduleEntry>(
      table.entries
        .filter((e) => e.indicatorCode === source.indicatorCode)
        .map((e) => [officialScheduleProviderEventId(table.provider, e), e]),
    );
    const events = (await deps.store.listEventsByProvider(table.provider)).filter(
      (event) => entryById.has(event.provider_event_id) && Date.parse(event.release_datetime) <= now.getTime(),
    );
    if (events.length === 0) continue;
    prepared.push({ source, table, indicator, entryById, events });
  }

  // ① 取得・構造の検証(書き込みなし。系列ごとに1回のリクエスト)
  const fetched: Fetched[] = [];
  let globalStop: 'RESPONSE_UNPARSABLE' | 'SERIES_UNIDENTIFIABLE' | null = null;
  for (const { source } of prepared) {
    let body: unknown;
    try {
      body = await deps.fetcher.getJson(CA_CORE_WDS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ vectorId: source.series.vectorId, latestN: CA_CORE_LATEST_N }]),
      });
    } catch (error) {
      if (error instanceof HttpError && error.kind === 'PARSE') {
        // JSON でない応答は、構造の破壊(CA のコア系列すべてを止める)
        globalStop ??= 'RESPONSE_UNPARSABLE';
        counters.error(`${source.indicatorCode}: RESPONSE_UNPARSABLE`);
        fetched.push({ source, kind: 'FAILED', reason: 'RESPONSE_UNPARSABLE' });
        continue;
      }
      counters.skip('FETCH_FAILED');
      counters.note('fetch_failed', {
        indicator: source.indicatorCode,
        error: error instanceof Error ? error.message : String(error),
      });
      fetched.push({ source, kind: 'FAILED', reason: 'FETCH_FAILED' });
      continue;
    }
    const response = classifyCoreResponse(source.series, body);
    switch (response.kind) {
      case 'OK':
        fetched.push({ source, kind: 'OK', points: response.points });
        break;
      case 'FETCH_FAILED':
        counters.skip('FETCH_FAILED');
        counters.note('fetch_failed', { indicator: source.indicatorCode, error: 'status is not SUCCESS' });
        fetched.push({ source, kind: 'FAILED', reason: 'FETCH_FAILED' });
        break;
      case 'SERIES_MISMATCH':
        // 本来起きない異常。その系列だけ止める(他系列の書き込みは完了させる)。値を別の系列に入れない
        counters.error(`${source.indicatorCode}: SERIES_MISMATCH (got vectorId ${response.got})`);
        fetched.push({ source, kind: 'FAILED', reason: 'SERIES_MISMATCH' });
        break;
      case 'RESPONSE_UNPARSABLE':
      case 'SERIES_UNIDENTIFIABLE':
        globalStop ??= response.kind;
        counters.error(`${source.indicatorCode}: ${response.kind}`);
        fetched.push({ source, kind: 'FAILED', reason: response.kind });
        break;
    }
  }

  // ② 全体停止: 構造が壊れた応答は StatCan 側の不具合を疑い、コアの全系列を安全側に倒す(何も書かない)
  const stoppedReason = (f: Fetched): string | null => globalStop ?? (f.kind === 'FAILED' ? f.reason : null);

  // ③ 系列ごとに経路 A(初回値)と参考情報(経路 B の第1段階版)
  for (const prep of prepared) {
    const { source, indicator, entryById, events } = prep;
    const fetchedEntry = fetched.find((f) => f.source === source)!;
    const stopReason = stoppedReason(fetchedEntry);
    const points = fetchedEntry.kind === 'OK' && !globalStop ? fetchedEntry.points : null;
    const seriesId = `v${source.series.vectorId}`;

    for (const event of events) {
      const entry = entryById.get(event.provider_event_id)!;
      const releaseAt = new Date(event.release_datetime);
      const snapshot = await deps.store.getReleaseSnapshot(event.id);
      const pending = (reason: string) => {
        if (event.status !== 'RELEASED') result.pending += 1;
        result.plan.push({
          provider_event_id: event.provider_event_id,
          indicator: source.indicatorCode,
          action: 'PENDING',
          reason,
        });
      };

      // QA-1: 初回値は保存済みなのにイベントの状態が RELEASED・AVAILABLE でない回は、状態だけを直す(既存と同じ)
      if (needsReleasedStateRepair(event, snapshot)) {
        result.plan.push({
          provider_event_id: event.provider_event_id,
          indicator: source.indicatorCode,
          action: 'REPAIR',
        });
        if (!dryRun) {
          try {
            await deps.store.updateEvent(event.id, { status: 'RELEASED', data_status: 'AVAILABLE' });
            counters.note('ca_core_repaired', { event_id: event.id, indicator: source.indicatorCode });
          } catch (error) {
            counters.error(`${event.provider_event_id}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
        }
      }

      // 初回値が保存済みの回: 参考情報だけ(書かない)
      if (snapshot || event.status === 'RELEASED') {
        if (!snapshot || snapshot.actual === null || points === null) continue;
        const period = snapshot.verification_source?.split('@')[1] ?? entry.referencePeriod ?? null;
        if (!period) continue;
        const outcome = observeStoredValue(
          {
            indicatorCode: source.indicatorCode,
            providerEventId: event.provider_event_id,
            eventId: event.id,
            period,
            stored: Number(snapshot.actual),
            capturedAt: snapshot.captured_at ?? null,
          },
          points,
          seriesId,
          now,
        );
        if (outcome.kind === 'UNCHANGED') {
          counters.skip('UNCHANGED');
          result.plan.push({
            provider_event_id: event.provider_event_id,
            indicator: source.indicatorCode,
            action: 'UNCHANGED',
            period,
            value: Number(snapshot.actual),
          });
        } else if (outcome.kind === 'OBSERVATION') {
          result.revision_observations.push(outcome.observation);
        } else if (outcome.kind === 'SAME_DAY_DIFF') {
          result.same_day_diff.push(outcome.diff);
          counters.note('same_day_diff', outcome.diff);
        }
        continue;
      }

      // 初回値が未保存の回
      if (Date.parse(event.release_datetime) < now.getTime() - lookbackMs) continue; // 古い回は対象外(既存と同じ 45 日)
      if (!entry.referencePeriod) {
        counters.skip('NO_REFERENCE_PERIOD');
        pending('NO_REFERENCE_PERIOD');
        continue;
      }
      if (source.firstValueWindow && isFirstValueWindowExpired(source.firstValueWindow, releaseAt, now)) {
        counters.skip('TOO_LATE_FOR_FIRST_RELEASE'); // 改定後の値を初回値として保存しない。自動では救済しない
        pending('TOO_LATE_FOR_FIRST_RELEASE');
        continue;
      }
      // 期限間近(5〜7日目)の警告。終了コードは変えない
      if (source.firstValueWindow?.basis === 'LOCAL_CALENDAR') {
        const tz = source.firstValueWindow.timeZone!;
        const daysAfter = localDaysAfter(releaseAt, now, tz);
        if (DEADLINE_WARNING_DAYS.includes(daysAfter)) {
          result.deadline_warnings.push({
            indicator: source.indicatorCode,
            provider_event_id: event.provider_event_id,
            daysAfter,
            deadline_local_date: addCalendarDays(localCalendarDay(releaseAt, tz), source.firstValueWindow.days),
          });
        }
      }
      if (stopReason !== null || points === null) {
        // 取得失敗・系列の不一致・全体停止。何も書かない(推測・前回値・現在値で補完しない)
        pending(stopReason ?? 'FETCH_FAILED');
        continue;
      }
      const verdict = evaluateFirstValue(points, entry.releaseDate, entry.referencePeriod);
      if (!verdict.ok) {
        counters.skip(verdict.reason);
        if (verdict.reason === 'PERIOD_MISMATCH') {
          counters.note('period_mismatch', { event_id: event.id, expected: entry.referencePeriod });
        }
        pending(verdict.reason);
        continue;
      }
      result.plan.push({
        provider_event_id: event.provider_event_id,
        indicator: source.indicatorCode,
        action: 'PUBLISH',
        period: verdict.period,
        value: verdict.value,
      });
      if (dryRun) {
        result.published += 1;
        continue;
      }
      const surprise = calculateSurprise(null, verdict.value, indicator.favorable_direction);
      try {
        await deps.store.insertReleaseSnapshot({
          event_id: event.id,
          forecast: null,
          actual: verdict.value,
          previous: null,
          unit: source.unit,
          source: source.sourceName,
          source_url: source.sourceUrl,
          captured_at: now.toISOString(),
          surprise: surprise.surprise,
          surprise_direction: surprise.direction,
          verification_status: 'VERIFIED',
          verification_source: `${seriesId}@${verdict.period}`,
          official_actual: verdict.value,
          secondary_value_kind: null,
          secondary_actual: null,
          secondary_forecast: null,
          secondary_previous: null,
        });
        await deps.store.updateEvent(event.id, { status: 'RELEASED', data_status: 'AVAILABLE' });
        result.published += 1;
        counters.success += 1;
        counters.note('ca_core_published', {
          event_id: event.id,
          indicator: source.indicatorCode,
          period: verdict.period,
          value: verdict.value,
        });
        // この実行で保存できた回は、期限間近の警告から外す
        result.deadline_warnings = result.deadline_warnings.filter(
          (w) => w.provider_event_id !== event.provider_event_id,
        );
      } catch (error) {
        counters.error(`${event.provider_event_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  counters.details.ca_core_published = result.published;
  counters.details.ca_core_pending = result.pending;
  counters.details.ca_core_revision_detection = result.revision_detection;
  counters.details.ca_core_revision_observations = result.revision_observations;
  counters.details.ca_core_same_day_diff_count = result.same_day_diff.length;
  counters.details.ca_core_deadline_warnings = result.deadline_warnings;
  return result;
}

/** Actions の注記(::notice / ::warning)。第1段階の改定は情報(警告ではない)。終了コードは変えない */
export function caCoreAnnotations(result: CaCoreCpiResult): string[] {
  const lines = [
    `::notice::CA core CPI revision detection is disabled in stage 1 (${result.revision_detection.mode}); ` +
      `${result.revision_observations.length} observation(s) shown for reference only, nothing written to event_revisions`,
  ];
  if (result.same_day_diff.length > 0) {
    lines.push(
      `::notice::same_day_diff: ${result.same_day_diff.length} (same-day value differs; nothing written, please check)`,
    );
  }
  for (const w of result.deadline_warnings) {
    lines.push(
      `::warning::FIRST_VALUE_DEADLINE (${7 - w.daysAfter} days left): ${w.indicator} ${w.provider_event_id} (deadline ${w.deadline_local_date} Toronto)`,
    );
  }
  return lines;
}
