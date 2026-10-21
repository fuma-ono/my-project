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
 *
 * Also supports `.in` / `.gte` / `.order` / `.range` (and treats `.or` as a
 * no-op) for the indicator list's release-summary queries (§13.1, v1.20).
 * `count` is the filtered row count before `.range` / `.limit`.
 * `.neq` / `.limit` are for the latest-price queries (homeRepository /
 * fxPairsRepository). `.order` is a stable sort, so rows with the same value
 * keep their insertion order — tests use that to put a tie first.
 *
 * A table missing from `tableData` reads as empty — e.g. `default_entitlements`
 * in tests that only set up `entitlements` (no default features).
 */
export function fakeSupabaseClient(tableData: Record<string, unknown[]>): SupabaseClient {
  const builder = (table: string) => {
    let rows = tableData[table] ?? [];
    let single = false;

    const applyEq = (column: string, value: unknown) => {
      rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
      return chain;
    };

    const field = (row: unknown, column: string) => (row as Record<string, unknown>)[column];
    let rangeBounds: { from: number; to: number } | null = null;

    const resolve = () => {
      if (single) {
        return { data: rows[0] ?? null, error: null };
      }
      const count = rows.length;
      const data = rangeBounds ? rows.slice(rangeBounds.from, rangeBounds.to + 1) : rows;
      return { data, error: null, count };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: applyEq,
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(field(row, column)));
        return chain;
      },
      gte: (column: string, value: string) => {
        rows = rows.filter((row) => Date.parse(String(field(row, column))) >= Date.parse(value));
        return chain;
      },
      neq: (column: string, value: unknown) => {
        rows = rows.filter((row) => field(row, column) !== value);
        return chain;
      },
      limit: (count: number) => {
        rangeBounds = { from: 0, to: count - 1 };
        return chain;
      },
      or: () => chain,
      order: (column: string, options: { ascending?: boolean } = {}) => {
        const direction = options.ascending === false ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const left = String(field(a, column));
          const right = String(field(b, column));
          return left === right ? 0 : left < right ? -direction : direction;
        });
        return chain;
      },
      range: (from: number, to: number) => {
        rangeBounds = { from, to };
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return Promise.resolve(resolve());
      },
      then: (onFulfilled: (result: { data: unknown; error: null; count?: number }) => unknown) =>
        Promise.resolve(onFulfilled(resolve())),
    };

    return chain;
  };

  return { from: builder } as unknown as SupabaseClient;
}
