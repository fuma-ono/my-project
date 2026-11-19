/**
 * HQ 指示 2026-11-19「FOMC の FREE/PRO 制御」: 過去の FOMC の政策金利は、FREE には直近 3 回(記録済みの会合)だけ。PRO は全部。
 * FOMC の会合は RELEASED にならず、既存のロック(RELEASED だけを数える)の対象外のため、別に判定する。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  requireUnlockedEvent,
  requireUnlockedEventForPlan,
  type UnlockableEvent,
} from '../../src/authorization/pastReleaseAccess.js';
import {
  assertEventIndicatorCode,
  isPolicyRateLockedForPlan,
  POLICY_RATE_INDICATOR,
} from '../../src/authorization/policyRateAccess.js';
import { ApiError } from '../../src/errors/ApiError.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

const FOMC = { indicator_id: 'ind-fomc', indicator_code: POLICY_RATE_INDICATOR };
const meeting = (n: number, indicator_id = 'ind-fomc') => ({
  id: `m${n}`,
  indicator_id,
  release_datetime: `2026-${String(n).padStart(2, '0')}-15T18:00:00Z`,
});
/** n 番目(1 = 一番古い)の会合までを作り、全部に政策金利を記録する。 */
const world = (count: number, withDecision: (n: number) => boolean = () => true) =>
  fakeSupabaseClient({
    economic_events: Array.from({ length: count }, (_, i) => meeting(i + 1)),
    fomc_policy_decisions: Array.from({ length: count }, (_, i) => i + 1)
      .filter(withDecision)
      .map((n) => ({ event_id: `m${n}` })),
  });
const failingClient = { from: () => Promise.reject(new Error('the DB must not be read')) } as unknown as SupabaseClient;
const locked = (client: SupabaseClient, plan: 'FREE' | 'PRO', n: number, overrides = {}) =>
  isPolicyRateLockedForPlan(client, plan, { id: `m${n}`, ...FOMC, ...overrides });

describe('isPolicyRateLockedForPlan', () => {
  it('FREE: the 3 most recent recorded meetings are visible; older ones are locked (5 meetings → m3,m4,m5 visible; m1,m2 locked)', async () => {
    const client = world(5);
    const result = await Promise.all([1, 2, 3, 4, 5].map((n) => locked(client, 'FREE', n)));
    expect(result).toEqual([true, true, false, false, false]);
  });

  it('boundary: exactly 3 recorded meetings → nothing locked; 4 → only the oldest is locked', async () => {
    expect(await Promise.all([1, 2, 3].map((n) => locked(world(3), 'FREE', n)))).toEqual([false, false, false]);
    expect(await Promise.all([1, 2, 3, 4].map((n) => locked(world(4), 'FREE', n)))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('PRO: nothing is locked, and the DB is not even read', async () => {
    expect(await locked(failingClient, 'PRO', 1)).toBe(false);
  });

  it('a meeting without a recorded policy rate has nothing to hide: not locked (and it does not use up one of the 3)', async () => {
    // m6 は政策金利が未記録の新しい会合。FREE の直近 3 回は、記録済みの m5・m4・m3
    const client = fakeSupabaseClient({
      economic_events: [1, 2, 3, 4, 5, 6].map((n) => meeting(n)),
      fomc_policy_decisions: [1, 2, 3, 4, 5].map((n) => ({ event_id: `m${n}` })),
    });
    expect(await locked(client, 'FREE', 6)).toBe(false);
    expect(await Promise.all([1, 2, 3, 4, 5].map((n) => locked(client, 'FREE', n)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('other indicators are never touched (no DB read) — the existing RELEASED lock keeps handling them', async () => {
    expect(
      await isPolicyRateLockedForPlan(failingClient, 'FREE', { id: 'x', indicator_id: 'i', indicator_code: 'US_CPI' }),
    ).toBe(false);
  });

  it('decisions of a different indicator do not count toward the 3', async () => {
    const client = fakeSupabaseClient({
      economic_events: [
        meeting(1),
        meeting(2),
        meeting(3),
        meeting(4),
        meeting(9, 'ind-other'),
        meeting(10, 'ind-other'),
      ],
      fomc_policy_decisions: ['m1', 'm2', 'm3', 'm4', 'm9', 'm10'].map((event_id) => ({ event_id })),
    });
    expect(await Promise.all([1, 2, 3, 4].map((n) => locked(client, 'FREE', n)))).toEqual([true, false, false, false]);
  });

  it('no recorded decisions at all → nothing is locked', async () => {
    expect(
      await locked(
        world(4, () => false),
        'FREE',
        1,
      ),
    ).toBe(false);
  });

  it('a DB error is not swallowed (fail closed at the route: the request errors, the rate is not returned)', async () => {
    const broken = {
      from: () => ({ select: () => Promise.resolve({ data: null, error: new Error('boom') }) }),
    } as unknown as SupabaseClient;
    await expect(locked(broken, 'FREE', 1)).rejects.toThrow('boom');
  });
});

describe('GET /events/{id} wiring: a locked FOMC meeting returns the locked shape without policy_rate', () => {
  const source = readFileSync(join(__dirname, '../../src/routes/events.ts'), 'utf8');

  it('the policy-rate lock is checked right after the RELEASED lock, before any value (incl. policy_rate) is read', () => {
    const releasedLock = source.indexOf('if (lockedIds.has(event.id))');
    const policyLock = source.indexOf('isPolicyRateLockedForPlan(app.supabase, plan, event)');
    const policyRead = source.indexOf('getFomcPolicyDecision(app.supabase, eventId)');
    expect(releasedLock).toBeGreaterThan(0);
    expect(policyLock).toBeGreaterThan(releasedLock);
    expect(policyRead).toBeGreaterThan(policyLock);
  });

  it('the locked response never carries a policy_rate (null) and does not read fomc_policy_decisions', () => {
    const lockedFn = source.slice(
      source.indexOf('async function lockedEventDetail'),
      source.indexOf('export function registerEventRoutes'),
    );
    expect(lockedFn).toContain('policy_rate: null');
    expect(lockedFn).not.toContain('getFomcPolicyDecision');
    expect(lockedFn).toContain('...LOCKED');
  });
});

describe('child resources (revisions / reaction / reaction chart / history) share the same lock via requireUnlockedEventForPlan (HQ 2026-11-19; C review P1)', () => {
  // FOMC の会合は RELEASED にならない(status は SCHEDULED のまま)ので、既存の RELEASED のロックは DB を読まずに素通りする
  const fomcEvent = (n: number, overrides = {}) => ({
    id: `m${n}`,
    indicator_id: 'ind-fomc',
    status: 'SCHEDULED',
    indicator_code: POLICY_RATE_INDICATOR,
    ...overrides,
  });

  it('FREE: a past FOMC meeting outside the recent 3 → 403 PLAN_LIMIT_EXCEEDED with required_plan PRO (the existing error, not a new one)', async () => {
    const client = world(5);
    for (const n of [1, 2]) {
      const error = await requireUnlockedEventForPlan(client, 'FREE', fomcEvent(n)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('PLAN_LIMIT_EXCEEDED');
      expect((error as ApiError).details).toEqual({ required_plan: 'PRO' });
      expect((error as ApiError).message).toContain('FREE plan');
    }
  });

  it('FREE: the 3 most recent recorded meetings are still readable (the definition "recent 3 meetings" is kept)', async () => {
    const client = world(5);
    for (const n of [3, 4, 5]) {
      await expect(requireUnlockedEventForPlan(client, 'FREE', fomcEvent(n))).resolves.toEqual({
        previousLocked: false,
      });
    }
  });

  it('PRO: unchanged — never locked, and the DB is not read for the policy-rate check', async () => {
    await expect(requireUnlockedEventForPlan(failingClient, 'PRO', fomcEvent(1))).resolves.toEqual({
      previousLocked: false,
    });
  });

  it('a meeting with no recorded policy rate (upcoming / not yet recorded) stays readable for FREE', async () => {
    const client = world(5, (n) => n !== 1); // m1 は未記録
    await expect(requireUnlockedEventForPlan(client, 'FREE', fomcEvent(1))).resolves.toEqual({ previousLocked: false });
  });

  it('other indicators (indicator_code given) are unchanged: no extra DB read', async () => {
    await expect(
      requireUnlockedEventForPlan(failingClient, 'FREE', {
        id: 'x',
        indicator_id: 'i',
        status: 'SCHEDULED',
        indicator_code: 'US_CPI',
      }),
    ).resolves.toEqual({ previousLocked: false });
  });

  describe('indicator_code is REQUIRED (type-safe: a future caller cannot skip the FOMC lock by forgetting it)', () => {
    it('compile time: leaving indicator_code out is a type error for the type and for both functions (tsc fails if any of these ever compiles)', () => {
      const noCode = { id: 'x', indicator_id: 'i', status: 'S' };
      const undefinedCode = { ...noCode, indicator_code: undefined };
      // @ts-expect-error indicator_code は必須。省略すると、コンパイルエラーになる
      const t1: UnlockableEvent = noCode;
      // @ts-expect-error undefined を明示しても通らない
      const t2: UnlockableEvent = undefinedCode;
      // @ts-expect-error requireUnlockedEventForPlan も、省略した発表を受け取らない(呼ばない。型の検査だけ)
      const f1 = () => requireUnlockedEventForPlan(failingClient, 'FREE', noCode);
      // @ts-expect-error requireUnlockedEvent も同じ
      const f2 = () => requireUnlockedEvent(failingClient, 'u1', noCode);
      expect([t1, t2]).toHaveLength(2);
      expect([typeof f1, typeof f2]).toEqual(['function', 'function']);
    });

    it('run time (a caller that bypasses the types: any / JS): a missing or empty indicator_code throws — the lock is never silently skipped, for FREE and PRO alike', async () => {
      const bad = [
        { id: 'm1', indicator_id: 'ind-fomc', status: 'SCHEDULED' },
        { id: 'm1', indicator_id: 'ind-fomc', status: 'SCHEDULED', indicator_code: '' },
        { id: 'm1', indicator_id: 'ind-fomc', status: 'SCHEDULED', indicator_code: null },
      ];
      for (const event of bad) {
        for (const plan of ['FREE', 'PRO'] as const) {
          await expect(
            requireUnlockedEventForPlan(world(5), plan, event as unknown as UnlockableEvent),
          ).rejects.toThrow('indicator_code is required');
        }
      }
    });

    it('the guard is not a 403: it is a programming error (a plain Error → 500), so it is noticed in tests, not shown to users as "upgrade"', async () => {
      const error = await requireUnlockedEventForPlan(world(5), 'FREE', {
        id: 'm1',
        indicator_id: 'ind-fomc',
        status: 'SCHEDULED',
      } as unknown as UnlockableEvent).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ApiError);
    });
  });

  it('the four child routes pass the event (with indicator_code, from getEventById) to the lock; the other FOMC-reachable routes are not value paths', () => {
    const events = readFileSync(join(__dirname, '../../src/routes/events.ts'), 'utf8');
    const historical = readFileSync(join(__dirname, '../../src/routes/historical.ts'), 'utf8');
    const repo = readFileSync(join(__dirname, '../../src/repositories/eventsRepository.ts'), 'utf8');
    expect(repo).toContain('indicator_code');
    // 型の面: 呼び出し元(4 か所)が渡す `event` は、すべて getEventById の結果(EventRow。indicator_code は必須)。tsc が保証する
    expect(repo).toMatch(/export interface EventRow[\s\S]*?indicator_code: string;/);
    for (const source of [events, historical]) {
      const calls = [...source.matchAll(/requireUnlockedEvent(?:ForPlan)?\(([^)]*)\)/g)].map((m) => m[1]!);
      for (const args of calls) expect(args).toMatch(/\bevent\)?$/); // 最後の引数は、変数 event(別の形のオブジェクトを、その場で作らない)
    }
    expect(events).toContain('requireUnlockedEvent(app.supabase, request.user!.id, event)'); // revisions
    expect(events.match(/requireUnlockedEventForPlan\(app\.supabase, plan, event\)/g)).toHaveLength(2); // reaction・reaction/chart
    expect(historical).toContain('requireUnlockedEventForPlan(app.supabase, plan, event)'); // history
    // strategy-analysis・comparison は、RELEASED の発表だけを読む(FOMC の会合は含まれない)
    expect(historical).toContain('listReleasedEventsBefore');
    expect(historical).toContain('listRecentReleasedEventIds');
  });
});

describe('runtime check of indicator_code is centralized: nothing slips through the FOMC lock (C review P2)', () => {
  const INVALID: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['spaces only', '   '],
    ['number', 123],
    ['boolean', true],
    ['object', { code: 'US_FOMC' }],
    ['array', ['US_FOMC']],
  ];
  const bad = (value: unknown) => ({ id: 'm1', indicator_id: 'ind-fomc', indicator_code: value });

  it('assertEventIndicatorCode accepts any non-empty string and rejects everything else', () => {
    for (const ok of ['US_FOMC', 'US_CPI', 'x']) expect(() => assertEventIndicatorCode(ok)).not.toThrow();
    for (const [, value] of INVALID)
      expect(() => assertEventIndicatorCode(value)).toThrow('indicator_code is required');
  });

  describe.each([['FREE'], ['PRO']] as const)(
    'isPolicyRateLockedForPlan (%s): the check is inside the function',
    (plan) => {
      it.each(INVALID)('%s → throws (never returns false by default); the DB is not read', async (_label, value) => {
        await expect(isPolicyRateLockedForPlan(failingClient, plan, bad(value) as never)).rejects.toThrow(
          'indicator_code is required',
        );
      });
    },
  );

  it('case / surrounding spaces do not slip past the FOMC check (normalized): an old meeting is still locked for FREE, still open for PRO', async () => {
    const client = world(5);
    for (const code of ['us_fomc', ' US_FOMC ', 'Us_Fomc']) {
      expect(
        await isPolicyRateLockedForPlan(client, 'FREE', { id: 'm1', indicator_id: 'ind-fomc', indicator_code: code }),
      ).toBe(true);
      expect(
        await isPolicyRateLockedForPlan(failingClient, 'PRO', {
          id: 'm1',
          indicator_id: 'ind-fomc',
          indicator_code: code,
        }),
      ).toBe(false);
    }
  });

  it('a different, valid indicator code is not FOMC: no DB read, not locked (FREE and PRO)', async () => {
    for (const plan of ['FREE', 'PRO'] as const) {
      expect(
        await isPolicyRateLockedForPlan(failingClient, plan, { id: 'x', indicator_id: 'i', indicator_code: 'US_CPI' }),
      ).toBe(false);
    }
  });

  describe('requireUnlockedEvent (by user id) and requireUnlockedEventForPlan: the same runtime check, FREE and PRO', () => {
    const entitlementRows = (userId: string, features: string[]) =>
      features.map((feature_code) => ({ user_id: userId, feature_code, enabled: true, expires_at: null }));
    const usersWorld = () =>
      fakeSupabaseClient({
        entitlements: [
          ...entitlementRows('u-free', ['VIEW_BASIC_EVENT']),
          ...entitlementRows('u-pro', ['VIEW_BASIC_EVENT', 'VIEW_ADVANCED_STATS']),
        ],
        default_entitlements: [],
        economic_events: Array.from({ length: 5 }, (_, i) => meeting(i + 1)),
        fomc_policy_decisions: Array.from({ length: 5 }, (_, i) => ({ event_id: `m${i + 1}` })),
      });
    // 型を迂回した呼び出し(不正な値)も作るので、UnlockableEvent に型を合わせる
    const event = (n: number, code: unknown) =>
      ({
        id: `m${n}`,
        indicator_id: 'ind-fomc',
        status: 'SCHEDULED',
        indicator_code: code,
      }) as unknown as UnlockableEvent;

    it.each(INVALID)(
      'requireUnlockedEvent: %s → throws a plain Error for FREE and for PRO (not a 403)',
      async (_label, value) => {
        for (const userId of ['u-free', 'u-pro']) {
          const error = await requireUnlockedEvent(usersWorld(), userId, event(1, value)).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(Error);
          expect(error).not.toBeInstanceOf(ApiError);
          expect((error as Error).message).toContain('indicator_code is required');
        }
      },
    );

    it.each(INVALID)('requireUnlockedEventForPlan: %s → throws for FREE and for PRO', async (_label, value) => {
      for (const plan of ['FREE', 'PRO'] as const) {
        await expect(requireUnlockedEventForPlan(usersWorld(), plan, event(1, value))).rejects.toThrow(
          'indicator_code is required',
        );
      }
    });

    it('with a valid code, requireUnlockedEvent keeps the real behaviour: FREE old meeting → PLAN_LIMIT_EXCEEDED; FREE recent → ok; PRO → ok', async () => {
      const client = usersWorld();
      const denied = await requireUnlockedEvent(client, 'u-free', event(1, POLICY_RATE_INDICATOR)).catch(
        (e: unknown) => e,
      );
      expect((denied as ApiError).code).toBe('PLAN_LIMIT_EXCEEDED');
      await expect(requireUnlockedEvent(client, 'u-free', event(5, POLICY_RATE_INDICATOR))).resolves.toEqual({
        previousLocked: false,
      });
      await expect(requireUnlockedEvent(client, 'u-pro', event(1, POLICY_RATE_INDICATOR))).resolves.toEqual({
        previousLocked: false,
      });
    });
  });
});
