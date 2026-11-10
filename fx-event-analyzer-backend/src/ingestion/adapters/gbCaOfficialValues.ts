/**
 * 英国 ONS・カナダ Statistics Canada の公式の時系列 API から、発表値を読む(HQ指示 2026-11-10「6地域の経済指標拡張・
 * 実装準備」)。公表予定(mappings/gbAuCaSchedule.ts)とは別の処理。キー・契約・有料 API なし。
 *
 * **その回の公表日と、API が示す公表日が一致したときだけ**値を返す(前の回の値を今回の値として使わない・推測しない)。
 *
 * - ONS(https://www.ons.gov.uk/<path>/timeseries/<cdid>/<dataset>/data、JSON): `description.releaseDate`(公表の日時、UTC)を
 *   英国時間の日付にして比べる。値は `months` の最後の行(`updateDate` が公表日と同じ日のもの)。系列(2026-11-10 に API で確認):
 *   GB_CPI = D7G7「CPI ANNUAL RATE 00: ALL ITEMS 2015=100」(%)、GB_CORE_CPI = DKO8「CPI 12mth: Excluding Energy, food,
 *   alcoholic beverages & tobacco」(%)、GB_UNEMPLOYMENT_RATE = MGSX「Unemployment rate (aged 16 and over, seasonally
 *   adjusted)」(%)。
 * - Statistics Canada(Web Data Service、POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods):
 *   点の `releaseTime`(東部時間の壁時計 'YYYY-MM-DDTHH:MM')の日付で比べる。系列(2026-11-10 に getSeriesInfoFromVector で
 *   確認): CA_UNEMPLOYMENT_RATE = v2062815「Canada;Unemployment rate;Total - Gender;15 years and over;Estimate;Seasonally
 *   adjusted」(%)。CA_CPI は公式 API に前年比の系列が見つからず(指数 v41690973 だけ)、前年比を計算で作らないため対象外。
 * - 豪州 ABS の値は、データの API(SDMX)の系列をまだ確かめていないため対象外。
 */

export interface OfficialValue {
  indicatorCode: string;
  seriesId: string;
  /** 'YYYY-MM' — 値の対象月(ONS は 'YYYY MON' を、StatCan は 'YYYY-MM-01' を変換)。 */
  period: string;
  value: number;
  /** API が示す公表日('YYYY-MM-DD'、公表元の現地の日付)。 */
  releasedOn: string;
  sourceUrl: string;
}

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface OnsSeries {
  indicatorCode: string;
  cdid: string;
  path: string;
}

export const ONS_SERIES: readonly OnsSeries[] = [
  { indicatorCode: 'GB_CPI', cdid: 'D7G7', path: 'economy/inflationandpriceindices/timeseries/d7g7/mm23' },
  { indicatorCode: 'GB_CORE_CPI', cdid: 'DKO8', path: 'economy/inflationandpriceindices/timeseries/dko8/mm23' },
  {
    indicatorCode: 'GB_UNEMPLOYMENT_RATE',
    cdid: 'MGSX',
    path: 'employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms',
  },
];

export const onsSeriesUrl = (series: OnsSeries) => `https://www.ons.gov.uk/${series.path}/data`;

/**
 * ONS の時系列の JSON → その公表日(英国時間の 'YYYY-MM-DD')の値。系列が違う・公表日が違う・値が数でない・最後の行の
 * updateDate が公表日と違う、のどれかなら null。
 */
export function parseOnsValueForRelease(series: OnsSeries, body: unknown, releaseDate: string): OfficialValue | null {
  const json = body as {
    description?: { cdid?: string; releaseDate?: string };
    months?: { date?: string; value?: string; updateDate?: string }[];
  };
  if (json?.description?.cdid?.toUpperCase() !== series.cdid) return null;
  const releasedAt = json.description.releaseDate ? new Date(json.description.releaseDate) : null;
  if (!releasedAt || Number.isNaN(releasedAt.getTime())) return null;
  const releasedOn = localDate(releasedAt, 'Europe/London');
  if (releasedOn !== releaseDate) return null; // まだ今回の公表の値になっていない
  const last = json.months?.at(-1);
  const match = last?.date ? /^(\d{4}) ([A-Z]{3})$/.exec(last.date.trim().toUpperCase()) : null;
  if (!last || !match || !MONTHS[match[2]!]) return null;
  if (!last.updateDate || localDate(new Date(last.updateDate), 'Europe/London') !== releaseDate) return null;
  const value = Number(last.value);
  if (last.value === undefined || last.value.trim() === '' || !Number.isFinite(value)) return null;
  return {
    indicatorCode: series.indicatorCode,
    seriesId: series.cdid,
    period: `${match[1]}-${MONTHS[match[2]!]}`,
    value,
    releasedOn,
    sourceUrl: onsSeriesUrl(series),
  };
}

export interface StatcanSeries {
  indicatorCode: string;
  vectorId: number;
}

export const STATCAN_SERIES: readonly StatcanSeries[] = [{ indicatorCode: 'CA_UNEMPLOYMENT_RATE', vectorId: 2062815 }];
export const STATCAN_WDS_URL = 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods';

/**
 * Statistics Canada の getDataFromVectorsAndLatestNPeriods の応答 → その公表日(東部時間の 'YYYY-MM-DD')の値。
 * 系列が違う・status が SUCCESS でない・最後の点の releaseTime の日付が公表日と違う・値が数でない、のどれかなら null。
 */
export function parseStatcanValueForRelease(
  series: StatcanSeries,
  body: unknown,
  releaseDate: string,
): OfficialValue | null {
  const items = Array.isArray(body) ? (body as unknown[]) : [];
  const item = items.find(
    (entry) => (entry as { object?: { vectorId?: number } })?.object?.vectorId === series.vectorId,
  ) as
    | {
        status?: string;
        object?: { vectorDataPoint?: { refPer?: string; value?: number | null; releaseTime?: string }[] };
      }
    | undefined;
  if (!item || item.status !== 'SUCCESS') return null;
  const last = item.object?.vectorDataPoint?.at(-1);
  if (!last?.refPer || !last.releaseTime) return null;
  const period = /^(\d{4})-(\d{2})-\d{2}$/.exec(last.refPer);
  if (!period || last.releaseTime.slice(0, 10) !== releaseDate) return null;
  if (typeof last.value !== 'number' || !Number.isFinite(last.value)) return null;
  return {
    indicatorCode: series.indicatorCode,
    seriesId: `v${series.vectorId}`,
    period: `${period[1]}-${period[2]}`,
    value: last.value,
    releasedOn: releaseDate,
    sourceUrl: STATCAN_WDS_URL,
  };
}
