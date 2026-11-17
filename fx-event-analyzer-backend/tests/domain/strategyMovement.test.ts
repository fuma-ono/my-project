import { describe, expect, it } from 'vitest';
import {
  assessMovement,
  buildStrategyAnalysis,
  DEFAULT_STRATEGY_CLASSIFICATION,
  type MinuteCandleInput,
  type StrategyReactionInput,
  type StrategyReleaseInput,
} from '../../src/domain/eventStrategyAnalysis.js';

/**
 * 値動きの分類(assessMovement。HQ指示 2026-11-17「Strategy Analysis バックエンド実装 第1段階」と「Cレビュー反映」)。
 * 閾値(pullbackMinRatio)は本番では未設定(null)。ここで使う 0.5 は「閾値を渡したときの分岐を確かめる」ための
 * テスト用の値で、運用の閾値ではない。
 *
 * 1分足の系列を先に決め、保存値(event_price_reactions の行)はその系列から計算して作る(= 保存値と系列が整合した状態)。
 * 矛盾のテストは、その整合した状態の一部を壊して作る。価格は発表直前を 150、1 pip = 0.01。
 */

const TEST_CONFIG = { pullbackMinRatio: 0.5 } as const;
const PRE = 150;
const PIP = 0.01;
const RELEASE_AT = '2026-11-10T13:30:00.000Z';

/** 発表直前の価格からの pips で表した足(高値・安値・終値)。 */
interface Candle {
  h: number;
  l: number;
  c: number;
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const round2 = (value: number) => Math.round(value * 100) / 100;
const price = (offsetPips: number) => round6(PRE + offsetPips * PIP);

/**
 * 60本の1分足(1本目 = 発表の瞬間に始まる足)。`first` が1本目、`at` が n 本目(1始まり)の上書き。
 * それ以外の足は、前の足の終値のまま動かない(高値 = 安値 = 終値)。
 */
function series(first: Candle, at: Record<number, Candle> = {}): Candle[] {
  const result: Candle[] = [];
  for (let n = 1; n <= 60; n += 1) {
    const prev = result[n - 2];
    result.push(n === 1 ? first : (at[n] ?? { h: prev!.c, l: prev!.c, c: prev!.c }));
  }
  return result;
}

function candleInputs(candles: readonly Candle[], unverifiedAt: readonly number[] = []): MinuteCandleInput[] {
  return candles.map((candle, index) => ({
    timestamp: new Date(Date.parse(RELEASE_AT) + index * 60_000).toISOString(),
    high: price(candle.h),
    low: price(candle.l),
    close: price(candle.c),
    unverified: unverifiedAt.includes(index + 1),
  }));
}

/** 先頭 minutes 本の足から、event_price_reactions の行(保存値)を計算する。 */
function reactionRow(timeframe: string, candles: readonly Candle[], minutes: number): StrategyReactionInput {
  const window = candles.slice(0, minutes);
  const maxUp = Math.max(...window.map((c) => c.h));
  const maxDown = Math.min(...window.map((c) => c.l));
  return {
    timeframe,
    pips: round2(window[minutes - 1]!.c),
    max_upward: round6(maxUp * PIP),
    max_downward: round6(maxDown * PIP),
    max_upward_pips: round2(maxUp),
    max_downward_pips: round2(maxDown),
    pre_release_price: PRE,
    data_status: 'AVAILABLE',
  };
}

function release(candles: readonly Candle[], overrides: Partial<StrategyReleaseInput> = {}): StrategyReleaseInput {
  return {
    event_id: 'e1',
    release_datetime: RELEASE_AT,
    forecast: null,
    actual: null,
    surprise: null,
    surprise_direction: null,
    release_datetime_precision: 'EXACT',
    minuteCompleteness15m: true,
    minuteCompleteness60m: true,
    reactions: [reactionRow('1m', candles, 1), reactionRow('15m', candles, 15), reactionRow('60m', candles, 60)],
    minuteCandles: candleInputs(candles),
    pip_size: PIP,
    ...overrides,
  };
}

/** 反応の行の一部を差し替える。 */
function withReaction(
  base: StrategyReleaseInput,
  timeframe: string,
  patch: Partial<StrategyReactionInput>,
): StrategyReleaseInput {
  return { ...base, reactions: base.reactions.map((r) => (r.timeframe === timeframe ? { ...r, ...patch } : r)) };
}

describe('assessMovement — 反転・全戻し(閾値を使わない分類)', () => {
  it('REVERSAL: 初動は上、15分後は発表直前の価格より下(最終的に逆側)', () => {
    const r = release(series({ h: 12, l: -1, c: 10 }, { 2: { h: 10, l: -20, c: -8 } }));
    const a = assessMovement(r, '15m');
    expect(a).toMatchObject({
      class: 'REVERSAL',
      reason: null,
      initial_direction: 'UP',
      favorable_peak_pips: 12,
      final_pips_in_initial_direction: -8,
      final_side: 'OPPOSITE',
      crossed_pre_price_after_initial: true,
    });
    expect(a.retrace_ratio).toBeCloseTo(20 / 12, 4);
  });

  it('REVERSAL: 初動は下、最終的に上(対称)', () => {
    const r = release(series({ h: 1, l: -12, c: -10 }, { 2: { h: 14, l: -12, c: 6 } }));
    expect(assessMovement(r, '15m')).toMatchObject({
      class: 'REVERSAL',
      initial_direction: 'DOWN',
      favorable_peak_pips: 12,
      final_pips_in_initial_direction: -6,
      final_side: 'OPPOSITE',
      crossed_pre_price_after_initial: true,
    });
  });

  it('FULL_RETRACEMENT: 2分目以降に発表直前の価格を割ったが、最終的には初動と同じ側(反転とは区別する)', () => {
    const r = release(series({ h: 12, l: -1, c: 10 }, { 2: { h: 14, l: -5, c: 7 } }));
    expect(assessMovement(r, '15m')).toMatchObject({
      class: 'FULL_RETRACEMENT',
      reason: null,
      final_side: 'SAME',
      crossed_pre_price_after_initial: true,
      final_pips_in_initial_direction: 7,
    });
  });

  it('FULL_RETRACEMENT: 窓の終わりが発表直前の価格と同じ(AT_PRE)', () => {
    const r = release(series({ h: 12, l: 1, c: 10 }, { 2: { h: 12, l: 0, c: 0 } }));
    expect(assessMovement(r, '15m')).toMatchObject({ class: 'FULL_RETRACEMENT', final_side: 'AT_PRE' });
  });

  it('2分目以降の足の安値が、発表直前の価格ちょうど(以下)なら「超えた」', () => {
    const r = release(series({ h: 12, l: 1, c: 10 }, { 5: { h: 11, l: 0, c: 9 } }));
    expect(assessMovement(r, '15m').crossed_pre_price_after_initial).toBe(true);
  });

  it('最初の1分足の中だけの逆側への振れ(1本目の安値が発表直前の価格を割る)は「後」に数えない', () => {
    // 1本目の安値は -3(発表直前の価格より下)。2本目以降の安値は 2 より下がらない。
    const r = release(series({ h: 12, l: -3, c: 10 }, { 2: { h: 12, l: 2, c: 9 } }));
    const a = assessMovement(r, '15m');
    expect(a.crossed_pre_price_after_initial).toBe(false);
    expect(a.class).toBe('UNDETERMINED'); // 閾値が未設定
    expect(assessMovement(r, '15m', TEST_CONFIG).class).toBe('CONTINUATION');
  });

  it('crossed = false は、窓の1分足が揃っていて、2分目以降のどの足も届かなかったときだけ', () => {
    const r = release(series({ h: 20, l: 2, c: 10 }, { 2: { h: 20, l: 4, c: 14 } }));
    expect(assessMovement(r, '15m')).toMatchObject({
      reason: 'THRESHOLD_NOT_SET',
      crossed_pre_price_after_initial: false,
    });
  });

  it('初動が下のとき、2分目以降に発表直前の価格を上に超えたら全戻し(対称)', () => {
    const r = release(series({ h: -0.5, l: -12, c: -10 }, { 3: { h: 3, l: -12, c: -6 } }));
    expect(assessMovement(r, '15m')).toMatchObject({
      class: 'FULL_RETRACEMENT',
      initial_direction: 'DOWN',
      crossed_pre_price_after_initial: true,
      final_side: 'SAME',
    });
  });

  it('初動が下で、2分目以降の高値が発表直前の価格に届かなければ crossed = false', () => {
    const r = release(series({ h: -0.5, l: -12, c: -10 }, { 2: { h: -2, l: -14, c: -12 } }));
    expect(assessMovement(r, '15m').crossed_pre_price_after_initial).toBe(false);
  });

  it('60分の窓は、16本目以降の足も見る(15分の窓では届かず、60分の窓では届く)', () => {
    const r = release(series({ h: 12, l: 2, c: 10 }, { 40: { h: 10, l: -2, c: 5 } }));
    expect(assessMovement(r, '15m')).toMatchObject({ crossed_pre_price_after_initial: false });
    expect(assessMovement(r, '60m')).toMatchObject({
      class: 'FULL_RETRACEMENT',
      crossed_pre_price_after_initial: true,
    });
  });
});

describe('assessMovement — 継続・押し戻し(閾値が要る分類)', () => {
  // 最終的に初動と同じ側で、2分目以降に発表直前の価格へは届いていない。戻し率 = (peak − final) / peak。
  const holds = release(series({ h: 20, l: 2, c: 10 }, { 2: { h: 20, l: 8, c: 14 } }));
  const deepPullback = release(series({ h: 20, l: 2, c: 10 }, { 2: { h: 20, l: 6, c: 6 } }));

  it('閾値が未設定(null)の間は UNDETERMINED(THRESHOLD_NOT_SET)。戻し率などの測定値は返す', () => {
    expect(DEFAULT_STRATEGY_CLASSIFICATION.pullbackMinRatio).toBeNull();
    const a = assessMovement(holds, '15m');
    expect(a).toMatchObject({
      class: 'UNDETERMINED',
      reason: 'THRESHOLD_NOT_SET',
      initial_direction: 'UP',
      favorable_peak_pips: 20,
      final_pips_in_initial_direction: 14,
      final_side: 'SAME',
      crossed_pre_price_after_initial: false,
    });
    expect(a.retrace_ratio).toBeCloseTo(0.3, 4);
  });

  it('閾値を渡すと、戻し率が閾値未満なら CONTINUATION、以上なら PULLBACK(テスト用の値 0.5)', () => {
    expect(assessMovement(holds, '15m', TEST_CONFIG)).toMatchObject({ class: 'CONTINUATION', reason: null });
    expect(assessMovement(deepPullback, '15m', TEST_CONFIG)).toMatchObject({ class: 'PULLBACK', reason: null });
  });

  it('戻し率がちょうど閾値なら PULLBACK(以上)', () => {
    const exactly = release(series({ h: 20, l: 2, c: 10 }, { 2: { h: 20, l: 10, c: 10 } }));
    const a = assessMovement(exactly, '15m', TEST_CONFIG);
    expect(a.retrace_ratio).toBeCloseTo(0.5, 4);
    expect(a.class).toBe('PULLBACK');
  });

  it('初動が下でも同じ(対称)', () => {
    const down = release(series({ h: -2, l: -20, c: -10 }, { 2: { h: -8, l: -20, c: -14 } }));
    expect(assessMovement(down, '15m', TEST_CONFIG)).toMatchObject({
      class: 'CONTINUATION',
      initial_direction: 'DOWN',
      favorable_peak_pips: 20,
      final_pips_in_initial_direction: 14,
    });
  });

  it('60分の窓も同じ規則で、別に判定する', () => {
    expect(assessMovement(holds, '60m', TEST_CONFIG).class).toBe('CONTINUATION');
  });
});

describe('assessMovement — 判定不可(推測で埋めない)', () => {
  const base = release(series({ h: 12, l: -1, c: 10 }, { 2: { h: 10, l: -20, c: -8 } }));

  it('発表時刻が EXACT でない', () => {
    for (const precision of ['APPROXIMATE', 'DATE_ONLY', 'UNKNOWN']) {
      expect(assessMovement({ ...base, release_datetime_precision: precision }, '15m')).toMatchObject({
        class: 'UNDETERMINED',
        reason: 'NOT_EXACT_RELEASE_TIME',
        final_side: null,
        crossed_pre_price_after_initial: null,
      });
    }
  });

  it('1分または窓の値動きが無い・AVAILABLE でない', () => {
    expect(
      assessMovement({ ...base, reactions: base.reactions.filter((r) => r.timeframe !== '15m') }, '15m').reason,
    ).toBe('DATA_MISSING');
    expect(
      assessMovement({ ...base, reactions: base.reactions.filter((r) => r.timeframe !== '1m') }, '15m').reason,
    ).toBe('DATA_MISSING');
    expect(assessMovement(withReaction(base, '15m', { data_status: 'UNAVAILABLE' }), '15m').reason).toBe(
      'DATA_MISSING',
    );
  });

  it('必要な値(極値・pips・発表直前の価格)が null / 無い', () => {
    for (const timeframe of ['1m', '15m']) {
      for (const field of [
        'max_upward',
        'max_downward',
        'max_upward_pips',
        'max_downward_pips',
        'pips',
        'pre_release_price',
      ] as const) {
        expect(
          assessMovement(withReaction(base, timeframe, { [field]: null }), '15m').reason,
          `${timeframe}.${field}`,
        ).toBe('DATA_MISSING');
      }
    }
  });

  it('1分足の系列が渡されていない(undefined)なら判定不可(crossed を極値の比較で代用しない)', () => {
    const { minuteCandles: _omit, ...rest } = base;
    expect(assessMovement(rest, '15m')).toMatchObject({ class: 'UNDETERMINED', reason: 'DATA_MISSING' });
  });

  it('1分足が揃っていない(完全性の確認が false)', () => {
    expect(assessMovement({ ...base, minuteCompleteness15m: false }, '15m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
    // 15分は揃っていても、60分が揃っていなければ60分だけ判定不可
    const partial = { ...base, minuteCompleteness60m: false };
    expect(assessMovement(partial, '15m').class).toBe('REVERSAL');
    expect(assessMovement(partial, '60m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
  });

  it('完全性の確認が true でも、系列に欠け・重複・UNVERIFIED があれば判定不可(系列そのものを確かめる)', () => {
    const candles = series({ h: 12, l: -1, c: 10 }, { 2: { h: 10, l: -20, c: -8 } });
    const missing = candleInputs(candles).filter((_, index) => index !== 5); // 6本目が無い
    expect(assessMovement({ ...base, minuteCandles: missing }, '15m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
    const duplicated = candleInputs(candles);
    duplicated[7] = duplicated[6]!; // 同じ時刻が2本、8本目の時刻が無い
    expect(assessMovement({ ...base, minuteCandles: duplicated }, '15m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
    const unverified = candleInputs(candles, [9]);
    expect(assessMovement({ ...base, minuteCandles: unverified }, '15m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
    // 16本目以降の欠けは、15分の窓には影響しない
    const lateGap = candleInputs(candles).filter((_, index) => index !== 20);
    expect(assessMovement({ ...base, minuteCandles: lateGap }, '15m').class).toBe('REVERSAL');
    expect(assessMovement({ ...base, minuteCandles: lateGap }, '60m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
  });

  it('初動が 0(横ばい)', () => {
    const flat = release(series({ h: 3, l: -3, c: 0 }, { 2: { h: 8, l: -3, c: 5 } }));
    expect(assessMovement(flat, '15m')).toMatchObject({ class: 'UNDETERMINED', reason: 'INITIAL_FLAT' });
  });

  describe('保存値の矛盾(1分足の行と長い窓の行は別々に更新されうる)。矛盾があれば crossed などを判定しない', () => {
    const consistentUp = release(series({ h: 12, l: 2, c: 10 }, { 2: { h: 12, l: 4, c: 9 } }));
    const noMeasures = {
      class: 'UNDETERMINED',
      reason: 'DATA_INCONSISTENT',
      crossed_pre_price_after_initial: null,
      retrace_ratio: null,
      final_side: null,
    };

    it('前提: 整合した状態は矛盾にならない', () => {
      expect(assessMovement(consistentUp, '15m').reason).toBe('THRESHOLD_NOT_SET');
      expect(assessMovement(consistentUp, '60m').reason).toBe('THRESHOLD_NOT_SET');
    });

    it('15分・60分の最大上昇が、1分の最大上昇より小さい', () => {
      const r = withReaction(consistentUp, '15m', { max_upward: 0.05, max_upward_pips: 5 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('15分・60分の最大下落(負の方向)が、1分の最大下落より小さく(浅く)なっている', () => {
      // 1分の安値 -1(= 最大下落 -0.01)なのに、15分の最大下落が 0(最大下落の方が大きいはずが、浅い)
      const base2 = release(series({ h: 12, l: -1, c: 10 }, { 2: { h: 12, l: 3, c: 9 } }));
      const r = withReaction(base2, '15m', { max_downward: 0, max_downward_pips: 0 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('1分の pips が、1分の極値の外(符号と極値の不整合)', () => {
      // 1分の最大上昇 12 pips に対し、1分の pips が 15
      const r = withReaction(consistentUp, '1m', { pips: 15 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
      // 1分の pips が最大下落(2 pips)より下 = 符号が逆(-5)で極値が上側にしかない
      const r2 = withReaction(consistentUp, '1m', { pips: -5 });
      expect(assessMovement(r2, '15m')).toMatchObject(noMeasures);
    });

    it('窓の pips が、窓の極値の外', () => {
      const r = withReaction(consistentUp, '15m', { pips: 30 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('発表直前の価格が、1分の行と窓の行で違う', () => {
      const r = withReaction(consistentUp, '15m', { pre_release_price: PRE + 0.5 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('保存された窓の最大・最小が、1分足の系列の極値を超えていない(保存値が古い・別の窓の値)', () => {
      // 系列には 2本目に安値 -20 があるのに、保存された窓の最大下落が -5 pips しかない
      const r = release(series({ h: 12, l: 2, c: 10 }, { 2: { h: 12, l: -20, c: 9 } }));
      const stale = withReaction(r, '15m', { max_downward: -0.05, max_downward_pips: -5 });
      expect(assessMovement(stale, '15m')).toMatchObject(noMeasures);
      // 系列の高値が保存された最大上昇を超えている場合も同じ
      const staleUp = withReaction(consistentUp, '15m', { max_upward: 0.1, max_upward_pips: 10 });
      expect(assessMovement(staleUp, '15m')).toMatchObject(noMeasures);
    });

    it('保存された窓の最大上昇が、系列の最高値より大きい(一致が必要。大きくても不一致)', () => {
      // 系列の窓の最高値は 12 pips。保存値を 15 pips にする(窓の行だけ)
      const r = withReaction(consistentUp, '15m', { max_upward: 0.15, max_upward_pips: 15 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('保存された窓の最大下落が、系列の最安値より深い(一致が必要。小さい側にずれても不一致)', () => {
      // 系列の窓の最安値は 2 pips。保存値を -3 pips(より深い)にする
      const r = withReaction(consistentUp, '15m', { max_downward: -0.03, max_downward_pips: -3 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('保存された窓の最大上昇が、系列の最高値より小さい', () => {
      const r = withReaction(consistentUp, '15m', { max_upward: 0.11, max_upward_pips: 11 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('1分の行の最大上昇・最大下落が、最初の1分足の高値・安値と違う', () => {
      // 最初の1分足の高値は 12 pips、安値は 2 pips
      const high = withReaction(consistentUp, '1m', { max_upward: 0.14, max_upward_pips: 14 });
      expect(assessMovement(high, '15m')).toMatchObject(noMeasures);
      const low = withReaction(consistentUp, '1m', { max_downward: 0.01, max_downward_pips: 1 });
      expect(assessMovement(low, '15m')).toMatchObject(noMeasures);
    });

    it('極値は許容誤差(1e-6)の中なら一致とみなす', () => {
      const r = withReaction(consistentUp, '15m', { max_upward: 0.12 + 5e-7 });
      expect(assessMovement(r, '15m').reason).toBe('THRESHOLD_NOT_SET');
      const over = withReaction(consistentUp, '15m', { max_upward: 0.12 + 2e-6 });
      expect(assessMovement(over, '15m').reason).toBe('DATA_INCONSISTENT');
    });

    it('窓の最終 pips が、N 本目の足の終値から計算した値と違う(15分: 15本目、60分: 60本目)', () => {
      // 15本目の終値だけ 1 pip 高くする(保存値は元のまま)。60本目の終値は変えないので、60分の窓は整合したまま。
      const closes = candleInputs(series({ h: 12, l: 2, c: 10 }, { 2: { h: 12, l: 4, c: 9 } }));
      closes[14] = { ...closes[14]!, close: round6(closes[14]!.close + PIP) };
      const r = { ...consistentUp, minuteCandles: closes };
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
      expect(assessMovement(r, '60m').reason).toBe('THRESHOLD_NOT_SET');
      // 60本目の終値を変えれば、60分の窓だけが矛盾
      const closes60 = candleInputs(series({ h: 12, l: 2, c: 10 }, { 2: { h: 12, l: 4, c: 9 } }));
      closes60[59] = { ...closes60[59]!, close: round6(closes60[59]!.close + PIP) };
      const r60 = { ...consistentUp, minuteCandles: closes60 };
      expect(assessMovement(r60, '60m')).toMatchObject(noMeasures);
      expect(assessMovement(r60, '15m').reason).toBe('THRESHOLD_NOT_SET');
    });

    it('1分の最終 pips が、1本目の足の終値から計算した値と違う(両方の窓が矛盾)', () => {
      const closes = candleInputs(series({ h: 12, l: 2, c: 10 }, { 2: { h: 12, l: 4, c: 9 } }));
      closes[0] = { ...closes[0]!, close: round6(closes[0]!.close + 2 * PIP) };
      const r = { ...consistentUp, minuteCandles: closes };
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
      expect(assessMovement(r, '60m')).toMatchObject(noMeasures);
    });

    it('pips は丸め(numeric(10,2) の 0.005 pips)の範囲なら一致とみなし、それを超えたら不一致', () => {
      // 15本目の終値 9 pips。保存の pips 9.004 は丸めの範囲(差 0.004)で一致、9.006 は範囲外(差 0.006)
      const ok = withReaction(consistentUp, '15m', { pips: 9.004, max_downward_pips: 2, max_upward_pips: 12 });
      expect(assessMovement(ok, '15m').reason).toBe('THRESHOLD_NOT_SET');
      const ng = withReaction(consistentUp, '15m', { pips: 9.006 });
      expect(assessMovement(ng, '15m')).toMatchObject(noMeasures);
    });

    it('極値の pips の列が、価格の列と合わない(最大上昇の pips だけ違う)', () => {
      const r = withReaction(consistentUp, '15m', { max_upward_pips: 13 });
      expect(assessMovement(r, '15m')).toMatchObject(noMeasures);
    });

    it('通貨ペアの pip の大きさが分からなければ判定しない(pips の再計算ができない)', () => {
      const { pip_size: _omit, ...rest } = consistentUp;
      expect(assessMovement(rest, '15m')).toMatchObject({ class: 'UNDETERMINED', reason: 'DATA_MISSING' });
    });

    it('buildStrategyAnalysis は通貨ペアから pip の大きさを補う(JPY を含むペアは 0.01)', () => {
      const { pip_size: _omit, ...rest } = consistentUp;
      const analysis = buildStrategyAnalysis([rest], 'USDJPY', 'USD');
      expect(analysis.releases[0]?.movement_15m.reason).toBe('THRESHOLD_NOT_SET');
    });

    it('境界: 最も伸びた幅と最終の位置が等しい(戻し率 0)は矛盾ではない', () => {
      const r = release(series({ h: 12, l: 2, c: 10 }, { 2: { h: 12, l: 10, c: 12 } }));
      const a = assessMovement(r, '15m');
      expect(a).toMatchObject({ favorable_peak_pips: 12, final_pips_in_initial_direction: 12, retrace_ratio: 0 });
      expect(assessMovement(r, '15m', TEST_CONFIG).class).toBe('CONTINUATION');
    });

    it('15分の行の矛盾は、ほかの窓(60分)の判定に影響しない。1分の行が原因なら両方の窓に及ぶ', () => {
      const r = withReaction(consistentUp, '15m', { pre_release_price: PRE + 0.5 });
      expect(assessMovement(r, '15m').reason).toBe('DATA_INCONSISTENT');
      expect(assessMovement(r, '60m').reason).toBe('THRESHOLD_NOT_SET'); // 60分の行は整合している
      const firstBroken = withReaction(consistentUp, '1m', { pre_release_price: PRE + 0.5 });
      expect(assessMovement(firstBroken, '15m').reason).toBe('DATA_INCONSISTENT');
      expect(assessMovement(firstBroken, '60m').reason).toBe('DATA_INCONSISTENT');
    });
  });

  it('判定不可のとき、判定できなかった測定値は null(作らない)', () => {
    const a = assessMovement({ ...base, release_datetime_precision: 'UNKNOWN' }, '15m');
    expect(a).toEqual({
      class: 'UNDETERMINED',
      reason: 'NOT_EXACT_RELEASE_TIME',
      initial_direction: null,
      favorable_peak_pips: null,
      final_pips_in_initial_direction: null,
      retrace_ratio: null,
      crossed_pre_price_after_initial: null,
      final_side: null,
    });
  });
});

describe('buildStrategyAnalysis — movement の要約と閾値の状態', () => {
  const reversal = (id: string, overrides: Partial<StrategyReleaseInput> = {}) => ({
    ...release(series({ h: 12, l: -1, c: 10 }, { 2: { h: 10, l: -20, c: -8 } })),
    event_id: id,
    ...overrides,
  });

  it('閾値が未設定のとき thresholds.status = NOT_SET。件数を窓ごとに数え、3件未満は ready = false', () => {
    const analysis = buildStrategyAnalysis([reversal('a'), reversal('b')], 'USDJPY', 'USD');
    expect(analysis.movement.thresholds).toEqual({ pullback_min_ratio: null, status: 'NOT_SET' });
    expect(analysis.movement.window_15m).toEqual({
      continuation: 0,
      pullback: 0,
      full_retracement: 0,
      reversal: 2,
      undetermined: 0,
      judged: 2,
      minimum_samples: 3,
      ready: false,
    });
    expect(analysis.releases[0]?.movement_15m.class).toBe('REVERSAL');
  });

  it('3件以上判定できれば ready = true。判定不可は undetermined に数え、judged に入れない', () => {
    const analysis = buildStrategyAnalysis(
      [reversal('a'), reversal('b'), reversal('c'), reversal('d', { release_datetime_precision: 'APPROXIMATE' })],
      'USDJPY',
      'USD',
    );
    expect(analysis.movement.window_15m).toMatchObject({ reversal: 3, undetermined: 1, judged: 3, ready: true });
  });

  it('閾値を渡すと thresholds.status = SET で、継続・押し戻しも数える', () => {
    const holds = release(series({ h: 20, l: 2, c: 10 }, { 2: { h: 20, l: 8, c: 14 } }));
    const analysis = buildStrategyAnalysis(
      [
        { ...holds, event_id: 'a' },
        { ...holds, event_id: 'b' },
        { ...holds, event_id: 'c' },
      ],
      'USDJPY',
      'USD',
      TEST_CONFIG,
    );
    expect(analysis.movement.thresholds).toEqual({ pullback_min_ratio: 0.5, status: 'SET' });
    expect(analysis.movement.window_15m).toMatchObject({ continuation: 3, judged: 3, ready: true });
  });

  it('既存の summary の形は変えない(movement は別のキー)', () => {
    const analysis = buildStrategyAnalysis([], 'USDJPY', 'USD');
    expect(Object.keys(analysis.summary).sort()).toEqual(
      [
        'breaks_15m',
        'breaks_60m',
        'direction_1m',
        'pattern_15m',
        'sell_the_fact',
        'sell_the_fact_after_initial_rise',
      ].sort(),
    );
    expect(analysis.status).toBe('DATA_PREPARING');
    expect(analysis.movement.window_15m.judged).toBe(0);
  });
});
