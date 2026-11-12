import { describe, expect, it } from 'vitest';
import {
  evaluableRateAlerts,
  formatRatePrice,
  fxPairLabel,
  hasRateAlertCrossed,
  RATE_ALERT_TRIGGER,
  rateAlertBody,
  rateAlertInboxRow,
  rateAlertTitle,
  selectCrossedRateAlerts,
  toRateAlertItem,
  type RateAlertRow,
} from '../../src/domain/rateAlerts.js';

const USDJPY_ID = '20000000-0000-0000-0000-000000000001';
const EURUSD_ID = '20000000-0000-0000-0000-000000000002';

function alert(overrides: Partial<RateAlertRow> = {}): RateAlertRow {
  return {
    id: 'a0000000-0000-0000-0000-000000000001',
    user_id: 'u0000000-0000-0000-0000-000000000001',
    fx_pair_id: USDJPY_ID,
    symbol: 'USDJPY',
    base_currency: 'USD',
    quote_currency: 'JPY',
    direction: 'ABOVE',
    target_price: 155,
    is_active: true,
    triggered_at: null,
    created_at: '2026-10-15T00:00:00.123+00:00',
    ...overrides,
  };
}

describe('hasRateAlertCrossed', () => {
  it('ABOVE fires at or above the target', () => {
    expect(hasRateAlertCrossed('ABOVE', 155, 154.99)).toBe(false);
    expect(hasRateAlertCrossed('ABOVE', 155, 155)).toBe(true);
    expect(hasRateAlertCrossed('ABOVE', 155, 155.01)).toBe(true);
  });

  it('BELOW fires at or below the target', () => {
    expect(hasRateAlertCrossed('BELOW', 155, 155.01)).toBe(false);
    expect(hasRateAlertCrossed('BELOW', 155, 155)).toBe(true);
    expect(hasRateAlertCrossed('BELOW', 155, 154.5)).toBe(true);
  });

  it('never fires on a non-finite price', () => {
    expect(hasRateAlertCrossed('ABOVE', 155, Number.NaN)).toBe(false);
    expect(hasRateAlertCrossed('BELOW', 155, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('price text', () => {
  it('fxPairLabel is BASE/QUOTE', () => {
    expect(fxPairLabel('USD', 'JPY')).toBe('USD/JPY');
  });

  it('formatRatePrice: 2 decimals for JPY quotes, 4 otherwise, more when the value has more (max 6)', () => {
    expect(formatRatePrice(155, 'JPY')).toBe('155.00');
    expect(formatRatePrice(155.125, 'JPY')).toBe('155.125');
    expect(formatRatePrice(1.08, 'USD')).toBe('1.0800');
    expect(formatRatePrice(1.08213478, 'USD')).toBe('1.082135');
  });

  it('title: 「USD/JPY が 155.00 を上回りました」 / 「…を下回りました」', () => {
    expect(rateAlertTitle(alert())).toBe('USD/JPY が 155.00 を上回りました');
    expect(
      rateAlertTitle(alert({ direction: 'BELOW', base_currency: 'EUR', quote_currency: 'USD', target_price: 1.08 })),
    ).toBe('EUR/USD が 1.0800 を下回りました');
  });

  it('body carries the current price and the target', () => {
    expect(rateAlertBody(alert(), 155.12)).toBe('現在 155.12（アラート: 155.00 以上）');
    expect(rateAlertBody(alert({ direction: 'BELOW' }), 154.9)).toBe('現在 154.90（アラート: 155.00 以下）');
  });
});

describe('rateAlertInboxRow', () => {
  it('is a HIGH, CROSSED RATE_ALERT row notified now and kept 7 days', () => {
    const now = new Date('2026-10-15T06:00:00.500Z');
    expect(rateAlertInboxRow(alert(), 155.42, now)).toEqual({
      user_id: 'u0000000-0000-0000-0000-000000000001',
      kind: 'RATE_ALERT',
      target_id: 'a0000000-0000-0000-0000-000000000001',
      trigger: RATE_ALERT_TRIGGER,
      title: 'USD/JPY が 155.00 を上回りました',
      body: '現在 155.42（アラート: 155.00 以上）',
      display_name: null,
      speaker_name: null,
      country_code: null,
      importance: 'HIGH',
      scheduled_at: null,
      notify_at: '2026-10-15T06:00:00Z',
      expires_at: '2026-10-22T06:00:00Z',
    });
    expect(RATE_ALERT_TRIGGER).toBe('CROSSED');
  });
});

describe('selectCrossedRateAlerts', () => {
  it('keeps active alerts whose pair has a price that crossed', () => {
    const above = alert({ id: 'above' });
    const notYet = alert({ id: 'not-yet', target_price: 160 });
    const below = alert({ id: 'below', fx_pair_id: EURUSD_ID, direction: 'BELOW', target_price: 1.09 });
    const noPrice = alert({ id: 'no-price', fx_pair_id: 'no-price-pair' });
    const inactive = alert({ id: 'inactive', is_active: false });
    const prices = new Map([
      [USDJPY_ID, 155.42],
      [EURUSD_ID, 1.0821],
    ]);
    expect(selectCrossedRateAlerts([above, notYet, below, noPrice, inactive], prices)).toEqual([
      { alert: above, price: 155.42 },
      { alert: below, price: 1.0821 },
    ]);
  });
});

describe('evaluableRateAlerts', () => {
  it('keeps the oldest active alerts up to the plan max', () => {
    const newest = alert({ id: 'c', created_at: '2026-10-15T03:00:00Z' });
    const oldest = alert({ id: 'a', created_at: '2026-10-15T01:00:00Z' });
    const middle = alert({ id: 'b', created_at: '2026-10-15T02:00:00Z' });
    const fired = alert({ id: 'z', created_at: '2026-10-14T00:00:00Z', is_active: false });
    expect(evaluableRateAlerts([newest, fired, middle, oldest], 1).map((row) => row.id)).toEqual(['a']);
    expect(evaluableRateAlerts([newest, fired, middle, oldest], 10).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(evaluableRateAlerts([newest], 0)).toEqual([]);
  });
});

describe('toRateAlertItem', () => {
  it('returns the API shape with second-precision UTC timestamps and a numeric target', () => {
    expect(
      toRateAlertItem(
        alert({ target_price: '155.500000' as unknown as number, triggered_at: '2026-10-15T06:00:00.9+00:00' }),
      ),
    ).toEqual({
      id: 'a0000000-0000-0000-0000-000000000001',
      fx_pair_id: USDJPY_ID,
      symbol: 'USDJPY',
      direction: 'ABOVE',
      target_price: 155.5,
      is_active: true,
      triggered_at: '2026-10-15T06:00:00Z',
      created_at: '2026-10-15T00:00:00Z',
    });
  });
});
