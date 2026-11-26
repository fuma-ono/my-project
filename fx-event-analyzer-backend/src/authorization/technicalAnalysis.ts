import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { canEnable, type Feature, missingRights, type RightsLedgerEntry } from '../domain/technical/rightsLedger.js';
import { TWELVEDATA_FREE_INTERNAL_SOURCE_ID } from '../domain/technical/rightsRegistry.js';
import { priceFeaturesEnabled } from './priceFeatures.js';

/** The response carries candles (chartHistory), indicators (technicalIndicators) and zones (keyZones): all must be granted. */
export const TECHNICAL_FEATURES: readonly Feature[] = ['chartHistory', 'technicalIndicators', 'keyZones'];

/** Flags only: TECHNICAL_ANALYSIS_ENABLED and (because the analysis derives from prices) PRICE_FEATURES_ENABLED. */
export function technicalFlagsEnabled(app: FastifyInstance): boolean {
  return app.env.TECHNICAL_ANALYSIS_ENABLED && priceFeaturesEnabled(app);
}

/** Ledger entries of one data source (the technical route reads a single source). */
export function ledgerEntriesFor(app: FastifyInstance, sourceId: string): RightsLedgerEntry[] {
  return app.technicalRightsLedger.filter((e) => e.sourceId === sourceId);
}

export function technicalRightsGranted(app: FastifyInstance, sourceId: string): boolean {
  const entries = ledgerEntriesFor(app, sourceId);
  return TECHNICAL_FEATURES.every((f) => canEnable(f, entries));
}

/** What GET /entitlements reports: flags AND rights, i.e. "the route would answer 200". */
export function technicalAnalysisAvailable(app: FastifyInstance): boolean {
  return technicalFlagsEnabled(app) && technicalRightsGranted(app, TWELVEDATA_FREE_INTERNAL_SOURCE_ID);
}

/**
 * Flag gate for the technical routes: 404 NOT_FOUND (the existing code, like requirePriceFeatures) before
 * any permission / DB access. Both flags are required; no new error code.
 */
export function requireTechnicalAnalysis(app: FastifyInstance): void {
  if (!technicalFlagsEnabled(app)) {
    throw ApiError.notFound();
  }
}

/**
 * Rights gate: flags may be on while the data source's rights are not confirmed. Then 403
 * DATA_RIGHTS_UNCONFIRMED (the missing `sourceId:right` pairs are listed in `missing`). Static ledger, no DB read.
 */
export function requireTechnicalRights(app: FastifyInstance, sourceId: string): void {
  if (technicalRightsGranted(app, sourceId)) return;
  const entries = ledgerEntriesFor(app, sourceId);
  const missing =
    entries.length === 0
      ? [`${sourceId}:*`]
      : [...new Set(TECHNICAL_FEATURES.flatMap((f) => missingRights(f, entries)))];
  throw new ApiError('DATA_RIGHTS_UNCONFIRMED', 'Data rights for this feature are not confirmed.', { missing });
}
