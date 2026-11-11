import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpeechBodyPatch, SpeechBodyStore, SpeechForBody } from '../ingestion/pipelines/speechBodies.js';

/**
 * 要人発言の本文の取り込みの読み書き(HQ指示 2026-11-10、migration 20261110000001)。service_role で使う
 * (取り込みのジョブだけ)。発言者・日時・題名は読むだけで、書くのは source_url・本文・取得日時・状態・理由だけ。
 */
export function createSpeechBodyStore(supabase: SupabaseClient): SpeechBodyStore {
  return {
    async listSpeechesNeedingBody(providers: readonly string[], sinceIso: string): Promise<SpeechForBody[]> {
      const { data, error } = await supabase
        .from('speech_events')
        .select(
          'id, provider, provider_event_id, title, statement_datetime, status, source_url, body_status, speakers!inner(name, organization)',
        )
        .in('provider', [...providers])
        .eq('status', 'DELIVERED')
        .in('body_status', ['PENDING', 'FAILED'])
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
          speaker_name: speaker.name,
          speaker_organization: speaker.organization,
        };
      });
    },

    async updateSpeechBody(id: string, patch: SpeechBodyPatch): Promise<void> {
      const { error } = await supabase.from('speech_events').update(patch).eq('id', id);
      if (error) throw error;
    },
  };
}
