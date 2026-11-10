/**
 * 同時発表イベントのグループ化(HQ指示 2026-11-10「イベント戦略分析の重複排除・集計改善・AI分析基盤の整備」STEP1)。
 *
 * 複数の指標(economic_indicators)が同じ発表の瞬間を指すことがある(例: 米雇用統計の NFP・失業率・平均時給は
 * 同じ 1 回の発表)。economic_events.provider はどの取り込みジョブ(発表元)がその行を作ったかを表し、
 * release_datetime はその発表の瞬間を表す。この2つが完全に一致する行は、同じ市場イベントとみなす。
 *
 * provider が null の行(発表元が分からない)は、誤って同一視するおそれがあるため、他のどの行とも合わせない
 * (常に自分だけのグループになる)。
 *
 * HQ指示(2026-11-10「実動作検証」): release_datetime_precision が EXACT でない行(APPROXIMATE・
 * DATE_ONLY・UNKNOWN)も、他のどの行とも合わせない。理由: Eurostat由来の EU_HICP・EU_UNEMPLOYMENT_RATE は
 * どちらも時刻が確認できない(APPROXIMATE、mappings/indicators.ts EUROSTAT_RELEASE_1100)ため、同じ
 * 「11:00」という仮の時刻を使っているだけで、同じ発表であることを意味しない。実際に
 * mappings/eurostatSchedule.ts の日程表には、2027-06-01・2027-07-01 のように、EU_HICP と
 * EU_UNEMPLOYMENT_RATE の発表日が偶然重なる行が既に存在し、時刻判定なしで同一視すると誤って
 * グループ化されていた(2026-11-10 実動作検証で発見)。EXACT(BLSの雇用統計・CPI・PPI等、1分単位まで
 * 確認済み)だけを同一視の根拠にする。
 *
 * 新しいテーブル・マイグレーションは使わず、既存の economic_events.provider・release_datetime・
 * release_datetime_precision だけでその場で計算する(DB変更なし)。
 */

export interface MarketEventRow {
  event_id: string;
  indicator_id: string;
  provider: string | null;
  release_datetime: string;
  /** economic_events.release_datetime_precision。EXACT 以外は他の行と合わせない(上記参照)。 */
  release_datetime_precision: string;
}

export interface MarketEventGroup<T extends MarketEventRow = MarketEventRow> {
  /** グループの鍵。provider が無い行は event_id 自体を使う(他と絶対に合わせないため)。 */
  key: string;
  provider: string | null;
  release_datetime: string;
  events: T[];
}

function groupKey(row: MarketEventRow): string {
  if (row.provider === null || row.release_datetime_precision !== 'EXACT') {
    return `__ungrouped__:${row.event_id}`;
  }
  return `${row.provider}|${row.release_datetime}`;
}

/** 行を同時発表(同じ provider・release_datetime)でグループ化する。入力の順を保つ(最初に現れた行の順)。 */
export function groupByMarketEvent<T extends MarketEventRow>(rows: readonly T[]): MarketEventGroup<T>[] {
  const groups = new Map<string, MarketEventGroup<T>>();
  const order: string[] = [];
  for (const row of rows) {
    const key = groupKey(row);
    let group = groups.get(key);
    if (!group) {
      group = { key, provider: row.provider, release_datetime: row.release_datetime, events: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.events.push(row);
  }
  return order.map((key) => groups.get(key)!);
}

/** 指定した発表(eventId)と同時発表の、他の指標の行(自分を除く)。見つからなければ空配列。 */
export function coReleasedRows<T extends MarketEventRow>(groups: readonly MarketEventGroup<T>[], eventId: string): T[] {
  const group = groups.find((g) => g.events.some((e) => e.event_id === eventId));
  if (!group) return [];
  return group.events.filter((e) => e.event_id !== eventId);
}

export interface MarketEventCoverage {
  /** 重複を除いた、実際の市場イベント(発表の瞬間)の数。 */
  independentMarketEvents: number;
  /** 指標ごとのイベント行の件数(重複排除前。グループ化しても減らない)。 */
  indicatorEventCount: number;
}

/** STEP2「集計改善」の基礎: 複数指標が同じ瞬間の発表なら、市場イベントとしては1件と数える。 */
export function summarizeMarketEventCoverage(groups: readonly Pick<MarketEventGroup, 'events'>[]): MarketEventCoverage {
  return {
    independentMarketEvents: groups.length,
    indicatorEventCount: groups.reduce((sum, group) => sum + group.events.length, 0),
  };
}
