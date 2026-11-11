/**
 * 豪州 ABS のデータの API(SDMX、https://data.api.abs.gov.au/rest/data/…)から発表値を読む(HQ追加指示 2026-11-10
 * 「経済指標データ機能の残課題整理」)。キー・契約・有料 API なし。利用条件は CC BY 4.0(migration 20261110000002)。
 *
 * 系列(2026-11-10 に API の構造定義と、公式ページの数字で確認):
 *   - AU_CPI = dataflow CPI 2.0.0、キー 3.10001.10.50.M(MEASURE 3「Percentage change from previous year」・INDEX 10001
 *     「All groups CPI」・TSEST 10「Original」・REGION 50「Australia」・月次)。単位 PCT。2026-09 = 4.3 は
 *     「Consumer Price Index, Australia, September 2026」の「The Consumer Price Index (CPI) rose 4.3%」と一致。
 *   - AU_UNEMPLOYMENT_RATE = dataflow LF 1.0.0、キー M13.3.1599.20.AUS.M(M13「Unemployment rate」・Persons・Total (age)・
 *     TSEST 20「Seasonally Adjusted」・Australia・月次)。単位 PCT。値は丸める前の数(4.71834873)で、観測の属性 DECIMALS(1)の
 *     桁に丸めると公式ページの「the unemployment rate increased 0.1ppt to 4.7%」と一致。
 *
 * 公表日の照合: SDMX の値には公表日が無い。代わりに `updatedAfter=<公表日の 00:00(シドニー)>` で問い合わせ、**その時刻より
 * 後に更新された系列だけ**を受け取る(公表の前は 404 NoRecordsFound)。2026-11-10 に確認: CPI は updatedAfter=2026-10-28 で
 * 返り(10/28 公表)・11-05 では 404、LF は 2026-10-15 で返り(10/15 公表)・10-16 では 404。
 * 対象期間の照合: 公表予定の表の referencePeriod(ABS の各指標の latest-release ページの「Next Release <日付> <題名>, <月> <年>」
 * を人が読んで書いた)と、更新された観測の最後の月を比べる(pipelines/officialValues.ts)。
 * updatedAfter の応答は差分(action Delete の dataSet と Replace の dataSet。Replace には更新された観測だけがあり、系列の
 * UNIT_MEASURE が空のことがある — 2026-11-10 に LF で確認)。そのため差分は「その月が公表日に更新された」ことの確認だけに使い、
 * 値・単位・桁は系列全体の応答(absSeriesUrl)から読む。2つの値が一致しなければ保存しない。
 */
import { zonedWallTimeToUtc } from '../time.js';
import type { OfficialValue } from './gbCaOfficialValues.js';

export interface AbsSeries {
  indicatorCode: string;
  dataflow: string;
  key: string;
}

export const ABS_SERIES: readonly AbsSeries[] = [
  { indicatorCode: 'AU_CPI', dataflow: 'ABS,CPI,2.0.0', key: '3.10001.10.50.M' },
  { indicatorCode: 'AU_UNEMPLOYMENT_RATE', dataflow: 'ABS,LF,1.0.0', key: 'M13.3.1599.20.AUS.M' },
];

export const ABS_SDMX_ACCEPT = 'application/vnd.sdmx.data+json';
const BASE = 'https://data.api.abs.gov.au/rest/data';

/** 改定の確認用(直近13か月)。 */
export const absSeriesUrl = (series: AbsSeries) => `${BASE}/${series.dataflow}/${series.key}?lastNObservations=13`;

/** 公表日の照合用: 公表日の 00:00(シドニー)より後に更新された系列だけを返す URL。 */
export function absReleaseUrl(series: AbsSeries, releaseDate: string): string | null {
  const [y, m, d] = releaseDate.split('-').map(Number);
  const start = zonedWallTimeToUtc(y!, m!, d!, 0, 0, 'Australia/Sydney');
  if (!start) return null;
  return `${BASE}/${series.dataflow}/${series.key}?updatedAfter=${start.toISOString().replace('.000Z', 'Z')}&lastNObservations=13`;
}

interface SdmxAttr {
  id: string;
  values?: { id?: string }[];
}
interface SdmxDataSet {
  action?: string;
  series?: Record<string, { attributes?: (number | null)[]; observations?: Record<string, unknown[]> }>;
}
interface SdmxStructure {
  dimensions?: { observation?: { id: string; values: { id: string }[] }[] };
  attributes?: { series?: SdmxAttr[]; observation?: SdmxAttr[] };
}
interface RawObservation {
  raw: number;
  decimals: number | null;
}

/**
 * 系列1本の観測(月 → 丸める前の値と DECIMALS)。action が Delete の dataSet は読まない(updatedAfter の応答は差分で、
 * 消えた観測の Delete と、更新された観測の Replace に分かれて返る)。unit = 系列の UNIT_MEASURE(差分の応答では空のことがある)。
 */
function readSeries(body: unknown): { unit: string | null; observations: Map<string, RawObservation> } | null {
  const data = (body as { data?: { dataSets?: SdmxDataSet[]; structures?: SdmxStructure[] } } | null)?.data;
  const structure = data?.structures?.[0];
  const times = structure?.dimensions?.observation?.find((d) => d.id === 'TIME_PERIOD')?.values;
  const dataSets = (data?.dataSets ?? []).filter((d) => d.action !== 'Delete');
  const seriesList = dataSets.flatMap((d) => Object.values(d.series ?? {}));
  if (seriesList.length !== 1 || !times) return null; // 系列は1本だけのはず
  const series = seriesList[0]!;

  const seriesAttrs = structure?.attributes?.series ?? [];
  const unitIdx = seriesAttrs.findIndex((a) => a.id === 'UNIT_MEASURE');
  const unitPos = unitIdx < 0 ? null : series.attributes?.[unitIdx];
  const unit = unitPos === null || unitPos === undefined ? null : (seriesAttrs[unitIdx]!.values?.[unitPos]?.id ?? null);

  const obsAttrs = structure?.attributes?.observation ?? [];
  const decIdx = obsAttrs.findIndex((a) => a.id === 'DECIMALS');
  const observations = new Map<string, RawObservation>();
  for (const [index, obs] of Object.entries(series.observations ?? {})) {
    const period = times[Number(index)]?.id;
    const raw = obs[0];
    if (!period || !/^\d{4}-\d{2}$/.test(period) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const decPos = decIdx < 0 ? null : (obs[decIdx + 1] as number | null | undefined);
    const decId = decPos === null || decPos === undefined ? undefined : obsAttrs[decIdx]!.values?.[decPos]?.id;
    const decimals = decId === undefined ? null : Number(decId);
    observations.set(period, { raw, decimals: Number.isInteger(decimals) ? decimals : null });
  }
  return { unit, observations };
}

const rounded = (o: RawObservation) => (o.decimals === null ? o.raw : Number(o.raw.toFixed(o.decimals)));

/** 系列全体の応答(absSeriesUrl)から、単位が PCT のときだけ、その月の公表の桁の値。 */
export function absValueForPeriod(series: AbsSeries, body: unknown, period: string): number | null {
  void series;
  const read = readSeries(body);
  if (!read || read.unit !== 'PCT') return null; // 単位が明確でないものは使わない
  const o = read.observations.get(period);
  return o ? rounded(o) : null;
}

/**
 * 公表の回の値。releaseBody = absReleaseUrl の応答(公表日の 00:00(シドニー)より後に更新された観測だけ)、
 * fullBody = absSeriesUrl の応答(単位・桁を読む)。更新された観測のうち最後の月を、その回の値とする。
 * 次のどれかなら null(保存しない): 更新された観測が無い・系列全体の単位が PCT でない・系列全体にその月が無い・
 * 差分と系列全体の値が違う(2つの問い合わせの間に公表が入った、など)。
 * 公表日そのものは API に無いので、releasedOn には照合に使った公表日を入れる。
 */
export function parseAbsValueForRelease(
  series: AbsSeries,
  releaseBody: unknown,
  releaseDate: string,
  fullBody: unknown,
): OfficialValue | null {
  const updated = readSeries(releaseBody);
  const full = readSeries(fullBody);
  if (!updated || updated.observations.size === 0 || !full || full.unit !== 'PCT') return null;
  const period = [...updated.observations.keys()].sort().at(-1)!;
  const inFull = full.observations.get(period);
  if (!inFull || inFull.raw !== updated.observations.get(period)!.raw) return null;
  return {
    indicatorCode: series.indicatorCode,
    seriesId: `${series.dataflow}/${series.key}`,
    period,
    value: rounded(inFull),
    releasedOn: releaseDate,
    sourceUrl: absSeriesUrl(series),
  };
}
