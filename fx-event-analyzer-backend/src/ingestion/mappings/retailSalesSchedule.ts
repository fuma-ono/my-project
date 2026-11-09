/**
 * 米国小売売上高(速報、Advance Monthly Retail Trade Report)の公式発表日程 — HQ承認
 * 2026-11-05「US_RETAIL_SALES 公式発表日程の自動取り込み実装」。CODE-REVIEWED CONFIG
 * (mappings/fomcSchedule.ts・mappings/blsSchedule.ts と同じ): 人が公式ページを読んで書く表で、
 * 規則から推測して日付を作らない。ライブのHTML取得・解析は行わない(調査の結果、Census Bureauの
 * 発表日程ページには構造化フィード(JSON/iCal)が無く、HTML構造を検証できる環境が無かったため)。
 *
 * 公式の取得元(2026-11-05 に2回取得・内容が一致することを確認。ログイン・キー不要):
 * - https://www.census.gov/retail/release_schedule.html
 *   「Advance Monthly Retail Trade Report」の表(発表時刻はすべて8:30 a.m. Eastern)。
 *   2026年9月分〜2027年12月分までを掲載。2027年12月分は "To be announced at a later date"。
 * - robots.txt(https://www.census.gov/robots.txt)にこのページへの Disallow は無い。
 * - 利用条件: https://www.census.gov/data/developers/terms-of-service.html
 *   商用利用を明示的に禁止する記載は無い。自動取得したことを示す場合の推奨文言:
 *   "This product uses the Census Bureau Data API but is not endorsed or certified by the
 *   Census Bureau."(今回はAPIではなく公開ページの日程を使うが、出典の明示として同趣旨を守る)。
 *
 * 表に載せる条件(いずれも満たすものだけ):
 * 1. 公式ページに実際に発表日が記載されている("To be announced..." は載せない)
 * 2. 作成時点(2026-11-05)より後に発表される回だけ(既に過去の発表は新規に作らない)
 *
 * 2026年9月分(発表日 2026-10-15)は上の条件2に当たるため表から外した。表の最初の行は
 * 2026年10月分(発表日 2026-11-17)から。
 *
 * | referencePeriod(対象月) | releaseDate(公式ページの発表日) |
 * |---|---|
 * | 2026-10 | 2026-11-17 |
 * | 2026-11 | 2026-12-16 |
 * | 2026-12 | 2027-01-15 |
 * | 2027-01 | 2027-02-17 |
 * | 2027-02 | 2027-03-16 |
 * | 2027-03 | 2027-04-16 |
 * | 2027-04 | 2027-05-14 |
 * | 2027-05 | 2027-06-16 |
 * | 2027-06 | 2027-07-16 |
 * | 2027-07 | 2027-08-16 |
 * | 2027-08 | 2027-09-16 |
 * | 2027-09 | 2027-10-15 |
 * | 2027-10 | 2027-11-16 |
 * | 2027-11 | 2027-12-15 |
 *
 * (2027-12分は "To be announced" のため載せていない。公式ページに発表日が載ったら、この表に
 * 1行追記する — 15.6節(FOMC表の更新手順)と同じ考え方。Census は会合日程のような「暫定」の
 * 概念を公表していないため、`provisional` に相当するフィールドは持たない。)
 */

export const CENSUS_RETAIL_SCHEDULE_URL = 'https://www.census.gov/retail/release_schedule.html';
/** 発表時刻は毎回 8:30 a.m. Eastern(公式ページの表記どおり)。 */
export const RETAIL_SALES_ANNOUNCEMENT_TIME = '08:30';
export const RETAIL_SALES_TIME_ZONE = 'America/New_York';

export interface RetailSalesScheduleEntry {
  /** 'YYYY-MM' — 対象月(発表の内容)。発表日(releaseDate)と混同しないよう別フィールドにする。 */
  referencePeriod: string;
  /** 'YYYY-MM-DD' — 公式ページに載っている発表日(America/New_York の壁時計の日付)。 */
  releaseDate: string;
  sources: readonly string[];
  /** 'YYYY-MM-DD' 人が最後にこの行を公式ページと比べて確認した日。 */
  checkedAt: string;
}

const SOURCES = [CENSUS_RETAIL_SCHEDULE_URL] as const;
const CHECKED_AT = '2026-11-05';

function entry(referencePeriod: string, releaseDate: string): RetailSalesScheduleEntry {
  return { referencePeriod, releaseDate, sources: SOURCES, checkedAt: CHECKED_AT };
}

/**
 * 2026-11-05 時点で公式ページに実際に発表日が載っていた回のうち、作成時点より後に発表されるものだけ
 * (2026年9月分は発表日が既に過去のため載せていない。2027年12月分は "To be announced" のため載せていない)。
 */
export const RETAIL_SALES_SCHEDULE: readonly RetailSalesScheduleEntry[] = [
  entry('2026-10', '2026-11-17'),
  entry('2026-11', '2026-12-16'),
  entry('2026-12', '2027-01-15'),
  entry('2027-01', '2027-02-17'),
  entry('2027-02', '2027-03-16'),
  entry('2027-03', '2027-04-16'),
  entry('2027-04', '2027-05-14'),
  entry('2027-05', '2027-06-16'),
  entry('2027-06', '2027-07-16'),
  entry('2027-07', '2027-08-16'),
  entry('2027-08', '2027-09-16'),
  entry('2027-09', '2027-10-15'),
  entry('2027-10', '2027-11-16'),
  entry('2027-11', '2027-12-15'),
];
