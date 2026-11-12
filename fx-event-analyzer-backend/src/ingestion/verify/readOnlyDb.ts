import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 読み取り専用の入口(HQ指示 2026-11-12「読み取り専用確認 target」)。決まった表の select だけを持つ。insert・update・
 * upsert・delete・rpc・storage・auth には届かない(この入口から呼ぶ手段が無い)。
 */
export const READ_ONLY_TABLES = ['speech_events', 'ingestion_logs'] as const;
export type ReadOnlyTable = (typeof READ_ONLY_TABLES)[number];

export function readOnly(supabase: SupabaseClient) {
  return {
    from(table: ReadOnlyTable) {
      if (!READ_ONLY_TABLES.includes(table)) throw new Error(`table not allowed: ${String(table)}`);
      return { select: (columns: string) => supabase.from(table).select(columns) };
    },
  };
}

export type ReadOnlyDb = ReturnType<typeof readOnly>;
