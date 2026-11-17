import { describe, expect, it } from 'vitest';
import {
  assessMovement,
  buildStrategyAnalysis,
  DEFAULT_STRATEGY_CLASSIFICATION,
  type StrategyReactionInput,
  type StrategyReleaseInput,
} from '../../src/domain/eventStrategyAnalysis.js';

/**
 * 値動きの分類(assessMovement。HQ指示 2026-11-17「Strategy Analysis バックエンド実装 第1段階」)。
 * 閾値(pullbackMinRatio)は本番では未設定(null)。ここで使う 0.5 は「閾値を渡したときの分岐を確かめる」ための
 * テスト用の値で、運用の閾値ではない。
 */

const TEST_CONFIG = { pullbackMinRatio: 0.5 } as const;

function reaction(
  timeframe: string,
  pips: number | null,
  maxUpward: number | null,
  maxDownward: number | null,
  maxUpwardPips: number | null,
  maxDownwardPips: number | null,
  dataStatus = 'AVAILABLE',
): StrategyReactionInput {
  return {
    timeframe,
    pips,
    max_upward: maxUpward,
    max_downward: maxDownward,
    max_upward_pips: maxUpwardPips,
    max_downward_pips: maxDownwardPips,
    data_status: dataStatus,
  };
}

/** 価格は pips × 0.01(USDJPY 相当)。1分の値と15分の値だけを渡す。 */
function release(
  first: { pips: number; up: number; down: number },
  window: { pips: number; up: number; down: number },
  overrides: Partial<StrategyReleaseInput> = {},
): StrategyReleaseInput {
  return {
    event_id: 'e1',
    release_datetime: '2026-11-10T13:30:00.000Z',
    forecast: null,
    actual: null,
    surprise: null,
    surprise_direction: null,
    release_datetime_precision: 'EXACT',
    minuteCompleteness15m: true,
    minuteCompleteness60m: true,
    reactions: [
      reaction('1m', first.pips, first.up * 0.01, first.down * 0.01, first.up, first.down),
      reaction('15m', window.pips, window.up * 0.01, window.down * 0.01, window.up, window.down),
      reaction('60m', window.pips, window.up * 0.01, window.down * 0.01, window.up, window.down),
    ],
    ...overrides,
  };
}

describe('assessMovement — 反転・全戻し(閾値を使わない分類)', () => {
  it('REVERSAL: 初動は上、15分後は発表直前の価格より下(最終的に逆側)', () => {
    const r = release({ pips: 10, up: 12, down: -1 }, { pips: -8, up: 12, down: -20 });
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
    const r = release({ pips: -10, up: 1, down: -12 }, { pips: 6, up: 14, down: -12 });
    expect(assessMovement(r, '15m')).toMatchObject({
      class: 'REVERSAL',
      initial_direction: 'DOWN',
      favorable_peak_pips: 12,
      final_pips_in_initial_direction: -6,
      final_side: 'OPPOSITE',
    });
  });

  it('FULL_RETRACEMENT: 一時的に発表直前の価格を割ったが、最終的には初動と同じ側(反転とは区別する)', () => {
    const r = release({ pips: 10, up: 12, down: -1 }, { pips: 7, up: 14, down: -5 });
    expect(assessMovement(r, '15m')).toMatchObject({
      class: 'FULL_RETRACEMENT',
      reason: null,
      final_side: 'SAME',
      crossed_pre_price_after_initial: true,
      final_pips_in_initial_direction: 7,
    });
  });

  it('FULL_RETRACEMENT: 窓の終わりが発表直前の価格と同じ(AT_PRE)', () => {
    const r = release({ pips: 10, up: 12, down: 0 }, { pips: 0, up: 12, down: 0 });
    expect(assessMovement(r, '15m')).toMatchObject({ class: 'FULL_RETRACEMENT', final_side: 'AT_PRE' });
  });

  it('1分の窓の中だけの逆側への振れ(最初の1分足の安値)は「後」に数えない', () => {
    // 15分の最安値(-3)は1分の最安値(-3)と同じ = 2分目以降に新しく割ってはいない。
    const r = release({ pips: 10, up: 12, down: -3 }, { pips: 9, up: 12, down: -3 });
    const a = assessMovement(r, '15m');
    expect(a.crossed_pre_price_after_initial).toBe(false);
    expect(a.class).not.toBe('FULL_RETRACEMENT');
  });

  it('1分の安値より低く、かつ発表直前の価格より下まで割ったら「後に超えた」', () => {
    const r = release({ pips: 10, up: 12, down: -3 }, { pips: 9, up: 12, down: -4 });
    expect(assessMovement(r, '15m')).toMatchObject({
      crossed_pre_price_after_initial: true,
      class: 'FULL_RETRACEMENT',
    });
  });

  it('初動が下のとき、発表直前の価格を上に超えたら全戻し(対称)', () => {
    const r = release({ pips: -10, up: 0.5, down: -12 }, { pips: -6, up: 3, down: -12 });
    expect(assessMovement(r, '15m')).toMatchObject({
      class: 'FULL_RETRACEMENT',
      initial_direction: 'DOWN',
      crossed_pre_price_after_initial: true,
      final_side: 'SAME',
    });
  });

  it('1分の安値より低くても、発表直前の価格(0)より上なら超えていない', () => {
    // 1分の安値 +2、15分の安値 +1(1分の安値より低いが、発表直前の価格より上)。
    const r = release({ pips: 10, up: 12, down: 2 }, { pips: 9, up: 12, down: 1 });
    expect(assessMovement(r, '15m').crossed_pre_price_after_initial).toBe(false);
  });
});

describe('assessMovement — 継続・押し戻し(閾値が要る分類)', () => {
  // 最終的に初動と同じ側で、発表直前の価格は超えていない。戻し率 = (peak − final) / peak。
  const holdsAbove = release({ pips: 10, up: 20, down: 2 }, { pips: 14, up: 20, down: 2 });
  const deepPullback = release({ pips: 10, up: 20, down: 2 }, { pips: 6, up: 20, down: 2 });

  it('閾値が未設定(null)の間は UNDETERMINED(THRESHOLD_NOT_SET)。戻し率などの測定値は返す', () => {
    expect(DEFAULT_STRATEGY_CLASSIFICATION.pullbackMinRatio).toBeNull();
    const a = assessMovement(holdsAbove, '15m');
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
    expect(assessMovement(holdsAbove, '15m', TEST_CONFIG)).toMatchObject({ class: 'CONTINUATION', reason: null });
    expect(assessMovement(deepPullback, '15m', TEST_CONFIG)).toMatchObject({ class: 'PULLBACK', reason: null });
  });

  it('戻し率がちょうど閾値なら PULLBACK(以上)', () => {
    const exactly = release({ pips: 10, up: 20, down: 2 }, { pips: 10, up: 20, down: 2 });
    expect(assessMovement(exactly, '15m', TEST_CONFIG).retrace_ratio).toBeCloseTo(0.5, 4);
    expect(assessMovement(exactly, '15m', TEST_CONFIG).class).toBe('PULLBACK');
  });

  it('初動が下でも同じ(対称)', () => {
    const down = release({ pips: -10, up: -2, down: -20 }, { pips: -14, up: -2, down: -20 });
    expect(assessMovement(down, '15m', TEST_CONFIG)).toMatchObject({
      class: 'CONTINUATION',
      initial_direction: 'DOWN',
      favorable_peak_pips: 20,
      final_pips_in_initial_direction: 14,
    });
  });

  it('60分の窓も同じ規則で、別に判定する', () => {
    const r = release({ pips: 10, up: 20, down: 2 }, { pips: 14, up: 20, down: 2 });
    expect(assessMovement(r, '60m', TEST_CONFIG).class).toBe('CONTINUATION');
  });
});

describe('assessMovement — 判定不可(推測で埋めない)', () => {
  const base = release({ pips: 10, up: 12, down: -1 }, { pips: -8, up: 12, down: -20 });

  it('発表時刻が EXACT でない', () => {
    for (const precision of ['APPROXIMATE', 'DATE_ONLY', 'UNKNOWN']) {
      expect(assessMovement({ ...base, release_datetime_precision: precision }, '15m')).toMatchObject({
        class: 'UNDETERMINED',
        reason: 'NOT_EXACT_RELEASE_TIME',
        final_side: null,
      });
    }
  });

  it('1分または窓の値動きが無い・AVAILABLE でない', () => {
    expect(
      assessMovement({ ...base, reactions: base.reactions.filter((r) => r.timeframe !== '15m') }, '15m'),
    ).toMatchObject({
      class: 'UNDETERMINED',
      reason: 'DATA_MISSING',
    });
    expect(
      assessMovement({ ...base, reactions: base.reactions.filter((r) => r.timeframe !== '1m') }, '15m'),
    ).toMatchObject({
      reason: 'DATA_MISSING',
    });
    const unavailable = base.reactions.map((r) => (r.timeframe === '15m' ? { ...r, data_status: 'UNAVAILABLE' } : r));
    expect(assessMovement({ ...base, reactions: unavailable }, '15m').reason).toBe('DATA_MISSING');
  });

  it('必要な値(max_upward_pips など)が null', () => {
    for (const field of ['max_upward', 'max_downward', 'max_upward_pips', 'max_downward_pips', 'pips'] as const) {
      const reactions = base.reactions.map((r) => (r.timeframe === '15m' ? { ...r, [field]: null } : r));
      expect(assessMovement({ ...base, reactions }, '15m').reason, field).toBe('DATA_MISSING');
    }
    const noFirstPips = base.reactions.map((r) => (r.timeframe === '1m' ? { ...r, pips: null } : r));
    expect(assessMovement({ ...base, reactions: noFirstPips }, '15m').reason).toBe('DATA_MISSING');
  });

  it('max_upward_pips が項目ごと無い(古い入力)も判定不可', () => {
    const reactions = base.reactions.map((r) => {
      const { max_upward_pips: _omit, ...rest } = r;
      return r.timeframe === '15m' ? rest : r;
    });
    expect(assessMovement({ ...base, reactions }, '15m').reason).toBe('DATA_MISSING');
  });

  it('1分足が欠けている(窓ごと)', () => {
    expect(assessMovement({ ...base, minuteCompleteness15m: false }, '15m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
    // 15分は揃っていても、60分が欠けていれば60分だけ判定不可
    const partial = { ...base, minuteCompleteness60m: false };
    expect(assessMovement(partial, '15m').class).toBe('REVERSAL');
    expect(assessMovement(partial, '60m').reason).toBe('MINUTE_CANDLES_INCOMPLETE');
  });

  it('初動が 0(横ばい)', () => {
    const flat = release({ pips: 0, up: 3, down: -3 }, { pips: 5, up: 8, down: -3 });
    expect(assessMovement(flat, '15m')).toMatchObject({ class: 'UNDETERMINED', reason: 'INITIAL_FLAT' });
  });

  it('保存値の矛盾(最も伸びた幅が最終の位置より小さい)', () => {
    const inconsistent = release({ pips: 10, up: 12, down: -1 }, { pips: 15, up: 12, down: -1 });
    expect(assessMovement(inconsistent, '15m')).toMatchObject({
      class: 'UNDETERMINED',
      reason: 'DATA_INCONSISTENT',
      favorable_peak_pips: 12,
      final_pips_in_initial_direction: 15,
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
  const rel = (id: string, overrides: Partial<StrategyReleaseInput> = {}) => ({
    ...release({ pips: 10, up: 12, down: -1 }, { pips: -8, up: 12, down: -20 }),
    event_id: id,
    ...overrides,
  });

  it('閾値が未設定のとき thresholds.status = NOT_SET。件数を窓ごとに数え、3件未満は ready = false', () => {
    const analysis = buildStrategyAnalysis([rel('a'), rel('b')], 'USDJPY', 'USD');
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
      [rel('a'), rel('b'), rel('c'), rel('d', { release_datetime_precision: 'APPROXIMATE' })],
      'USDJPY',
      'USD',
    );
    expect(analysis.movement.window_15m).toMatchObject({ reversal: 3, undetermined: 1, judged: 3, ready: true });
  });

  it('閾値を渡すと thresholds.status = SET で、継続・押し戻しも数える', () => {
    const holds = release({ pips: 10, up: 20, down: 2 }, { pips: 14, up: 20, down: 2 });
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
