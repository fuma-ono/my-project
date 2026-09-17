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

    it('returns 404 EVENT_NOT_FOUND for an unknown id', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/events/00000000-0000-0000-0000-000000000000',
        headers: authHeader,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('EVENT_NOT_FOUND');
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
      expect(Number(body.snapshot.surprise)).toBeCloseTo(0.2);

      const usdjpy = body.related_fx_pairs.find((pair: { symbol: string }) => pair.symbol === 'USDJPY');
      const oneMin = usdjpy.reactions.find((r: { timeframe: string }) => r.timeframe === '1m');
      expect(oneMin.analysis_status).toBe('READY');
      expect(oneMin.data_status).toBeUndefined();
    });
  });

  describe('Entitlement gating — VIEW_MARKET_REACTION (api-design.md §27.1)', () => {
    it('403s the reaction endpoint for a user without the entitlement', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/events/${US_CPI_EVENT_ID}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}`,
        headers: authHeader,
      });
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe('FEATURE_NOT_ENTITLED');
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
      expect(body.indicators.some((row: { code: string }) => row.code === 'US_CPI')).toBe(true);
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
      expect(JSON.parse(response.body).plan).toBe('FREE');
    });
  });
});
