import { judgeSpeechFetch, type SpeechRunSample } from '../ingestion/quality/metrics.js';
import { formatIsoSeconds } from './notifications.js';
import { resolveSpeakerPhotoUrl } from './speakerPhotos.js';

/**
 * GET /home `speeches` (api-design.md §12, v1.27): 直近の要人発言.
 * The most recent DELIVERED speeches of the last 7 days, newest first,
 * at most 3. Same item shape the UI screenshot mock has returned since
 * 2026-10-06 (scripts/ui-screenshot-mock-server.mjs homeHandler).
 */

export const HOME_SPEECHES_MAX = 3;
export const HOME_SPEECHES_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * 「パウエルFRB理事」: the family name + the title, as the Home card and the
 * mock show it. Foreign names are stored as 「ジェローム・パウエル」 (given・
 * family), so the part after the last 「・」 is used; a name without one
 * (「植田和男」) is used whole → 「植田和男日本銀行総裁」.
 */
export function speakerDisplayName(name: string, title: string): string {
  const trimmed = name.trim();
  const separator = Math.max(trimmed.lastIndexOf('・'), trimmed.lastIndexOf('･'));
  const familyName = separator >= 0 && separator < trimmed.length - 1 ? trimmed.slice(separator + 1) : trimmed;
  return `${familyName}${title.trim()}`;
}

/** [now − 7 days, now]: statement_datetime must fall in this range. */
export function homeSpeechesRange(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - HOME_SPEECHES_WINDOW_DAYS * DAY_MS), to: now };
}

export interface HomeSpeechSource {
  speech_id: string;
  title: string;
  summary: string | null;
  statement_datetime: string;
  speaker: {
    name: string;
    title: string;
    organization: string;
    country_code: string;
    photo_url?: string | null | undefined;
  };
}

export interface HomeSpeechItem {
  speech_id: string;
  country_code: string;
  speaker_name: string;
  statement_datetime: string;
  headline: string;
  organization: string;
  speaker_photo_url: string | null;
  /** 発言前後の値動き. No speech price-reaction data exists (SpeechPriceReaction
   * is out of scope, db-design.md §3.16), so these are always null — never a
   * made-up number. */
  reaction_fx_symbol: string | null;
  reaction_price_before: number | null;
  reaction_price_after: number | null;
  reaction_pips: number | null;
}

/** headline = summary when present (non-blank), else title. */
export function toHomeSpeechItem(speech: HomeSpeechSource, baseUrl: string): HomeSpeechItem {
  const summary = speech.summary?.trim();
  return {
    speech_id: speech.speech_id,
    country_code: speech.speaker.country_code,
    speaker_name: speakerDisplayName(speech.speaker.name, speech.speaker.title),
    statement_datetime: formatIsoSeconds(new Date(speech.statement_datetime)),
    headline: summary ? summary : speech.title,
    organization: speech.speaker.organization,
    speaker_photo_url: resolveSpeakerPhotoUrl(speech.speaker.photo_url, baseUrl),
    reaction_fx_symbol: null,
    reaction_price_before: null,
    reaction_price_after: null,
    reaction_pips: null,
  };
}

/**
 * GET /home `speeches_status`(api-design.md §12 v1.34、HQ承認 2026-10-23): `speeches` が空のとき、
 * 「直近7日間に発言が無い」のか「取得できていない」のかをアプリが言い分けるための情報。
 * `speeches` 自体には一切影響しない。
 *
 * - last_success_at: frb_calendar の最後の SUCCESS の完了時刻。記録が無ければ null
 * - stale: frb_calendar の取得の失敗(quality/metrics.ts judgeSpeechFetch。品質レポート第9章と
 *   同じ判定 — 最新の実行が SUCCESS 以外・エラーあり・取得0件、または18時間以内の SUCCESS なし)。
 *   実行記録が1件も無ければ true
 *
 * ECB(ecb_press_rss)は判定に入れない: 公開時刻しか無いため仕様上 speech_events へ1件も
 * 書かず(TIME_NOT_EXACT)、ホームの要人発言の有無に関係しない。FRB と ECB を混ぜて判定しない。
 */
export interface HomeSpeechesStatus {
  window_days: number;
  last_success_at: string | null;
  stale: boolean;
}

export function toHomeSpeechesStatus(runs: readonly SpeechRunSample[], now: Date): HomeSpeechesStatus {
  const health = judgeSpeechFetch(runs, now);
  return {
    window_days: HOME_SPEECHES_WINDOW_DAYS,
    last_success_at: health.lastSuccessAt === null ? null : formatIsoSeconds(new Date(health.lastSuccessAt)),
    stale: health.failed,
  };
}
