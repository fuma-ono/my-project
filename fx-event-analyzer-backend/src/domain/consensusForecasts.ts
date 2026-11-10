/**
 * 経済指標の予測値(市場予想・公式見通し) — HQ指示 2026-11-10「経済指標の市場予測値（コンセンサス）取得」。
 *
 * 履歴は indicator_forecasts(migration 20261110000003)。取得元ごと・取得のたびに1行(上書きしない)。この module は
 * DB に触れない計算だけ: 発表前の最終予想の選び方、実績値との比較、イベントごとの予想の状態。
 *
 * 取得元の条件(HQ): 商用アプリで利用可・保存と再表示が可・公式 API または機械可読の配信・制限が明確・無料・出典を表示できる。
 * スクレイピングと条件の不明な取得元は使わない。
 */
import { calculateSurprise, type FavorableDirection, type SurpriseDirection } from './surprise.js';

export type ForecastKind = 'MARKET_CONSENSUS' | 'OFFICIAL_PROJECTION';

/** API で返すイベントごとの予想の状態。 */
export type ForecastStatus =
  /** 発表前の最終予想がある */
  | 'AVAILABLE'
  /** 条件を満たす取得元はあるが、この回の予想をまだ取得できていない */
  | 'DATA_PREPARING'
  /** 条件を満たす取得元が無い(この指標の予想は表示しない) */
  | 'UNAVAILABLE';

export interface ForecastRow {
  event_id: string;
  indicator_code: string;
  reference_period: string;
  release_datetime: string;
  forecast_kind: ForecastKind;
  forecast_value: number;
  unit: string;
  source: string;
  source_url: string;
  fetched_at: string;
}

export interface ConsensusSourceCandidate {
  name: string;
  url: string;
  verdict: 'REJECTED' | 'UNCONFIRMED';
  /** 条件のどれを満たさないか(2026-11-10 までに利用規約・料金ページで確認した内容)。 */
  reason: string;
}

/**
 * 調べた取得元(どれも採用しない)。条件をすべて満たす取得元が見つかったら、CONSENSUS_SOURCES に足し、
 * ingestion/pipelines/consensusForecasts.ts の adapter を書く。
 */
export const CONSENSUS_SOURCE_CANDIDATES: readonly ConsensusSourceCandidate[] = [
  {
    name: 'Finnhub (economic calendar)',
    url: 'https://finnhub.io/pricing',
    verdict: 'REJECTED',
    reason: '経済カレンダーは有料プラン。無料キーは個人利用に限られ、商用アプリでの再表示が認められていない',
  },
  {
    name: 'Trading Economics API',
    url: 'https://tradingeconomics.com/api/pricing.aspx',
    verdict: 'REJECTED',
    reason: '予想(consensus / forecast)を含むカレンダー API は有料契約',
  },
  {
    name: 'Investing.com economic calendar',
    url: 'https://www.investing.com/about-us/terms-and-conditions',
    verdict: 'REJECTED',
    reason: '公式 API が無く、利用規約でデータの保存・再配布を禁じている(取得はスクレイピングになる)',
  },
  {
    name: 'FXStreet economic calendar',
    url: 'https://www.fxstreet.com/terms-and-conditions',
    verdict: 'REJECTED',
    reason: '利用規約でデータの保存・再配布を禁じている。カレンダーの API は個別契約',
  },
  {
    name: 'Forex Factory calendar',
    url: 'https://www.forexfactory.com',
    verdict: 'UNCONFIRMED',
    reason: '公式 API と、商用での保存・再表示の条件を確認できない(条件不明は使わない)',
  },
  {
    name: '各国の統計機関(BLS・ONS・ABS・Statistics Canada・e-Stat・Eurostat)',
    url: 'https://www.bls.gov',
    verdict: 'REJECTED',
    reason: '実績値だけを公表し、市場予想は公表しない',
  },
  {
    name: '中央銀行の見通し(FRB の SEP・ECB/日銀の展望レポートなど)',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    verdict: 'REJECTED',
    reason: '年・四半期の見通しで、毎月の指標の回ごとの予想ではない(OFFICIAL_PROJECTION として扱える回が無い)',
  },
];

/** 採用した取得元(指標ごと)。2026-11-10 時点で空 — どの指標も UNAVAILABLE。 */
export const CONSENSUS_SOURCES: readonly { source: string; kind: ForecastKind; indicatorCodes: readonly string[] }[] =
  [];

/** 取得元・種類ごとに、発表の前に取得した最後の行(同じ時刻の行は無い: DB の unique)。 */
export function finalPreReleaseForecasts(rows: readonly ForecastRow[], releaseDatetime: string): ForecastRow[] {
  const releaseAt = Date.parse(releaseDatetime);
  const best = new Map<string, ForecastRow>();
  for (const row of rows) {
    if (row.release_datetime !== releaseDatetime && Date.parse(row.release_datetime) !== releaseAt) continue;
    if (Date.parse(row.fetched_at) >= releaseAt) continue;
    const key = `${row.source}\u0000${row.forecast_kind}`;
    const current = best.get(key);
    if (!current || Date.parse(row.fetched_at) > Date.parse(current.fetched_at)) best.set(key, row);
  }
  return [...best.values()].sort((a, b) =>
    a.forecast_kind === b.forecast_kind
      ? a.source.localeCompare(b.source)
      : a.forecast_kind === 'MARKET_CONSENSUS'
        ? -1
        : 1,
  );
}

export interface ForecastComparison {
  source: string;
  forecast_kind: ForecastKind;
  forecast: number;
  actual: number | null;
  /** actual − forecast。単位が違う・実績値が無いときは null。 */
  difference: number | null;
  direction: SurpriseDirection | null;
  unit: string;
  fetched_at: string;
}

/** 発表前の最終予想と実績値(初回値)の比較。単位が違うものは比べない。 */
export function compareForecastsWithActual(
  finals: readonly ForecastRow[],
  actual: { value: number | null; unit: string | null },
  favorableDirection: FavorableDirection,
): ForecastComparison[] {
  return finals.map((row) => {
    const comparable = actual.value !== null && actual.unit !== null && actual.unit === row.unit;
    const surprise = comparable
      ? calculateSurprise(row.forecast_value, actual.value, favorableDirection)
      : { surprise: null, direction: null };
    return {
      source: row.source,
      forecast_kind: row.forecast_kind,
      forecast: row.forecast_value,
      actual: comparable ? actual.value : null,
      difference: surprise.surprise === null ? null : Math.round(surprise.surprise * 10_000) / 10_000,
      direction: surprise.direction,
      unit: row.unit,
      fetched_at: row.fetched_at,
    };
  });
}

/** イベントごとの予想の状態。kind ごとに分ける(市場予想と公式見通しを混ぜない)。 */
export function forecastStatus(
  indicatorCode: string,
  kind: ForecastKind,
  finals: readonly ForecastRow[],
  sources: typeof CONSENSUS_SOURCES = CONSENSUS_SOURCES,
): ForecastStatus {
  const hasSource = sources.some((s) => s.kind === kind && s.indicatorCodes.includes(indicatorCode));
  if (!hasSource) return 'UNAVAILABLE';
  return finals.some((f) => f.forecast_kind === kind && f.indicator_code === indicatorCode)
    ? 'AVAILABLE'
    : 'DATA_PREPARING';
}
