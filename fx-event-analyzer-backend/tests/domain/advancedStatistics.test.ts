import { describe, expect, it } from 'vitest';
import { gateAdvancedStatistics } from '../../src/domain/advancedStatistics.js';

describe('gateAdvancedStatistics', () => {
  it('returns available:false with data:null (never a blanket 403) when entitlement is missing', () => {
    const result = gateAdvancedStatistics(false, { average_absolute_movement: 1, average_absolute_pips: 10 });
    expect(result).toEqual({ available: false, required_entitlement: 'VIEW_ADVANCED_STATS', data: null });
  });

  it('returns available:true with the real data when entitled', () => {
    const data = { average_absolute_movement: 1, average_absolute_pips: 10 };
    expect(gateAdvancedStatistics(true, data)).toEqual({ available: true, required_entitlement: null, data });
  });
});
