import { describe, expect, it } from 'vitest';
import { listLatestFxPrices } from '../../src/repositories/fxPairsRepository.js';
import { listMajorFx } from '../../src/repositories/homeRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * 最新価格は1分足だけから取る(HQ承認 2026-10-21)。fx_prices には1分足から作った
 * 5分〜60分足も入っていて、足の始まりの時刻が1分足と同じになることがある。
 * fake の `.order` は安定ソートなので、同じ時刻の行は入れた順に並ぶ — 混ざる場合を再現するため、
 * 他の時間足の行を先に入れる。
 */
const USDJPY = 'pair-usdjpy';

function candle(timeframe: string, timestamp: string, close: number, verification_status = 'SINGLE_SOURCE') {
  return { fx_pair_id: USDJPY, timeframe, timestamp, close, verification_status };
}

const PAIRS = [{ id: USDJPY, symbol: 'USDJPY', is_active: true }];

/** 1分足 10:45 と同じ時刻の 5分足・15分足(中身は 10:49 / 10:59 の終値)。10:46 以降の1分足は未確認。 */
const MIXED = [
  candle('15m', '2026-10-16T10:45:00Z', 150.9),
  candle('5m', '2026-10-16T10:45:00Z', 150.5),
  candle('1m', '2026-10-16T10:46:00Z', 150.2, 'UNVERIFIED'),
  candle('1m', '2026-10-16T10:45:00Z', 150.1),
  candle('1m', '2026-10-16T10:44:00Z', 150.0),
];

describe('listMajorFx (GET /home major_fx) reads 1m candles only', () => {
  it('picks the latest and previous 1m candles even when 5m/15m rows share the timestamp', async () => {
    const supabase = fakeSupabaseClient({ fx_pairs: PAIRS, fx_prices: MIXED });
    const [row] = await listMajorFx(supabase, ['USDJPY']);
    expect(row).toMatchObject({ symbol: 'USDJPY', price: 150.1, timestamp: '2026-10-16T10:45:00Z' });
    expect(row?.change).toBeCloseTo(0.1, 10);
    expect(row?.change_percent).toBeCloseTo((0.1 / 150.0) * 100, 10);
  });

  it('ignores a newer non-1m row', async () => {
    const supabase = fakeSupabaseClient({
      fx_pairs: PAIRS,
      fx_prices: [candle('60m', '2026-10-16T11:00:00Z', 151.0), candle('1m', '2026-10-16T10:59:00Z', 150.3)],
    });
    const [row] = await listMajorFx(supabase, ['USDJPY']);
    expect(row).toMatchObject({ price: 150.3, change: null, change_percent: null, timestamp: '2026-10-16T10:59:00Z' });
  });

  it('keeps the existing results for one 1m candle (no change) and none (all null)', async () => {
    const one = fakeSupabaseClient({ fx_pairs: PAIRS, fx_prices: [candle('1m', '2026-10-16T10:45:00Z', 150.1)] });
    expect((await listMajorFx(one, ['USDJPY']))[0]).toEqual({
      fx_pair_id: USDJPY,
      symbol: 'USDJPY',
      price: 150.1,
      change: null,
      change_percent: null,
      timestamp: '2026-10-16T10:45:00Z',
    });
    const onlyAggregates = fakeSupabaseClient({
      fx_pairs: PAIRS,
      fx_prices: [candle('5m', '2026-10-16T10:45:00Z', 150.5)],
    });
    expect((await listMajorFx(onlyAggregates, ['USDJPY']))[0]).toEqual({
      fx_pair_id: USDJPY,
      symbol: 'USDJPY',
      price: null,
      change: null,
      change_percent: null,
      timestamp: null,
    });
  });
});

describe('listLatestFxPrices (rate alerts) reads 1m candles only', () => {
  it('uses the latest verified-or-single-source 1m close', async () => {
    const supabase = fakeSupabaseClient({ fx_prices: MIXED });
    expect(await listLatestFxPrices(supabase, [USDJPY])).toEqual(new Map([[USDJPY, 150.1]]));
  });

  it('leaves a pair without 1m candles out of the map (as for a pair without prices)', async () => {
    const supabase = fakeSupabaseClient({ fx_prices: [candle('5m', '2026-10-16T10:45:00Z', 150.5)] });
    expect(await listLatestFxPrices(supabase, [USDJPY])).toEqual(new Map());
  });
});
