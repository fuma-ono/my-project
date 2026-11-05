/**
 * NY連銀 Markets Data API の EFFR の記録から、FOMC の誘導目標レンジを読む(HQ承認 2026-11-05「FOMC政策金利の
 * 実データ取り込み」案A)。
 *
 *   GET https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *   → { refRates: [{ effectiveDate: "2026-09-17", type: "EFFR", percentRate: 3.88,
 *                    targetRateFrom: 3.75, targetRateTo: 4.00, … }] }
 *
 * - 仕様: https://markets.newyorkfed.org/static/docs/markets-api.html(markets-api.yml の effr-record)。
 *   仕様は項目名と型だけで説明が無い。実績の項目は仕様では `percent`、実際の応答は `percentRate`(2026-11-05 確認)。
 * - targetRateFrom / targetRateTo = その effectiveDate に有効だった、FOMC が決めたフェデラルファンド金利の誘導目標
 *   レンジの下限・上限(%)。NY連銀の EFFR のページ「The Federal Open Market Committee establishes the target
 *   rate, or range, for trading in the federal funds market.」。percentRate(EFFR = 実際の取引の加重中央値)は
 *   誘導目標ではないので読まない。
 * - 公開: その日の値は翌営業日の 9:00 a.m.(ニューヨーク)ごろ。キー不要。
 * - 規約(newyorkfed.org/privacy/termsofuse): 業務での利用・自動取得・再配布は可。出典と告知・免責文を付ける
 *   (domain/attribution.ts の NY_FED_ATTRIBUTION)。
 *
 * 値が読めない記録(数値でない・欠けている・下限 ≥ 上限・負・25% 超・日付が不正)は `skipped` に入れ、値を補わない。
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';

export const NY_FED_EFFR_SEARCH_URL = 'https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json';

export interface NyFedTargetRange {
  /** 'YYYY-MM-DD'(ニューヨークの日付)。 */
  effectiveDate: string;
  /** targetRateFrom(%)。 */
  lower: number;
  /** targetRateTo(%)。 */
  upper: number;
}

export interface NyFedTargetRangeResult {
  ranges: NyFedTargetRange[];
  skipped: {
    effectiveDate: string | null;
    reason: 'DATE_INVALID' | 'RANGE_MISSING' | 'RANGE_INVALID' | 'DUPLICATE_DATE';
  }[];
}

const responseSchema = z.object({
  refRates: z.array(
    z
      .object({
        effectiveDate: z.unknown().optional(),
        type: z.unknown().optional(),
        targetRateFrom: z.unknown().optional(),
        targetRateTo: z.unknown().optional(),
      })
      .passthrough(),
  ),
});

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? value : null;
}

/** EFFR の記録(type "EFFR")だけを読む。日付の昇順。同じ日付が2つあり値が違えば、その日は使わない。 */
export function parseNyFedTargetRanges(body: unknown): NyFedTargetRangeResult {
  const parsed = responseSchema.parse(body);
  const byDate = new Map<string, NyFedTargetRange>();
  const conflicted = new Set<string>();
  const skipped: NyFedTargetRangeResult['skipped'] = [];
  for (const record of parsed.refRates) {
    if (record.type !== undefined && record.type !== 'EFFR') continue;
    const effectiveDate = validDate(record.effectiveDate);
    if (!effectiveDate) {
      skipped.push({ effectiveDate: null, reason: 'DATE_INVALID' });
      continue;
    }
    const { targetRateFrom: lower, targetRateTo: upper } = record;
    if (typeof lower !== 'number' || typeof upper !== 'number') {
      skipped.push({ effectiveDate, reason: 'RANGE_MISSING' });
      continue;
    }
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower < 0 || upper <= lower || upper > 25) {
      skipped.push({ effectiveDate, reason: 'RANGE_INVALID' });
      continue;
    }
    const existing = byDate.get(effectiveDate);
    if (existing && (existing.lower !== lower || existing.upper !== upper)) {
      conflicted.add(effectiveDate);
      continue;
    }
    byDate.set(effectiveDate, { effectiveDate, lower, upper });
  }
  for (const date of conflicted) {
    byDate.delete(date);
    skipped.push({ effectiveDate: date, reason: 'DUPLICATE_DATE' });
  }
  const ranges = [...byDate.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return { ranges, skipped };
}

export function nyFedEffrSearchUrl(startDate: string, endDate: string): string {
  return `${NY_FED_EFFR_SEARCH_URL}?startDate=${startDate}&endDate=${endDate}`;
}

/** startDate〜endDate(両端を含む)の EFFR の記録を1回取る(取れなければ HttpError などを投げる)。 */
export async function fetchNyFedTargetRanges(
  startDate: string,
  endDate: string,
  deps: HttpClientDeps = {},
): Promise<NyFedTargetRangeResult> {
  const http = new HttpClient('nyfed', PROVIDER_HTTP_SETTINGS.nyfed, deps);
  return parseNyFedTargetRanges(await http.getJson(nyFedEffrSearchUrl(startDate, endDate)));
}
