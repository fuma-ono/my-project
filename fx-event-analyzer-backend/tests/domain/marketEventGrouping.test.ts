/**
 * 同時発表イベントのグループ化(HQ指示 2026-11-10 STEP1)。
 * 実データ調査(docs/projects/event-strategy-trading-utility-report.md)で確認した、米雇用統計
 * (US_NFP・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGS が 2026-11-06 13:30 UTC の同じ発表)を題材にする。
 */
import { describe, expect, it } from 'vitest';
import {
  coReleasedRows,
  groupByMarketEvent,
  summarizeMarketEventCoverage,
  type MarketEventRow,
} from '../../src/domain/marketEventGrouping.js';

const row = (
  event_id: string,
  indicator_id: string,
  provider: string | null,
  release_datetime: string,
): MarketEventRow => ({
  event_id,
  indicator_id,
  provider,
  release_datetime,
});

describe('groupByMarketEvent', () => {
  it('同じ provider・release_datetime の行を1つのグループにまとめる(米雇用統計3指標)', () => {
    const rows = [
      row('nfp-event', 'US_NFP', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('unrate-event', 'US_UNEMPLOYMENT_RATE', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('ahe-event', 'US_AVG_HOURLY_EARNINGS', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('jolts-event', 'US_JOLTS', 'bls_schedule', '2026-11-03T15:00:00.000Z'),
    ];
    const groups = groupByMarketEvent(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.events.map((e) => e.event_id)).toEqual(['nfp-event', 'unrate-event', 'ahe-event']);
    expect(groups[1]!.events.map((e) => e.event_id)).toEqual(['jolts-event']);
  });

  it('provider が null の行は、timestamp が同じでも他の行と絶対に合わせない', () => {
    const rows = [
      row('a', 'IND_A', null, '2026-11-06T13:30:00.000Z'),
      row('b', 'IND_B', null, '2026-11-06T13:30:00.000Z'),
      row('c', 'IND_C', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
    ];
    const groups = groupByMarketEvent(rows);
    // a・b はそれぞれ自分だけのグループ(provider不明の誤同一視を避ける)。c は別の独立したグループ。
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.events.length === 1)).toBe(true);
  });

  it('provider が違えば、release_datetime が同じでも別のグループ', () => {
    const rows = [
      row('a', 'IND_A', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('b', 'IND_B', 'eurostat_schedule', '2026-11-06T13:30:00.000Z'),
    ];
    expect(groupByMarketEvent(rows)).toHaveLength(2);
  });

  it('入力が空なら空配列', () => {
    expect(groupByMarketEvent([])).toEqual([]);
  });
});

describe('coReleasedRows', () => {
  const rows = [
    row('nfp-event', 'US_NFP', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
    row('unrate-event', 'US_UNEMPLOYMENT_RATE', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
    row('ahe-event', 'US_AVG_HOURLY_EARNINGS', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
    row('jolts-event', 'US_JOLTS', 'bls_schedule', '2026-11-03T15:00:00.000Z'),
  ];
  const groups = groupByMarketEvent(rows);

  it('同時発表の他の指標(自分を除く)を返す', () => {
    const siblings = coReleasedRows(groups, 'nfp-event').map((r) => r.event_id);
    expect(siblings.sort()).toEqual(['ahe-event', 'unrate-event']);
  });

  it('同時発表が無ければ空配列', () => {
    expect(coReleasedRows(groups, 'jolts-event')).toEqual([]);
  });

  it('グループに無い event_id は空配列(例外を投げない)', () => {
    expect(coReleasedRows(groups, 'unknown')).toEqual([]);
  });
});

describe('summarizeMarketEventCoverage', () => {
  it('独立市場イベント数は重複排除後、指標イベント数は重複排除前', () => {
    const rows = [
      row('nfp-event', 'US_NFP', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('unrate-event', 'US_UNEMPLOYMENT_RATE', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('ahe-event', 'US_AVG_HOURLY_EARNINGS', 'bls_schedule', '2026-11-06T13:30:00.000Z'),
      row('jolts-event', 'US_JOLTS', 'bls_schedule', '2026-11-03T15:00:00.000Z'),
    ];
    const coverage = summarizeMarketEventCoverage(groupByMarketEvent(rows));
    // 修正前は「4回の発表を分析した」と見えてしまうが、実際の市場イベントは2回
    expect(coverage).toEqual({ independentMarketEvents: 2, indicatorEventCount: 4 });
  });

  it('グループが無ければ両方0', () => {
    expect(summarizeMarketEventCoverage([])).toEqual({ independentMarketEvents: 0, indicatorEventCount: 0 });
  });
});
