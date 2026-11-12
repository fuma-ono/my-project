/**
 * 要人発言の要約を作る工程(HQ指示 2026-11-11「本文取得と要約生成を別々の工程として扱う」)。本文の取得
 * (pipelines/speechBodies.ts)とは別の工程で、本文の取れた発言(body_status = FETCHED)だけを対象にする。
 *
 * 1件ごとに: 本文 → 要約(speechSummary.ts の summarizeExtractive。原文からの抜粋、言語モデル・有料 API は使わない)。
 *   作れた → summary・summary_method = EXTRACTIVE_EN・summary_generated_at、summary_error = null(API の summary_status は READY)
 *   作れない → summary = null、summary_error に理由(API の summary_status は FAILED)
 * 対象: 要約がまだ無く、作れなかった理由も無い発言。pastDays = null なら過去のすべての発言(過去の発言への適用)。
 * 人が書いた要約(summary_method が無い summary)は上書きしない(要約がある行は対象に入らない)。
 * 本文の権利を確認できていない発言元(ECB)は本文が無いので、要約も作られない(summary_status は NOT_AVAILABLE のまま)。
 */
import { summarizeExtractive, SUMMARY_METHOD_EXTRACTIVE_EN } from '../speechSummary.js';
import type { JobCounters } from '../runner.js';

export interface SpeechForSummary {
  id: string;
  provider: string;
  statement_datetime: string;
  speech_body: string;
}

export interface SpeechSummaryPatch {
  summary: string | null;
  summary_method: string | null;
  summary_generated_at: string | null;
  summary_error: string | null;
}

export interface SpeechSummaryStore {
  /** body_status = FETCHED・本文あり・summary が null・summary_error が null の発言(sinceIso が null なら全期間、古い順)。 */
  listSpeechesNeedingSummary(sinceIso: string | null, limit: number): Promise<SpeechForSummary[]>;
  /**
   * 要約も理由も無い行だけを書き換える(HQ承認 2026-11-11: 既存の要約・失敗の理由を上書きしない。二重の実行の防止)。
   * 書き換えなかったら false。
   */
  updateSpeechSummary(id: string, patch: SpeechSummaryPatch): Promise<boolean>;
}

export interface SpeechSummarySettings {
  /** null = 過去のすべての発言 */
  pastDays: number | null;
  /** 1回の実行で要約を作る上限 */
  maxSpeeches: number;
  /** true = dry-run: 要約を作ってみるが DB に書かない(対象の件数と、READY / FAILED になるはずの内訳を返す)。 */
  dryRun?: boolean;
}

export interface SpeechSummaryPlanItem {
  speech_id: string;
  statement_datetime: string;
  result: 'READY' | 'FAILED';
  /** FAILED の理由 */
  reason: string | null;
  /** 要約の文字数(本文は出さない) */
  summary_characters: number | null;
}

export const SPEECH_SUMMARY_SETTINGS: SpeechSummarySettings = { pastDays: 30, maxSpeeches: 200 };

export async function ingestSpeechSummaries(
  store: SpeechSummaryStore,
  settings: SpeechSummarySettings,
  now: Date,
  counters: JobCounters,
): Promise<{ ready: number; failed: number; plan: SpeechSummaryPlanItem[] }> {
  const plan: SpeechSummaryPlanItem[] = [];
  const sinceIso =
    settings.pastDays === null ? null : new Date(now.getTime() - settings.pastDays * 86_400_000).toISOString();
  const speeches = await store.listSpeechesNeedingSummary(sinceIso, settings.maxSpeeches);
  counters.fetched += speeches.length;
  let ready = 0;
  let failed = 0;
  for (const speech of speeches) {
    const result = summarizeExtractive(speech.speech_body);
    plan.push({
      speech_id: speech.id,
      statement_datetime: speech.statement_datetime,
      result: result.ok ? 'READY' : 'FAILED',
      reason: result.ok ? null : result.reason,
      summary_characters: result.ok ? result.summary.length : null,
    });
    if (settings.dryRun) {
      if (result.ok) ready += 1;
      else failed += 1;
      continue;
    }
    const patch: SpeechSummaryPatch = result.ok
      ? {
          summary: result.summary,
          summary_method: SUMMARY_METHOD_EXTRACTIVE_EN,
          summary_generated_at: now.toISOString(),
          summary_error: null,
        }
      : { summary: null, summary_method: null, summary_generated_at: null, summary_error: result.reason };
    if (!(await store.updateSpeechSummary(speech.id, patch))) {
      counters.skip('CONCURRENT_UPDATE'); // ほかの実行が先に書いた(上書きしない)
      continue;
    }
    if (result.ok) {
      ready += 1;
      counters.success += 1;
    } else {
      failed += 1;
      counters.skip(result.reason);
    }
  }
  counters.details.ready = ready;
  counters.details.failed = failed;
  return { ready, failed, plan };
}
