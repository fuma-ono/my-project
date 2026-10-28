/**
 * ④ Central-bank speech schedules → speech_events (upsert keyed by
 * provider + provider_event_id).
 *
 * - Speaker: resolved only through mappings/speakers.ts to an existing
 *   speakers row; unknown names are skipped and logged, never created.
 * - Time: only sources that state the scheduled time (EXACT) are written;
 *   publication-time-only items (RSS pubDate) are skipped by default,
 *   because speech reactions are computed per minute from
 *   statement_datetime (api-design.md §14.8〜§14.10).
 * - Status: SCHEDULED until the start time has passed, then DELIVERED.
 * - A SCHEDULED speech that disappears from the source is only logged
 *   (the source does not say whether it was cancelled or moved) — unless the
 *   caller passes `reconcile` (ECB weekly schedule only, HQ判断 2026-10-28 R1〜R3):
 *   see reconcileDisappeared below.
 */
import { findSpeakerAlias, SPEAKER_ALIASES, SPEECH_KIND_LABEL_JA, type SpeakerAlias } from '../mappings/speakers.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore, SpeechEventRow, StoredSpeechRef } from '../store.js';
import { wallClockParts } from '../time.js';
import type { NormalizedSpeech } from '../types.js';

export interface SpeechPipelineOptions {
  store: IngestionStore;
  aliases?: readonly SpeakerAlias[];
  now?: () => Date;
  /** Accept PUBLICATION_TIME items as statement times (default false — see header). */
  allowPublicationTime?: boolean;
  /**
   * Ignore speeches that started more than this many days ago (the FRB
   * calendar JSON carries years of history; backfilling it is a separate,
   * deliberate decision). Default 14.
   */
  pastDays?: number;
  /**
   * Reconcile disappeared SCHEDULED speeches instead of only logging them (HQ判断 2026-10-28 R1〜R3).
   * `coverage` = the dates the fetched page covers ([first day 00:00, day after the last day 00:00)
   * in the source's time zone); null = unknown → nothing is changed. Only for a source that lists
   * every item of the period it covers (the ECB weekly schedule).
   */
  reconcile?: { coverage: { fromIso: string; toIso: string } | null; timeZone: string };
}

/** Up to this many disappeared speeches are always reconciled; more only if at most half of the scheduled ones. */
export const RECONCILE_ALWAYS_ALLOWED = 2;

/** speech_events.title: Japanese kind label + the source's topic (not translated). */
export function speechTitle(speech: NormalizedSpeech): string {
  const label = SPEECH_KIND_LABEL_JA[speech.kind];
  const topic = speech.topic?.replace(/\s+/g, ' ').trim();
  return topic ? `${label}: ${topic}` : label;
}

/**
 * 鮮度監視用の記録(HQ承認 2026-10-23「要人発言の鮮度監視」)。取り込み対象・
 * スキップ・状態は一切変えず、ingestion_logs.details に次の2つを書くだけ:
 * - source_latest_at: 取得した全件(後でスキップされたものも含む)の startsAt の最大値(ISO)。0件なら null
 * - source_future_count: 取得した全件のうち startsAt が now より後の件数。0件なら 0
 * 品質レポート第9章(quality/metrics.ts judgeSpeechFreshness)が、取得元の更新停止・
 * 取り込みの漏れの判定に使う。
 */
function recordSourceFreshness(speeches: readonly NormalizedSpeech[], now: Date, counters: JobCounters): void {
  const times = speeches.map((speech) => Date.parse(speech.startsAt)).filter(Number.isFinite);
  counters.details.source_latest_at = times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
  counters.details.source_future_count = times.filter((time) => time > now.getTime()).length;
}

export async function ingestSpeeches(
  provider: string,
  speeches: readonly NormalizedSpeech[],
  options: SpeechPipelineOptions,
  counters: JobCounters,
): Promise<void> {
  const { store } = options;
  const aliases = options.aliases ?? SPEAKER_ALIASES;
  const now = (options.now ?? (() => new Date()))();
  counters.fetched += speeches.length;
  recordSourceFreshness(speeches, now, counters);

  const speakers = await store.listSpeakers();
  const speakerIdByKey = new Map(speakers.map((speaker) => [`${speaker.organization}|${speaker.name}`, speaker.id]));

  const rows = new Map<string, SpeechEventRow>();
  const oldest = now.getTime() - (options.pastDays ?? 14) * 86_400_000;
  for (const speech of speeches) {
    if (Date.parse(speech.startsAt) < oldest) {
      counters.skip('OUTSIDE_WINDOW');
      continue;
    }
    if (speech.timePrecision !== 'EXACT' && !options.allowPublicationTime) {
      counters.skip('TIME_NOT_EXACT');
      continue;
    }
    const alias = findSpeakerAlias(speech.organization, speech.speakerName, aliases);
    if (!alias) {
      counters.skip('SPEAKER_UNKNOWN');
      counters.note('unknown_speakers', `${speech.organization}: ${speech.speakerName}`);
      continue;
    }
    const speakerId = speakerIdByKey.get(`${alias.organization}|${alias.nameJa}`);
    if (!speakerId) {
      counters.skip('SPEAKER_NOT_IN_DB');
      counters.note('speakers_not_in_db', `${alias.organization}: ${alias.nameJa}`);
      continue;
    }
    rows.set(speech.providerEventId, {
      speaker_id: speakerId,
      provider,
      provider_event_id: speech.providerEventId,
      title: speechTitle(speech),
      statement_datetime: speech.startsAt,
      importance: alias.importance,
      status: Date.parse(speech.startsAt) <= now.getTime() ? 'DELIVERED' : 'SCHEDULED',
    });
  }

  if (options.reconcile) {
    await reconcileDisappeared(provider, speeches, rows, options.reconcile, now, store, counters);
  }

  if (rows.size > 0) {
    counters.success += await store.upsertSpeechEvents([...rows.values()]);
  }
  if (options.reconcile) return;

  // Disappeared SCHEDULED speeches: future ones up to the latest time this fetch covers.
  const fetchedTimes = speeches.map((speech) => Date.parse(speech.startsAt)).filter(Number.isFinite);
  if (fetchedTimes.length > 0) {
    const from = now.toISOString();
    const to = new Date(Math.max(...fetchedTimes) + 1).toISOString();
    if (from < to) {
      const scheduled = await store.listScheduledSpeechIds(provider, from, to);
      const fetchedIds = new Set(speeches.map((speech) => speech.providerEventId));
      for (const id of scheduled) {
        if (!fetchedIds.has(id)) counters.note('disappeared_scheduled_speeches', id);
      }
    }
  }
}

/**
 * HQ判断 2026-10-28(R1〜R3)。取得したページが範囲(coverage)の項目をすべて載せている取得元のための処理。
 * 範囲の中で、今より後の SCHEDULED の行のうち、今回のページに無いもの(消えた予定)を:
 * - R2 同じ話者・同じ日(取得元の時間帯の日付)に、DB にまだ無い新しい行がちょうど1つあり、その日の消えた予定も
 *   1つだけ → 時刻の変更とみなし、旧行の provider_event_id・時刻・題名・重要度を新しい値にする(新しい行は作らない。
 *   この後の upsert は同じ行を更新するだけ)。DB トリガーが RESCHEDULED を記録する
 * - R1 それ以外(話者の変更・候補が0件か2件以上) → CANCELLED。DB トリガーが CANCELLED を記録する
 * 安全弁(どれかに当たれば何も変えず、cancel_suppressed に理由を残す):
 * - 範囲が分からない(coverage が null)
 * - 今回の取得で項目が0件(ページの形が変わり何も読めない可能性。形が全く違うときは adapter がエラーにする)
 * - 消えた予定が RECONCILE_ALWAYS_ALLOWED 件より多く、かつ範囲の SCHEDULED の半分を超える
 * 範囲の外(過去・ページより先)の行と、SCHEDULED 以外の行は変えない。CANCELLED の行がページに戻ったら、
 * この後の upsert で SCHEDULED / DELIVERED に戻る(再掲載)。
 */
async function reconcileDisappeared(
  provider: string,
  speeches: readonly NormalizedSpeech[],
  rows: ReadonlyMap<string, SpeechEventRow>,
  reconcile: NonNullable<SpeechPipelineOptions['reconcile']>,
  now: Date,
  store: IngestionStore,
  counters: JobCounters,
): Promise<void> {
  const { coverage, timeZone } = reconcile;
  if (!coverage) {
    counters.note('cancel_suppressed', { reason: 'NO_COVERAGE' });
    return;
  }
  const stored = await store.listSpeechRefs(provider, coverage.fromIso, coverage.toIso);
  const fetchedIds = new Set(speeches.map((speech) => speech.providerEventId));
  const scheduled = stored.filter(
    (row) => row.status === 'SCHEDULED' && Date.parse(row.statement_datetime) >= now.getTime(),
  );
  const disappeared = scheduled.filter((row) => !fetchedIds.has(row.provider_event_id));
  if (disappeared.length === 0) return;
  for (const row of disappeared) counters.note('disappeared_scheduled_speeches', row.provider_event_id);

  if (speeches.length === 0) {
    counters.note('cancel_suppressed', { reason: 'NO_ITEMS', disappeared: disappeared.length });
    return;
  }
  if (disappeared.length > RECONCILE_ALWAYS_ALLOWED && disappeared.length * 2 > scheduled.length) {
    counters.note('cancel_suppressed', {
      reason: 'MASS_DISAPPEARANCE',
      disappeared: disappeared.length,
      scheduled: scheduled.length,
    });
    return;
  }

  const dayKey = (speakerId: string, iso: string): string => {
    const wall = wallClockParts(new Date(iso), timeZone);
    return `${speakerId}|${wall.year}-${wall.month}-${wall.day}`;
  };
  const storedIds = new Set(stored.map((row) => row.provider_event_id));
  const freshByDay = groupBy(
    [...rows.values()].filter((row) => !storedIds.has(row.provider_event_id)),
    (row) => dayKey(row.speaker_id, row.statement_datetime),
  );
  const disappearedByDay = groupBy(disappeared, (row: StoredSpeechRef) =>
    dayKey(row.speaker_id, row.statement_datetime),
  );

  for (const row of disappeared) {
    const key = dayKey(row.speaker_id, row.statement_datetime);
    const fresh = freshByDay.get(key) ?? [];
    if (fresh.length === 1 && disappearedByDay.get(key)!.length === 1) {
      const moved = fresh[0]!;
      await store.updateSpeechEvent(provider, row.provider_event_id, {
        provider_event_id: moved.provider_event_id,
        statement_datetime: moved.statement_datetime,
        title: moved.title,
        importance: moved.importance,
      });
      counters.note('rescheduled_speeches', { from: row.provider_event_id, to: moved.provider_event_id });
    } else {
      await store.updateSpeechEvent(provider, row.provider_event_id, { status: 'CANCELLED' });
      counters.note('cancelled_speeches', row.provider_event_id);
    }
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}
