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
 * - HQ指示(2026-10-27): 書く前に保存済みの行と比べ、値も状態も同じ行は書かない(calculated_at だけを
 *   書き換えない)。値のある行(AVAILABLE)を値の無い行(UNAVAILABLE)で上書きしない(1分足が後から
 *   欠けても値を失わない)。settings.range を渡すと、直近の代わりにその期間の発表を計算し直す。
 * - HQ指示(2026-11-10「価格反応データ A〜D」):
 *   B: 窓の1分足が後から UNVERIFIED になった・そろわなくなった(読めた足が1本以上あり、計算し直すと UNAVAILABLE)
 *      ときは、保存済みの AVAILABLE を UNAVAILABLE で上書きする(値を残さない)。足が1本も読めなかったとき
 *      (DB の読み取りの失敗が疑われる)だけは、今までどおり AVAILABLE を残す(KEEP_AVAILABLE)。
 *   D: 窓の終わりから REACTION_FINALITY_MINUTES(FORWARD の取り直しの長さ + 定時の間隔)が過ぎるまでは書かない。
 *      為替の取り込みは直近 FORWARD 分を毎回取り直すので、それより前の足は値が変わらない(確定)。
 * - HQ指示(2026-11-10「FOMC 案3」): 政策金利(fomc_policy_decisions)が記録済みの FOMC の会合も対象にする。
 *   会合の行は SCHEDULED・PENDING のまま(api-design v1.47。状態は変えない)。RELEASED の発表の扱いは変えない
 *   (一覧を足すだけ。同じ id は1回だけ)。settings.eventId を渡すと、期間に関係なくその1件だけを計算する
 *   (RELEASED か、政策金利が記録済みの会合のどちらでもなければ、何も書かずにエラー)。
 */
import { availableTimeframes } from '../../domain/dataQuality.js';
import { computeEventPairReactionRows, EVENT_REACTION_TIMEFRAMES } from '../../domain/economicEventReactions.js';
import { PRE_STATEMENT_LOOKBACK_MINUTES, TIMEFRAME_MINUTES, type PriceCandle } from '../../domain/speechReactions.js';
import { FX_FETCH_SETTINGS } from '../config.js';
import type { JobCounters } from '../runner.js';
import { usableForReactions } from '../validation/fxCandles.js';
import type { EventPriceReactionRow, IngestionStore } from '../store.js';

const MINUTE_MS = 60_000;

/**
 * HQ指示(2026-11-10 D): 1分足が確定したとみなすまでの分数(窓の終わりから)。為替の取り込みは毎回、直近
 * FX_FETCH_SETTINGS.forwardMinutes(120)分を取り直すので、それより前の足は変わらない。+20 は取り込みの間隔(20分)。
 * 60分の時間枠なら発表から 60 + 140 = 200 分(約3時間20分)後、1分なら 141 分後から計算する。
 */
export const REACTION_FINALITY_MINUTES = FX_FETCH_SETTINGS.forwardMinutes + 20;
const MAX_TIMEFRAME_MINUTES = Math.max(...EVENT_REACTION_TIMEFRAMES.map((tf) => TIMEFRAME_MINUTES[tf]));

export interface EventReactionSettings {
  /** How far back (days) a RELEASED event is still worth attempting (mirrors FX_FETCH_SETTINGS.repairHorizonDays). */
  horizonDays: number;
  /**
   * HQ指示(2026-10-27「反応計算の期間指定」): 指定すると horizonDays の代わりに、release_datetime が
   * [from, to) の RELEASED の発表を計算し直す(過去の発表のバックフィル。為替の1分足が無ければ UNAVAILABLE のまま)。
   */
  range?: { fromIso: string; toIso: string };
  /** HQ指示(2026-11-10 D): 確定を待つ分数(既定 REACTION_FINALITY_MINUTES)。テスト用に上書きできる。 */
  finalityMinutes?: number;
  /** HQ指示(2026-11-10): この1件だけを計算する(期間・horizonDays は使わない。range とは一緒に使わない)。 */
  eventId?: string;
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
  // eventId のときは期間で絞らない(古い会合も指定できるように)。
  const listSince = settings.eventId ? new Date(0).toISOString() : sinceIso;
  const [released, policyRate, activePairs] = await Promise.all([
    store.listReleasedEventsForReactions(listSince),
    store.listPolicyRateEventsForReactions(listSince),
    store.listFxPairs(),
  ]);
  // RELEASED の発表に、政策金利が記録済みの会合を足す(同じ id は1回だけ。並びは発表時刻 → id)。
  const byId = new Map(released.map((event) => [event.id, event]));
  for (const event of policyRate) if (!byId.has(event.id)) byId.set(event.id, event);
  const listed = [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.release_datetime) - Date.parse(b.release_datetime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (settings.eventId && !byId.has(settings.eventId)) {
    counters.error(
      `event ${settings.eventId} is neither RELEASED nor a FOMC meeting with a recorded policy rate — nothing written`,
    );
    return;
  }
  const events = settings.eventId
    ? listed.filter((event) => event.id === settings.eventId)
    : listed.filter((event) => Date.parse(event.release_datetime) < untilMs);
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
      // HQ指示(2026-10-30 P0-1): 照合で食い違った足(UNVERIFIED)は「足が無い」として扱う(data-sources.md §6.4、
      // Read API の値動き・チャートと同じ)。SINGLE_SOURCE・VERIFIED はそのまま使う。補間はしない。
      const rawRows = await store.listFxMinuteRows(pair.id, fromIso, toIso);
      const rows = usableForReactions(rawRows);
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
        finalityMinutes: settings.finalityMinutes ?? REACTION_FINALITY_MINUTES,
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
          // B: 足が読めていて(UNVERIFIED を含めて1本以上)、それでもそろわない・UNVERIFIED がある → 値を残さない。
          // 足が1本も読めなかったときだけ(読み取りの失敗が疑われる)、今までどおり AVAILABLE を残す。
          if (rawRows.length === 0) {
            counters.skip('KEEP_AVAILABLE');
            continue;
          }
          counters.note('downgraded', { event_id: event.id, fx_pair_id: pair.id, timeframe: row.timeframe });
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
