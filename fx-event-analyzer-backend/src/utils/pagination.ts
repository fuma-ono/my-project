/** api-design.md §5: page/limit, default 20, max 100. */
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  has_next: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(query: { page?: unknown; limit?: unknown }): PaginationParams {
  const rawPage = Number(query.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawLimit = Number(query.limit);
  const boundedLimit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, boundedLimit);

  return { page, limit };
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, has_next: page * limit < total };
}

/** Supabase/PostgREST `.range(from, to)` is inclusive on both ends. */
export function rangeFor(page: number, limit: number): { from: number; to: number } {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}

/**
 * Restricts a client-supplied sort key to a fixed allowlist per endpoint —
 * never interpolates client input into a dynamic ORDER BY (Phase 2
 * instruction §15: "SQL injection等につながる動的ORDER BYをそのまま受け
 * 付けない").
 */
export function resolveSort<T extends string>(requested: string | undefined, allowlist: readonly T[], fallback: T): T {
  if (requested && (allowlist as readonly string[]).includes(requested)) {
    return requested as T;
  }
  return fallback;
}
