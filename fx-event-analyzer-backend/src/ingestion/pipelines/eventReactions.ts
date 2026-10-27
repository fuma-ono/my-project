/**
 * event_price_reactions の書き込み(HQ決定 2026-10-18「経済指標の価格反応実装」)。
 * RELEASED(確定済み)の経済指標イベントごとに、通貨が関係するアクティブな
 * 為替ペア × 時間枠(1m/5m/15m/30m/60m)の価格反応を計算し、書き込む。
 *
 * 外部APIは一切呼ばない(既存のfx_prices/economic_eventsを読むだけ)。追加費用0円。
 *
 * - 対象: status==='RELEASED'、release_datetimeが直近`repairHorizonDays`以内の
 *   イベントのみ(FX価格のgap repairと同じ horizon — それより古いイベントは
 *   1分足の欠損が今後も補填されないため、何度実行しても結果が変わらない)。
 * - 対象ペア: イベントの指標の通貨(currency_code)がbase/quoteに含まれる
 *   アクティブな為替ペア全て(表示側が選ぶ上位4ペアがどれであっても、
 *   データが必ず揃っているようにする)。
 * - 時間枠ごとの計算・書き込み可否は src/domain/economicEventReactions.ts
 *   (純粋関数、要人発言側のロジックを再利用)に委ねる。将来の時間枠には
 *   何も書かない。欠損が確認された時間枠はUNAVAILABLEとして書き、
 *   後で1分足が補填されれば次回の実行でAVAILABLEへ再計算・上書きする
 *   (upsertのため同一イベント・ペア・時間枠の行が重複することはない)。
 */
import { availableTimeframes } from '../../domain/dataQuality.js';
import { computeEventPairReactionRows, EVENT_REACTION_TIMEFRAMES } from '../../domain/economicEventReactions.js';
import { PRE_STATEMENT_LOOKBACK_MINUTES, TIMEFRAME_MINUTES, type PriceCandle } from '../../domain/speechReactions.js';
import type { JobCounters } from '../runner.js';
import type { EventPriceReactionRow, IngestionStore } from '../store.js';

const MINUTE_MS = 60_000;
const MAX_TIMEFRAME_MINUTES = Math.max(...EVENT_REACTION_TIMEFRAMES.map((tf) => TIMEFRAME_MINUTES[tf]));

export interface EventReactionSettings {
  /** How far back (days) a RELEASED event is still worth attempting (mirrors FX_FETCH_SETTINGS.repairHorizonDays). */
  horizonDays: number;
  /**
   * HQ指示(2026-10-27「反応計算の期間指定」): 指定すると horizonDays の代わりに、release_datetime が
   * [from, to) の RELEASED の発表を計算し直す(過去の発表のバックフィル。為替の1分足が無ければ UNAVAILABLE のまま)。
   */
  range?: { fromIso: string; toIso: string };
}

/** Same numbers and status → nothing to write (calculated_at alone does not count). */
function sameReaction(a: EventPriceReactionRow, b: EventPriceReactionRow): boolean {
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return (
    a.data_status === b.data_status &&
    (
      [
        'pre_release_price',
        'post_release_price',
        'movement',
        'pips',
        'change_percent',
        'max_upward',
        'max_downward',
        'max_upward_pips',
        'max_downward_pips',
      ] as const
    ).every((key) => num(a[key]) === num(b[key]))
  );
}

export async function ingestEventPriceReactions(
  store: IngestionStore,
  settings: EventReactionSettings,
  now: Date,
  counters: JobCounters,
): Promise<void> {
  const sinceIso =
    settings.range?.fromIso ?? new Date(now.getTime() - settings.horizonDays * 24 * 60 * MINUTE_MS).toISOString();
  const untilMs = settings.range ? Date.parse(settings.range.toIso) : Number.POSITIVE_INFINITY;
  const [listed, activePairs] = await Promise.all([
    store.listReleasedEventsForReactions(sinceIso),
    store.listFxPairs(),
  ]);
  const events = listed.filter((event) => Date.parse(event.release_datetime) < untilMs);
  // 書く前に、保存済みの行と比べる(HQ指示 2026-10-27):
  // - 値も状態も同じ行は書かない(calculated_at だけを書き換えない)
  // - 値のある行(AVAILABLE)を、値の無い行(UNAVAILABLE)で上書きしない(為替の1分足が後から欠けても値を失わない)
  const stored = new Map<string, EventPriceReactionRow>();
  for (const row of await store.listEventPriceReactions(events.map((event) => event.id))) {
    stored.set(`${row.event_id}|${row.fx_pair_id}|${row.timeframe}`, row);
  }

  for (const event of events) {
    counters.fetched += 1;
    const candidatePairs = activePairs.filter(
      (pair) => pair.base_currency === event.currency_code || pair.quote_currency === event.currency_code,
    );
    if (candidatePairs.length === 0) {
      counters.skip('NO_CURRENCY_RELEVANT_PAIR');
      continue;
    }
    if (availableTimeframes(event.release_datetime_precision).length === 0) {
      // Never happens today (every precision leaves at least 15m/30m/60m analyzable —
      // dataQuality.ts), but kept explicit rather than assumed.
      counters.skip('NO_ANALYZABLE_TIMEFRAME');
      continue;
    }

    const release = Date.parse(event.release_datetime);
    // listFxMinuteRows is [fromIso, toIso) — half-open, unlike the API-side
    // listChartPrices' inclusive [from, to]. The candle opening at
    // release + (MAX_TIMEFRAME_MINUTES − 1) min must be included (it closes
    // at release + MAX_TIMEFRAME_MINUTES min), so the exclusive upper bound
    // is release + MAX_TIMEFRAME_MINUTES min exactly.
    const fromIso = new Date(release - PRE_STATEMENT_LOOKBACK_MINUTES * MINUTE_MS).toISOString();
    const toIso = new Date(release + MAX_TIMEFRAME_MINUTES * MINUTE_MS).toISOString();

    const rowsToWrite: EventPriceReactionRow[] = [];
    let computedAny = false;
    let available = 0;
    let unavailable = 0;
    for (const pair of candidatePairs) {
      const rows = await store.listFxMinuteRows(pair.id, fromIso, toIso);
      const candles: PriceCandle[] = rows.map((row) => ({
        timestamp: row.timestamp,
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      }));
      const computed = computeEventPairReactionRows({
        releaseDatetime: event.release_datetime,
        precision: event.release_datetime_precision,
        symbol: pair.symbol,
        candles,
        now,
      });
      if (computed.length > 0) computedAny = true;
      for (const row of computed) {
        if (row.data_status === 'AVAILABLE') available += 1;
        else unavailable += 1;
        const candidate: EventPriceReactionRow = {
          event_id: event.id,
          fx_pair_id: pair.id,
          timeframe: row.timeframe,
          pre_release_price: row.pre_release_price,
          post_release_price: row.post_release_price,
          movement: row.movement,
          pips: row.pips,
          change_percent: row.change_percent,
          max_upward: row.max_upward,
          max_downward: row.max_downward,
          max_upward_pips: row.max_upward_pips,
          max_downward_pips: row.max_downward_pips,
          data_status: row.data_status,
          calculated_at: now.toISOString(),
        };
        const existing = stored.get(`${event.id}|${pair.id}|${row.timeframe}`);
        if (existing && existing.data_status === 'AVAILABLE' && candidate.data_status === 'UNAVAILABLE') {
          counters.skip('KEEP_AVAILABLE');
          continue;
        }
        if (existing && sameReaction(existing, candidate)) {
          counters.skip('UNCHANGED');
          continue;
        }
        rowsToWrite.push(candidate);
      }
    }

    if (rowsToWrite.length === 0) {
      counters.skip(computedAny ? 'NOTHING_CHANGED' : 'NOTHING_READY_YET');
      continue;
    }
    await store.upsertEventPriceReactions(rowsToWrite);
    counters.success += 1;
    counters.note('events', { event_id: event.id, pairs: candidatePairs.length, available, unavailable });
  }
}
