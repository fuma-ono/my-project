/**
 * 初回値の受付期間(設計書 ca-cpi-detailed-design.md §15.2・§16.7)。1つの設定 `firstValueWindow` に一元化する。
 *
 * - ELAPSED: 公表からの経過時間(ミリ秒)で測る。ABS の既存の挙動(7日 = 7×86,400,000 ms。超えたら受け付けない)。
 * - LOCAL_CALENDAR: 指定した時刻帯(CA は America/Toronto)の暦日の差で測る。daysAfter = 今日の暦日 − 公表日の暦日。
 *   0 ≤ daysAfter ≤ days なら受け付ける(days = 7 なら、公表日の7日後の現地 23:59:59 まで)。夏時間・UTC の日付に影響されない。
 *
 * 設定漏れは起動時に例外で止める(FIRST_VALUE_WINDOW_MISSING。取得・書き込みの前)。
 */
export interface FirstValueWindow {
  /** 正の整数 */
  days: number;
  basis: 'ELAPSED' | 'LOCAL_CALENDAR';
  /** LOCAL_CALENDAR のとき必須(IANA 名) */
  timeZone?: string;
}

export const CA_FIRST_VALUE_WINDOW: FirstValueWindow = {
  days: 7,
  basis: 'LOCAL_CALENDAR',
  timeZone: 'America/Toronto',
};

/** 公表日に拘束されない(受付期間を設けない)系列。ここに無い系列で設定が無いものは、起動時に止める。 */
export const FIRST_VALUE_WINDOW_EXEMPT: readonly string[] = [
  'GB_CPI',
  'GB_CORE_CPI',
  'GB_UNEMPLOYMENT_RATE',
  'GB_GDP_MOM',
  'GB_RETAIL_SALES_MOM',
  'CA_UNEMPLOYMENT_RATE',
];

export class FirstValueWindowError extends Error {
  constructor(
    readonly code: 'FIRST_VALUE_WINDOW_MISSING' | 'FIRST_VALUE_WINDOW_INVALID',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'FirstValueWindowError';
  }
}

export function validateFirstValueWindow(indicatorCode: string, window: FirstValueWindow): void {
  const bad = (reason: string) =>
    new FirstValueWindowError('FIRST_VALUE_WINDOW_INVALID', `${indicatorCode}: ${reason}`);
  if (!Number.isInteger(window.days) || window.days <= 0) throw bad('days must be a positive integer');
  if (window.basis !== 'ELAPSED' && window.basis !== 'LOCAL_CALENDAR')
    throw bad('basis must be ELAPSED or LOCAL_CALENDAR');
  if (window.basis === 'LOCAL_CALENDAR') {
    if (!window.timeZone) throw bad('timeZone is required for LOCAL_CALENDAR');
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: window.timeZone });
    } catch {
      throw bad('timeZone is not a valid IANA time zone');
    }
  }
}

/** 取得・書き込みの前に呼ぶ。設定が無い系列(免除リストに無いもの)・不正な設定があれば例外。 */
export function validateFirstValueWindows(
  sources: readonly { indicatorCode: string; firstValueWindow?: FirstValueWindow | undefined }[],
  exempt: readonly string[] = FIRST_VALUE_WINDOW_EXEMPT,
): void {
  for (const source of sources) {
    if (!source.firstValueWindow) {
      if (exempt.includes(source.indicatorCode)) continue;
      throw new FirstValueWindowError('FIRST_VALUE_WINDOW_MISSING', source.indicatorCode);
    }
    validateFirstValueWindow(source.indicatorCode, source.firstValueWindow);
  }
}

/** 'YYYY-MM-DD'(指定した時刻帯の暦日) */
export function localCalendarDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** 暦日の差(todayLocal − releaseLocal)。時刻・夏時間に影響されない。 */
export function localDaysAfter(release: Date, now: Date, timeZone: string): number {
  return dayNumber(localCalendarDay(now, timeZone)) - dayNumber(localCalendarDay(release, timeZone));
}

/** 受付期間を過ぎたか(過ぎたら TOO_LATE_FOR_FIRST_RELEASE。書かず PENDING のまま) */
export function isFirstValueWindowExpired(window: FirstValueWindow, release: Date, now: Date): boolean {
  if (window.basis === 'ELAPSED') return now.getTime() - release.getTime() > window.days * 86_400_000;
  return localDaysAfter(release, now, window.timeZone!) > window.days;
}

/** 'YYYY-MM-DD' に日数を足す(暦日の計算) */
export function addCalendarDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);
}
