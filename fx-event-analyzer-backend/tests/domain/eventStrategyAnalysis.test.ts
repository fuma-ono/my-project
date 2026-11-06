/**
 * Pro イベント別トレード戦略分析(HQ指示 2026-11-06、api-design v1.48)。保存済みの値動きとスナップショットだけから数え、
 * 無い値を作らない・少ない回数で傾向を出さない、を確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeRelease,
  buildStrategyAnalysis,
  currencySide,
  STRATEGY_MINIMUM_SAMPLES,
  type StrategyReactionInput,
  type StrategyReleaseInput,
} from '../../src/domain/eventStrategyAnalysis.js';

/** 発表直前の価格からの最大・最小(価格の幅)と pips。 */
function reaction(
  timeframe: string,
  pips: number | null,
  up: number | null,
  down: number | null,
  status = 'AVAILABLE',
) {
  return { timeframe, pips, max_upward: up, max_downward: down, data_status: status } satisfies StrategyReactionInput;
}

function release(
  id: string,
  reactions: StrategyReactionInput[],
  surpriseDirection: string | null = null,
): StrategyReleaseInput {
  return {
    event_id: id,
    release_datetime: `2026-0${id.slice(-1)}-10T12:30:00.000Z`,
    forecast: surpriseDirection ? 3.0 : null,
    actual: surpriseDirection ? 3.1 : null,
    surprise: surpriseDirection ? 0.1 : null,
    surprise_direction: surpriseDirection,
    reactions,
  };
}

describe('analyzeRelease', () => {
  it('reads the direction, the 15m pattern and the breaks of the first-minute high/low from the stored excursions', () => {
    // 1分: 高値 +0.10・安値 -0.02、15分: 高値 +0.25(上に抜けた)・安値 -0.02(同じ = 抜けていない)
    const row = analyzeRelease(
      release('e1', [reaction('1m', 8, 0.1, -0.02), reaction('15m', 20, 0.25, -0.02), reaction('60m', -5, 0.25, -0.3)]),
      'BASE',
    );
    expect(row).toMatchObject({
      direction_1m: 'UP',
      pips_1m: 8,
      pips_15m: 20,
      pattern_15m: 'CONTINUATION',
      high_break_15m: true,
      low_break_15m: false,
      high_break_60m: true,
      low_break_60m: true,
    });
  });

  it('reports a reversal and a downside break', () => {
    const row = analyzeRelease(
      release('e1', [reaction('1m', -6, 0.01, -0.06), reaction('15m', 9, 0.15, -0.08)]),
      'BASE',
    );
    expect(row).toMatchObject({
      direction_1m: 'DOWN',
      pattern_15m: 'REVERSAL',
      high_break_15m: true,
      low_break_15m: true,
    });
  });

  it('leaves everything it cannot judge as null (no made-up values)', () => {
    const row = analyzeRelease(
      release('e1', [reaction('1m', 4, 0.05, -0.01), reaction('15m', null, null, null, 'UNAVAILABLE')]),
      'BASE',
    );
    expect(row).toMatchObject({
      direction_1m: 'UP',
      pips_15m: null,
      pattern_15m: null,
      high_break_15m: null,
      low_break_15m: null,
      high_break_60m: null,
      low_break_60m: null,
      sell_the_fact: null,
      forecast: null,
      actual: null,
      surprise: null,
    });
    expect(analyzeRelease(release('e2', []), 'BASE')).toMatchObject({
      direction_1m: null,
      pips_1m: null,
      pattern_15m: null,
    });
    // 1分か15分が 0 なら、続いた・反転したとは言わない
    expect(
      analyzeRelease(release('e3', [reaction('1m', 0, 0, 0), reaction('15m', 5, 0.05, 0)]), 'BASE').pattern_15m,
    ).toBeNull();
  });

  it('Sell the Fact: a currency-positive result, then the currency sold within 15 minutes (side of the pair matters)', () => {
    const sold = [reaction('1m', 3, 0.03, 0), reaction('15m', -12, 0.03, -0.12)];
    expect(analyzeRelease(release('e1', sold, 'POSITIVE'), 'BASE').sell_the_fact).toBe(true); // USDJPY が下がった = USD 安
    expect(analyzeRelease(release('e1', sold, 'POSITIVE'), 'QUOTE').sell_the_fact).toBe(false); // EURUSD が下がった = USD 高
    const bought = [reaction('1m', 3, 0.03, 0), reaction('15m', 12, 0.12, 0)];
    expect(analyzeRelease(release('e1', bought, 'POSITIVE'), 'BASE').sell_the_fact).toBe(false);
    // 良い結果でない・予想が無い・指標の通貨が通貨ペアに無い: 判定しない
    expect(analyzeRelease(release('e1', sold, 'NEGATIVE'), 'BASE').sell_the_fact).toBeNull();
    expect(analyzeRelease(release('e1', sold, null), 'BASE').sell_the_fact).toBeNull();
    expect(analyzeRelease(release('e1', sold, 'POSITIVE'), null).sell_the_fact).toBeNull();
  });
});

describe('currencySide', () => {
  it('finds the indicator currency in the pair', () => {
    expect(currencySide('USDJPY', 'USD')).toBe('BASE');
    expect(currencySide('EURUSD', 'USD')).toBe('QUOTE');
    expect(currencySide('EURJPY', 'USD')).toBeNull();
    expect(currencySide('USDJPY', null)).toBeNull();
  });
});

describe('buildStrategyAnalysis', () => {
  const full = (
    id: string,
    m1: number,
    m15: number,
    up1: number,
    up15: number,
    dn1: number,
    dn15: number,
    sd: string | null = null,
  ) =>
    release(id, [reaction('1m', m1, up1, dn1), reaction('15m', m15, up15, dn15), reaction('60m', m15, up15, dn15)], sd);

  it('counts the tendencies over up to 5 past releases when each item has at least 3 samples', () => {
    const analysis = buildStrategyAnalysis(
      [
        full('e1', 5, 10, 0.05, 0.12, -0.01, -0.01, 'POSITIVE'),
        full('e2', -4, -9, 0.0, 0.0, -0.05, -0.1, 'POSITIVE'),
        full('e3', 3, -2, 0.04, 0.04, -0.01, -0.05, 'POSITIVE'),
        full('e4', 6, 8, 0.06, 0.09, 0.0, 0.0, 'NEGATIVE'),
        full('e5', -2, 4, 0.0, 0.05, -0.03, -0.03),
        full('e6', 9, 9, 0.1, 0.2, 0, -0.1), // 6回目は使わない
      ],
      'USDJPY',
      'USD',
    );
    expect(analysis.status).toBe('READY');
    expect(analysis.releases.map((r) => r.event_id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(analysis.summary.direction_1m).toEqual({ up: 3, down: 2, flat: 0, samples: 5 });
    expect(analysis.summary.pattern_15m).toEqual({ continuation: 3, reversal: 2, samples: 5 });
    // 上に抜けた: e1・e4・e5 / 下に抜けた: e2・e3 / 両方: なし / どちらも無し: なし
    expect(analysis.summary.breaks_15m).toEqual({ high: 3, low: 2, both: 0, neither: 0, samples: 5 });
    // POSITIVE は e1(15分 +10 = USD 高)・e2(-9 = USD 安)・e3(-2 = USD 安) → 3回のうち2回
    expect(analysis.summary.sell_the_fact).toEqual({ occurred: 2, samples: 3 });
  });

  it(`is DATA_PREPARING with no tendency when fewer than ${STRATEGY_MINIMUM_SAMPLES} releases can be compared`, () => {
    const analysis = buildStrategyAnalysis(
      [full('e1', 5, 10, 0.05, 0.12, -0.01, -0.01), full('e2', -4, -9, 0, 0, -0.05, -0.1), release('e3', [])],
      'USDJPY',
      'USD',
    );
    expect(analysis.status).toBe('DATA_PREPARING');
    expect(analysis.releases).toHaveLength(3); // 個々の発表は見せる
    expect(analysis.summary).toEqual({
      direction_1m: null,
      breaks_15m: null,
      breaks_60m: null,
      pattern_15m: null,
      sell_the_fact: null,
    });
  });

  it('gives a per-item tendency only for the items with enough samples (e.g. no forecasts → no Sell the Fact)', () => {
    const analysis = buildStrategyAnalysis(
      [
        full('e1', 5, 10, 0.05, 0.12, -0.01, -0.01),
        full('e2', -4, -9, 0, 0, -0.05, -0.1),
        full('e3', 3, -2, 0.04, 0.04, -0.01, -0.05),
      ],
      'USDJPY',
      'USD',
    );
    expect(analysis.status).toBe('READY');
    expect(analysis.summary.direction_1m).not.toBeNull();
    expect(analysis.summary.sell_the_fact).toBeNull();
  });

  it('is DATA_PREPARING with no releases at all', () => {
    expect(buildStrategyAnalysis([], 'USDJPY', 'USD')).toMatchObject({ status: 'DATA_PREPARING', releases: [] });
  });
});
