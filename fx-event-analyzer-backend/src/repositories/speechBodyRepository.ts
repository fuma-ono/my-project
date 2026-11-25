import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FrbRowForMatching,
  SpeechBodyPatch,
  SpeechBodyStore,
  SpeechForBody,
} from '../ingestion/pipelines/speechBodies.js';

/**
 * 要人発言の本文の取り込みの読み書き(HQ指示 2026-11-10、migration 20261110000001・20261112000001)。service_role で使う
 * (取り込みのジョブだけ)。発言者・日時・題名は読むだけで、書くのは source_url・本文・取得日時・状態・理由・試行回数だけ。
 *
 * 二重の実行を防ぐ(HQ承認 2026-11-11「状態条件と楽観的条件」): どの書き込みも「状態が PENDING / FAILED」の行だけに効き、
 * 回数を指定したときは「回数がその値のまま」の行だけに効く。条件に合わなければ何も変えず false を返す(FETCHED の本文と
 * URL を上書きしない・同じ試行を二重に数えない)。
 */
export function createSpeechBodyStore(supabase: SupabaseClient): SpeechBodyStore {
  return {
    async listSpeechesNeedingBody(providers, sinceIso, maxAttempts): Promise<SpeechForBody[]> {
      const { data, error } = await supabase
        .from('speech_events')
        .select(
          'id, provider, provider_event_id, title, statement_datetime, status, source_url, body_status, body_attempts, speakers!inner(name, organization)',
        )
        .in('provider', [...providers])
        .eq('status', 'DELIVERED')
        .in('body_status', ['PENDING', 'FAILED'])
        .lt('body_attempts', Math.trunc(maxAttempts))
        .gte('statement_datetime', sinceIso)
        .order('statement_datetime', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const speaker = row.speakers as unknown as { name: string; organization: string };
        return {
          id: row.id,
          provider: row.provider,
          provider_event_id: row.provider_event_id,
          title: row.title,
          statement_datetime: row.statement_datetime,
          status: row.status,
          source_url: row.source_url,
          body_status: row.body_status,
          body_attempts: Number(row.body_attempts ?? 0),
          speaker_name: speaker.name,
          speaker_organization: speaker.organization,
        };
      });
    },

    async listFrbRowsForMatching(): Promise<FrbRowForMatching[]> {
      const out: FrbRowForMatching[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('speech_events')
          .select('id, statement_datetime, source_url, speakers!inner(name, organization)')
          .eq('provider', 'frb_calendar')
          .order('statement_datetime', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          const speaker = row.speakers as unknown as { name: string; organization: string };
          out.push({
            id: row.id,
            statement_datetime: row.statement_datetime,
            source_url: row.source_url,
            speaker_name: speaker.name,
            speaker_organization: speaker.organization,
          });
        }
        if ((data ?? []).length < PAGE) return out;
      }
    },

    async claimBodyAttempt(id, expectedAttempts, attemptedAtIso, maxAttempts): Promise<boolean> {
      const { data, error } = await supabase
        .from('speech_events')
        .update({ body_attempts: expectedAttempts + 1, body_last_attempt_at: attemptedAtIso })
        .eq('id', id)
        .in('body_status', ['PENDING', 'FAILED'])
        .eq('body_attempts', expectedAttempts)
        .lt('body_attempts', Math.trunc(maxAttempts)) // 上限に達した行は数えない(DB の条件でも止める)
        .select('id');
      if (error) throw error;
      return (data ?? []).length === 1;
    },

    async updateSpeechBody(id: string, patch: SpeechBodyPatch, expectedAttempts: number): Promise<boolean> {
      const { data, error } = await supabase
        .from('speech_events')
        .update(patch)
        .eq('id', id)
        .in('body_status', ['PENDING', 'FAILED'])
        .eq('body_attempts', expectedAttempts)
        .select('id');
      if (error) throw error;
      return (data ?? []).length === 1;
    },
  };
}
