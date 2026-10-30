import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  grantEntitlement,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

// Seed fixtures (supabase/seed.sql) — used by id rather than re-inserted,
// since Phase 2 instruction §19 is explicit that seed data is dev/test
// only and the point of these tests is to exercise the real DB/API path.
const US_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000001';
const US_CPI_EVENT_ID = '30000000-0000-0000-0000-000000000001'; // RELEASED, has 1 revision + explanation.
const BOJ_EVENT_ID = '30000000-0000-0000-0000-000000000002'; // RELEASED, forecast missing -> surprise null.
const NFP_EVENT_ID = '30000000-0000-0000-0000-000000000003'; // SCHEDULED, not yet released.
const USDJPY_FX_PAIR_ID = '20000000-0000-0000-0000-000000000001';

describe.skipIf(!integration)('Backend API — Phase 2 endpoints against real seeded data', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  let authHeader: { authorization: string };

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    user = await createTestUser(ctx);
    authHeader = { authorization: `Bearer ${user.accessToken}` };
    // GET /events/:event_id itself requires VIEW_BASIC_EVENT (api-design.md
    // §27.1) — granted once here since most of this file's tests read it.
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
  });

  afterAll(async () => {
    await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  describe('Indicators', () => {
    it('lists indicators with pagination meta', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/indicators?limit=2', headers: authHeader });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBe(2);
      expect(body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(body.meta.total).toBeGreaterThanOrEqual(5);
    });

    it('includes name_en and a key_points array on every listed indicator (v1.16)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/indicators?limit=100',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const rows: Array<{ code: string; name_en: unknown; key_points: unknown }> = JSON.parse(response.body).data;
      for (const row of rows) {
        expect(row).toHaveProperty('name_en');
        expect(Array.isArray(row.key_points)).toBe(true);
      }
      const seeded = rows.filter((row) => ['US_CPI', 'US_NFP', 'US_FOMC', 'JP_CPI', 'BOJ_RATE'].includes(row.code));
      expect(seeded).toHaveLength(5);
      for (const row of seeded) {
        expect(typeof row.name_en).toBe('string');
        expect((row.key_points as string[]).length).toBeGreaterThanOrEqual(2);
      }
    });

    it('includes market_view_above / market_view_below on every listed indicator (v1.18)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/indicators?limit=100',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const rows: Array<{ code: string; market_view_above: unknown; market_view_below: unknown }> = JSON.parse(
        response.body,
      ).data;
      for (const row of rows) {
        expect(row).toHaveProperty('market_view_above');
        expect(row).toHaveProperty('market_view_below');
      }
      const seeded = rows.filter((row) => ['US_CPI', 'US_NFP', 'US_FOMC', 'JP_CPI', 'BOJ_RATE'].includes(row.code));
      expect(seeded).toHaveLength(5);
      for (const row of seeded) {
        expect(row.market_view_above).toMatch(/予想を上回る|予想より高い/);
        expect(row.market_view_below).toMatch(/予想を下回る|予想より低い/);
      }
    });

    it('includes display_name on every listed indicator (v1.21)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/indicators?limit=100',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const rows: Array<{ code: string; display_name: unknown }> = JSON.parse(response.body).data;
      for (const row of rows) expect(row).toHaveProperty('display_name');
      const byCode = Object.fromEntries(rows.map((row) => [row.code, row.display_name]));
      expect(byCode.US_CPI).toBe('消費者物価指数（CPI）');
      expect(byCode.US_NFP).toBe('非農業部門雇用者数（NFP）');
    });

    it('filters by q (partial match, ILIKE)', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/indicators?q=CPI', headers: authHeader });
      const body = JSON.parse(response.body);
      expect(body.data.every((row: { code: string }) => row.code.includes('CPI'))).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2); // US_CPI and JP_CPI
    });

    it('returns indicator detail with related_fx_pairs and latest_event', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/indicators/${US_CPI_INDICATOR_ID}`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.indicator.code).toBe('US_CPI');
      // v1.16 (SCR-006): English name, Japanese 概要, and 注目される理由.
      expect(body.indicator.name_en).toBe('Consumer Price Index');
      // v1.21: 一覧画面の表示名。
      expect(body.indicator.display_name).toBe('消費者物価指数（CPI）');
      expect(body.indicator.description).toMatch(/^消費者物価指数（CPI）は/);
      expect(body.indicator.key_points).toEqual([
        'インフレの動向を把握できる',
        '金融政策への影響が大きい',
        '為替や株式市場に大きな影響を与える',
      ]);
      // v1.18 (SCR-008): 一般的な見方 (結果が予想を上回った / 下回ったとき)。
      expect(body.indicator.market_view_above).toBe(
        '米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
      );
      expect(body.indicator.market_view_below).toBe(
        '米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。',
      );
      expect(body.related_fx_pairs.some((pair: { symbol: string }) => pair.symbol === 'USDJPY')).toBe(true);
    });

    it('returns 404 INDICATOR_NOT_FOUND for an unknown id', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/indicators/00000000-0000-0000-0000-000000000000',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('INDICATOR_NOT_FOUND');
    });

    it('lists an indicator’s events (§13.3) with the release snapshot folded in', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/indicators/${US_CPI_INDICATOR_ID}/events`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      // §7.1: the API contract value (READY), never the raw DB data_status (AVAILABLE).
      expect(body.data[0]).toMatchObject({ event_id: US_CPI_EVENT_ID, status: 'RELEASED', data_status: 'READY' });
      expect(Number(body.data[0].surprise)).toBeCloseTo(0.2);
      expect(body.meta.total).toBe(1);
    });

    it('filters an indicator’s events by status', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/indicators/${US_CPI_INDICATOR_ID}/events?status=SCHEDULED`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(0);
    });

    it('404s the events sub-resource for an unknown indicator', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/indicators/00000000-0000-0000-0000-000000000000/events',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('INDICATOR_NOT_FOUND');
    });

    // v1.20 (SCR-005): next_release_datetime / next_event_id / latest_release_datetime
    // and sort=next_release. The seeded NFP event (2026-10-03) is SCHEDULED
    // but already in the past, so it is not a "next" release; BOJ gets
    // far-future events here (2099 — outside every calendar/notification
    // window other tests use) so a real next release exists.
    describe('next / latest release (v1.20)', () => {
      const BOJ_INDICATOR_ID = '10000000-0000-0000-0000-000000000005';
      const NFP_INDICATOR_ID = '10000000-0000-0000-0000-000000000002';
      const BOJ_NEXT_EVENT_ID = '30000000-0000-0000-0000-0000000020a1';
      const BOJ_LATER_EVENT_ID = '30000000-0000-0000-0000-0000000020a2';
      const BOJ_CANCELLED_EVENT_ID = '30000000-0000-0000-0000-0000000020a3';
      const insertedIds = [BOJ_NEXT_EVENT_ID, BOJ_LATER_EVENT_ID, BOJ_CANCELLED_EVENT_ID];

      type ReleaseFields = {
        id: string;
        next_release_datetime: string | null;
        next_event_id: string | null;
        latest_release_datetime: string | null;
      };
      const time = (value: string | null) => (value === null ? null : Date.parse(value));

      beforeAll(async () => {
        const base = {
          indicator_id: BOJ_INDICATOR_ID,
          provider: 'integration-test',
          release_datetime_precision: 'EXACT',
          importance: 'HIGH',
        };
        const { error } = await ctx.serviceClient.from('economic_events').insert([
          {
            ...base,
            id: BOJ_LATER_EVENT_ID,
            provider_event_id: 'next-release-later',
            release_datetime: '2099-03-19T03:00:00Z',
            status: 'SCHEDULED',
          },
          {
            ...base,
            id: BOJ_NEXT_EVENT_ID,
            provider_event_id: 'next-release-next',
            release_datetime: '2099-01-23T03:00:00Z',
            status: 'SCHEDULED',
          },
          {
            ...base,
            id: BOJ_CANCELLED_EVENT_ID,
            provider_event_id: 'next-release-cancelled',
            release_datetime: '2099-01-01T03:00:00Z',
            status: 'CANCELLED',
          },
        ]);
        if (error) throw new Error(`Failed to insert test events: ${error.message}`);
      });

      afterAll(async () => {
        await ctx.serviceClient.from('economic_events').delete().in('id', insertedIds);
      });

      it('adds the three fields to every listed indicator, derived from economic_events', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/indicators?limit=100',
          headers: authHeader,
        });
        expect(response.statusCode).toBe(200);
        const rows: ReleaseFields[] = JSON.parse(response.body).data;
        for (const row of rows) {
          expect(row).toHaveProperty('next_release_datetime');
          expect(row).toHaveProperty('next_event_id');
          expect(row).toHaveProperty('latest_release_datetime');
        }
        const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
        // BOJ: earliest future SCHEDULED (the CANCELLED one is ignored); latest RELEASED is the seed's 2026-09-12.
        expect(byId[BOJ_INDICATOR_ID]!.next_event_id).toBe(BOJ_NEXT_EVENT_ID);
        expect(time(byId[BOJ_INDICATOR_ID]!.next_release_datetime)).toBe(Date.parse('2099-01-23T03:00:00Z'));
        expect(time(byId[BOJ_INDICATOR_ID]!.latest_release_datetime)).toBe(Date.parse('2026-09-12T03:00:00Z'));
        // US CPI: no future SCHEDULED event, latest RELEASED is 2026-09-10.
        expect(byId[US_CPI_INDICATOR_ID]).toMatchObject({ next_release_datetime: null, next_event_id: null });
        expect(time(byId[US_CPI_INDICATOR_ID]!.latest_release_datetime)).toBe(Date.parse('2026-09-10T12:30:00Z'));
        // NFP: its only event is SCHEDULED but in the past, and nothing was RELEASED.
        expect(byId[NFP_INDICATOR_ID]).toMatchObject({
          next_release_datetime: null,
          next_event_id: null,
          latest_release_datetime: null,
        });
      });

      it('includes the same fields on GET /indicators/{id}', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/indicators/${BOJ_INDICATOR_ID}`,
          headers: authHeader,
        });
        expect(response.statusCode).toBe(200);
        const { indicator } = JSON.parse(response.body) as { indicator: ReleaseFields };
        expect(indicator.next_event_id).toBe(BOJ_NEXT_EVENT_ID);
        expect(time(indicator.next_release_datetime)).toBe(Date.parse('2099-01-23T03:00:00Z'));
        expect(time(indicator.latest_release_datetime)).toBe(Date.parse('2026-09-12T03:00:00Z'));
      });

      // v1.31「次の発表」: 予定(SCHEDULED)は近い順が既定。アプリは from=現在 を付けて先頭の1件を次の発表にする。
      it('status=SCHEDULED lists the nearest future release first (v1.31), and order=desc keeps the old order', async () => {
        const url = `/api/v1/indicators/${BOJ_INDICATOR_ID}/events?status=SCHEDULED&limit=1`;
        const nearest = await ctx.app.inject({ method: 'GET', url, headers: authHeader });
        expect(nearest.statusCode).toBe(200);
        expect(JSON.parse(nearest.body).data.map((row: { event_id: string }) => row.event_id)).toEqual([
          BOJ_NEXT_EVENT_ID,
        ]);

        const from = encodeURIComponent(new Date().toISOString());
        const withFrom = await ctx.app.inject({ method: 'GET', url: `${url}&from=${from}`, headers: authHeader });
        expect(JSON.parse(withFrom.body).data[0].event_id).toBe(BOJ_NEXT_EVENT_ID);

        const desc = await ctx.app.inject({ method: 'GET', url: `${url}&order=desc`, headers: authHeader });
        expect(JSON.parse(desc.body).data[0].event_id).toBe(BOJ_LATER_EVENT_ID);

        const bad = await ctx.app.inject({ method: 'GET', url: `${url}&order=up`, headers: authHeader });
        expect(bad.statusCode).toBe(422);
      });

      it('keeps the release history newest first (status=RELEASED, v1.31)', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/indicators/${BOJ_INDICATOR_ID}/events?status=RELEASED`,
          headers: authHeader,
        });
        const times: number[] = JSON.parse(response.body).data.map((row: { release_datetime: string }) =>
          Date.parse(row.release_datetime),
        );
        expect(times.length).toBeGreaterThan(0);
        expect([...times].sort((a, b) => b - a)).toEqual(times);
      });

      it('never shows a past-due SCHEDULED release as the next one when from=now is sent (v1.31)', async () => {
        // NFP の seed の行は SCHEDULED のまま発表時刻(2026-10-03)を過ぎている。
        const from = encodeURIComponent(new Date().toISOString());
        const response = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/indicators/${NFP_INDICATOR_ID}/events?status=SCHEDULED&from=${from}&limit=1`,
          headers: authHeader,
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).data).toEqual([]);
      });

      it('latest_event is the newest event up to now, not the farthest future schedule (v1.31)', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/indicators/${BOJ_INDICATOR_ID}`,
          headers: authHeader,
        });
        const { latest_event: latestEvent } = JSON.parse(response.body) as {
          latest_event: { id: string; release_datetime: string } | null;
        };
        expect(latestEvent).not.toBeNull();
        expect(insertedIds).not.toContain(latestEvent!.id);
        expect(Date.parse(latestEvent!.release_datetime)).toBeLessThanOrEqual(Date.now());
      });

      it('event search lists the next schedule (one per indicator) before past events (v1.31)', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/search?q=BOJ_RATE&type=event',
          headers: authHeader,
        });
        expect(response.statusCode).toBe(200);
        const events: Array<{ id: string }> = JSON.parse(response.body).events;
        expect(events[0]!.id).toBe(BOJ_NEXT_EVENT_ID);
        expect(events.map((row) => row.id)).not.toContain(BOJ_LATER_EVENT_ID);
        expect(events.map((row) => row.id)).toContain(BOJ_EVENT_ID);
      });

      it('sort=next_release puts indicators with a next release first, ascending, then the rest', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/indicators?sort=next_release&limit=100',
          headers: authHeader,
        });
        expect(response.statusCode).toBe(200);
        const rows: ReleaseFields[] = JSON.parse(response.body).data;
        const firstNull = rows.findIndex((row) => row.next_release_datetime === null);
        const withNext = firstNull === -1 ? rows : rows.slice(0, firstNull);
        expect(rows.slice(withNext.length).every((row) => row.next_release_datetime === null)).toBe(true);
        const times = withNext.map((row) => time(row.next_release_datetime)!);
        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(withNext.some((row) => row.id === BOJ_INDICATOR_ID)).toBe(true);
      });
    });
  });

  describe('Events', () => {
    it('a released event with a revision reports revision_status REVISED and a non-null explanation', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.event.revision_status).toBe('REVISED');
      // v1.22: HQ's 一覧表示名 next to indicator_name.
      expect(body.event.display_name).toBe('消費者物価指数（CPI）');
      // §7.1: the API contract value (READY), never the raw DB data_status (AVAILABLE).
      expect(body.event.data_status).toBe('READY');
      expect(body.explanation).not.toBeNull();
      expect(Number(body.analysis.surprise)).toBeCloseTo(0.2);
      expect(body.analysis.surprise_direction).toBe('POSITIVE');
    });

    it('an event with no forecast reports surprise null (never 0)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${BOJ_EVENT_ID}`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.analysis.surprise).toBeNull();
      expect(body.analysis.surprise_direction).toBeNull();
      // Seed data_status PARTIAL -> API contract DATA_PENDING (§7.1).
      expect(body.event.data_status).toBe('DATA_PENDING');
      // APPROXIMATE precision excludes 1m.
      expect(body.available_timeframes).not.toContain('1m');
    });

    it('a scheduled (not yet released) event has no revision and no explanation', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${NFP_EVENT_ID}`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.event.revision_status).toBe('NONE');
      expect(body.explanation).toBeNull();
      expect(body.snapshot).toBeNull();
    });

    // v1.44 reaction_state(HQ判断 2026-10-30 P1-1 段階1): 行が無い理由を足すだけで、analysis_status は変えない。
    it('reaction_state: a stored row is CALCULATED; an old release with no row is NOT_CALCULATED (still DATA_PENDING, never DATA_UNAVAILABLE)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const bySymbol = new Map(
        body.related_fx_pairs.map((pair: { symbol: string; reaction: Record<string, unknown> }) => [
          pair.symbol,
          pair.reaction,
        ]),
      );
      // seed: US CPI (2026-09-10) has USDJPY rows (AVAILABLE) and no EURUSD rows
      expect(bySymbol.get('USDJPY')).toMatchObject({
        analysis_status: 'READY',
        reaction_state: 'CALCULATED',
        retry_scheduled: null,
      });
      expect(bySymbol.get('EURUSD')).toMatchObject({
        analysis_status: 'DATA_PENDING',
        reaction_state: 'NOT_CALCULATED',
        retry_scheduled: false,
      });
      for (const major of body.major_fx_reactions as { reactions: Record<string, unknown>[] }[]) {
        for (const reaction of major.reactions) {
          expect(['CALCULATED', 'NOT_DUE', 'NOT_CALCULATED', null]).toContain(reaction.reaction_state);
          if (reaction.reaction_state === null) expect(reaction.analysis_status).toBe('NOT_ANALYZABLE');
        }
      }
    });

    it('reaction_state: a scheduled (not yet released) event is NOT_DUE', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${NFP_EVENT_ID}`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      for (const pair of body.related_fx_pairs as { reaction: Record<string, unknown> }[]) {
        expect(pair.reaction).toMatchObject({
          analysis_status: 'DATA_PENDING',
          reaction_state: 'NOT_DUE',
          retry_scheduled: null,
        });
      }
    });

    it('returns 404 EVENT_NOT_FOUND for an unknown id', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/events/00000000-0000-0000-0000-000000000000',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('EVENT_NOT_FOUND');
    });

    it('returns major_fx_reactions: event-currency pairs, related first, 1m/5m/15m (SCR-007, v1.17)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Seed: USD pairs are USDJPY/EURUSD (related, priority 1/2), then GBPUSD/AUDUSD/USDCHF by the major order.
      expect(body.major_fx_reactions.map((p: { symbol: string }) => p.symbol)).toEqual([
        'USDJPY',
        'EURUSD',
        'GBPUSD',
        'AUDUSD',
      ]);
      const usdjpy = body.major_fx_reactions[0];
      expect(usdjpy.fx_pair_id).toBe(USDJPY_FX_PAIR_ID);
      expect(usdjpy.reactions.map((r: { timeframe: string }) => r.timeframe)).toEqual(['1m', '5m', '15m']);
      // Same stored values GET /events/{id}/reaction returns (seed: 28 / 56 / 85 pips).
      expect(usdjpy.reactions.map((r: { pips: number }) => Number(r.pips))).toEqual([28, 56, 85]);
      expect(Number(usdjpy.reactions[0].change_percent)).toBeCloseTo(0.1902);
      expect(usdjpy.reactions.every((r: { analysis_status: string }) => r.analysis_status === 'READY')).toBe(true);
      // No price data for EURUSD in the seed.
      expect(body.major_fx_reactions[1].reactions[0]).toEqual({
        timeframe: '1m',
        pips: null,
        change_percent: null,
        analysis_status: 'DATA_PENDING',
      });
      // related_fx_pairs is unchanged (5m summary).
      expect(body.related_fx_pairs[0].reaction.timeframe).toBe('5m');
      expect(Number(body.related_fx_pairs[0].reaction.pips)).toBeCloseTo(56.0);
    });

    it('major_fx_reactions of a scheduled event are null pips with DATA_PENDING', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${NFP_EVENT_ID}`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.major_fx_reactions).toHaveLength(4);
      for (const pair of body.major_fx_reactions) {
        for (const reaction of pair.reactions) {
          expect(reaction.pips).toBeNull();
          expect(reaction.change_percent).toBeNull();
          expect(reaction.analysis_status).toBe('DATA_PENDING');
        }
      }
    });

    it('major_fx_reactions marks 1m NOT_ANALYZABLE for an APPROXIMATE release', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${BOJ_EVENT_ID}`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      // JPY pairs: USDJPY (related) first, then EURJPY/GBPJPY/AUDJPY by the major order.
      expect(body.major_fx_reactions.map((p: { symbol: string }) => p.symbol)).toEqual([
        'USDJPY',
        'EURJPY',
        'GBPJPY',
        'AUDJPY',
      ]);
      expect(body.major_fx_reactions[0].reactions[0].analysis_status).toBe('NOT_ANALYZABLE');
    });

    it('lists revisions for an event, paginated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}/revisions`,
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.data.length).toBe(1);
      expect(body.data[0].field_name).toBe('PREVIOUS');
    });
  });

  describe('Historical Event Detail (api-design.md §20)', () => {
    it('returns snapshot/explanation and maps reaction data_status to the API-contract analysis_status', async () => {
      await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_HISTORICAL);
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}/history`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.indicator_id).toBe(US_CPI_INDICATOR_ID);
      expect(body.event.display_name).toBe('消費者物価指数（CPI）');
      expect(Number(body.snapshot.surprise)).toBeCloseTo(0.2);

      const usdjpy = body.related_fx_pairs.find((pair: { symbol: string }) => pair.symbol === 'USDJPY');
      const oneMin = usdjpy.reactions.find((r: { timeframe: string }) => r.timeframe === '1m');
      expect(oneMin.analysis_status).toBe('READY');
      expect(oneMin.data_status).toBeUndefined();
    });
  });

  describe('Historical Comparison display_name (api-design.md §21, v1.22)', () => {
    // Own user: entitlements are unique per (user_id, feature_code), and the
    // shared user's VIEW_HISTORICAL is granted by another test.
    let historicalUser: TestUser;

    beforeAll(async () => {
      historicalUser = await createTestUser(ctx);
      await grantEntitlement(ctx, historicalUser.id, FEATURE_CODES.VIEW_HISTORICAL);
    });

    afterAll(async () => {
      await deleteTestUser(ctx, historicalUser.id);
    });

    it.each(['5m', 'all'])('returns indicator.display_name for timeframe=%s', async (timeframe) => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/indicators/${US_CPI_INDICATOR_ID}/comparison?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=${timeframe}`,
        headers: { authorization: `Bearer ${historicalUser.accessToken}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.indicator).toMatchObject({
        code: 'US_CPI',
        display_name: '消費者物価指数（CPI）',
        country_code: 'US',
        currency_code: 'USD',
      });
      // 過去イベント比較の表(api-design v1.26): どの時間足を選んでも、各発表に1分・5分・15分のpipsが付く。
      for (const event of body.events) {
        expect(Object.keys(event.pips_by_timeframe).sort()).toEqual(['15m', '1m', '5m']);
      }
    });
  });

  describe('Entitlement gating — VIEW_MARKET_REACTION (api-design.md §27.1)', () => {
    it('403s the reaction endpoint for a user whose VIEW_MARKET_REACTION is explicitly disabled', async () => {
      // VIEW_MARKET_REACTION is a default feature (default_entitlements,
      // HQ instruction 2026-10-16), so "no row" now means granted. Revoking
      // it takes an explicit disabled row — on its own user, since rows are
      // unique per (user_id, feature_code) and the shared user is granted
      // the feature in the next test.
      const revoked = await createTestUser(ctx);
      try {
        await grantEntitlement(ctx, revoked.id, FEATURE_CODES.VIEW_MARKET_REACTION, { enabled: false });
        const response = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/events/${US_CPI_EVENT_ID}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}`,
          headers: { authorization: `Bearer ${revoked.accessToken}` },
        });
        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.body).error.code).toBe('FEATURE_NOT_ENTITLED');
      } finally {
        await deleteTestUser(ctx, revoked.id);
      }
    });

    it('200s once the user is granted VIEW_MARKET_REACTION, returning real reaction data for all timeframes', async () => {
      await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_MARKET_REACTION);
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const oneMin = body.reactions.find((r: { timeframe: string }) => r.timeframe === '1m');
      expect(Number(oneMin.pips)).toBeCloseTo(28.0);
      expect(oneMin.analysis_status).toBe('READY');
    });
  });

  describe('Search (api-design.md §23, partial match)', () => {
    it('finds the US CPI indicator by partial code match', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=CPI&type=indicator',
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      const cpi = body.indicators.find((row: { code: string }) => row.code === 'US_CPI');
      expect(cpi).toBeDefined();
      expect(cpi.display_name).toBe('消費者物価指数（CPI）');
      expect(body.events).toBeUndefined();
    });

    it('finds a currency by partial name match', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=yen&type=currency',
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.currencies).toEqual([{ code: 'JPY', name: 'Japanese Yen' }]);
    });
  });

  describe('Home (api-design.md §12, timezone-scoped day range)', () => {
    it('returns the US CPI event when the release day, in UTC, falls in range', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/home?date=2026-09-10&timezone=UTC',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.events.some((e: { event_id: string }) => e.event_id === US_CPI_EVENT_ID)).toBe(true);
    });

    it('includes related_fx_pairs per event (ui-screens.md §5　関連通貨ペア)', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/home?date=2026-09-10&timezone=UTC',
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      const cpiEvent = body.events.find((e: { event_id: string }) => e.event_id === US_CPI_EVENT_ID);
      expect(cpiEvent.related_fx_pairs.some((pair: { symbol: string }) => pair.symbol === 'USDJPY')).toBe(true);
      // §7.1: the API contract value (READY), never the raw DB data_status (AVAILABLE).
      expect(cpiEvent.data_status).toBe('READY');
      // v1.13: the indicator's unit, for Home's 予想/前回.
      expect(cpiEvent.unit).toBe('%');
    });

    it('does not return the event for an unrelated day', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/home?date=2026-01-01&timezone=UTC',
        headers: authHeader,
      });
      const body = JSON.parse(response.body);
      expect(body.events.some((e: { event_id: string }) => e.event_id === US_CPI_EVENT_ID)).toBe(false);
    });
  });

  describe('Subscription — implicit FREE default (no row yet)', () => {
    it('reports plan FREE, not a 404, for a user with no subscriptions row', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/subscription', headers: authHeader });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ plan: 'FREE', product_id: null });
    });
  });
});
