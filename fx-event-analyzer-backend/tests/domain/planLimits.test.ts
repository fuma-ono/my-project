import { describe, expect, it } from 'vitest';
import {
  applyNotificationPlanLimits,
  calendarEarliestFrom,
  calendarLatestTo,
  capRowRange,
  checkCalendarRange,
  historyLimitFor,
  notificationPlanViolation,
  PLAN_LIMITS,
  planFromFeatures,
  planLimitsFor,
  toEntitlementLimits,
} from '../../src/domain/planLimits.js';

const NOW = new Date('2026-10-08T03:00:00Z');

describe('planLimitsFor', () => {
  it('returns the HQ-decided limits (2026-10-08)', () => {
    expect(planLimitsFor('FREE')).toEqual({
      calendar_past: { unit: 'MONTHS', count: 1 },
      calendar_future_years: 2,
      favorites_max: 3,
      notification_importances: ['HIGH'],
      notification_fx_pairs_max: 1,
      history_events_max: 5,
    });
    expect(planLimitsFor('PRO')).toEqual({
      calendar_past: { unit: 'YEARS', count: 5 },
      calendar_future_years: 2,
      favorites_max: null,
      notification_importances: ['HIGH', 'MEDIUM', 'LOW'],
      notification_fx_pairs_max: null,
      history_events_max: 20,
    });
  });
});

describe('planFromFeatures', () => {
  it('is PRO only with VIEW_ADVANCED_STATS among the active features', () => {
    expect(planFromFeatures([])).toBe('FREE');
    expect(planFromFeatures(['VIEW_BASIC_EVENT', 'VIEW_HISTORICAL', 'VIEW_MARKET_REACTION'])).toBe('FREE');
    expect(planFromFeatures(['VIEW_BASIC_EVENT', 'VIEW_ADVANCED_STATS'])).toBe('PRO');
  });
});

describe('calendarEarliestFrom / calendarLatestTo', () => {
  it('FREE: 00:00 on the 1st of last month, in the given timezone', () => {
    expect(calendarEarliestFrom('FREE', NOW, 'UTC').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(calendarEarliestFrom('FREE', NOW, 'Asia/Tokyo').toISOString()).toBe('2026-08-31T15:00:00.000Z');
    // EDT (UTC-4) on Sep 1st.
    expect(calendarEarliestFrom('FREE', NOW, 'America/New_York').toISOString()).toBe('2026-09-01T04:00:00.000Z');
  });

  it('uses the month *in the timezone*, not in UTC', () => {
    // 2026-09-30T20:00Z is already October 1st in Tokyo → last month = September.
    const instant = new Date('2026-09-30T20:00:00Z');
    expect(calendarEarliestFrom('FREE', instant, 'UTC').toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(calendarEarliestFrom('FREE', instant, 'Asia/Tokyo').toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });

  it('FREE in January goes back to December 1st of the year before', () => {
    expect(calendarEarliestFrom('FREE', new Date('2027-01-15T00:00:00Z'), 'UTC').toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    // EST (UTC-5) in December.
    expect(calendarEarliestFrom('FREE', new Date('2027-01-15T00:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
  });

  it('PRO: Jan 1st of (current year − 5)', () => {
    expect(calendarEarliestFrom('PRO', NOW, 'UTC').toISOString()).toBe('2021-01-01T00:00:00.000Z');
    expect(calendarEarliestFrom('PRO', NOW, 'Asia/Tokyo').toISOString()).toBe('2020-12-31T15:00:00.000Z');
  });

  it('PRO: the year is taken in the timezone (Dec 31st UTC is already Jan 1st in Tokyo)', () => {
    const instant = new Date('2026-12-31T16:00:00Z');
    expect(calendarEarliestFrom('PRO', instant, 'UTC').toISOString()).toBe('2021-01-01T00:00:00.000Z');
    expect(calendarEarliestFrom('PRO', instant, 'Asia/Tokyo').toISOString()).toBe('2021-12-31T15:00:00.000Z');
  });

  it('both plans: to may not exceed Jan 1st of (current year + 2)', () => {
    expect(calendarLatestTo('FREE', NOW, 'UTC').toISOString()).toBe('2028-01-01T00:00:00.000Z');
    expect(calendarLatestTo('PRO', NOW, 'UTC').toISOString()).toBe('2028-01-01T00:00:00.000Z');
    expect(calendarLatestTo('FREE', NOW, 'Asia/Tokyo').toISOString()).toBe('2027-12-31T15:00:00.000Z');
    // EST (UTC-5) on Jan 1st.
    expect(calendarLatestTo('PRO', NOW, 'America/New_York').toISOString()).toBe('2028-01-01T05:00:00.000Z');
  });
});

describe('checkCalendarRange', () => {
  const check = (plan: 'FREE' | 'PRO', from: string, to: string, timeZone = 'UTC') =>
    checkCalendarRange(plan, new Date(from), new Date(to), NOW, timeZone);

  it('accepts exactly the earliest from (inclusive) and the latest to', () => {
    expect(check('FREE', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')).toEqual({ kind: 'OK' });
    expect(check('FREE', '2027-12-01T00:00:00Z', '2028-01-01T00:00:00Z')).toEqual({ kind: 'OK' });
    expect(check('PRO', '2021-01-01T00:00:00Z', '2021-02-01T00:00:00Z')).toEqual({ kind: 'OK' });
  });

  it('FREE one second before the 1st of last month → PLAN_LIMIT_EXCEEDED, PRO allows it', () => {
    expect(check('FREE', '2026-08-31T23:59:59Z', '2026-09-30T00:00:00Z')).toEqual({
      kind: 'PLAN_LIMIT_EXCEEDED',
      field: 'from',
      bound: new Date('2026-09-01T00:00:00Z'),
      requiredPlan: 'PRO',
    });
    expect(check('PRO', '2026-08-31T23:59:59Z', '2026-09-30T00:00:00Z')).toEqual({ kind: 'OK' });
  });

  it('evaluates the bound in the request timezone', () => {
    // 2026-08-31T15:00Z = Sep 1st 00:00 JST: allowed in Tokyo, not in UTC.
    expect(check('FREE', '2026-08-31T15:00:00Z', '2026-09-30T15:00:00Z', 'Asia/Tokyo')).toEqual({ kind: 'OK' });
    expect(check('FREE', '2026-08-31T15:00:00Z', '2026-09-30T15:00:00Z').kind).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('past what PRO allows → OUT_OF_RANGE for both plans (no plan helps)', () => {
    expect(check('FREE', '2020-12-31T23:59:59Z', '2021-01-31T00:00:00Z')).toEqual({
      kind: 'OUT_OF_RANGE',
      field: 'from',
      bound: new Date('2026-09-01T00:00:00Z'),
    });
    expect(check('PRO', '2020-12-31T23:59:59Z', '2021-01-31T00:00:00Z')).toEqual({
      kind: 'OUT_OF_RANGE',
      field: 'from',
      bound: new Date('2021-01-01T00:00:00Z'),
    });
  });

  it('to past Jan 1st of year + 2 → OUT_OF_RANGE for both plans', () => {
    for (const plan of ['FREE', 'PRO'] as const) {
      expect(check(plan, '2027-12-15T00:00:00Z', '2028-01-01T00:00:01Z')).toEqual({
        kind: 'OUT_OF_RANGE',
        field: 'to',
        bound: new Date('2028-01-01T00:00:00Z'),
      });
    }
  });
});

describe('toEntitlementLimits', () => {
  it('serializes the limits with second-precision UTC timestamps', () => {
    expect(toEntitlementLimits('FREE', NOW, 'Asia/Tokyo')).toEqual({
      calendar_earliest_from: '2026-08-31T15:00:00Z',
      calendar_latest_to: '2027-12-31T15:00:00Z',
      favorites_max: 3,
      notification_importances: ['HIGH'],
      notification_fx_pairs_max: 1,
      history_events_max: 5,
    });
    expect(toEntitlementLimits('PRO', NOW, 'UTC')).toEqual({
      calendar_earliest_from: '2021-01-01T00:00:00Z',
      calendar_latest_to: '2028-01-01T00:00:00Z',
      favorites_max: null,
      notification_importances: ['HIGH', 'MEDIUM', 'LOW'],
      notification_fx_pairs_max: null,
      history_events_max: 20,
    });
  });

  it('returns a copy, never the shared constant', () => {
    const limits = toEntitlementLimits('PRO', NOW, 'UTC');
    limits.notification_importances.pop();
    expect(PLAN_LIMITS.PRO.notification_importances).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });
});

describe('notificationPlanViolation', () => {
  it('allows FREE only HIGH and a list of at most one pair', () => {
    expect(notificationPlanViolation('FREE', { importances: ['HIGH'], fx_pairs: ['EURUSD'] })).toBeNull();
    expect(notificationPlanViolation('FREE', { importances: ['HIGH', 'MEDIUM'] })).toMatch(/MEDIUM/);
    expect(notificationPlanViolation('FREE', { importances: ['LOW'] })).toMatch(/LOW/);
    expect(notificationPlanViolation('FREE', { fx_pairs: ['USDJPY', 'EURUSD'] })).toMatch(/at most 1/);
    expect(notificationPlanViolation('FREE', { fx_pairs: null })).toMatch(/all pairs/);
  });

  it('only checks the fields that are present', () => {
    expect(notificationPlanViolation('FREE', {})).toBeNull();
    expect(notificationPlanViolation('FREE', { importances: undefined, fx_pairs: undefined })).toBeNull();
  });

  it('never restricts PRO', () => {
    expect(
      notificationPlanViolation('PRO', { importances: ['HIGH', 'MEDIUM', 'LOW'], fx_pairs: ['USDJPY', 'EURUSD'] }),
    ).toBeNull();
    expect(notificationPlanViolation('PRO', { fx_pairs: null })).toBeNull();
  });
});

describe('applyNotificationPlanLimits', () => {
  it('leaves PRO settings as stored', () => {
    expect(applyNotificationPlanLimits('PRO', { importances: ['HIGH', 'MEDIUM'], fxPairSymbols: null })).toEqual({
      importances: ['HIGH', 'MEDIUM'],
      fxPairSymbols: null,
    });
    expect(applyNotificationPlanLimits('PRO', { importances: ['LOW'], fxPairSymbols: ['EURUSD', 'USDJPY'] })).toEqual({
      importances: ['LOW'],
      fxPairSymbols: ['EURUSD', 'USDJPY'],
    });
  });

  it('FREE: only HIGH, only the first stored pair', () => {
    expect(
      applyNotificationPlanLimits('FREE', {
        importances: ['HIGH', 'MEDIUM', 'LOW'],
        fxPairSymbols: ['EURJPY', 'USDJPY'],
      }),
    ).toEqual({ importances: ['HIGH'], fxPairSymbols: ['EURJPY'] });
  });

  it('FREE: stored null (all pairs) is evaluated as USDJPY', () => {
    expect(applyNotificationPlanLimits('FREE', { importances: ['HIGH', 'MEDIUM'], fxPairSymbols: null })).toEqual({
      importances: ['HIGH'],
      fxPairSymbols: ['USDJPY'],
    });
  });

  it('FREE: no allowed importance left → HIGH', () => {
    expect(applyNotificationPlanLimits('FREE', { importances: ['MEDIUM'], fxPairSymbols: ['USDJPY'] })).toEqual({
      importances: ['HIGH'],
      fxPairSymbols: ['USDJPY'],
    });
  });
});

describe('historyLimitFor', () => {
  it('reports the applied count with the plan and PRO maxima', () => {
    expect(historyLimitFor('FREE', 5)).toEqual({ applied: 5, max_for_plan: 5, pro_max: 20 });
    expect(historyLimitFor('FREE', 2)).toEqual({ applied: 2, max_for_plan: 5, pro_max: 20 });
    expect(historyLimitFor('PRO', 20)).toEqual({ applied: 20, max_for_plan: 20, pro_max: 20 });
  });
});

describe('capRowRange', () => {
  it('cuts an inclusive range at the cap', () => {
    expect(capRowRange({ from: 0, to: 19 }, 5)).toEqual({ from: 0, to: 4 });
    expect(capRowRange({ from: 0, to: 2 }, 5)).toEqual({ from: 0, to: 2 });
    expect(capRowRange({ from: 3, to: 5 }, 5)).toEqual({ from: 3, to: 4 });
  });

  it('is null for a page entirely past the cap', () => {
    expect(capRowRange({ from: 5, to: 9 }, 5)).toBeNull();
    expect(capRowRange({ from: 20, to: 39 }, 20)).toBeNull();
  });
});
