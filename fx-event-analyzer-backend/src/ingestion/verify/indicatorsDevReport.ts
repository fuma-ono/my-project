/**
 * DEV の経済指標の読み取り専用の確認(HQ指示 2026-11-12「GB/AU 経済指標の DEV 検証」)。集計と出力の形だけ
 * (DB は読まない — 読むのは jobs/verifyIndicatorsDev.ts)。
 * 出力してよいもの: 指標のコード・表示名・国・重要度・出典・ペアの数・イベントの件数と状態・値(actual)・公表日時。
 * 出力しないもの: 鍵・接続情報・ユーザーの情報。
 */

export interface VerifyIndicatorRow {
  id: string;
  code: string;
  name: string;
  country_code: string;
  currency_code: string;
  importance: string;
  source: string | null;
  source_url: string | null;
  is_active: boolean;
  display_name?: string | null;
}

export interface VerifyPairRow {
  indicator_id: string;
  is_active: boolean;
  fx_pairs: { symbol: string } | null;
}

export interface VerifyEventRow {
  id: string;
  indicator_id: string;
  provider: string | null;
  status: string;
  data_status: string;
  release_datetime: string;
}

export interface VerifySnapshotRow {
  event_id: string;
  actual: number | string | null;
  previous: number | string | null;
  source: string | null;
  verification_status?: string | null;
}

export interface IndicatorsDevReport {
  at: string;
  indicators: {
    code: string;
    display_name: string | null;
    country: string;
    importance: string;
    active: boolean;
    source: string | null;
    has_source_url: boolean;
    pairs: string[];
    events: Record<string, number>;
    events_total: number;
    snapshots_with_actual: number;
  }[];
  unknownIndicators: string[];
  missing: string[];
  eventsByProvider: Record<string, number>;
  snapshotsTotal: number;
}

/** 検証の対象の指標(GB/AU/CA の7件は migration 20261110000002、そのほかは比較のために一緒に出す)。 */
export const GB_AU_CA_CODES = [
  'GB_CPI',
  'GB_CORE_CPI',
  'GB_UNEMPLOYMENT_RATE',
  'AU_CPI',
  'AU_UNEMPLOYMENT_RATE',
  'CA_CPI',
  'CA_UNEMPLOYMENT_RATE',
] as const;

export function buildIndicatorsDevReport(
  indicators: readonly VerifyIndicatorRow[],
  pairs: readonly VerifyPairRow[],
  events: readonly VerifyEventRow[],
  snapshots: readonly VerifySnapshotRow[],
  now: Date,
): IndicatorsDevReport {
  const byId = new Map(indicators.map((i) => [i.id, i]));
  const snapshotsByEvent = new Map<string, VerifySnapshotRow[]>();
  for (const s of snapshots) snapshotsByEvent.set(s.event_id, [...(snapshotsByEvent.get(s.event_id) ?? []), s]);
  const eventsByProvider: Record<string, number> = {};
  for (const e of events) {
    const key = e.provider ?? '(none)';
    eventsByProvider[key] = (eventsByProvider[key] ?? 0) + 1;
  }
  const rows = [...indicators]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((i) => {
      const mine = events.filter((e) => e.indicator_id === i.id);
      const counts: Record<string, number> = {};
      for (const e of mine) {
        const key = `${e.status}/${e.data_status}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return {
        code: i.code,
        display_name: i.display_name ?? null,
        country: i.country_code,
        importance: i.importance,
        active: i.is_active,
        source: i.source,
        has_source_url: !!i.source_url,
        pairs: pairs
          .filter((p) => p.indicator_id === i.id && p.is_active && p.fx_pairs)
          .map((p) => p.fx_pairs!.symbol)
          .sort(),
        events: counts,
        events_total: mine.length,
        snapshots_with_actual: mine.filter((e) => (snapshotsByEvent.get(e.id) ?? []).some((s) => s.actual !== null))
          .length,
      };
    });
  const codes = new Set(indicators.map((i) => i.code));
  return {
    at: now.toISOString(),
    indicators: rows,
    unknownIndicators: events.filter((e) => !byId.has(e.indicator_id)).map((e) => e.id),
    missing: GB_AU_CA_CODES.filter((c) => !codes.has(c)),
    eventsByProvider,
    snapshotsTotal: snapshots.length,
  };
}

/** 検証の対象(GB/AU/CA)の、イベントごとの値(件数が少ないときだけ。値と公表日時のみ)。 */
export function eventValues(
  indicators: readonly VerifyIndicatorRow[],
  events: readonly VerifyEventRow[],
  snapshots: readonly VerifySnapshotRow[],
  codes: readonly string[],
  limit: number,
) {
  const ids = new Map(indicators.filter((i) => codes.includes(i.code)).map((i) => [i.id, i.code]));
  return events
    .filter((e) => ids.has(e.indicator_id))
    .sort((a, b) => a.release_datetime.localeCompare(b.release_datetime))
    .slice(0, limit)
    .map((e) => {
      const s = snapshots.find((x) => x.event_id === e.id);
      return [
        ids.get(e.indicator_id),
        e.release_datetime,
        e.status,
        e.data_status,
        s?.actual ?? null,
        s?.previous ?? null,
        s?.source ?? null,
      ];
    });
}
