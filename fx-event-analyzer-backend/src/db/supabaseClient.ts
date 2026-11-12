import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

/**
 * service_role-authenticated Supabase client. This bypasses RLS by design
 * (api-design.md §2.3.1: "Backendはservice_role接続 + Backend Authorization
 * を使用する") — Backend Authorization (src/authorization/) is the real
 * access-control boundary, RLS is defense-in-depth only. This client must
 * never be constructed with anything but the service_role key, and the
 * service_role key must never leave this process (Phase 2 instruction §6/§18).
 */
export function createSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
