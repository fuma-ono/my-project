import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpeechForSummary, SpeechSummaryStore } from '../ingestion/pipelines/speechSummaries.js';

/** 要人発言の要約の工程の読み書き(migration 20261111000001、service_role)。書くのは要約と、その作り方・日時・理由だけ。 */
export function createSpeechSummaryStore(supabase: SupabaseClient): SpeechSummaryStore {
  return {
    async listSpeechesNeedingSummary(sinceIso, limit): Promise<SpeechForSummary[]> {
      let query = supabase
        .from('speech_events')
        .select('id, provider, statement_datetime, speech_body')
        .eq('body_status', 'FETCHED')
        .not('speech_body', 'is', null)
        .is('summary', null)
        .is('summary_error', null);
      if (sinceIso) query = query.gte('statement_datetime', sinceIso);
      const { data, error } = await query
        .order('statement_datetime', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },

    async updateSpeechSummary(id, patch) {
      // 要約も理由も無い行だけ(既存の要約・失敗の理由を上書きしない。二重の実行で二重に書かない)
      const { data, error } = await supabase
        .from('speech_events')
        .update(patch)
        .eq('id', id)
        .eq('body_status', 'FETCHED')
        .is('summary', null)
        .is('summary_error', null)
        .select('id');
      if (error) throw error;
      return (data ?? []).length === 1;
    },
  };
}
