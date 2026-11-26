/**
 * 日銀・ECB の金融政策会合の日程の表示(HQ指示 2026-11-26)。`GET /events/{id}` の `event.meeting`。
 * 出すのは会合の期間(現地の日付)・出典の機関名・公式ページの https の URL だけ。時刻・政策金利の値・予想・結果は出さない
 * (決定の公表時刻は未確認。release_datetime_precision = DATE_ONLY)。公開された内容は加工しない。
 * 対象は provider が boj_meeting_schedule / ecb_meeting_schedule の予定だけ。ほかのイベントは `meeting` を付けない(null)。
 */
export interface EventMeeting {
  /** 会合の初日(現地の日付、YYYY-MM-DD)。 */
  start_date: string;
  /** 会合の最終日(現地の日付、YYYY-MM-DD)。 */
  end_date: string;
  /** 公式ページ(https のみ)。 */
  source_url: string;
  /** 出典の機関名(表示用)。 */
  source_name: string;
}

const MEETING_SOURCE_NAMES: Readonly<Record<string, string>> = {
  boj_meeting_schedule: '日本銀行',
  ecb_meeting_schedule: '欧州中央銀行(ECB)',
};

export function isMeetingProvider(provider: string | null | undefined): boolean {
  return typeof provider === 'string' && Object.hasOwn(MEETING_SOURCE_NAMES, provider);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 行が不正(日付の形・https でない・期間が逆)なら null(会合の表示を出さない)。 */
export function buildEventMeeting(
  provider: string | null | undefined,
  row: { meeting_start_date: unknown; meeting_end_date: unknown; source_url: unknown } | null,
): EventMeeting | null {
  const sourceName = provider ? MEETING_SOURCE_NAMES[provider] : undefined;
  if (!row || sourceName === undefined) return null;
  const { meeting_start_date: start, meeting_end_date: end, source_url: url } = row;
  if (typeof start !== 'string' || typeof end !== 'string' || typeof url !== 'string') return null;
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end) || end < start) return null;
  if (!url.startsWith('https://')) return null;
  return { start_date: start, end_date: end, source_url: url, source_name: sourceName };
}
