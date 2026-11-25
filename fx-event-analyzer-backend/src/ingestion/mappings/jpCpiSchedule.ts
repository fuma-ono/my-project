/**
 * 日本の消費者物価指数(全国、総務省統計局)の公表予定 — HQ指示 2026-11-10「経済指標の網羅性改善」。
 * CODE-REVIEWED CONFIG(mappings/retailSalesSchedule.ts・mappings/fomcSchedule.ts と同じ): 人が公式ページを読んで書く表で、
 * 規則から推測して日付を作らない。ライブの HTML の取得・解析はしない。
 *
 * 公式の取得元(2026-11-10 に確認。ログイン・キー不要):
 * - https://www.e-stat.go.jp/release-calendar/statistics/00200573 (政府統計の総合窓口 e-Stat の公表予定、消費者物価指数)
 *   「全国」の各月分の公表日と時刻(どれも 08:30)。統計局の CPI のページ(https://www.stat.go.jp/data/cpi/1.html)も
 *   公表予定はこのカレンダーへ案内している。
 * - 時刻の基準: ページに「日本時間」の明記は無い。日本の政府統計の公表時刻なので Asia/Tokyo とした(HQ に報告済み。
 *   DEV に入れる前に確認する)。
 * - 利用条件: e-Stat 利用規約(https://www.e-stat.go.jp/terms-of-use、政府標準利用規約 第2.0版に準拠): 「商用利用も可能です。」。
 *   出典の記載が必要(例「出典：政府統計の総合窓口(e-Stat)」)。表示の出典(attribution)は別ブランチで付ける。
 *
 * 表に載せる条件(いずれも満たすものだけ):
 * 1. 公式ページに実際に公表日が載っている「全国」の「各月分」(年平均・年度平均・東京都区部・遡及結果は載せない)
 * 2. 作成時点(2026-11-10)より後に公表される回だけ
 *
 * | referencePeriod(対象月) | releaseDate(公表日) |
 * |---|---|
 * | 2026-10 | 2026-11-20 |
 * | 2026-11 | 2026-12-18 |
 * | 2026-12 | 2027-01-22 |
 * | 2027-01 | 2027-02-19 |
 * | 2027-02 | 2027-03-19 |
 *
 * (2027年3月分以降は、ページにまだ載っていない。載ったら1行ずつ追記する。)
 */

export const ESTAT_CPI_SCHEDULE_URL = 'https://www.e-stat.go.jp/release-calendar/statistics/00200573';
/** 公表時刻は毎回 08:30(公式ページの表記どおり)。 */
export const JP_CPI_ANNOUNCEMENT_TIME = '08:30';
/** ページに明記は無いが、日本の政府統計の公表時刻なので日本時間(上の説明)。 */
export const JP_CPI_TIME_ZONE = 'Asia/Tokyo';

export interface JpCpiScheduleEntry {
  /** 'YYYY-MM' — 対象月(公表の内容)。公表日と混同しないよう別のフィールドにする。 */
  referencePeriod: string;
  /** 'YYYY-MM-DD' — 公式ページに載っている公表日(Asia/Tokyo の日付)。 */
  releaseDate: string;
  sources: readonly string[];
  /** 'YYYY-MM-DD' 人が最後にこの行を公式ページと比べて確認した日。 */
  checkedAt: string;
}

const SOURCES = [ESTAT_CPI_SCHEDULE_URL] as const;
const CHECKED_AT = '2026-11-10';

function entry(referencePeriod: string, releaseDate: string): JpCpiScheduleEntry {
  return { referencePeriod, releaseDate, sources: SOURCES, checkedAt: CHECKED_AT };
}

/** 2026-11-10 時点で公式ページに公表日が載っていた「全国」の各月分のうち、これから公表されるもの。 */
export const JP_CPI_SCHEDULE: readonly JpCpiScheduleEntry[] = [
  entry('2026-10', '2026-11-20'),
  entry('2026-11', '2026-12-18'),
  entry('2026-12', '2027-01-22'),
  entry('2027-01', '2027-02-19'),
  entry('2027-02', '2027-03-19'),
];
