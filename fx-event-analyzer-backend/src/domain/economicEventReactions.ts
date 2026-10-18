import { availableTimeframes, type ReleaseDatetimePrecision } from './dataQuality.js';
import { calculateMaxExcursion, calculateReaction } from './reaction.js';
import {
  closeTimeMs,
  pipSizeForSymbol,
  round,
  selectPreStatementPrice,
  selectPriceAt,
  TIMEFRAME_MINUTES,
  type PriceCandle,
  type SpeechReactionTimeframe,
} from './speechReactions.js';

/**
 * 経済指標の価格反応(event_price_reactions)の計算 — HQ決定(2026-10-18
 * 「経済指標の価格反応実装と異常系テストを進める」)。
 *
 * db-design.md §3.12 は「Ingestion Workerが計算して書き込む」と既に明記していたが、
 * 書き込むジョブがこれまで存在しなかった(data-quality-verification-2026-10-17.md
 * §9.2で判明)。要人発言側(speechReactions.ts)が既に実装・テスト済みの
 * 「fx_pricesのtimestampは足の開始、価格は対象時刻に終わる足のclose」という
 * 計測基準と、pips/変化率/最大上昇・下降幅の計算ロジックをそのまま再利用する
 * (closeTimeMs/selectPreStatementPrice/selectPriceAt/pipSizeForSymbol/round/
 * calculateReaction/calculateMaxExcursion — いずれも変更していない)。
 *
 * 要人発言との違いは2点だけ:
 * 1. 対象はRELEASED(確定済み)のイベントのみ。呼び出し側がstatus==='RELEASED'
 *    でない限りこの関数を呼ばないことを前提とする(将来のイベントに実績の価格
 *    反応を生成しない、というHQ条件を呼び出し側の責務にする)。
 * 2. release_datetime_precisionがEXACTでない場合、精度上その時間枠を分析できない
 *    (dataQuality.tsのavailableTimeframes、既存のAPIの読み取り側と同じ判定を
 *    先取りして使う)。推測値を作らないため、精度で除外された時間枠は計算も
 *    書き込みも行わない。
 *
 * まだ締切(発表時刻+時間枠)が来ていない時間枠は、行を一切書かない(API側は
 * 行が無ければDATA_PENDINGとして返すため、PENDING行を明示的に書く必要がない)。
 * 締切が来ていて必要な1分足が欠けている場合はUNVERIFIED/欠損としてUNAVAILABLE行を
 * 書く(推測値では埋めない)。後で欠けていた1分足が補填されれば、次回の実行で
 * AVAILABLEへ上書きされる(再計算、upsertのため重複行は作られない)。
 */

export const EVENT_REACTION_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m'] as const;
export type EventReactionTimeframe = SpeechReactionTimeframe;

export interface EventPairReactionRow {
  timeframe: EventReactionTimeframe;
  pre_release_price: number | null;
  post_release_price: number | null;
  movement: number | null;
  pips: number | null;
  change_percent: number | null;
  max_upward: number | null;
  max_downward: number | null;
  max_upward_pips: number | null;
  max_downward_pips: number | null;
  data_status: 'AVAILABLE' | 'UNAVAILABLE';
}

/**
 * The rows worth writing for one (event, pair) — never a PENDING placeholder, never a
 * timeframe excluded by release_datetime_precision, never a future (not-yet-closed) window.
 * Pure function: deterministic given its inputs (including `now`).
 */
export function computeEventPairReactionRows(input: {
  releaseDatetime: string;
  precision: ReleaseDatetimePrecision;
  symbol: string;
  candles: readonly PriceCandle[];
  now: Date;
}): EventPairReactionRow[] {
  const { releaseDatetime, precision, symbol, candles, now } = input;
  const release = Date.parse(releaseDatetime);
  const pipSize = pipSizeForSymbol(symbol);
  const preReleasePrice = selectPreStatementPrice(candles, releaseDatetime);
  const nowMs = now.getTime();

  const rows: EventPairReactionRow[] = [];
  for (const timeframe of availableTimeframes(precision) as readonly EventReactionTimeframe[]) {
    const minutes = TIMEFRAME_MINUTES[timeframe];
    const endMs = release + minutes * 60_000;
    if (endMs > nowMs) continue; // not closed yet — write nothing, stays DATA_PENDING at read time

    const postReleasePrice = selectPriceAt(candles, endMs);
    if (preReleasePrice === null || postReleasePrice === null) {
      rows.push({
        timeframe,
        pre_release_price: preReleasePrice,
        post_release_price: null,
        movement: null,
        pips: null,
        change_percent: null,
        max_upward: null,
        max_downward: null,
        max_upward_pips: null,
        max_downward_pips: null,
        data_status: 'UNAVAILABLE',
      });
      continue;
    }

    const { movement, pips, changePercent } = calculateReaction({ preReleasePrice, postReleasePrice, pipSize });
    const inWindow = candles.filter((candle) => {
      const closeAt = closeTimeMs(candle);
      return closeAt > release && closeAt <= endMs;
    });
    const excursion = calculateMaxExcursion({
      preReleasePrice,
      pricesInWindow: inWindow.flatMap((candle) => [Number(candle.high), Number(candle.low)]),
      pipSize,
    });

    rows.push({
      timeframe,
      pre_release_price: preReleasePrice,
      post_release_price: postReleasePrice,
      movement: round(movement, 6),
      // event_price_reactions.pips / max_upward_pips / max_downward_pips are numeric(10,2)
      // (db-design.md §3.12) — 2 decimals, not speeches' 1-decimal (pipette) API convention,
      // which has no DB column scale to match.
      pips: round(pips, 2),
      change_percent: round(changePercent, 4),
      max_upward: round(excursion.maxUpward, 6),
      max_downward: round(excursion.maxDownward, 6),
      max_upward_pips: round(excursion.maxUpwardPips, 2),
      max_downward_pips: round(excursion.maxDownwardPips, 2),
      data_status: 'AVAILABLE',
    });
  }
  return rows;
}
