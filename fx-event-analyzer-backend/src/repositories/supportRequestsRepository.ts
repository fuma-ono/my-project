import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupportCategory, SupportClassification, SupportKind, SupportStatus } from '../domain/support.js';
import { ensureProfile } from './profilesRepository.js';

/** support_requests row as the API returns it (api-design.md §24.7/§24.8).
 * classification and github_issue_* stay server-side. */
export interface SupportRequestRow {
  id: string;
  kind: SupportKind;
  category: SupportCategory;
  body: string;
  status: SupportStatus;
  reply_body: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface NewSupportRequest {
  kind: SupportKind;
  category: SupportCategory;
  body: string;
  app_version: string | null;
  os_version: string | null;
  device_model: string | null;
  classification: SupportClassification;
  status: SupportStatus;
  reply_body: string | null;
  replied_at: string | null;
}

const COLUMNS = 'id, kind, category, body, status, reply_body, replied_at, created_at';

export const SUPPORT_REQUESTS_LIST_LIMIT = 50;

export async function insertSupportRequest(
  supabase: SupabaseClient,
  userId: string,
  request: NewSupportRequest,
): Promise<SupportRequestRow> {
  await ensureProfile(supabase, userId);
  const { data, error } = await supabase
    .from('support_requests')
    .insert({ user_id: userId, ...request })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** Rows the user created at or after sinceIso — the rolling-window rate limit. */
export async function countSupportRequestsSince(
  supabase: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('support_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/** The user's own rows, newest first (at most 50). */
export async function listSupportRequests(supabase: SupabaseClient, userId: string): Promise<SupportRequestRow[]> {
  const { data, error } = await supabase
    .from('support_requests')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(SUPPORT_REQUESTS_LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

export async function setSupportRequestIssue(
  supabase: SupabaseClient,
  requestId: string,
  issue: { number: number; url: string },
): Promise<void> {
  const { error } = await supabase
    .from('support_requests')
    .update({ github_issue_number: issue.number, github_issue_url: issue.url })
    .eq('id', requestId);
  if (error) throw error;
}
