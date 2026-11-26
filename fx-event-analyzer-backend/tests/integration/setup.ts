import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { loadEnv } from '../../src/config/env.js';
import type { SignedDataVerifier } from '../../src/storekit/signedDataVerifier.js';

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
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return null;
  }
  return {
    env: loadEnv({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      PORT: '3000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'silent',
      // 既存の結合テストは価格由来の機能を検証するので、既定で有効にする(無効の挙動は price-features-disabled.test.ts が
      // buildIntegrationContext の env で PRICE_FEATURES_ENABLED: false に差し替えて検証)。
      PRICE_FEATURES_ENABLED: 'true',
      // 既存の結合テストは FREE の上限(過去の発表・比較・通知の重要度・お気に入り)を検証するので、既定で適用する。
      FREE_LIMITS_ENFORCED: 'true',
      // 要約・本文を返す経路を検証するので、結合テストでは SPEECH_TEXT_EXPOSED を有効にする(既定は false。無効の挙動は単体テストが検証)。
      SPEECH_TEXT_EXPOSED: 'true',
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

export function buildIntegrationContext(
  integration: IntegrationEnv,
  options: {
    signedDataVerifier?: SignedDataVerifier;
    /** Fake fetch for GitHub Issue creation (SCR-020) — nothing reaches GitHub. */
    githubFetch?: typeof fetch;
    /** Extra env, e.g. GITHUB_ISSUES_TOKEN / GITHUB_ISSUES_REPO. */
    env?: Partial<Env>;
  } = {},
): IntegrationContext {
  const serviceClient = createClient(integration.env.SUPABASE_URL, integration.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { env: envOverrides, ...appOptions } = options;
  const env: Env = { ...integration.env, ...envOverrides };
  const app = buildApp({ env, supabase: serviceClient, logger: false, ...appOptions });
  return { app, serviceClient, anonKey: integration.anonKey, supabaseUrl: integration.env.SUPABASE_URL };
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let userCounter = 0;

/**
 * `supabase db reset` restarts containers as its very last step, and
 * GoTrue's own `/auth/v1/health` (polled by CI before running this suite)
 * only reports process liveness, not full DB-write readiness — the first
 * `admin.createUser()` call of a run can still land in that narrow gap.
 * Observed for real in CI ("Database error creating new user") even after
 * the health-check wait was added. Retry with a short backoff rather than
 * fail the whole suite on infra warm-up timing.
 */
async function createUserWithRetry(
  ctx: IntegrationContext,
  email: string,
  password: string,
): Promise<{ user: { id: string } }> {
  const maxAttempts = 5;
  let lastErrorMessage = 'unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await ctx.serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (!error && data.user) {
      return { user: data.user };
    }
    lastErrorMessage = error?.message ?? 'unknown error';
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Failed to create test user after ${maxAttempts} attempts: ${lastErrorMessage}`);
}

/** Creates a real auth.users row via the Admin API, then signs in as them
 * (via a fresh anon-key client) to obtain a genuine, GoTrue-issued access
 * token — never a hand-minted JWT — so Auth tests exercise the exact same
 * signature/claims shape production tokens have. */
export async function createTestUser(ctx: IntegrationContext): Promise<TestUser> {
  userCounter += 1;
  // 並列に動く別のテストファイルは、それぞれ userCounter が 0 から始まる。時刻(ミリ秒)と番号だけでは同じメールになりうる
  // (CI で 'A user with this email address has already been registered' が出た)。UUID で重複を避ける。
  const email = `fx-backend-test-${randomUUID()}-${userCounter}@example.com`;
  const password = 'Test-Password-1234!';

  const data = await createUserWithRetry(ctx, email, password);

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
