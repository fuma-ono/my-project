import { describe, expect, it } from 'vitest';
import { searchCurrencies } from '../../src/domain/currencies.js';

describe('searchCurrencies', () => {
  it('matches by code, case-insensitively', () => {
    expect(searchCurrencies('jpy')).toEqual([{ code: 'JPY', name: 'Japanese Yen' }]);
  });

  it('matches by name substring, case-insensitively', () => {
    expect(searchCurrencies('dollar')).toEqual(
      expect.arrayContaining([
        { code: 'USD', name: 'US Dollar' },
        { code: 'AUD', name: 'Australian Dollar' },
        { code: 'NZD', name: 'New Zealand Dollar' },
        { code: 'CAD', name: 'Canadian Dollar' },
      ]),
    );
  });

  it('returns an empty array for no match', () => {
    expect(searchCurrencies('xyz')).toEqual([]);
  });
});
