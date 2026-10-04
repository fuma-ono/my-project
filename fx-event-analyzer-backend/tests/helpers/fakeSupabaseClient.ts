import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A minimal stand-in for the one supabase-js query shape the Authorization
 * layer's repositories actually use: `.from(table).select(cols).eq(...).eq(...)`
 * and, optionally, `.maybeSingle()`. This is a boundary fake, not a claim
 * that it models supabase-js in general — real query behavior (including
 * RLS) is exercised separately, directly against Postgres, in
 * tests/db/*.test.ts. It exists so authorization/entitlement *decision*
 * logic (isActive / hasEntitlement / requireEntitlement's 403 behavior) can
 * be unit-tested without a live Supabase stack.
 */
export function fakeSupabaseClient(tableData: Record<string, unknown[]>): SupabaseClient {
  const builder = (table: string) => {
    let rows = tableData[table] ?? [];
    let single = false;

    const applyEq = (column: string, value: unknown) => {
      rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
      return chain;
    };

    const resolve = () => {
      if (single) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: applyEq,
      maybeSingle: () => {
        single = true;
        return Promise.resolve(resolve());
      },
      then: (onFulfilled: (result: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(onFulfilled(resolve())),
    };

    return chain;
  };

  return { from: builder } as unknown as SupabaseClient;
}
