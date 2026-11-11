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
 * HQ指示(2026-11-10「価格反応データ A〜D」):
 * - A: 時間枠の窓(発表の時刻に始まる足から、N分後に終わる足まで)の1分足が N 本すべてあり、発表の時刻ちょうどに
 *   終わる足(発表直前の価格)もあるときだけ AVAILABLE。1本でも欠けていれば UNAVAILABLE(値を入れない)。
 *   呼び出し側は UNVERIFIED の足を渡さない(eventReactions.ts の usableForReactions)ので、UNVERIFIED も欠けと同じ扱い。
 *   発表直前の価格に、15分前までの古い足を代わりに使うこと(selectPreStatementPrice の lookback)もしない。
 * - D: finalityMinutes を渡すと、窓の終わりからその分数が過ぎるまで(1分足が取り直されて確定するまで)、その時間枠は
 *   書かない(行が無ければ API は今までどおり NOT_DUE / NOT_CALCULATED)。
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
  /** HQ指示(2026-11-10 D): 窓の終わりからこの分数が過ぎてから計算する(既定 0 = 窓が閉じたらすぐ)。 */
  finalityMinutes?: number;
}): EventPairReactionRow[] {
  const { releaseDatetime, precision, symbol, candles, now } = input;
  const release = Date.parse(releaseDatetime);
  const pipSize = pipSizeForSymbol(symbol);
  // A: 発表直前の価格は、発表の時刻ちょうどに終わる足(終わりが (発表 − 1分, 発表] の足)だけ。古い足で代わりにしない。
  const preCandleExists = candles.some((candle) => {
    const closeAt = closeTimeMs(candle);
    return closeAt <= release && closeAt > release - 60_000;
  });
  const preReleasePrice = preCandleExists ? selectPreStatementPrice(candles, releaseDatetime) : null;
  const nowMs = now.getTime();
  const finalityMs = (input.finalityMinutes ?? 0) * 60_000;

  const rows: EventPairReactionRow[] = [];
  for (const timeframe of availableTimeframes(precision) as readonly EventReactionTimeframe[]) {
    const minutes = TIMEFRAME_MINUTES[timeframe];
    const endMs = release + minutes * 60_000;
    if (endMs > nowMs) continue; // not closed yet — write nothing, stays DATA_PENDING at read time
    if (endMs + finalityMs > nowMs) continue; // D: 1分足がまだ確定していない — 書かない(次の実行で計算する)

    const postReleasePrice = selectPriceAt(candles, endMs);
    const inWindow = candles.filter((candle) => {
      const closeAt = closeTimeMs(candle);
      return closeAt > release && closeAt <= endMs;
    });
    // A: 窓の1分足が N 本すべてそろっているか(同じ分の重複は数えない)。
    const windowMinutes = new Set(inWindow.map((candle) => Math.floor(closeTimeMs(candle) / 60_000))).size;
    if (preReleasePrice === null || postReleasePrice === null || windowMinutes < minutes) {
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
