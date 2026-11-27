/**
 * Rights ledger registry for the data sources that feed the technical-analysis API.
 *
 * Release gate (owner decision 2026-11-25): data whose rights are not confirmed in writing may be used
 * for development / verification, but a public feature must stay closed. `canEnable` (rightsLedger.ts)
 * is the pure decision; this file is the data. A right counts as granted only with status 'confirmed'
 * AND a non-empty evidenceUrl.
 *
 * Current state (2026-11-26): the only source is the Twelve Data FREE key, which is internal-use only
 * (price_data_provider_comparison.txt; first inquiry sent 2026-11-24, no reply). Every right is
 * 'unconfirmed', so GET /fx-pairs/{id}/technical answers 403 DATA_RIGHTS_UNCONFIRMED in every
 * environment even when TECHNICAL_ANALYSIS_ENABLED and PRICE_FEATURES_ENABLED are both 'true'.
 *
 * The ledger records, per source: provider name, terms URL (termsUrl), and per right the status, evidenceUrl and
 * confirmedAt. Rights over the RAW data (storage, redistribution) and rights over ANALYSIS RESULTS computed from it
 * (commercialUse, derivedDisplay) are separate keys; which feature needs which is in REQUIRED_RIGHTS
 * (rightsLedger.ts). GET /events/{id}/reaction-analysis (feature 'eventReactionAnalysis') needs commercialUse +
 * derivedDisplay + storage and does not need raw-data redistribution; GET /fx-pairs/{id}/technical exposes raw candles
 * (chartHistory) and does need redistribution. The registry keeps every right unconfirmed (pinned by a test).
 *
 * To open the route: replace/extend this entry with the confirmed rights AND their evidenceUrl
 * (terms page or signed reply stored under fx-dev-records), after owner approval. Nothing else
 * (flags, code paths) may be used to bypass the gate.
 */
import { emptyRights, type RightsLedgerEntry } from './rightsLedger.js';

/** BarSource.id of the Supabase-backed adapter: fx_prices is filled by the Twelve Data free-key ingestion. */
export const TWELVEDATA_FREE_INTERNAL_SOURCE_ID = 'twelvedata_free_internal';

export const TECHNICAL_RIGHTS_LEDGER: readonly RightsLedgerEntry[] = [
  {
    sourceId: TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
    providerName: 'Twelve Data (free key)',
    termsUrl: 'https://twelvedata.com/terms',
    rights: {
      ...emptyRights(),
      externalDisplay: { status: 'unconfirmed', note: 'Free key is for internal verification; written reply pending.' },
    },
    maxUsers: null,
  },
];
