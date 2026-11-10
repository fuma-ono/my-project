/**
 * 同時発表イベントのグループ化(HQ指示 2026-11-10 STEP1、2026-11-10「実動作検証」で修正)。
 * 実データ調査(docs/projects/event-strategy-trading-utility-report.md)で確認した、米雇用統計
 * (US_NFP・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGS が 2026-11-06 13:30 UTC の同じ発表)を題材にする。
 * 「実動作検証」で見つかった反例(mappings/eurostatSchedule.ts): EU_HICP・EU_UNEMPLOYMENT_RATE は
 * どちらも時刻が APPROXIMATE(11:00 Europe/Luxembourg、確認できていない仮の値)で、日程表には
 * 2027-06-01・2027-07-01 のように発表日が偶然重なる行が実在する。時刻を確認できない(EXACTでない)行は
 * 合わせないことで、これを誤ってグループ化しないようにする。
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
  release_datetime_precision = 'EXACT',
): MarketEventRow => ({
  event_id,
  indicator_id,
  provider,
  release_datetime,
  release_datetime_precision,
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

  describe('同じ event_id の行が複数回渡されても1件として数える(2026-11-10「実動作検証」で発見)', () => {
    // historical.ts は「対象イベント自身の行」と「DB検索(listCoReleasedEvents)で見つかった行」を両方渡す。
    // 対象イベント自身のprovider・release_datetimeは当然DB検索にも一致するため、対象イベント自身が
    // 検索結果にも含まれ、同じevent_idが2回入ってくる(自分＋同時発表の相手1件のはずがindicator_countが
    // 3になってしまっていた実際のCI失敗を再現する)。
    it('対象イベント自身が重複して渡っても、indicator_countは実際の指標数のまま', () => {
      const selfRow = row('nfp-event', 'US_NFP', 'bls_schedule', '2026-11-06T13:30:00.000Z');
      const siblingRow = row('unrate-event', 'US_UNEMPLOYMENT_RATE', 'bls_schedule', '2026-11-06T13:30:00.000Z');
      // [自分自身(呼び出し側で構築), 自分自身(DB検索結果に含まれる), 同時発表の相手] の順で渡る想定
      const groups = groupByMarketEvent([selfRow, selfRow, siblingRow]);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.events.map((e) => e.event_id)).toEqual(['nfp-event', 'unrate-event']);
      expect(summarizeMarketEventCoverage(groups)).toEqual({ independentMarketEvents: 1, indicatorEventCount: 2 });
    });

    it('同時発表の相手が無い(自分だけ)場合も、自分自身の重複でindicator_countが2にならない', () => {
      const selfRow = row('solo-event', 'US_JOLTS', 'bls_schedule', '2026-11-03T15:00:00.000Z');
      const groups = groupByMarketEvent([selfRow, selfRow]);
      expect(groups).toHaveLength(1);
      expect(summarizeMarketEventCoverage(groups)).toEqual({ independentMarketEvents: 1, indicatorEventCount: 1 });
    });

    it('precisionがAPPROXIMATEな行が重複しても、1件として数える(別々のungrouped扱いにしない)', () => {
      const selfRow = row('eu-event', 'EU_HICP', 'eurostat_schedule', '2027-06-01T09:00:00.000Z', 'APPROXIMATE');
      const groups = groupByMarketEvent([selfRow, selfRow]);
      expect(groups).toHaveLength(1);
      expect(summarizeMarketEventCoverage(groups)).toEqual({ independentMarketEvents: 1, indicatorEventCount: 1 });
    });
  });

  describe('release_datetime_precision が EXACT でない行は合わせない(2026-11-10「実動作検証」で発見)', () => {
    it('実例: Eurostat由来のEU_HICP・EU_UNEMPLOYMENT_RATEは、日付が偶然重なってもグループ化しない', () => {
      // mappings/eurostatSchedule.ts の実際の日程表どおり(2027-06-01、どちらもAPPROXIMATE・11:00 Luxembourg)。
      const rows = [
        row('hicp-event', 'EU_HICP', 'eurostat_schedule', '2027-06-01T09:00:00.000Z', 'APPROXIMATE'),
        row('unrate-eu-event', 'EU_UNEMPLOYMENT_RATE', 'eurostat_schedule', '2027-06-01T09:00:00.000Z', 'APPROXIMATE'),
      ];
      const groups = groupByMarketEvent(rows);
      // 修正前はprovider・timestampが一致するため1グループに誤ってまとめられていた
      expect(groups).toHaveLength(2);
      expect(groups.every((g) => g.events.length === 1)).toBe(true);
    });

    it('EXACTな行同士(米雇用統計)は、APPROXIMATEな行が同じ日時にあっても影響を受けない', () => {
      const rows = [
        row('nfp-event', 'US_NFP', 'bls_schedule', '2026-11-06T13:30:00.000Z', 'EXACT'),
        row('unrate-event', 'US_UNEMPLOYMENT_RATE', 'bls_schedule', '2026-11-06T13:30:00.000Z', 'EXACT'),
        row('other-approx', 'EU_HICP', 'bls_schedule', '2026-11-06T13:30:00.000Z', 'APPROXIMATE'),
      ];
      const groups = groupByMarketEvent(rows);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.events.map((e) => e.event_id)).toEqual(['nfp-event', 'unrate-event']);
      expect(groups[1]!.events.map((e) => e.event_id)).toEqual(['other-approx']);
    });

    it('DATE_ONLY・UNKNOWNも同様に合わせない', () => {
      for (const precision of ['DATE_ONLY', 'UNKNOWN']) {
        const rows = [
          row('a', 'IND_A', 'some_provider', '2026-11-06T13:30:00.000Z', precision),
          row('b', 'IND_B', 'some_provider', '2026-11-06T13:30:00.000Z', precision),
        ];
        expect(groupByMarketEvent(rows), precision).toHaveLength(2);
      }
    });
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
