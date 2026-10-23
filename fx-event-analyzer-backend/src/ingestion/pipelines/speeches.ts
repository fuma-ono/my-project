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
 *   (the source does not say whether it was cancelled or moved).
 */
import { findSpeakerAlias, SPEAKER_ALIASES, SPEECH_KIND_LABEL_JA, type SpeakerAlias } from '../mappings/speakers.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore, SpeechEventRow } from '../store.js';
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
}

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

  if (rows.size > 0) {
    counters.success += await store.upsertSpeechEvents([...rows.values()]);
  }

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
