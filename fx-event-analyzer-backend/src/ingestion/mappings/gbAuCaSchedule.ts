/**
 * 英国・豪州・カナダの主要経済指標の公表予定 — HQ指示 2026-11-10「6地域の経済指標拡張・実装準備」。
 * CODE-REVIEWED CONFIG(mappings/retailSalesSchedule.ts・mappings/jpCpiSchedule.ts と同じ): 人が公式ページを読んで書く表で、
 * 規則から推測して日付を作らない。ライブのページの取得・解析はしない。2026-11-10 に公式ページで確認した回だけを載せる。
 *
 * 英国 ONS(https://www.ons.gov.uk/releasecalendar、公表予定の各回の data-gtm-release-date / release-time):
 *   - 「Consumer price inflation, UK: October 2026」2026-11-18 07:00(英国時間)だけが載っていた(11月分以降はまだ載っていない)。
 *     CPI とコアCPI は同じ公表(GB_CPI・GB_CORE_CPI の両方に同じ日時)。
 *   - 「UK Labour Market: November 2026 / December 2026 / January 2027 / February 2027」2026-11-17・12-15・2027-01-19・02-16
 *     07:00。題名の月は公表の月(失業率はその前の3か月の平均)なので、キーには公表の月を使う(対象期間を推測しない)。
 * 豪州 ABS(https://www.abs.gov.au/release-calendar/future-releases/<YYYYMM>/all、11:30am AEDT/AEST = Australia/Sydney):
 *   - 「Consumer Price Index, Australia」2026-11-25・2027-01-06・01-27・02-24・03-24・04-28
 *   - 「Labour Force, Australia」2026-11-19・12-17・2027-01-21・02-18・03-25・04-15
 *   公表予定のページから各回の対象月をはっきり読み取れなかったので、キーには公表日を使う(対象月を推測しない)。
 *   対象月(referencePeriod)は、2026-11-10 に各指標の latest-release ページ(下の ABS_LATEST_RELEASE_URLS)の
 *   「Next Release <日付> <題名>, <月> <年>」に書かれていた3回と、2026-11-13 に公表カレンダーの月別ページの
 *   「Reference period」から読んだ2027-02〜04の3回(absCalendarReferencePeriods.ts の規則)に入れる。
 * カナダ Statistics Canada(主要指標の公表予定 JSON
 *   https://www150.statcan.gc.ca/n1/dai-quo/ssi/homepage/schedule-key_indicators-eng.json の title・description・date。
 *   時刻は「The Daily is released Monday to Friday at 8:30 a.m. Eastern time」https://www150.statcan.gc.ca/n1/dai-quo/index-eng.htm):
 *   - 「Consumer Price Index」October 2026 → 2026-11-16、November → 12-14、December → 2027-01-18、January 2027 → 02-16、
 *     February 2027 → 03-15
 *   - 「Labour Force Survey」November 2026 → 2026-12-04、December → 2027-01-08、January 2027 → 02-05、February 2027 → 03-12
 *
 * 利用条件はどれも商用利用可・出典の表示が必要(migration 20261110000002 の説明)。
 */

export interface OfficialScheduleEntry {
  indicatorCode: string;
  /** provider_event_id の後ろの部分。公式ページに対象月があればそれ('YYYY-MM')、無ければ公表日('YYYY-MM-DD')。 */
  key: string;
  /**
   * HQ指示(2026-11-10「実績値の取得・保存」): その回の値の対象期間('YYYY-MM')。**公式ページに対象月が書かれている回だけ**
   * (ONS の CPI「Consumer price inflation, UK: October 2026」、StatCan の JSON の description、ABS の latest-release ページの
   * 「Next Release」)。英国の労働市場(題名の月は公表の月で、失業率の対象の3か月は公表の前の公式ページに書かれていない)と、
   * ABS の「Next Release」に載っていない先の回は undefined。
   * undefined の回は、実績値を保存しない(対象期間を照合できないため)。
   */
  referencePeriod?: string;
  /** 'YYYY-MM-DD' — 公式ページの公表日(timeZone の壁時計の日付)。 */
  releaseDate: string;
  /** 'HH:MM' — 公式ページの公表時刻。 */
  time: string;
  timeZone: string;
  sources: readonly string[];
  /** 'YYYY-MM-DD' 人が最後にこの行を公式ページと比べて確認した日。 */
  checkedAt: string;
}

export interface OfficialScheduleTable {
  provider: string;
  entries: readonly OfficialScheduleEntry[];
}

const CHECKED_AT = '2026-11-10';
export const ONS_RELEASE_CALENDAR_URL = 'https://www.ons.gov.uk/releasecalendar';
export const ABS_RELEASE_CALENDAR_URL = 'https://www.abs.gov.au/release-calendar/future-releases';
export const STATCAN_SCHEDULE_URL =
  'https://www150.statcan.gc.ca/n1/dai-quo/ssi/homepage/schedule-key_indicators-eng.json';

function rows(
  indicatorCode: string,
  time: string,
  timeZone: string,
  source: string,
  pairs: readonly (readonly [key: string, releaseDate: string])[],
  /** true = key は公式ページに書かれた対象月(referencePeriod にも入れる)。 */
  keyIsReferencePeriod = false,
): OfficialScheduleEntry[] {
  return pairs.map(([key, releaseDate]) => ({
    indicatorCode,
    key,
    releaseDate,
    time,
    timeZone,
    sources: [source],
    checkedAt: CHECKED_AT,
    ...(keyIsReferencePeriod ? { referencePeriod: key } : {}),
  }));
}

const ONS_CPI: readonly (readonly [string, string])[] = [['2026-10', '2026-11-18']];
const ONS_LABOUR_MARKET: readonly (readonly [string, string])[] = [
  ['2026-11', '2026-11-17'],
  ['2026-12', '2026-12-15'],
  ['2027-01', '2027-01-19'],
  ['2027-02', '2027-02-16'],
];

export const ONS_SCHEDULE: OfficialScheduleTable = {
  provider: 'ons_release_calendar',
  entries: [
    ...rows('GB_CPI', '07:00', 'Europe/London', ONS_RELEASE_CALENDAR_URL, ONS_CPI, true),
    ...rows('GB_CORE_CPI', '07:00', 'Europe/London', ONS_RELEASE_CALENDAR_URL, ONS_CPI, true),
    ...rows('GB_UNEMPLOYMENT_RATE', '07:00', 'Europe/London', ONS_RELEASE_CALENDAR_URL, ONS_LABOUR_MARKET),
  ],
};

const byDate = (dates: readonly string[]) => dates.map((date) => [date, date] as const);

export const ABS_LATEST_RELEASE_URLS = {
  AU_CPI:
    'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release',
  AU_UNEMPLOYMENT_RATE:
    'https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia/latest-release',
} as const;

/** 公表日 → 対象月(latest-release ページの「Next Release」の題名の月。2026-11-10 確認)。 */
const ABS_REFERENCE_PERIODS: Record<string, Record<string, string>> = {
  // 「Consumer Price Index, Australia, October 2026」25/11/2026 ・ November 2026 6/01/2027 ・ December 2026 27/01/2027
  AU_CPI: { '2026-11-25': '2026-10', '2027-01-06': '2026-11', '2027-01-27': '2026-12' },
  // 「Labour Force, Australia, October 2026」19/11/2026 ・ November 2026 17/12/2026 ・ December 2026 21/01/2027
  AU_UNEMPLOYMENT_RATE: { '2026-11-19': '2026-10', '2026-12-17': '2026-11', '2027-01-21': '2026-12' },
};

/**
 * 公表日 → 対象月(ABS の公表カレンダーの月別ページ「Reference period」。2026-11-13 確認、HQ承認)。
 * 読み取りの規則は absCalendarReferencePeriods.ts。登録済みの6回(上の latest-release 由来)も、同じ規則で全件一致することをテストで確かめる。
 * provider_event_id の key は公表日のまま(対象月は referencePeriod に入れるだけで、既存のイベントの識別子は変わらない)。
 */
const ABS_CALENDAR_REFERENCE_PERIODS: Record<string, Record<string, string>> = {
  AU_CPI: { '2027-02-24': '2027-01', '2027-03-24': '2027-02', '2027-04-28': '2027-03' },
  AU_UNEMPLOYMENT_RATE: { '2027-02-18': '2027-01', '2027-03-25': '2027-02', '2027-04-15': '2027-03' },
};

export const absCalendarMonthUrl = (releaseDate: string): string =>
  `${ABS_RELEASE_CALENDAR_URL}/${releaseDate.slice(0, 4)}${releaseDate.slice(5, 7)}/all`;

const withAbsPeriods = (entries: OfficialScheduleEntry[]): OfficialScheduleEntry[] =>
  entries.map((e) => {
    const latest = ABS_REFERENCE_PERIODS[e.indicatorCode]?.[e.releaseDate];
    if (latest) {
      return {
        ...e,
        referencePeriod: latest,
        sources: [...e.sources, ABS_LATEST_RELEASE_URLS[e.indicatorCode as keyof typeof ABS_LATEST_RELEASE_URLS]],
      };
    }
    const calendar = ABS_CALENDAR_REFERENCE_PERIODS[e.indicatorCode]?.[e.releaseDate];
    return calendar
      ? {
          ...e,
          referencePeriod: calendar,
          sources: [...e.sources, absCalendarMonthUrl(e.releaseDate)],
          checkedAt: '2026-11-13',
        }
      : e;
  });

export const ABS_SCHEDULE: OfficialScheduleTable = {
  provider: 'abs_release_calendar',
  entries: withAbsPeriods([
    ...rows(
      'AU_CPI',
      '11:30',
      'Australia/Sydney',
      ABS_RELEASE_CALENDAR_URL,
      byDate(['2026-11-25', '2027-01-06', '2027-01-27', '2027-02-24', '2027-03-24', '2027-04-28']),
    ),
    ...rows(
      'AU_UNEMPLOYMENT_RATE',
      '11:30',
      'Australia/Sydney',
      ABS_RELEASE_CALENDAR_URL,
      byDate(['2026-11-19', '2026-12-17', '2027-01-21', '2027-02-18', '2027-03-25', '2027-04-15']),
    ),
  ]),
};

export const STATCAN_SCHEDULE: OfficialScheduleTable = {
  provider: 'statcan_release_schedule',
  entries: [
    ...rows(
      'CA_CPI',
      '08:30',
      'America/Toronto',
      STATCAN_SCHEDULE_URL,
      [
        ['2026-10', '2026-11-16'],
        ['2026-11', '2026-12-14'],
        ['2026-12', '2027-01-18'],
        ['2027-01', '2027-02-16'],
        ['2027-02', '2027-03-15'],
      ],
      true,
    ),
    ...rows(
      'CA_UNEMPLOYMENT_RATE',
      '08:30',
      'America/Toronto',
      STATCAN_SCHEDULE_URL,
      [
        ['2026-11', '2026-12-04'],
        ['2026-12', '2027-01-08'],
        ['2027-01', '2027-02-05'],
        ['2027-02', '2027-03-12'],
      ],
      true,
    ),
  ],
};

export const GB_AU_CA_SCHEDULES: readonly OfficialScheduleTable[] = [ONS_SCHEDULE, ABS_SCHEDULE, STATCAN_SCHEDULE];
