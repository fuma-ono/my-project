import { describe, expect, it } from 'vitest';
import {
  canEnable,
  emptyRights,
  type Feature,
  missingRights,
  REQUIRED_RIGHTS,
  type RightKey,
  type RightsLedgerEntry,
} from '../../../src/domain/technical/index.js';
import {
  TECHNICAL_RIGHTS_LEDGER,
  TWELVEDATA_FREE_INTERNAL_SOURCE_ID,
} from '../../../src/domain/technical/rightsRegistry.js';

/**
 * Rights ledger extension for the event reaction analysis (owner rule 2026-11-27: raw-data rights and analysis-result
 * rights are recorded separately; raw-data redistribution is NOT a blanket requirement). Synthetic entries only.
 */
const OPTIONS = { requireConfirmedAt: true, requireProvenance: true } as const;
const ALL_KEYS = Object.keys(emptyRights()) as RightKey[];

function entry(confirmed: readonly RightKey[], extra: Partial<RightsLedgerEntry> = {}, confirmedAt = '2030-01-01') {
  const rights = emptyRights();
  for (const k of confirmed) {
    rights[k] = { status: 'confirmed', evidenceUrl: `https://example.invalid/evidence/${k}`, confirmedAt };
  }
  return {
    sourceId: 'synthetic',
    providerName: 'Synthetic Provider',
    termsUrl: 'https://example.invalid/terms',
    rights,
    ...extra,
  } satisfies RightsLedgerEntry;
}

describe('which feature needs which right', () => {
  it('eventReactionAnalysis needs commercial use, derived-output display and storage, and nothing about raw redistribution', () => {
    expect([...REQUIRED_RIGHTS.eventReactionAnalysis].sort()).toEqual(['commercialUse', 'derivedDisplay', 'storage']);
    expect(REQUIRED_RIGHTS.eventReactionAnalysis).not.toContain('redistribution');
  });

  it('only the feature that exposes raw bars (chartHistory candles) needs raw-data redistribution', () => {
    const needing = (Object.keys(REQUIRED_RIGHTS) as Feature[]).filter((f) =>
      REQUIRED_RIGHTS[f].includes('redistribution'),
    );
    expect(needing).toEqual(['chartHistory']);
  });

  it('the other existing features keep exactly their previous requirements', () => {
    expect(REQUIRED_RIGHTS.technicalIndicators).toEqual([
      'externalDisplay',
      'storage',
      'history',
      'derivedData',
      'userLimit',
    ]);
    expect(REQUIRED_RIGHTS.keyZones).toEqual(['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit']);
    expect(REQUIRED_RIGHTS.backtest).toEqual(['externalDisplay', 'storage', 'history', 'derivedData', 'userLimit']);
    expect(REQUIRED_RIGHTS.aiAnalysis).toEqual([
      'externalDisplay',
      'storage',
      'history',
      'derivedData',
      'mlTraining',
      'modelCommercialUse',
      'userLimit',
    ]);
    expect(REQUIRED_RIGHTS.chartHistory).toEqual([
      'externalDisplay',
      'storage',
      'history',
      'userLimit',
      'redistribution',
    ]);
  });
});

describe('eventReactionAnalysis gate', () => {
  const needed: RightKey[] = ['commercialUse', 'derivedDisplay', 'storage'];

  it('opens with the three rights, a confirmation date, provider name and terms URL (no raw redistribution)', () => {
    expect(missingRights('eventReactionAnalysis', [entry(needed)], OPTIONS)).toEqual([]);
    expect(canEnable('eventReactionAnalysis', [entry(needed)], OPTIONS)).toBe(true);
  });

  it.each(needed)('stays closed when %s is not confirmed', (key) => {
    const e = entry(needed.filter((k) => k !== key));
    expect(missingRights('eventReactionAnalysis', [e], OPTIONS)).toEqual([`synthetic:${key}`]);
    expect(canEnable('eventReactionAnalysis', [e], OPTIONS)).toBe(false);
  });

  it('a denied right and a status without evidence do not count', () => {
    const denied = entry(needed);
    denied.rights.derivedDisplay = {
      status: 'denied',
      evidenceUrl: 'https://example.invalid/x',
      confirmedAt: '2030-01-01',
    };
    expect(missingRights('eventReactionAnalysis', [denied], OPTIONS)).toEqual(['synthetic:derivedDisplay']);
    const noEvidence = entry(needed);
    noEvidence.rights.storage = { status: 'confirmed', confirmedAt: '2030-01-01' };
    expect(missingRights('eventReactionAnalysis', [noEvidence], OPTIONS)).toEqual(['synthetic:storage']);
  });

  it('without a confirmation date (or with a malformed one) the new feature is not enabled', () => {
    const rights = emptyRights();
    for (const k of needed) rights[k] = { status: 'confirmed', evidenceUrl: 'https://example.invalid/e' };
    const undated = { sourceId: 'synthetic', providerName: 'P', termsUrl: 'https://example.invalid/t', rights };
    expect(missingRights('eventReactionAnalysis', [undated], OPTIONS).sort()).toEqual(
      needed.map((k) => `synthetic:${k}`).sort(),
    );
    expect(canEnable('eventReactionAnalysis', [entry(needed, {}, '2030/01/01')], OPTIONS)).toBe(false);
    expect(canEnable('eventReactionAnalysis', [entry(needed, {}, '')], OPTIONS)).toBe(false);
  });

  it('the provider name and terms URL must be recorded', () => {
    expect(missingRights('eventReactionAnalysis', [entry(needed, { providerName: ' ' })], OPTIONS)).toEqual([
      'synthetic:providerName',
    ]);
    const { termsUrl: _t, ...noTerms } = entry(needed);
    expect(missingRights('eventReactionAnalysis', [noTerms], OPTIONS)).toEqual(['synthetic:termsUrl']);
  });

  it('every source feeding it must pass; no entries means closed', () => {
    expect(canEnable('eventReactionAnalysis', [], OPTIONS)).toBe(false);
    expect(canEnable('eventReactionAnalysis', [entry(needed), entry([], { sourceId: 'b' })], OPTIONS)).toBe(false);
  });
});

describe('raw data vs analysis results are separate rights', () => {
  const analysisOnly = entry(['commercialUse', 'derivedDisplay', 'storage']);

  it('analysis-output rights open the reaction analysis but not the raw-candle chart', () => {
    expect(canEnable('eventReactionAnalysis', [analysisOnly], OPTIONS)).toBe(true);
    expect(canEnable('chartHistory', [analysisOnly])).toBe(false);
  });

  it('raw redistribution alone does not open the reaction analysis (analysis display is its own right)', () => {
    expect(canEnable('eventReactionAnalysis', [entry(['redistribution', 'storage'])], OPTIONS)).toBe(false);
  });

  it('chartHistory also needs redistribution on top of its previous rights', () => {
    const previous: RightKey[] = ['externalDisplay', 'storage', 'history', 'userLimit'];
    expect(missingRights('chartHistory', [entry(previous)])).toEqual(['synthetic:redistribution']);
    expect(canEnable('chartHistory', [entry([...previous, 'redistribution'])])).toBe(true);
  });
});

describe('existing features are unaffected by the new options', () => {
  const all = entry(ALL_KEYS);
  it('their default call does not look at confirmedAt / provenance', () => {
    const rights = emptyRights();
    for (const k of ALL_KEYS) rights[k] = { status: 'confirmed', evidenceUrl: 'https://example.invalid/e' };
    const bare: RightsLedgerEntry = { sourceId: 'x', rights };
    for (const f of ['chartHistory', 'technicalIndicators', 'keyZones', 'backtest', 'aiAnalysis'] as const) {
      expect(canEnable(f, [bare])).toBe(true);
      expect(canEnable(f, [all])).toBe(true);
      expect(canEnable(f, [{ sourceId: 'x', rights: emptyRights() }])).toBe(false);
    }
  });
});

describe('registry guard: the real ledger stays closed', () => {
  it('has the single Twelve Data free-key entry with every right (old and new) unconfirmed, no evidence, no date', () => {
    expect(TECHNICAL_RIGHTS_LEDGER).toHaveLength(1);
    const e = TECHNICAL_RIGHTS_LEDGER[0]!;
    expect(e.sourceId).toBe(TWELVEDATA_FREE_INTERNAL_SOURCE_ID);
    expect(Object.keys(e.rights).sort()).toEqual([...ALL_KEYS].sort());
    for (const key of ALL_KEYS) {
      expect(e.rights[key].status, key).toBe('unconfirmed');
      expect(e.rights[key].evidenceUrl, key).toBeUndefined();
      expect(e.rights[key].confirmedAt, key).toBeUndefined();
    }
  });

  it('records the provider and its terms URL, and opens no feature', () => {
    const e = TECHNICAL_RIGHTS_LEDGER[0]!;
    expect(e.providerName).toBe('Twelve Data (free key)');
    expect(e.termsUrl).toBe('https://twelvedata.com/terms');
    for (const f of Object.keys(REQUIRED_RIGHTS) as Feature[]) {
      expect(canEnable(f, TECHNICAL_RIGHTS_LEDGER, OPTIONS), f).toBe(false);
      expect(missingRights(f, TECHNICAL_RIGHTS_LEDGER, OPTIONS).length, f).toBeGreaterThan(0);
    }
  });

  it('the new right keys exist in emptyRights as unconfirmed', () => {
    const rights = emptyRights();
    for (const k of ['commercialUse', 'redistribution', 'derivedDisplay'] as const) {
      expect(rights[k]).toEqual({ status: 'unconfirmed' });
    }
  });
});
