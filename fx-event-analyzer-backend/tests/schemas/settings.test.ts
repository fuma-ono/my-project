import { describe, expect, it } from 'vitest';
import { updateSettingsBodySchema } from '../../src/schemas/settings.js';

const parse = (body: unknown) => updateSettingsBodySchema.safeParse(body).success;

describe('updateSettingsBodySchema', () => {
  it('accepts a partial body', () => {
    expect(parse({ notifications: { push: false } })).toBe(true);
    expect(parse({})).toBe(true);
  });

  it('accepts the full SCR-016 notifications shape', () => {
    expect(
      parse({
        notifications: {
          push: true,
          indicators: true,
          speeches: false,
          fx_pairs: ['USDJPY', 'EURUSD'],
          importances: ['HIGH', 'MEDIUM'],
          lead_minutes: 10,
        },
      }),
    ).toBe(true);
  });

  it('accepts lead_minutes 0/5/10/15/30/60 only', () => {
    for (const minutes of [0, 5, 10, 15, 30, 60]) {
      expect(parse({ notifications: { lead_minutes: minutes } })).toBe(true);
    }
    expect(parse({ notifications: { lead_minutes: 1 } })).toBe(false);
    expect(parse({ notifications: { lead_minutes: 120 } })).toBe(false);
    expect(parse({ notifications: { lead_minutes: '5' } })).toBe(false);
  });

  it('requires at least one importance and only known levels', () => {
    expect(parse({ notifications: { importances: [] } })).toBe(false);
    expect(parse({ notifications: { importances: ['CRITICAL'] } })).toBe(false);
    expect(parse({ notifications: { importances: ['LOW'] } })).toBe(true);
  });

  it('dedupes importances and orders them HIGH, MEDIUM, LOW', () => {
    const result = updateSettingsBodySchema.parse({ notifications: { importances: ['LOW', 'HIGH', 'LOW'] } });
    expect(result.notifications?.importances).toEqual(['HIGH', 'LOW']);
  });

  it('accepts fx_pairs null (= all) or a non-empty array of unique symbols', () => {
    expect(parse({ notifications: { fx_pairs: null } })).toBe(true);
    expect(parse({ notifications: { fx_pairs: ['USDJPY'] } })).toBe(true);
    expect(parse({ notifications: { fx_pairs: [] } })).toBe(false);
    expect(parse({ notifications: { fx_pairs: ['USDJPY', 'USDJPY'] } })).toBe(false);
    expect(parse({ notifications: { fx_pairs: [''] } })).toBe(false);
  });

  it('rejects the removed v1 notification fields', () => {
    expect(parse({ notifications: { pre_release: true } })).toBe(false);
    expect(parse({ notifications: { min_importance: 3 } })).toBe(false);
  });

  it('validates display values', () => {
    expect(parse({ display: { language: 'en', region: 'US', timezone: 'America/New_York' } })).toBe(true);
    expect(parse({ display: { language: 'fr' } })).toBe(false);
    expect(parse({ display: { region: 'jp' } })).toBe(false);
    expect(parse({ display: { timezone: 'Mars/Olympus' } })).toBe(false);
  });

  it('validates chart values', () => {
    expect(parse({ chart: { default_fx_pair_symbol: null, default_timeframe: '60m' } })).toBe(true);
    expect(parse({ chart: { default_timeframe: '4h' } })).toBe(false);
    expect(parse({ chart: { default_fx_pair_symbol: '' } })).toBe(false);
  });

  it('rejects unknown fields at every level', () => {
    expect(parse({ theme: 'dark' })).toBe(false);
    expect(parse({ notifications: { push_token: 'x' } })).toBe(false);
  });
});
