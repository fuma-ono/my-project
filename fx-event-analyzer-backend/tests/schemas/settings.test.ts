import { describe, expect, it } from 'vitest';
import { updateSettingsBodySchema } from '../../src/schemas/settings.js';

const parse = (body: unknown) => updateSettingsBodySchema.safeParse(body).success;

describe('updateSettingsBodySchema', () => {
  it('accepts a partial body', () => {
    expect(parse({ notifications: { result: false } })).toBe(true);
    expect(parse({})).toBe(true);
  });

  it('accepts min_importance 1-5 only, as integers', () => {
    expect(parse({ notifications: { min_importance: 1 } })).toBe(true);
    expect(parse({ notifications: { min_importance: 5 } })).toBe(true);
    expect(parse({ notifications: { min_importance: 0 } })).toBe(false);
    expect(parse({ notifications: { min_importance: 6 } })).toBe(false);
    expect(parse({ notifications: { min_importance: 2.5 } })).toBe(false);
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
