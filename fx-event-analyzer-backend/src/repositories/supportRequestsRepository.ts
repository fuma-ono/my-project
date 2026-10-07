import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupportCategory, SupportClassification, SupportKind, SupportStatus } from '../domain/support.js';
import { ApiError } from '../errors/ApiError.js';

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

/** Raised by insert_support_request() when the user already sent the
 * maximum number of requests within the last hour. */
const SUPPORT_REQUEST_RATE_LIMITED = 'P0429';

/**
 * Stores a request unless the user is over the rolling one-hour limit.
 * The count and the insert run in one SQL function under a per-user
 * advisory lock (supabase/migrations/20261007000001_support_requests_rate_limit.sql),
 * so concurrent requests cannot both pass the check. Over the limit →
 * 429 RATE_LIMITED and nothing is stored.
 */
export async function insertSupportRequest(
  supabase: SupabaseClient,
  userId: string,
  request: NewSupportRequest,
  maxPerHour: number,
): Promise<SupportRequestRow> {
  const { data, error } = await supabase
    .rpc('insert_support_request', {
      p_user_id: userId,
      p_kind: request.kind,
      p_category: request.category,
      p_body: request.body,
      p_app_version: request.app_version,
      p_os_version: request.os_version,
      p_device_model: request.device_model,
      p_classification: request.classification,
      p_status: request.status,
      p_reply_body: request.reply_body,
      p_replied_at: request.replied_at,
      p_max_per_hour: maxPerHour,
    })
    .single<SupportRequestRow>();
  if (error) {
    if (error.code === SUPPORT_REQUEST_RATE_LIMITED) {
      throw ApiError.rateLimited('Too many support requests. Please try again later.');
    }
    throw error;
  }
  return data;
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
