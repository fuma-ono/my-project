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
  notify_quiet_hours_enabled: true,
  notify_quiet_start: '22:30',
  notify_quiet_end: '06:00',
  display_language: 'ja',
  display_region: 'JP',
  display_timezone: 'Asia/Tokyo',
  display_theme: 'DARK',
  display_text_size: 'LARGE',
  display_date_format: 'YYYY年M月D日',
  display_time_format: '12H',
  display_currency: 'USD',
  display_week_start: 'SUNDAY',
  chart_default_fx_pair_symbol: 'USDJPY',
  chart_default_timeframe: '5m',
  chart_type: 'LINE',
  chart_show_indicators: true,
  chart_indicator_ma: false,
  chart_indicator_bollinger: true,
  chart_indicator_macd: false,
  chart_indicator_rsi: true,
  chart_indicator_stochastic: true,
  chart_crosshair: false,
  chart_price_line: true,
  home_fx_pairs: ['EURJPY', 'USDJPY'],
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
        quiet_hours_enabled: true,
        quiet_start: '22:30',
        quiet_end: '06:00',
      },
      display: {
        language: 'ja',
        region: 'JP',
        timezone: 'Asia/Tokyo',
        theme: 'DARK',
        text_size: 'LARGE',
        date_format: 'YYYY年M月D日',
        time_format: '12H',
        currency: 'USD',
        week_start: 'SUNDAY',
      },
      chart: {
        default_fx_pair_symbol: 'USDJPY',
        default_timeframe: '5m',
        chart_type: 'LINE',
        show_indicators: true,
        indicator_ma: false,
        indicator_bollinger: true,
        indicator_macd: false,
        indicator_rsi: true,
        indicator_stochastic: true,
        crosshair: false,
        price_line: true,
      },
      home: {
        fx_pairs: ['EURJPY', 'USDJPY'],
      },
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

  it('keeps home.fx_pairs null (= default) and the saved order otherwise', () => {
    expect(toSettingsResponse({ ...row, home_fx_pairs: null }).home.fx_pairs).toBeNull();
    expect(toSettingsResponse({ ...row, home_fx_pairs: ['GBPJPY', 'AUDUSD', 'USDJPY'] }).home.fx_pairs).toEqual([
      'GBPJPY',
      'AUDUSD',
      'USDJPY',
    ]);
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

  it('maps home.fx_pairs to home_fx_pairs, including null (= back to default)', () => {
    expect(toSettingsUpdate({ home: { fx_pairs: ['EURJPY', 'USDJPY'] } })).toEqual({
      home_fx_pairs: ['EURJPY', 'USDJPY'],
    });
    expect(toSettingsUpdate({ home: { fx_pairs: null } })).toEqual({ home_fx_pairs: null });
    expect(toSettingsUpdate({ home: {} })).toEqual({});
  });

  it('maps the quiet hours fields', () => {
    expect(
      toSettingsUpdate({ notifications: { quiet_hours_enabled: true, quiet_start: '22:00', quiet_end: '06:30' } }),
    ).toEqual({
      notify_quiet_hours_enabled: true,
      notify_quiet_start: '22:00',
      notify_quiet_end: '06:30',
    });
    expect(toSettingsUpdate({ notifications: { quiet_end: '08:00' } })).toEqual({ notify_quiet_end: '08:00' });
  });

  it('maps the SCR-018 display fields', () => {
    expect(
      toSettingsUpdate({
        display: {
          theme: 'LIGHT',
          text_size: 'SMALL',
          date_format: 'MM/DD/YYYY',
          time_format: '12H',
          currency: 'EUR',
          week_start: 'SUNDAY',
        },
      }),
    ).toEqual({
      display_theme: 'LIGHT',
      display_text_size: 'SMALL',
      display_date_format: 'MM/DD/YYYY',
      display_time_format: '12H',
      display_currency: 'EUR',
      display_week_start: 'SUNDAY',
    });
    expect(toSettingsUpdate({ display: { date_format: 'YYYY年M月D日' } })).toEqual({
      display_date_format: 'YYYY年M月D日',
    });
  });

  it('maps the SCR-019 chart fields (chart_type stays chart_type)', () => {
    expect(
      toSettingsUpdate({
        chart: {
          chart_type: 'BAR',
          show_indicators: true,
          indicator_ma: true,
          indicator_bollinger: true,
          indicator_macd: true,
          indicator_rsi: true,
          indicator_stochastic: true,
          crosshair: true,
          price_line: true,
        },
      }),
    ).toEqual({
      chart_type: 'BAR',
      chart_show_indicators: true,
      chart_indicator_ma: true,
      chart_indicator_bollinger: true,
      chart_indicator_macd: true,
      chart_indicator_rsi: true,
      chart_indicator_stochastic: true,
      chart_crosshair: true,
      chart_price_line: true,
    });
    expect(toSettingsUpdate({ chart: { indicator_rsi: true } })).toEqual({ chart_indicator_rsi: true });
  });

  it('maps false chart booleans instead of dropping them as falsy', () => {
    expect(
      toSettingsUpdate({
        chart: {
          show_indicators: false,
          indicator_ma: false,
          indicator_bollinger: false,
          indicator_macd: false,
          indicator_rsi: false,
          indicator_stochastic: false,
          crosshair: false,
          price_line: false,
        },
      }),
    ).toEqual({
      chart_show_indicators: false,
      chart_indicator_ma: false,
      chart_indicator_bollinger: false,
      chart_indicator_macd: false,
      chart_indicator_rsi: false,
      chart_indicator_stochastic: false,
      chart_crosshair: false,
      chart_price_line: false,
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
    expect(toSettingsUpdate({ notifications: { quiet_hours_enabled: false } })).toEqual({
      notify_quiet_hours_enabled: false,
    });
  });
});
