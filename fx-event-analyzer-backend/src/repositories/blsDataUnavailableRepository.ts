import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlsDataUnavailableStore } from '../ingestion/pipelines/blsDataUnavailable.js';
import { createIngestionRepository } from './ingestionRepository.js';

/** pipelines/blsDataUnavailable.ts の読み書き(service_role)。イベントは既存の ingestion repository、説明は event_explanations。 */
export function createBlsDataUnavailableStore(supabase: SupabaseClient): BlsDataUnavailableStore {
  const ingestion = createIngestionRepository(supabase);
  return {
    findEventByProviderId: (provider, providerEventId) => ingestion.findEventByProviderId(provider, providerEventId),
    updateEvent: (eventId, patch) => ingestion.updateEvent(eventId, patch),
    getReleaseSnapshot: (eventId) => ingestion.getReleaseSnapshot(eventId),

    async getLatestExplanation(eventId) {
      const { data, error } = await supabase
        .from('event_explanations')
        .select('version, explanation_type, summary, source, source_url')
        .eq('event_id', eventId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },

    async insertExplanation(row) {
      const { error } = await supabase.from('event_explanations').insert(row);
      if (error) throw error;
    },
  };
}
