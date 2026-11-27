import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import {
  canEnable,
  type Feature,
  isRightConfirmed,
  missingRights,
  type MissingRightsOptions,
} from '../domain/technical/rightsLedger.js';
import { TWELVEDATA_FREE_INTERNAL_SOURCE_ID } from '../domain/technical/rightsRegistry.js';
import { priceFeaturesEnabled } from './priceFeatures.js';
import { ledgerEntriesFor } from './technicalAnalysis.js';

/**
 * Data rights gate of GET /events/{event_id}/reaction-analysis (event reaction analysis, parameter set rx-v1).
 *
 * The response carries analysis RESULTS (pips, classification labels, statistics) computed from 1-minute bars that
 * our DB stores; it does not return the bars. So the feature needs (rightsLedger.ts REQUIRED_RIGHTS):
 * commercialUse, derivedDisplay (analysis results may be shown externally on a commercial basis) and storage.
 * Raw-data redistribution is NOT required here (it is required only by features that expose raw bars).
 * The new feature also needs a recorded confirmation date (confirmedAt) on each of those rights and the entry's
 * providerName / termsUrl.
 */
export const REACTION_ANALYSIS_FEATURES: readonly Feature[] = ['eventReactionAnalysis'];

/** Same source as the 1-minute bars the route reads (fx_prices is filled by the Twelve Data free-key ingestion). */
export const REACTION_ANALYSIS_SOURCE_ID = TWELVEDATA_FREE_INTERNAL_SOURCE_ID;

const REACTION_RIGHTS_OPTIONS: MissingRightsOptions = { requireConfirmedAt: true, requireProvenance: true };

export function reactionAnalysisRightsGranted(app: FastifyInstance, sourceId: string): boolean {
  const entries = ledgerEntriesFor(app, sourceId);
  return entries.length > 0 && REACTION_ANALYSIS_FEATURES.every((f) => canEnable(f, entries, REACTION_RIGHTS_OPTIONS));
}

/**
 * Price POINTS (absolute price levels: close_price per window, pre_release_price) are price information itself, so they
 * are returned only when the ledger confirms externalDisplay (display of price information in the app) for every entry of
 * the source, with evidence URL and confirmation date. This is NOT part of the route gate: an unconfirmed externalDisplay
 * never closes the endpoint, it only omits those fields. Static ledger: no flag / query / header can switch it.
 */
export function pricePointsDisplayGranted(app: FastifyInstance, sourceId: string): boolean {
  const entries = ledgerEntriesFor(app, sourceId);
  return entries.length > 0 && entries.every((e) => isRightConfirmed(e, 'externalDisplay', true));
}

/** What GET /entitlements reports: PRICE_FEATURES_ENABLED AND the ledger confirms the feature, i.e. "the route would pass its gates". */
export function reactionAnalysisAvailable(app: FastifyInstance): boolean {
  return priceFeaturesEnabled(app) && reactionAnalysisRightsGranted(app, REACTION_ANALYSIS_SOURCE_ID);
}

/**
 * Rights gate: 403 DATA_RIGHTS_UNCONFIRMED (same code and detail shape as requireTechnicalRights; the missing
 * `sourceId:right` pairs are listed in `missing`). Static ledger, no DB read. There is no bypass flag.
 */
export function requireReactionAnalysisRights(app: FastifyInstance, sourceId: string): void {
  if (reactionAnalysisRightsGranted(app, sourceId)) return;
  const entries = ledgerEntriesFor(app, sourceId);
  const missing =
    entries.length === 0
      ? [`${sourceId}:*`]
      : [...new Set(REACTION_ANALYSIS_FEATURES.flatMap((f) => missingRights(f, entries, REACTION_RIGHTS_OPTIONS)))];
  throw new ApiError('DATA_RIGHTS_UNCONFIRMED', 'Data rights for this feature are not confirmed.', { missing });
}
