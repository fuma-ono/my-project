import type { SpeechSummary } from '../repositories/speechesRepository.js';

/**
 * 要人発言の本文由来のテキストの公開ポリシー(config/speechText.ts の SPEECH_TEXT_EXPOSED)。
 * 無効のとき: summary = null、summary_status = NOT_AVAILABLE、summary_method = null、body_status = NOT_APPLICABLE
 * (キーは残す。現行・既存の iOS ビルドの形を変えない)。英語の原題・発言者・日時・source_url・attribution は変えない。
 */
export function applySpeechTextPolicy(speech: SpeechSummary, exposed: boolean): SpeechSummary {
  if (exposed) return speech;
  return {
    ...speech,
    summary: null,
    summary_status: 'NOT_AVAILABLE',
    summary_method: null,
    body_status: 'NOT_APPLICABLE',
  };
}
