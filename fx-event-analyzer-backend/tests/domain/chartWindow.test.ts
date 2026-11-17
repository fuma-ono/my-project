import { describe, expect, it } from 'vitest';
import { chartWindow } from '../../src/domain/chartWindow.js';

const release = '2026-10-09T12:30:00.000Z';

describe('chartWindow', () => {
  it('1m: 15 minutes either side of the release', () => {
    expect(chartWindow(release, '1m')).toEqual({ from: '2026-10-09T12:15:00.000Z', to: '2026-10-09T12:45:00.000Z' });
  });

  it('5m: 60 minutes either side', () => {
    expect(chartWindow(release, '5m')).toEqual({ from: '2026-10-09T11:30:00.000Z', to: '2026-10-09T13:30:00.000Z' });
  });

  it('15m: 3 hours either side', () => {
    expect(chartWindow(release, '15m')).toEqual({ from: '2026-10-09T09:30:00.000Z', to: '2026-10-09T15:30:00.000Z' });
  });

  it('other timeframes keep 30 minutes before and 60 after', () => {
    expect(chartWindow(release, '60m')).toEqual({ from: '2026-10-09T12:00:00.000Z', to: '2026-10-09T13:30:00.000Z' });
  });
});

// ---- 第1段階の拡張(HQ指示 2026-11-17): before_minutes / after_minutes、期待本数・欠損の状態(進行中の窓を含む) ----
import {
  CHART_MAX_AFTER_MINUTES,
  CHART_MAX_BEFORE_MINUTES,
  chartCandleCoverage,
  chartFinalityBoundaryMs,
  defaultChartMinutes,
  expectedChartTimestamps,
  parseChartMinutes,
  resolveChartWindow,
} from '../../src/domain/chartWindow.js';

const at = (iso: string) => Date.parse(iso);
const FAR_FUTURE = at('2030-01-01T00:00:00.000Z');

describe('parseChartMinutes', () => {
  it('無ければ undefined(既定の範囲を使う)', () => {
    expect(parseChartMinutes(undefined, CHART_MAX_BEFORE_MINUTES)).toBeUndefined();
  });

  it('0 以上 max 以下の整数だけを受け付ける', () => {
    expect(parseChartMinutes('0', 180)).toBe(0);
    expect(parseChartMinutes('120', 180)).toBe(120);
    expect(parseChartMinutes('180', 180)).toBe(180);
  });

  it('上限超え・負数・小数・空・数字以外・指数表記・配列は null(検証エラー)', () => {
    for (const bad of ['181', '-1', '1.5', '', ' 10', '10 ', '1e2', 'abc', '0x10', '+5']) {
      expect(parseChartMinutes(bad, 180), JSON.stringify(bad)).toBeNull();
    }
    expect(parseChartMinutes(['10'], 180)).toBeNull();
    expect(parseChartMinutes(10, 180)).toBeNull();
  });

  it('上限は前後とも180分(既存の最大の範囲 = 15分足の前後3時間)', () => {
    expect(CHART_MAX_BEFORE_MINUTES).toBe(180);
    expect(CHART_MAX_AFTER_MINUTES).toBe(180);
  });
});

describe('resolveChartWindow', () => {
  it('指定が無ければ時間足ごとの既定の範囲のまま(chartWindow と同じ)', () => {
    for (const tf of ['1m', '5m', '15m', '30m', '60m']) {
      const resolved = resolveChartWindow(release, tf);
      expect(resolved.source).toBe('DEFAULT');
      expect({ from: resolved.from, to: resolved.to }).toEqual(chartWindow(release, tf));
      expect(resolved.before_minutes).toBe(defaultChartMinutes(tf).before);
      expect(resolved.after_minutes).toBe(defaultChartMinutes(tf).after);
    }
  });

  it('1分足で、発表の30分前から発表後2時間まで', () => {
    expect(resolveChartWindow(release, '1m', { beforeMinutes: 30, afterMinutes: 120 })).toEqual({
      from: '2026-10-09T12:00:00.000Z',
      to: '2026-10-09T14:30:00.000Z',
      before_minutes: 30,
      after_minutes: 120,
      source: 'REQUESTED',
    });
  });

  it('片方だけ指定したら、もう片方はその時間足の既定', () => {
    expect(resolveChartWindow(release, '1m', { afterMinutes: 120 })).toMatchObject({
      before_minutes: 15,
      after_minutes: 120,
      source: 'REQUESTED',
    });
    expect(resolveChartWindow(release, '5m', { beforeMinutes: 10 })).toMatchObject({
      before_minutes: 10,
      after_minutes: 60,
    });
  });

  it('0 分も指定できる(発表の時刻から)', () => {
    expect(resolveChartWindow(release, '1m', { beforeMinutes: 0, afterMinutes: 0 })).toMatchObject({
      from: release,
      to: release,
    });
  });
});

describe('chartFinalityBoundaryMs — 取り込みの「確定」の境目(2分)', () => {
  it('now − 2分を分に切り捨てた時刻', () => {
    expect(chartFinalityBoundaryMs(at('2026-11-10T13:40:30.000Z'))).toBe(at('2026-11-10T13:38:00.000Z'));
    expect(chartFinalityBoundaryMs(at('2026-11-10T13:42:00.000Z'))).toBe(at('2026-11-10T13:40:00.000Z'));
  });
});

describe('expectedChartTimestamps — 到来した、市場が開いている間の足', () => {
  // 2026-11-10 は火曜(通常の営業日)。
  const tue = '2026-11-10T13:30:00.000Z';
  const window = resolveChartWindow(tue, '1m', { beforeMinutes: 60, afterMinutes: 120 }); // 12:30〜15:30

  it('全部到来していれば、1分足は 60分前から120分後まで = 180本', () => {
    expect(expectedChartTimestamps(window.from, window.to, '1m', FAR_FUTURE)).toHaveLength(180);
  });

  it('最大の範囲(前後180分)でも1分足は 360本(1,000本の上限には届かない)', () => {
    const max = resolveChartWindow(tue, '1m', { beforeMinutes: 180, afterMinutes: 180 });
    expect(expectedChartTimestamps(max.from, max.to, '1m', FAR_FUTURE)).toHaveLength(360);
  });

  it('5・15・30・60分足は、エポックの区切りに揃った足だけ', () => {
    expect(expectedChartTimestamps(window.from, window.to, '5m', FAR_FUTURE)).toHaveLength(36);
    expect(expectedChartTimestamps(window.from, window.to, '15m', FAR_FUTURE)).toHaveLength(12);
    expect(expectedChartTimestamps(window.from, window.to, '30m', FAR_FUTURE)).toHaveLength(6);
    // 60分足: 13:00・14:00・15:00(12:30 は区切りでない)
    expect(expectedChartTimestamps(window.from, window.to, '60m', FAR_FUTURE)).toEqual([
      '2026-11-10T13:00:00.000Z',
      '2026-11-10T14:00:00.000Z',
      '2026-11-10T15:00:00.000Z',
    ]);
  });

  it('進行中の窓: 未来の足・まだ確定していない足は含めない(境目 13:38 → 1分足は 12:30〜13:37 の68本)', () => {
    const now = at('2026-11-10T13:40:30.000Z');
    const list = expectedChartTimestamps(window.from, window.to, '1m', now);
    expect(list).toHaveLength(68);
    expect(list[0]).toBe('2026-11-10T12:30:00.000Z');
    expect(list[list.length - 1]).toBe('2026-11-10T13:37:00.000Z');
  });

  it('進行中の窓の5分足: 足の終わりが境目以前のものだけ(13:30 の足まで = 13本)', () => {
    const now = at('2026-11-10T13:40:30.000Z'); // 境目 13:38 → 13:35 の足(終わり 13:40)は未確定
    expect(expectedChartTimestamps(window.from, window.to, '5m', now)).toHaveLength(13);
  });

  it('窓が全部未来(発表の前)なら 0 本', () => {
    expect(expectedChartTimestamps(window.from, window.to, '1m', at('2026-11-10T12:00:00.000Z'))).toEqual([]);
  });

  it('金曜の市場の終わり(ニューヨーク 17:00 = 冬時間の 22:00Z)から先は数えない', () => {
    // 2026-11-13(金)21:30〜23:00Z のうち、開いているのは 21:30〜22:00 の30分
    const from = '2026-11-13T21:30:00.000Z';
    const to = '2026-11-13T23:00:00.000Z';
    expect(expectedChartTimestamps(from, to, '1m', FAR_FUTURE)).toHaveLength(30);
    expect(expectedChartTimestamps(from, to, '5m', FAR_FUTURE)).toHaveLength(6);
  });

  it('土曜は1本も無い', () => {
    expect(expectedChartTimestamps('2026-11-14T12:00:00.000Z', '2026-11-14T14:00:00.000Z', '1m', FAR_FUTURE)).toEqual(
      [],
    );
  });

  it('日曜の市場の始まり(ニューヨーク 17:00 = 22:00Z)から数える', () => {
    expect(
      expectedChartTimestamps('2026-11-15T21:30:00.000Z', '2026-11-15T22:30:00.000Z', '1m', FAR_FUTURE),
    ).toHaveLength(30);
  });

  it('休みの日(12/25・1/1)は1本も無い', () => {
    expect(expectedChartTimestamps('2026-12-25T12:00:00.000Z', '2026-12-25T13:00:00.000Z', '1m', FAR_FUTURE)).toEqual(
      [],
    );
  });

  it('知らない時間足は空', () => {
    expect(expectedChartTimestamps('2026-11-10T12:00:00.000Z', '2026-11-10T13:00:00.000Z', '2h', FAR_FUTURE)).toEqual(
      [],
    );
  });
});

describe('chartCandleCoverage — 欠損の状態(足は補わない。未来の時間帯は欠損に数えない)', () => {
  const from = '2026-11-10T13:00:00.000Z';
  const to = '2026-11-10T13:10:00.000Z'; // 1分足 10本が期待
  const minutes = (count: number, startOffset = 0) =>
    Array.from({ length: count }, (_, i) => new Date(Date.parse(from) + (startOffset + i) * 60_000).toISOString());
  const afterWindow = at('2026-11-10T13:30:00.000Z');

  it('窓が確定していて全部ある: READY', () => {
    expect(chartCandleCoverage(from, to, '1m', minutes(10), afterWindow)).toEqual({
      expected_candles: 10,
      returned_candles: 10,
      missing_candles: 0,
      unexpected_candles: 0,
      window_complete: true,
      data_status: 'READY',
    });
  });

  it('窓が確定していて一部が欠けている: DATA_UNAVAILABLE(欠けた数と返した数で程度が分かる)', () => {
    expect(chartCandleCoverage(from, to, '1m', minutes(7), afterWindow)).toMatchObject({
      expected_candles: 10,
      returned_candles: 7,
      missing_candles: 3,
      window_complete: true,
      data_status: 'DATA_UNAVAILABLE',
    });
  });

  it('窓が確定していて1本も無い: DATA_UNAVAILABLE', () => {
    expect(chartCandleCoverage(from, to, '1m', [], afterWindow)).toMatchObject({
      expected_candles: 10,
      returned_candles: 0,
      missing_candles: 10,
      data_status: 'DATA_UNAVAILABLE',
    });
  });

  it('進行中(窓の終わりが未来): 到来した分が全部あっても DATA_PENDING。READY にしない', () => {
    // 境目 13:05(now 13:07:30)→ 13:00〜13:04 の5本が期待
    const now = at('2026-11-10T13:07:30.000Z');
    expect(chartCandleCoverage(from, to, '1m', minutes(5), now)).toEqual({
      expected_candles: 5,
      returned_candles: 5,
      missing_candles: 0,
      unexpected_candles: 0,
      window_complete: false,
      data_status: 'DATA_PENDING',
    });
  });

  it('進行中: 未来の時間帯を欠損に数えない。到来した分の欠けだけを数える(状態は DATA_PENDING)', () => {
    const now = at('2026-11-10T13:07:30.000Z'); // 期待 5本(13:00〜13:04)
    expect(chartCandleCoverage(from, to, '1m', minutes(3), now)).toMatchObject({
      expected_candles: 5,
      returned_candles: 3,
      missing_candles: 2,
      window_complete: false,
      data_status: 'DATA_PENDING',
    });
  });

  it('窓の終了の直後: 境目が窓の終わりに届いた瞬間(to ≤ 境目)から window_complete = true', () => {
    // to = 13:10。境目 = floor(now − 2分)。now = 13:11:59 → 境目 13:09 → まだ未完了。now = 13:12:00 → 境目 13:10 → 完了
    expect(chartCandleCoverage(from, to, '1m', minutes(10), at('2026-11-10T13:11:59.000Z'))).toMatchObject({
      window_complete: false,
      data_status: 'DATA_PENDING',
    });
    expect(chartCandleCoverage(from, to, '1m', minutes(10), at('2026-11-10T13:12:00.000Z'))).toMatchObject({
      window_complete: true,
      data_status: 'READY',
    });
  });

  it('窓が全部未来(発表の前): 期待 0 本・DATA_PENDING', () => {
    expect(chartCandleCoverage(from, to, '1m', [], at('2026-11-10T12:00:00.000Z'))).toEqual({
      expected_candles: 0,
      returned_candles: 0,
      missing_candles: 0,
      unexpected_candles: 0,
      window_complete: false,
      data_status: 'DATA_PENDING',
    });
  });

  it('市場の休みで期待が0本、窓が確定していれば READY(欠損なし)', () => {
    expect(
      chartCandleCoverage(
        '2026-11-14T12:00:00.000Z',
        '2026-11-14T13:00:00.000Z',
        '1m',
        [],
        at('2026-11-18T00:00:00.000Z'),
      ),
    ).toMatchObject({
      expected_candles: 0,
      missing_candles: 0,
      window_complete: true,
      data_status: 'READY',
    });
  });

  it('休場時間の余分な足が、欠損を隠さない(本数は足りていても、欠けた足は欠損)', () => {
    // 金曜 21:30〜23:00Z。開いているのは 21:30〜21:59 の30分。そのうち29本 + 休場の 22:00〜22:04 の5本 = 34本を返した。
    const fridayFrom = '2026-11-13T21:30:00.000Z';
    const fridayTo = '2026-11-13T23:00:00.000Z';
    const open = Array.from({ length: 30 }, (_, i) => new Date(Date.parse(fridayFrom) + i * 60_000).toISOString());
    const closed = Array.from({ length: 5 }, (_, i) =>
      new Date(Date.parse('2026-11-13T22:00:00.000Z') + i * 60_000).toISOString(),
    );
    const returned = [...open.slice(0, 29), ...closed]; // 21:59 が無い
    const result = chartCandleCoverage(fridayFrom, fridayTo, '1m', returned, at('2026-11-14T12:00:00.000Z'));
    expect(result).toMatchObject({
      expected_candles: 30,
      returned_candles: 34, // 本数だけなら期待(30)を超える
      missing_candles: 1, // それでも 21:59 の欠けは欠損
      unexpected_candles: 5,
      window_complete: true,
      data_status: 'DATA_UNAVAILABLE',
    });
  });

  it('同じ時刻の足が重複しても、欠損を隠さない(時刻の集合で比べる)', () => {
    const dup = [...minutes(8), minutes(1)[0]!, minutes(1)[0]!]; // 異なる時刻は8つ、返した本数は10
    expect(chartCandleCoverage(from, to, '1m', dup, afterWindow)).toMatchObject({
      expected_candles: 10,
      returned_candles: 10,
      missing_candles: 2,
      data_status: 'DATA_UNAVAILABLE',
    });
  });

  it('5分足も、期待のタイムスタンプとの差で欠損を数える', () => {
    const w = resolveChartWindow('2026-11-10T13:30:00.000Z', '5m', { beforeMinutes: 10, afterMinutes: 10 }); // 13:20〜13:40
    const starts = ['13:20', '13:25', '13:30', '13:35'].map((t) => `2026-11-10T${t}:00.000Z`);
    expect(chartCandleCoverage(w.from, w.to, '5m', starts.slice(0, 3), afterWindow + 3_600_000)).toMatchObject({
      expected_candles: 4,
      missing_candles: 1,
      data_status: 'DATA_UNAVAILABLE',
    });
  });
});
