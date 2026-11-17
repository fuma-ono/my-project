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

// ---- 第1段階の拡張(HQ指示 2026-11-17): before_minutes / after_minutes・期待本数・欠損の状態 ----
import {
  CHART_MAX_AFTER_MINUTES,
  CHART_MAX_BEFORE_MINUTES,
  chartCandleCoverage,
  defaultChartMinutes,
  expectedChartCandles,
  parseChartMinutes,
  resolveChartWindow,
} from '../../src/domain/chartWindow.js';

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

describe('expectedChartCandles — 市場が開いている間の足の数', () => {
  // 2026-11-10 は火曜(通常の営業日)。
  const tue = '2026-11-10T13:30:00.000Z';

  it('1分足: 発表の60分前から120分後まで = 180本', () => {
    const w = resolveChartWindow(tue, '1m', { beforeMinutes: 60, afterMinutes: 120 });
    expect(expectedChartCandles(w.from, w.to, '1m')).toBe(180);
  });

  it('5・15・30・60分足は、エポックの区切りに揃った足だけを数える', () => {
    const w = resolveChartWindow(tue, '1m', { beforeMinutes: 60, afterMinutes: 120 }); // 12:30〜15:30
    expect(expectedChartCandles(w.from, w.to, '5m')).toBe(36);
    expect(expectedChartCandles(w.from, w.to, '15m')).toBe(12);
    expect(expectedChartCandles(w.from, w.to, '30m')).toBe(6);
    // 60分足: 13:00・14:00・15:00(12:30 は区切りでない)
    expect(expectedChartCandles(w.from, w.to, '60m')).toBe(3);
  });

  it('金曜の市場の終わり(ニューヨーク 17:00 = 冬時間の 22:00Z)から先は数えない', () => {
    // 2026-11-13(金)21:30〜23:00Z のうち、開いているのは 21:30〜22:00 の30分
    expect(expectedChartCandles('2026-11-13T21:30:00.000Z', '2026-11-13T23:00:00.000Z', '1m')).toBe(30);
    expect(expectedChartCandles('2026-11-13T21:30:00.000Z', '2026-11-13T23:00:00.000Z', '5m')).toBe(6);
  });

  it('土曜は1本も無い(期待本数 0)', () => {
    expect(expectedChartCandles('2026-11-14T12:00:00.000Z', '2026-11-14T14:00:00.000Z', '1m')).toBe(0);
  });

  it('日曜の市場の始まり(ニューヨーク 17:00 = 22:00Z)から数える', () => {
    expect(expectedChartCandles('2026-11-15T21:30:00.000Z', '2026-11-15T22:30:00.000Z', '1m')).toBe(30);
  });

  it('休みの日(12/25・1/1)は1本も無い', () => {
    expect(expectedChartCandles('2026-12-25T12:00:00.000Z', '2026-12-25T13:00:00.000Z', '1m')).toBe(0);
  });

  it('知らない時間足は 0', () => {
    expect(expectedChartCandles('2026-11-10T12:00:00.000Z', '2026-11-10T13:00:00.000Z', '2h')).toBe(0);
  });
});

describe('chartCandleCoverage — 欠損の状態(足は補わない)', () => {
  const from = '2026-11-10T13:00:00.000Z';
  const to = '2026-11-10T13:10:00.000Z'; // 1分足 10本が期待
  const minutes = (count: number, startOffset = 0) =>
    Array.from({ length: count }, (_, i) => new Date(Date.parse(from) + (startOffset + i) * 60_000).toISOString());

  it('全部ある: READY', () => {
    expect(chartCandleCoverage(from, to, '1m', minutes(10))).toEqual({
      expected_candles: 10,
      returned_candles: 10,
      missing_candles: 0,
      data_status: 'READY',
    });
  });

  it('一部だけ: PARTIAL(欠けた本数を返す)', () => {
    expect(chartCandleCoverage(from, to, '1m', minutes(7))).toEqual({
      expected_candles: 10,
      returned_candles: 7,
      missing_candles: 3,
      data_status: 'PARTIAL',
    });
  });

  it('1本も無い: DATA_UNAVAILABLE', () => {
    expect(chartCandleCoverage(from, to, '1m', [])).toEqual({
      expected_candles: 10,
      returned_candles: 0,
      missing_candles: 10,
      data_status: 'DATA_UNAVAILABLE',
    });
  });

  it('範囲の外の足(取得の境界の足 `to` ちょうど・範囲より前)は数えない', () => {
    const extra = [...minutes(10), to, new Date(Date.parse(from) - 60_000).toISOString()];
    expect(chartCandleCoverage(from, to, '1m', extra)).toMatchObject({
      returned_candles: 10,
      missing_candles: 0,
      data_status: 'READY',
    });
  });

  it('期待が 0 本(市場の休み)で返却も 0 本なら、欠損なしの READY', () => {
    expect(chartCandleCoverage('2026-11-14T12:00:00.000Z', '2026-11-14T13:00:00.000Z', '1m', [])).toEqual({
      expected_candles: 0,
      returned_candles: 0,
      missing_candles: 0,
      data_status: 'READY',
    });
  });

  it('期待より多くても、欠損は負にならない', () => {
    // 期待10本の窓に、同じ分が重複して11本あった場合(あり得ないが、missing は 0)
    expect(chartCandleCoverage(from, to, '1m', [...minutes(10), minutes(1)[0]!]).missing_candles).toBe(0);
  });
});
