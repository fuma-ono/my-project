/**
 * 要人発言の「本文由来のテキスト」(要約・原文抜粋 summary / summary_status / summary_method / body_status、
 * Home の headline に入る要約)を利用者に返すかのサーバー側フラグ
 * (オーナー決定 2026-11-25: 1.0 では要人発言は 英語の原題・発言者名・肩書き・日時・公式の出典リンク だけを出す。
 * 再掲の権利(法務)が確認できるまで、日本語の文脈行・トピックタグ・原文抜粋・本文・訳・要約は公開しない)。
 *
 * 環境変数 SPEECH_TEXT_EXPOSED が文字列 'true' のときだけ有効。未設定・空・それ以外('1'・'TRUE' など)はすべて無効。
 * DB のデータ(speech_events.summary / speech_body など)は消さない。再有効化は、この変数を明示的に設定する手動の作業。
 * (speech_body はもともと API では返していない。)
 */
export const SPEECH_TEXT_EXPOSED_ENV_VAR = 'SPEECH_TEXT_EXPOSED';

export function parseSpeechTextExposed(value: string | undefined): boolean {
  return value === 'true';
}
