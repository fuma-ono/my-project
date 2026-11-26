import { describe, expect, it } from 'vitest';
import {
  canEnable,
  emptyRights,
  missingRights,
  validateCanonicalBars,
  type BarSource,
  type Feature,
  type RightKey,
  type RightsLedgerEntry,
} from '../../../src/domain/technical/index.js';

const allConfirmed = (sourceId: string): RightsLedgerEntry => {
  const rights = emptyRights();
  for (const k of Object.keys(rights) as RightKey[]) {
    rights[k] = { status: 'confirmed', evidenceUrl: `https://example.invalid/${sourceId}/${k}` };
  }
  return { sourceId, rights };
};

describe('rights ledger gate', () => {
  const features: Feature[] = ['chartHistory', 'technicalIndicators', 'keyZones', 'backtest', 'aiAnalysis'];

  it('blocks when there are no entries or everything is unconfirmed (default)', () => {
    for (const f of features) {
      expect(canEnable(f, [])).toBe(false);
      expect(canEnable(f, [{ sourceId: 'x', rights: emptyRights() }])).toBe(false);
    }
  });

  it('allows when all rights are confirmed with evidence', () => {
    for (const f of features) expect(canEnable(f, [allConfirmed('a')])).toBe(true);
  });

  it('a confirmed status without an evidence URL does not count', () => {
    const e = allConfirmed('a');
    e.rights.externalDisplay = { status: 'confirmed' };
    expect(canEnable('chartHistory', [e])).toBe(false);
    e.rights.externalDisplay = { status: 'confirmed', evidenceUrl: '  ' };
    expect(canEnable('chartHistory', [e])).toBe(false);
  });

  it('denied blocks; only the rights a feature needs matter', () => {
    const e = allConfirmed('a');
    e.rights.mlTraining = { status: 'unconfirmed' };
    expect(canEnable('technicalIndicators', [e])).toBe(true);
    expect(canEnable('aiAnalysis', [e])).toBe(false);
    expect(missingRights('aiAnalysis', [e])).toEqual(['a:mlTraining']);
    e.rights.derivedData = { status: 'denied', evidenceUrl: 'https://example.invalid/d' };
    expect(canEnable('technicalIndicators', [e])).toBe(false);
  });

  it('every source feeding the feature must pass', () => {
    const bad = allConfirmed('b');
    bad.rights.userLimit = { status: 'unconfirmed' };
    expect(canEnable('keyZones', [allConfirmed('a'), bad])).toBe(false);
    expect(missingRights('keyZones', [allConfirmed('a'), bad])).toEqual(['b:userLimit']);
  });
});

describe('bar source contract', () => {
  it('validateCanonicalBars accepts good data and reports problems', () => {
    const ok = [
      { t: 0, o: 1, h: 2, l: 0.5, c: 1.5 },
      { t: 60_000, o: 1.5, h: 2, l: 1, c: 1.8, v: 10 },
    ];
    expect(validateCanonicalBars(ok)).toEqual([]);
    expect(validateCanonicalBars([ok[1]!, ok[0]!])).toEqual(['index 1: not strictly ascending']);
    expect(validateCanonicalBars([{ t: 0, o: 1, h: 0.9, l: 0.5, c: 1 }])).toEqual(['index 0: inconsistent OHLC']);
    expect(validateCanonicalBars([{ t: NaN, o: 1, h: 1, l: 1, c: 1 }])).toEqual(['index 0: non-finite value']);
    expect(validateCanonicalBars([{ t: 0, o: 1, h: 1, l: 1, c: 1, v: -1 }])).toEqual(['index 0: invalid volume']);
  });

  it('an in-memory adapter can implement BarSource (no vendor dependency)', async () => {
    const src: BarSource = {
      id: 'memory',
      fetchBars: (q) => Promise.resolve([{ t: q.fromMs, o: 1, h: 1, l: 1, c: 1 }]),
    };
    const bars = await src.fetchBars({ pair: 'USDJPY', timeframe: '5m', fromMs: 0, toMs: 1 });
    expect(validateCanonicalBars(bars)).toEqual([]);
  });
});
