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
 */
export type RightKey =
  'externalDisplay' | 'storage' | 'history' | 'derivedData' | 'mlTraining' | 'modelCommercialUse' | 'userLimit';

export type RightStatus = 'confirmed' | 'unconfirmed' | 'denied';

export interface RightEntry {
  status: RightStatus;
  /** URL / document id of the written evidence (terms page, signed reply). Required to count as confirmed. */
  evidenceUrl?: string;
  note?: string;
}

export interface RightsLedgerEntry {
  sourceId: string;
  rights: Record<RightKey, RightEntry>;
  /** Maximum users allowed by the contract, if any. */
  maxUsers?: number | null;
}

export type Feature = 'chartHistory' | 'technicalIndicators' | 'keyZones' | 'backtest' | 'aiAnalysis';

export const REQUIRED_RIGHTS: Record<Feature, readonly RightKey[]> = {
  chartHistory: ['externalDisplay', 'storage', 'history', 'userLimit'],
  technicalIndicators: ['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit'],
  keyZones: ['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit'],
  backtest: ['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit'],
  aiAnalysis: ['externalDisplay', 'storage', 'history', 'derivedData', 'mlTraining', 'modelCommercialUse', 'userLimit'],
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
  };
}

function isGranted(r: RightEntry | undefined): boolean {
  return r !== undefined && r.status === 'confirmed' && (r.evidenceUrl ?? '').trim() !== '';
}

/** Lists `sourceId:right` pairs that block the feature (empty array = nothing blocks). */
export function missingRights(feature: Feature, entries: readonly RightsLedgerEntry[]): string[] {
  const missing: string[] = [];
  for (const e of entries) {
    for (const key of REQUIRED_RIGHTS[feature]) {
      if (!isGranted(e.rights[key])) missing.push(`${e.sourceId}:${key}`);
    }
  }
  return missing;
}

export function canEnable(feature: Feature, entries: readonly RightsLedgerEntry[]): boolean {
  return entries.length > 0 && missingRights(feature, entries).length === 0;
}
