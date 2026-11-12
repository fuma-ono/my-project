import type { FastifyInstance } from 'fastify';
import {
  listEventsInRange,
  listMajorFx,
  listRelatedFxPairsForIndicators,
  listSnapshotsForEvents,
} from '../repositories/homeRepository.js';
import { getHomeFxPairSymbols } from '../repositories/userSettingsRepository.js';
import { resolveDayRangeUtc } from '../domain/timezone.js';
import { homeQuerySchema } from '../schemas/home.js';
import { mapEventDataStatus, type EconomicEventDbStatus } from '../domain/dataQuality.js';
import { HOME_SPEECHES_MAX, homeSpeechesRange, toHomeSpeechItem } from '../domain/homeSpeeches.js';
import { resolvePublicBaseUrl } from '../domain/speakerPhotos.js';
import { listRecentDeliveredSpeeches } from '../repositories/speechesRepository.js';

/**
 * GET /home — api-design.md §12. "最近のイベント" is not a separate
 * field/endpoint (H-2, resolved) — the client splits this same day-scoped
 * `events` array by `status` (SCHEDULED vs RELEASED) itself.
 *
 * `speeches` (v1.27, 直近の要人発言): the latest DELIVERED speeches of the
 * last 7 days (relative to now, not `date`), newest first, max 3 — see
 * src/domain/homeSpeeches.ts.
 */
export function registerHomeRoutes(app: FastifyInstance): void {
  app.get('/home', async (request) => {
    const query = homeQuerySchema.parse(request.query);
    const { startUtc, endUtc } = resolveDayRangeUtc(query.date, query.timezone);

    const events = await listEventsInRange(app.supabase, startUtc, endUtc);
    const snapshots = await listSnapshotsForEvents(
      app.supabase,
      events.map((event) => event.id),
    );
    const snapshotByEventId = new Map(snapshots.map((snapshot) => [snapshot.event_id, snapshot]));
    const relatedFxPairsByIndicator = await listRelatedFxPairsForIndicators(
      app.supabase,
      events.map((event) => event.indicator_id),
    );

    // SCR-026: the user's home.fx_pairs (in that order), else the default 3.
    const homeFxPairSymbols = await getHomeFxPairSymbols(app.supabase, request.user!.id);
    const majorFx = await listMajorFx(app.supabase, homeFxPairSymbols);

    const speechRange = homeSpeechesRange(new Date());
    const recentSpeeches = await listRecentDeliveredSpeeches(
      app.supabase,
      speechRange.from.toISOString(),
      speechRange.to.toISOString(),
      HOME_SPEECHES_MAX,
    );
    const baseUrl = resolvePublicBaseUrl(app.env.PUBLIC_BASE_URL, request);

    return {
      date: query.date,
      timezone: query.timezone,
      events: events.map((event) => {
        const snapshot = snapshotByEventId.get(event.id);
        return {
          event_id: event.id,
          indicator_id: event.indicator_id,
          indicator_name: event.indicator_name,
          display_name: event.indicator_display_name,
          country_code: event.country_code,
          currency_code: event.currency_code,
          unit: event.unit,
          importance: event.importance,
          release_datetime: event.release_datetime,
          release_datetime_precision: event.release_datetime_precision,
          status: event.status,
          data_status: mapEventDataStatus(event.data_status as EconomicEventDbStatus),
          forecast: snapshot?.forecast ?? null,
          actual: snapshot?.actual ?? null,
          previous: snapshot?.previous ?? null,
          surprise: snapshot?.surprise ?? null,
          surprise_direction: snapshot?.surprise_direction ?? null,
          related_fx_pairs: relatedFxPairsByIndicator.get(event.indicator_id) ?? [],
        };
      }),
      major_fx: majorFx,
      speeches: recentSpeeches.map((speech) => toHomeSpeechItem(speech, baseUrl)),
    };
  });
}
