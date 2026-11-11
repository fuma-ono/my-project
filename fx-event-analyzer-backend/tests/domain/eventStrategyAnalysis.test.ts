/**
 * Pro イベント別トレード戦略分析(HQ指示 2026-11-06、api-design v1.48)。保存済みの値動きとスナップショットだけから数え、
 * 無い値を作らない・少ない回数で傾向を出さない、を確かめる。
 * HQ指示(2026-11-07「1分足欠損への対応」): 15分・60分のブレイク判定は1分足が全部揃っている(かつUNVERIFIEDでない)
 * ときだけ行い、欠損を「ブレイクなし」にしないことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeRelease,
  buildStrategyAnalysis,
  currencySide,
  isUsableStrategyPair,
  selectDefaultStrategyPair,
  STRATEGY_MINIMUM_SAMPLES,
  type StrategyPairCandidate,
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
  completeness: { complete15m?: boolean; complete60m?: boolean } = {},
  precision = 'EXACT',
): StrategyReleaseInput {
  return {
    event_id: id,
    release_datetime: `2026-0${id.slice(-1)}-10T12:30:00.000Z`,
    release_datetime_precision: precision,
    forecast: surpriseDirection ? 3.0 : null,
    actual: surpriseDirection ? 3.1 : null,
    surprise: surpriseDirection ? 0.1 : null,
    surprise_direction: surpriseDirection,
    reactions,
    minuteCompleteness15m: completeness.complete15m ?? true,
    minuteCompleteness60m: completeness.complete60m ?? true,
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

  describe('HQ指示(2026-11-09 P0): Sell the Fact の精度・2つの定義', () => {
    const sold = [reaction('1m', 3, 0.03, 0), reaction('15m', -12, 0.03, -0.12)];

    it('発表時刻が EXACT でない発表は、どちらの Sell the Fact も判定しない(15分の値動きがあっても)', () => {
      // APPROXIMATE は1分の値動きが作られず、15分だけがある(domain/dataQuality.ts)
      const only15 = [reaction('15m', -12, 0.03, -0.12)];
      for (const precision of ['APPROXIMATE', 'DATE_ONLY', 'UNKNOWN']) {
        const row = analyzeRelease(release('e1', only15, 'POSITIVE', {}, precision), 'BASE');
        expect(row.sell_the_fact, precision).toBeNull();
        expect(row.sell_the_fact_after_initial_rise, precision).toBeNull();
      }
      // 同じ値動きでも EXACT なら判定する
      expect(analyzeRelease(release('e1', only15, 'POSITIVE'), 'BASE').sell_the_fact).toBe(true);
    });

    it('「好結果で初動は通貨高、その後15分で通貨安」: 通貨ペアのどちら側かを見る', () => {
      // USDJPY(USD = BASE): 1分 +3(USD 高)→ 15分 -12(USD 安)
      expect(analyzeRelease(release('e1', sold, 'POSITIVE'), 'BASE').sell_the_fact_after_initial_rise).toBe(true);
      // EURUSD(USD = QUOTE): 同じ動きは 1分 USD 安 → 15分 USD 高
      expect(analyzeRelease(release('e1', sold, 'POSITIVE'), 'QUOTE').sell_the_fact_after_initial_rise).toBe(false);
      // QUOTE で 1分 -3(USD 高)→ 15分 +12(USD 安)
      const quoteSold = [reaction('1m', -3, 0, -0.0003), reaction('15m', 12, 0.0012, -0.0003)];
      expect(analyzeRelease(release('e1', quoteSold, 'POSITIVE'), 'QUOTE').sell_the_fact_after_initial_rise).toBe(true);
    });

    it('初動が通貨安・横ばいなら「初動は通貨高」の方は false(好結果なのに15分後に通貨安の方は true)', () => {
      const weakFirst = analyzeRelease(
        release('e1', [reaction('1m', -2, 0, -0.02), reaction('15m', -12, 0, -0.12)], 'POSITIVE'),
        'BASE',
      );
      expect(weakFirst.sell_the_fact).toBe(true);
      expect(weakFirst.sell_the_fact_after_initial_rise).toBe(false);
      const flatFirst = analyzeRelease(
        release('e1', [reaction('1m', 0, 0, 0), reaction('15m', -12, 0, -0.12)], 'POSITIVE'),
        'BASE',
      );
      expect(flatFirst.sell_the_fact_after_initial_rise).toBe(false);
    });

    it('1分後の値が無ければ「初動は通貨高」の方は判定しない(15分だけの判定は残る)', () => {
      const row = analyzeRelease(release('e1', [reaction('15m', -12, 0, -0.12)], 'POSITIVE'), 'BASE');
      expect(row.sell_the_fact).toBe(true);
      expect(row.sell_the_fact_after_initial_rise).toBeNull();
      expect(analyzeRelease(release('e1', sold, 'NEGATIVE'), 'BASE').sell_the_fact_after_initial_rise).toBeNull();
      expect(analyzeRelease(release('e1', sold, 'POSITIVE'), null).sell_the_fact_after_initial_rise).toBeNull();
    });
  });

  describe('1分足の欠損・UNVERIFIEDへの対応(HQ指示 2026-11-07)', () => {
    const full = [reaction('1m', 8, 0.1, -0.02), reaction('15m', 20, 0.25, -0.02), reaction('60m', -5, 0.3, -0.3)];

    it('15分のブレイクはnull(欠損をブレイクなしにしない)だが、1分・5分判定(direction_1m・pattern_15m)には影響しない', () => {
      const row = analyzeRelease(release('e1', full, null, { complete15m: false }), 'BASE');
      expect(row.high_break_15m).toBeNull();
      expect(row.low_break_15m).toBeNull();
      // 60分の窓は揃っているので影響を受けない
      expect(row.high_break_60m).toBe(true);
      expect(row.low_break_60m).toBe(true);
      // 既存の1分、15分pipsの判定(direction_1m・pattern_15m)はこの確認の対象外
      expect(row.direction_1m).toBe('UP');
      expect(row.pattern_15m).toBe('CONTINUATION');
    });

    it('60分のブレイクはnull(1分足の欠損・UNVERIFIEDを含む)', () => {
      const row = analyzeRelease(release('e1', full, null, { complete60m: false }), 'BASE');
      expect(row.high_break_60m).toBeNull();
      expect(row.low_break_60m).toBeNull();
      // 15分の窓は揃っているので影響を受けない
      expect(row.high_break_15m).toBe(true);
      expect(row.low_break_15m).toBe(false);
    });

    it('15分・60分とも窓の1分足が揃っていれば(15本・60本、UNVERIFIEDなし)通常どおり判定する', () => {
      const row = analyzeRelease(release('e1', full, null, { complete15m: true, complete60m: true }), 'BASE');
      expect(row.high_break_15m).toBe(true);
      expect(row.low_break_15m).toBe(false);
      expect(row.high_break_60m).toBe(true);
      expect(row.low_break_60m).toBe(true);
    });
  });

  describe('リスク特性の追加(HQ指示 2026-11-10 STEP3): pips_5m・pips_30m・往復(round_trip)', () => {
    it('5分・30分の値動きは、保存されていれば pips として返す(無ければ null)', () => {
      const row = analyzeRelease(
        release('e1', [
          reaction('1m', 8, 0.1, -0.02),
          reaction('5m', 15, 0.18, -0.02),
          reaction('15m', 20, 0.25, -0.02),
          reaction('30m', null, null, null, 'UNAVAILABLE'),
          reaction('60m', -5, 0.25, -0.3),
        ]),
        'BASE',
      );
      expect(row).toMatchObject({ pips_5m: 15, pips_30m: null, pips_60m: -5 });
    });

    it('往復(round_trip): 1分の高値・安値を、その窓の中で両方とも抜けた(高値だけ・安値だけでは false)', () => {
      // 実データ調査(docs/projects/event-strategy-trading-utility-report.md、USDJPY 2026-11-06)で確認した型:
      // 15分までには高値だけ抜け、安値は60分まで抜けなかった(= 15分では往復していないが、60分では往復した)。
      const row = analyzeRelease(
        release('e1', [
          reaction('1m', 10, 0.1, -0.02),
          reaction('15m', 20, 0.3, -0.02), // 高値を抜いた(0.3 > 0.1)が、安値は抜いていない(-0.02 = -0.02)
          reaction('60m', -5, 0.3, -0.25), // 安値も抜いた(-0.25 < -0.02)
        ]),
        'BASE',
      );
      expect(row).toMatchObject({
        high_break_15m: true,
        low_break_15m: false,
        round_trip_15m: false,
        high_break_60m: true,
        low_break_60m: true,
        round_trip_60m: true,
      });
    });

    it('高値・安値どちらかの判定ができない(1分足の欠損・データなし)ときは round_trip も null', () => {
      const row = analyzeRelease(
        release('e1', [reaction('1m', 8, 0.1, -0.02), reaction('15m', 20, 0.25, -0.02)], null, {
          complete15m: false,
        }),
        'BASE',
      );
      expect(row.high_break_15m).toBeNull();
      expect(row.round_trip_15m).toBeNull();
    });
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
    completeness: { complete15m?: boolean; complete60m?: boolean } = {},
  ) =>
    release(
      id,
      [reaction('1m', m1, up1, dn1), reaction('15m', m15, up15, dn15), reaction('60m', m15, up15, dn15)],
      sd,
      completeness,
    );

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
    // 初動は通貨高 → 15分で通貨安: e1(+5→+10 いいえ)・e2(-4 初動が通貨安 いいえ)・e3(+3→-2 はい) → 3回のうち1回
    expect(analysis.summary.sell_the_fact_after_initial_rise).toEqual({ occurred: 1, samples: 3 });
  });

  it('EXACT でない発表は Sell the Fact の分母に入らない(HQ指示 2026-11-09 P0)', () => {
    const approx = (id: string) =>
      release(id, [reaction('15m', -9, 0, -0.1), reaction('60m', -9, 0, -0.1)], 'POSITIVE', {}, 'APPROXIMATE');
    const analysis = buildStrategyAnalysis(
      [full('e1', 5, 10, 0.05, 0.12, -0.01, -0.01, 'POSITIVE'), approx('e2'), approx('e3'), approx('e4')],
      'USDJPY',
      'USD',
    );
    // 修正前は APPROXIMATE の3回が15分だけで判定され、「4回中3回」と出ていた
    expect(analysis.releases.slice(1).every((r) => r.sell_the_fact === null)).toBe(true);
    expect(analysis.summary.sell_the_fact).toBeNull();
    expect(analysis.summary.sell_the_fact_after_initial_rise).toBeNull();
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
      sell_the_fact_after_initial_rise: null,
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

  it('excludes releases with an incomplete 1-minute window from the breaks summary, without breaking the samples needed elsewhere (HQ指示 2026-11-07)', () => {
    const analysis = buildStrategyAnalysis(
      [
        full('e1', 5, 10, 0.05, 0.12, -0.01, -0.01, null, { complete15m: false }),
        full('e2', -4, -9, 0.0, 0.0, -0.05, -0.1, null, { complete15m: true }),
        full('e3', 3, -2, 0.04, 0.04, -0.01, -0.05, null, { complete15m: true }),
      ],
      'USDJPY',
      'USD',
    );
    // direction_1m・pattern_15m は1分足の欠損確認の対象外なので、3件とも判定できる(e1:+5→UP, e2:-4→DOWN, e3:+3→UP)
    expect(analysis.summary.direction_1m).toEqual({ up: 2, down: 1, flat: 0, samples: 3 });
    // breaks_15mはe1がnullになるため、判定できたのは2件 → 3件未満でDATA_PREPARING(null)
    expect(analysis.releases[0]!.high_break_15m).toBeNull();
    expect(analysis.summary.breaks_15m).toBeNull();
  });
});

describe('通貨ペアの選択・並び順(HQ指示 2026-11-09 P0)', () => {
  const pair = (
    symbol: string,
    priority: number,
    overrides: Partial<StrategyPairCandidate> = {},
  ): StrategyPairCandidate => ({
    fx_pair_id: `id-${symbol}`,
    symbol,
    base_currency: symbol.slice(0, 3),
    quote_currency: symbol.slice(3, 6),
    is_active: true,
    priority,
    ...overrides,
  });

  it('使えるのは、有効で指標の通貨を含むペアだけ', () => {
    expect(isUsableStrategyPair(pair('USDJPY', 1), 'USD')).toBe(true);
    expect(isUsableStrategyPair(pair('EURUSD', 1), 'USD')).toBe(true);
    expect(isUsableStrategyPair(pair('EURJPY', 1), 'USD')).toBe(false); // USD を含まない(値動きが計算されない)
    expect(isUsableStrategyPair(pair('USDJPY', 1, { is_active: false }), 'USD')).toBe(false);
    expect(isUsableStrategyPair(pair('USDJPY', 1), null)).toBe(false);
  });

  it('既定のペア: 使えないペアを飛ばし、priority → 主要ペアの順 → symbol で決まる(入力の順によらない)', () => {
    expect(selectDefaultStrategyPair([pair('USDJPY', 1, { is_active: false }), pair('EURUSD', 2)], 'USD')?.symbol).toBe(
      'EURUSD',
    );
    expect(selectDefaultStrategyPair([pair('EURJPY', 1), pair('GBPUSD', 5)], 'USD')?.symbol).toBe('GBPUSD');
    // 同じ priority: 主要ペアの順(USDJPY → EURUSD → GBPUSD …)。入力の順を入れ替えても同じ
    const tie = [pair('GBPUSD', 1), pair('EURUSD', 1), pair('USDJPY', 1)];
    expect(selectDefaultStrategyPair(tie, 'USD')?.symbol).toBe('USDJPY');
    expect(selectDefaultStrategyPair([...tie].reverse(), 'USD')?.symbol).toBe('USDJPY');
    // priority が小さい方が先(主要ペアの順より優先)
    expect(selectDefaultStrategyPair([pair('USDJPY', 2), pair('GBPUSD', 1)], 'USD')?.symbol).toBe('GBPUSD');
    // 主要ペアの順に無いもの同士は symbol 順
    expect(selectDefaultStrategyPair([pair('USDSGD', 1), pair('USDHKD', 1)], 'USD')?.symbol).toBe('USDHKD');
    // 使えるペアが無い
    expect(selectDefaultStrategyPair([pair('EURJPY', 1)], 'USD')).toBeNull();
    expect(selectDefaultStrategyPair([], 'USD')).toBeNull();
  });
});
