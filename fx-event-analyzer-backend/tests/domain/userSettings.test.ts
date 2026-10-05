import { describe, expect, it } from 'vitest';
import { toSettingsResponse, toSettingsUpdate } from '../../src/domain/userSettings.js';
import type { UserSettingsRow } from '../../src/repositories/userSettingsRepository.js';

const row: UserSettingsRow = {
  notify_push: true,
  notify_indicators: false,
  notify_speeches: true,
  notify_fx_pair_symbols: ['USDJPY', 'EURUSD'],
  notify_importances: ['LOW', 'HIGH'],
  notify_lead_minutes: 15,
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
      notifications: {
        push: true,
        indicators: false,
        speeches: true,
        fx_pairs: ['USDJPY', 'EURUSD'],
        importances: ['HIGH', 'LOW'],
        lead_minutes: 15,
      },
      display: { language: 'ja', region: 'JP', timezone: 'Asia/Tokyo' },
      chart: { default_fx_pair_symbol: 'USDJPY', default_timeframe: '5m' },
      updated_at: '2026-10-02T00:00:00.000Z',
    });
  });

  it('always orders importances HIGH, MEDIUM, LOW regardless of stored order', () => {
    const response = toSettingsResponse({ ...row, notify_importances: ['LOW', 'MEDIUM', 'HIGH'] });
    expect(response.notifications.importances).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });

  it('keeps fx_pairs null (= all pairs)', () => {
    expect(toSettingsResponse({ ...row, notify_fx_pair_symbols: null }).notifications.fx_pairs).toBeNull();
  });
});

describe('toSettingsUpdate', () => {
  it('maps only the fields present', () => {
    expect(toSettingsUpdate({ notifications: { lead_minutes: 30 }, display: { timezone: 'UTC' } })).toEqual({
      notify_lead_minutes: 30,
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

  it('keeps an explicit null fx_pairs (= back to all pairs)', () => {
    expect(toSettingsUpdate({ notifications: { fx_pairs: null } })).toEqual({ notify_fx_pair_symbols: null });
  });

  it('maps the array fields', () => {
    expect(toSettingsUpdate({ notifications: { fx_pairs: ['USDJPY'], importances: ['HIGH'] } })).toEqual({
      notify_fx_pair_symbols: ['USDJPY'],
      notify_importances: ['HIGH'],
    });
  });

  it('maps false booleans and lead_minutes 0 instead of dropping them as falsy', () => {
    expect(
      toSettingsUpdate({ notifications: { push: false, indicators: false, speeches: false, lead_minutes: 0 } }),
    ).toEqual({
      notify_push: false,
      notify_indicators: false,
      notify_speeches: false,
      notify_lead_minutes: 0,
    });
  });
});
