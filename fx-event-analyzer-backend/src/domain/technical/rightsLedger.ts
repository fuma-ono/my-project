/**
 * Data rights ledger (pure types + release-gate helper).
 *
 * Purpose: data whose rights are unconfirmed may be used for development / verification, but a
 * public feature flag must not be enabled. `canEnable` is the pure decision function for that gate;
 * wiring it to flags/config is a later step.
 *
 * Rules:
 *  - A right counts as granted only if status === 'confirmed' AND an evidenceUrl is recorded.
 *    'unconfirmed' (default for anything not yet answered in writing) and 'denied' both block.
 *  - userLimit is 'confirmed' only when the provider's user/seat limit accommodates the planned
 *    public release (note it in `note`/`maxUsers`).
 *  - A feature is enabled only if EVERY ledger entry passed in (i.e. every source feeding that
 *    feature) grants all rights the feature requires. No entries => false.
 *
 * Raw data vs analysis results (owner rule 2026-11-27): rights over the RAW data (storing the bars,
 * redistributing them) are recorded separately from rights over ANALYSIS RESULTS computed from the data
 * (pips, classification labels, statistics: commercial display / external provision). A feature needs only
 * the rights of what it actually exposes. See REQUIRED_RIGHTS for which feature needs which right.
 *
 *  - commercialUse   : the data may be used commercially at all (paid / public product).
 *  - storage         : the raw data may be stored in our DB (fx_prices).
 *  - redistribution  : the RAW data (bars / candles / quotes) may be passed on to third parties.
 *  - derivedDisplay  : analysis results derived from the data may be shown / provided externally on a
 *                      commercial basis (derived outputs only, no raw bars in the response).
 *  - externalDisplay / history / derivedData / mlTraining / modelCommercialUse / userLimit: unchanged.
 */
export type RightKey =
  | 'externalDisplay'
  | 'storage'
  | 'history'
  | 'derivedData'
  | 'mlTraining'
  | 'modelCommercialUse'
  | 'userLimit'
  | 'commercialUse'
  | 'redistribution'
  | 'derivedDisplay';

export type RightStatus = 'confirmed' | 'unconfirmed' | 'denied';

export interface RightEntry {
  status: RightStatus;
  /** URL / document id of the written evidence (terms page, signed reply). Required to count as confirmed. */
  evidenceUrl?: string;
  /** Date the right was confirmed in writing (YYYY-MM-DD). Required for features checked with `requireConfirmedAt`. */
  confirmedAt?: string;
  note?: string;
}

export interface RightsLedgerEntry {
  sourceId: string;
  /** Display name of the data provider (recorded for the ledger; required by `requireProvenance`). */
  providerName?: string;
  /** Terms-of-use URL of the provider (required by `requireProvenance`). */
  termsUrl?: string;
  rights: Record<RightKey, RightEntry>;
  /** Maximum users allowed by the contract, if any. */
  maxUsers?: number | null;
}

export type Feature =
  'chartHistory' | 'technicalIndicators' | 'keyZones' | 'backtest' | 'aiAnalysis' | 'eventReactionAnalysis';

/**
 * Which feature needs which right.
 *  - chartHistory exposes raw candles, so it additionally needs raw-data `redistribution`.
 *  - technicalIndicators / keyZones / backtest / aiAnalysis: unchanged.
 *  - eventReactionAnalysis (GET /events/{id}/reaction-analysis) exposes derived outputs only (pips, labels, statistics)
 *    computed from bars that our DB stores: commercialUse + derivedDisplay + storage. It does NOT require
 *    raw-data `redistribution`.
 */
export const REQUIRED_RIGHTS: Record<Feature, readonly RightKey[]> = {
  chartHistory: ['externalDisplay', 'storage', 'history', 'userLimit', 'redistribution'],
  technicalIndicators: ['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit'],
  keyZones: ['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit'],
  backtest: ['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit'],
  aiAnalysis: ['externalDisplay', 'storage', 'history', 'derivedData', 'mlTraining', 'modelCommercialUse', 'userLimit'],
  eventReactionAnalysis: ['commercialUse', 'derivedDisplay', 'storage'],
};

export function emptyRights(): Record<RightKey, RightEntry> {
  return {
    externalDisplay: { status: 'unconfirmed' },
    storage: { status: 'unconfirmed' },
    history: { status: 'unconfirmed' },
    derivedData: { status: 'unconfirmed' },
    mlTraining: { status: 'unconfirmed' },
    modelCommercialUse: { status: 'unconfirmed' },
    userLimit: { status: 'unconfirmed' },
    commercialUse: { status: 'unconfirmed' },
    redistribution: { status: 'unconfirmed' },
    derivedDisplay: { status: 'unconfirmed' },
  };
}

export interface MissingRightsOptions {
  /** Also require a recorded confirmation date (YYYY-MM-DD) on every required right. Default false (existing features). */
  requireConfirmedAt?: boolean;
  /** Also require the entry to record providerName and termsUrl. Default false (existing features). */
  requireProvenance?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isGranted(r: RightEntry | undefined, requireConfirmedAt: boolean): boolean {
  if (r === undefined || r.status !== 'confirmed' || (r.evidenceUrl ?? '').trim() === '') return false;
  return !requireConfirmedAt || ISO_DATE.test((r.confirmedAt ?? '').trim());
}

/** True when one right of one entry counts as confirmed (status, evidence URL and, if asked, a confirmation date). */
export function isRightConfirmed(entry: RightsLedgerEntry, key: RightKey, requireConfirmedAt = false): boolean {
  return isGranted(entry.rights[key], requireConfirmedAt);
}

/**
 * Lists `sourceId:right` pairs that block the feature (empty array = nothing blocks). With `options` (used only by
 * eventReactionAnalysis' gate) a confirmation date and the entry's provider name / terms URL must be recorded too.
 */
export function missingRights(
  feature: Feature,
  entries: readonly RightsLedgerEntry[],
  options: MissingRightsOptions = {},
): string[] {
  const missing: string[] = [];
  for (const e of entries) {
    for (const key of REQUIRED_RIGHTS[feature]) {
      if (!isGranted(e.rights[key], options.requireConfirmedAt === true)) missing.push(`${e.sourceId}:${key}`);
    }
    if (options.requireProvenance === true) {
      if ((e.providerName ?? '').trim() === '') missing.push(`${e.sourceId}:providerName`);
      if ((e.termsUrl ?? '').trim() === '') missing.push(`${e.sourceId}:termsUrl`);
    }
  }
  return missing;
}

export function canEnable(
  feature: Feature,
  entries: readonly RightsLedgerEntry[],
  options: MissingRightsOptions = {},
): boolean {
  return entries.length > 0 && missingRights(feature, entries, options).length === 0;
}
