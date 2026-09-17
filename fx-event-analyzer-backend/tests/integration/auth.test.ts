import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

describe.skipIf(!integration)('Auth — JWT verification (api-design.md §2.2)', () => {
  let ctx: IntegrationContext;
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    userA = await createTestUser(ctx);
    userB = await createTestUser(ctx);
  });

  afterAll(async () => {
    await deleteTestUser(ctx, userA.id);
    await deleteTestUser(ctx, userB.id);
    await ctx.app.close();
  });

  it('rejects a request with no Authorization header as 401', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/account' });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed/invalid token as 401', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a token signed with the wrong secret as 401', async () => {
    const forged = jwt.sign({ sub: userA.id, role: 'authenticated' }, 'wrong-secret', {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired token as 401', async () => {
    const expired = jwt.sign({ sub: userA.id, role: 'authenticated' }, integration!.env.SUPABASE_JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a real, validly signed access token', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${userA.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).user_id).toBe(userA.id);
  });

  it('/health does not require auth', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe.skipIf(!integration)('RLS — user isolation (db-design.md §6, defense in depth)', () => {
  let ctx: IntegrationContext;
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    userA = await createTestUser(ctx);
    userB = await createTestUser(ctx);
  });

  afterAll(async () => {
    await deleteTestUser(ctx, userA.id);
    await deleteTestUser(ctx, userB.id);
    await ctx.app.close();
  });

  it('a user can SELECT their own profile directly, RLS-bound', async () => {
    const asUserA = createClient(ctx.supabaseUrl, ctx.anonKey, {
      global: { headers: { Authorization: `Bearer ${userA.accessToken}` } },
    });
    const { data, error } = await asUserA.from('profiles').select('id').eq('id', userA.id).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(userA.id);
  });

  it('a user cannot SELECT another user’s profile directly — RLS returns no row, not an error', async () => {
    const asUserA = createClient(ctx.supabaseUrl, ctx.anonKey, {
      global: { headers: { Authorization: `Bearer ${userA.accessToken}` } },
    });
    const { data, error } = await asUserA.from('profiles').select('id').eq('id', userB.id).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('a user cannot SELECT another user’s subscriptions/entitlements rows directly', async () => {
    const asUserA = createClient(ctx.supabaseUrl, ctx.anonKey, {
      global: { headers: { Authorization: `Bearer ${userA.accessToken}` } },
    });
    const subs = await asUserA.from('subscriptions').select('id').eq('user_id', userB.id);
    const ents = await asUserA.from('entitlements').select('id').eq('user_id', userB.id);
    expect(subs.data).toEqual([]);
    expect(ents.data).toEqual([]);
  });

  it('any authenticated user may SELECT shared market data (economic_indicators)', async () => {
    const asUserA = createClient(ctx.supabaseUrl, ctx.anonKey, {
      global: { headers: { Authorization: `Bearer ${userA.accessToken}` } },
    });
    const { data, error } = await asUserA.from('economic_indicators').select('id').limit(1);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });

  it('ingestion_logs has no SELECT policy at all — even an authenticated user gets zero rows', async () => {
    const asUserA = createClient(ctx.supabaseUrl, ctx.anonKey, {
      global: { headers: { Authorization: `Bearer ${userA.accessToken}` } },
    });
    const { data, error } = await asUserA.from('ingestion_logs').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('an anonymous (unauthenticated) request cannot read anyone’s profile', async () => {
    const anon = createClient(ctx.supabaseUrl, ctx.anonKey);
    const { data } = await anon.from('profiles').select('id').eq('id', userA.id).maybeSingle();
    expect(data).toBeNull();
  });
});

describe.skipIf(!integration)('RELEASE snapshot immutability (db-design.md §3.6, DB trigger)', () => {
  let ctx: IntegrationContext;
  const CPI_EVENT_ID = '30000000-0000-0000-0000-000000000001';

  beforeAll(() => {
    ctx = buildIntegrationContext(integration!);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('rejects an UPDATE on a RELEASE snapshot, even via the service_role client', async () => {
    const { error } = await ctx.serviceClient
      .from('event_snapshots')
      .update({ actual: 999 })
      .eq('event_id', CPI_EVENT_ID)
      .eq('snapshot_type', 'RELEASE');
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/immutable/);
  });

  it('rejects a DELETE on a RELEASE snapshot, even via the service_role client', async () => {
    const { error } = await ctx.serviceClient
      .from('event_snapshots')
      .delete()
      .eq('event_id', CPI_EVENT_ID)
      .eq('snapshot_type', 'RELEASE');
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/immutable/);
  });

  it('the RELEASE snapshot is unchanged after the rejected mutation attempts', async () => {
    const { data } = await ctx.serviceClient
      .from('event_snapshots')
      .select('actual')
      .eq('event_id', CPI_EVENT_ID)
      .eq('snapshot_type', 'RELEASE')
      .single();
    expect(Number(data?.actual)).toBe(3.3);
  });
});
