/**
 * BLS が前年比の元の月を公表していない回を DATA_UNAVAILABLE の発表済みにする(HQ指示 2026-11-11「CPI 2026-11-10
 * DATA_UNAVAILABLE 対応(案A)」)。対象は mappings/blsDataUnavailable.ts の表の回だけ。
 *
 * 1件ごとに、次のすべてを満たすときだけ書く(1つでも違えば何もしない):
 *   1. イベントがある(provider = bls_schedule、provider_event_id = bls_schedule:<指標>:<対象月>)
 *   2. イベントの発表時刻が表と一致する
 *   3. 発表時刻を過ぎている
 *   4. BLS の公式データに、その回の対象月の値がある(発表は行われた)
 *   5. BLS の公式データに、前年比に必要な月の値が無い(今も公表されていない。公表されたら通常の取り込みに任せる)
 *   6. RELEASE スナップショットが無い(実績値が既に入っている回は変えない)
 * 書くもの:
 *   - economic_events: status = RELEASED、data_status = UNAVAILABLE(API では DATA_UNAVAILABLE)
 *   - event_explanations: FACT_SUMMARY 1件(summary = 理由、source = BLS、source_url、published_at = 発表時刻)
 * 書かないもの: event_snapshots(実績値・予想・前回値・サプライズ)。前月比を前年比の代わりにしない。予想・推定もしない。
 * 何度動かしても同じ(既に RELEASED・UNAVAILABLE で、同じ理由の説明があれば何もしない)。
 * 反応値(event-reactions)は RELEASED のイベントを選ぶので、実績値が無くてもこの回の値動きを計算できる(イベントは変えない)。
 */
import type { OfficialObservation } from '../types.js';
import type { BlsDataUnavailableEntry } from '../mappings/blsDataUnavailable.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';

export const BLS_SCHEDULE_PROVIDER_FOR_UNAVAILABLE = 'bls_schedule';

export interface StoredExplanation {
  version: number;
  explanation_type: string;
  summary: string | null;
  source: string | null;
  source_url: string | null;
}

export interface NewExplanation {
  event_id: string;
  version: number;
  explanation_type: 'FACT_SUMMARY';
  summary: string;
  source: string;
  source_url: string;
  published_at: string;
}

export interface BlsDataUnavailableStore extends Pick<
  IngestionStore,
  'findEventByProviderId' | 'updateEvent' | 'getReleaseSnapshot'
> {
  /** いちばん新しい説明(無ければ null)。 */
  getLatestExplanation(eventId: string): Promise<StoredExplanation | null>;
  insertExplanation(row: NewExplanation): Promise<void>;
}

export interface BlsDataUnavailableResult {
  applied: string[];
  unchanged: string[];
  /** 条件を満たさず何もしなかった回(理由つき) */
  skipped: { key: string; reason: string }[];
  /** dry-run のときに書くはずだった内容 */
  planned: { key: string; event_id: string; event: Record<string, string>; explanation: NewExplanation | null }[];
}

const monthStart = (period: string) => `${period}-01`;

/** BLS の観測値から、その月の値があるか(value が数として読めるか)。 */
function hasValue(observations: readonly OfficialObservation[], seriesId: string, period: string): boolean {
  return observations.some(
    (o) =>
      o.seriesId === seriesId && o.periodStart === monthStart(period) && o.value !== null && Number.isFinite(o.value),
  );
}

export async function applyBlsDataUnavailable(
  deps: {
    store: BlsDataUnavailableStore;
    entries: readonly BlsDataUnavailableEntry[];
    /** BLS の公式データ(entries の系列。期間は対象月と前年比の元の月を含む) */
    observations: readonly OfficialObservation[];
    now?: () => Date;
    dryRun?: boolean;
  },
  counters: JobCounters,
): Promise<BlsDataUnavailableResult> {
  const now = deps.now?.() ?? new Date();
  const result: BlsDataUnavailableResult = { applied: [], unchanged: [], skipped: [], planned: [] };
  const skip = (key: string, reason: string) => {
    counters.skip(reason);
    result.skipped.push({ key, reason });
  };

  for (const entry of deps.entries) {
    const key = `${entry.indicatorCode}:${entry.referencePeriod}`;
    counters.fetched += 1;
    const event = await deps.store.findEventByProviderId(
      BLS_SCHEDULE_PROVIDER_FOR_UNAVAILABLE,
      `${BLS_SCHEDULE_PROVIDER_FOR_UNAVAILABLE}:${entry.indicatorCode}:${entry.referencePeriod}`,
    );
    if (!event) {
      skip(key, 'EVENT_NOT_FOUND');
      continue;
    }
    if (Date.parse(event.release_datetime) !== Date.parse(entry.releaseDatetimeUtc)) {
      skip(key, 'RELEASE_TIME_MISMATCH');
      continue;
    }
    if (now.getTime() < Date.parse(entry.releaseDatetimeUtc)) {
      skip(key, 'NOT_RELEASED_YET');
      continue;
    }
    if (!hasValue(deps.observations, entry.seriesId, entry.referencePeriod)) {
      skip(key, 'REFERENCE_PERIOD_NOT_PUBLISHED'); // BLS がこの回をまだ出していない
      continue;
    }
    if (hasValue(deps.observations, entry.seriesId, entry.missingPeriod)) {
      skip(key, 'BASE_PERIOD_NOW_AVAILABLE'); // 元の月が公表された → 通常の取り込みで実績値を作る
      continue;
    }
    if (await deps.store.getReleaseSnapshot(event.id)) {
      skip(key, 'HAS_RELEASE_SNAPSHOT'); // 実績値が既にある回は変えない
      continue;
    }

    const latest = await deps.store.getLatestExplanation(event.id);
    const explanationPresent =
      latest !== null &&
      latest.explanation_type === 'FACT_SUMMARY' &&
      latest.summary === entry.reason &&
      latest.source === entry.source &&
      latest.source_url === entry.sourceUrl;
    const eventDone = event.status === 'RELEASED' && event.data_status === 'UNAVAILABLE';
    if (eventDone && explanationPresent) {
      result.unchanged.push(key);
      counters.skip('UNCHANGED');
      continue;
    }

    const explanation: NewExplanation | null = explanationPresent
      ? null
      : {
          event_id: event.id,
          version: (latest?.version ?? 0) + 1,
          explanation_type: 'FACT_SUMMARY',
          summary: entry.reason,
          source: entry.source,
          source_url: entry.sourceUrl,
          published_at: entry.releaseDatetimeUtc,
        };
    if (deps.dryRun) {
      result.planned.push({
        key,
        event_id: event.id,
        event: { status: 'RELEASED', data_status: 'UNAVAILABLE' },
        explanation,
      });
      continue;
    }
    if (!eventDone) await deps.store.updateEvent(event.id, { status: 'RELEASED', data_status: 'UNAVAILABLE' });
    if (explanation) await deps.store.insertExplanation(explanation);
    result.applied.push(key);
    counters.success += 1;
    counters.note('applied', { key, event_id: event.id });
  }
  counters.details.applied = result.applied;
  counters.details.unchanged = result.unchanged;
  counters.details.skipped = result.skipped;
  return result;
}
