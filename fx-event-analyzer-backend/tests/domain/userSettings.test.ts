import { describe, expect, it } from 'vitest';
import { toSettingsResponse, toSettingsUpdate } from '../../src/domain/userSettings.js';
import type { UserSettingsRow } from '../../src/repositories/userSettingsRepository.js';

const row: UserSettingsRow = {
  notify_pre_release: true,
  notify_result: false,
  notify_favorites: true,
  notify_min_importance: 4,
  display_language: 'ja',
  display_region: 'JP',
  display_timezone: 'Asia/Tokyo',
  chart_default_fx_pair_symbol: 'USDJPY',
  chart_default_timeframe: '5m',
  updated_at: '2026-10-02T00:00:00.000Z',
};

describe('toSettingsResponse', () => {
  it('groups the flat row per settings screen', () => {
    expect(toSettingsResponse(row)).toEqual({
      notifications: { pre_release: true, result: false, favorites: true, min_importance: 4 },
      display: { language: 'ja', region: 'JP', timezone: 'Asia/Tokyo' },
      chart: { default_fx_pair_symbol: 'USDJPY', default_timeframe: '5m' },
      updated_at: '2026-10-02T00:00:00.000Z',
    });
  });
});

describe('toSettingsUpdate', () => {
  it('maps only the fields present', () => {
    expect(toSettingsUpdate({ notifications: { min_importance: 5 }, display: { timezone: 'UTC' } })).toEqual({
      notify_min_importance: 5,
      display_timezone: 'UTC',
    });
  });

  it('is empty for an empty body', () => {
    expect(toSettingsUpdate({})).toEqual({});
  });

  it('keeps an explicit null default FX pair (clears it)', () => {
    expect(toSettingsUpdate({ chart: { default_fx_pair_symbol: null } })).toEqual({
      chart_default_fx_pair_symbol: null,
    });
  });

  it('maps false booleans instead of dropping them as falsy', () => {
    expect(toSettingsUpdate({ notifications: { pre_release: false, result: false, favorites: false } })).toEqual({
      notify_pre_release: false,
      notify_result: false,
      notify_favorites: false,
    });
  });
});
