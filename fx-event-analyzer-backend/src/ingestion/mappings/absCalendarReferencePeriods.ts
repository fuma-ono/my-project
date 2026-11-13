/**
 * ABS の公表カレンダー(https://www.abs.gov.au/release-calendar/future-releases/<YYYYMM>/all)の本文から、
 * 各回の対象月(Reference period)を読む規則(HQ承認 2026-11-13「AU Reference period」)。
 * ライブのページの取得はしない。規則を固定してテストするための、タグを外した本文を受け取るだけの純粋関数。
 *
 * 本文の並び: 「<曜日> <日> <月> <年> 11:30am <AEDT|AEST> <題名> <説明> Reference period <対象> View current release」。
 * 対象は、その回の題名のすぐ後ろ(次の回の前の「Reference period」は前の回のもの)。「View current release」を
 * またいで探さない(= 前後の回の対象月を取り違えない)。月単位でない対象(「December Quarter 2026」「2025-26 financial year」)は読まない。
 */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const ABS_CALENDAR_TITLES = {
  'Consumer Price Index, Australia': 'AU_CPI',
  'Labour Force, Australia': 'AU_UNEMPLOYMENT_RATE',
} as const;

export interface AbsCalendarReleasePeriod {
  indicatorCode: 'AU_CPI' | 'AU_UNEMPLOYMENT_RATE';
  /** 'YYYY-MM-DD' — ページに書かれた公表日。 */
  releaseDate: string;
  /** 'YYYY-MM' — 「Reference period <月> <年>」。 */
  referencePeriod: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function parseAbsCalendarReferencePeriods(text: string): AbsCalendarReleasePeriod[] {
  const out: AbsCalendarReleasePeriod[] = [];
  const months = MONTHS.join('|');
  const titles = Object.keys(ABS_CALENDAR_TITLES).join('|');
  const re = new RegExp(
    String.raw`\w+day (\d{1,2}) (${months}) (\d{4}) \d{1,2}:\d{2}[ap]m \w+ (${titles})((?:(?!View current release).)*?)` +
      String.raw`Reference period (${months}) (\d{4}) View current release`,
    'g',
  );
  for (const m of text.matchAll(re)) {
    const [, day, month, year, title, , refMonth, refYear] = m;
    out.push({
      indicatorCode: ABS_CALENDAR_TITLES[title as keyof typeof ABS_CALENDAR_TITLES],
      releaseDate: `${year}-${pad(MONTHS.indexOf(month as (typeof MONTHS)[number]) + 1)}-${pad(Number(day))}`,
      referencePeriod: `${refYear}-${pad(MONTHS.indexOf(refMonth as (typeof MONTHS)[number]) + 1)}`,
    });
  }
  return out;
}
