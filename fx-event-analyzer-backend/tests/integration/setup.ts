import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { loadEnv } from '../../src/config/env.js';

/**
 * These tests exercise the real app (src/app.ts) against a real local
 * Supabase stack — `supabase start` (Postgres + GoTrue + PostgREST), the
 * same stack the CI workflow (.github/workflows/fx-event-analyzer-backend-*.yml)
 * runs via the Supabase CLI. Docker is not available in every environment
 * that might run this file (notably the sandbox this Backend was first
 * built in — see README.md), so the whole suite is skipped, not failed,
 * when the required env vars aren't present. `npm test` still runs every
 * pure-logic and fake-boundary test unconditionally; only this directory
 * is conditional.
 */
export interface IntegrationEnv {
  env: Env;
  anonKey: string;
}

export function loadIntegrationEnv(): IntegrationEnv | null {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_JWT_SECRET || !SUPABASE_ANON_KEY) {
    return null;
  }
  return {
    env: loadEnv({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_JWT_SECRET,
      PORT: '3000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'silent',
    }),
    anonKey: SUPABASE_ANON_KEY,
  };
}

export interface IntegrationContext {
  app: FastifyInstance;
  /** service_role client — bypasses RLS, used for fixture setup/teardown and DB-level assertions. */
  serviceClient: SupabaseClient;
  /** anon-key client — used to sign in as a real test user and to run RLS-bound queries as them. */
  anonKey: string;
  supabaseUrl: string;
}

export function buildIntegrationContext(integration: IntegrationEnv): IntegrationContext {
  const serviceClient = createClient(integration.env.SUPABASE_URL, integration.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const app = buildApp({ env: integration.env, supabase: serviceClient, logger: false });
  return { app, serviceClient, anonKey: integration.anonKey, supabaseUrl: integration.env.SUPABASE_URL };
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let userCounter = 0;

/** Creates a real auth.users row via the Admin API, then signs in as them
 * (via a fresh anon-key client) to obtain a genuine, GoTrue-issued access
 * token — never a hand-minted JWT — so Auth tests exercise the exact same
 * signature/claims shape production tokens have. */
export async function createTestUser(ctx: IntegrationContext): Promise<TestUser> {
  userCounter += 1;
  const email = `fx-backend-test-${Date.now()}-${userCounter}@example.com`;
  const password = 'Test-Password-1234!';

  const { data, error } = await ctx.serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    throw new Error(`Failed to create test user: ${error?.message ?? 'unknown error'}`);
  }

  const anonClient = createClient(ctx.supabaseUrl, ctx.anonKey);
  const signIn = await anonClient.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`Failed to sign in test user: ${signIn.error?.message ?? 'unknown error'}`);
  }

  // profiles row is not created automatically (no DB trigger for it — out
  // of Phase 2 scope); insert it directly so /account and entitlement/
  // subscription FKs have somewhere to point.
  const { error: profileError } = await ctx.serviceClient.from('profiles').insert({ id: data.user.id });
  if (profileError) {
    throw new Error(`Failed to insert profile for test user: ${profileError.message}`);
  }

  return { id: data.user.id, email, accessToken: signIn.data.session.access_token };
}

export async function deleteTestUser(ctx: IntegrationContext, userId: string): Promise<void> {
  // profiles/subscriptions/entitlements all cascade from auth.users(id).
  await ctx.serviceClient.auth.admin.deleteUser(userId);
}

export async function grantEntitlement(
  ctx: IntegrationContext,
  userId: string,
  featureCode: string,
  options: { enabled?: boolean; expiresAt?: string | null } = {},
): Promise<void> {
  const { enabled = true, expiresAt = null } = options;
  const { error } = await ctx.serviceClient
    .from('entitlements')
    .insert({ user_id: userId, feature_code: featureCode, enabled, expires_at: expiresAt });
  if (error) {
    throw new Error(`Failed to grant entitlement: ${error.message}`);
  }
}
