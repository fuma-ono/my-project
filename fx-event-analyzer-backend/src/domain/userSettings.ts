import type { UserSettingsRow, UserSettingsUpdate } from '../repositories/userSettingsRepository.js';
import type {
  ChartType,
  DisplayCurrency,
  DisplayDateFormat,
  DisplayTextSize,
  DisplayTheme,
  DisplayTimeFormat,
  DisplayWeekStart,
  UpdateSettingsBody,
} from '../schemas/settings.js';
import { sortImportancesDesc, type Importance } from './importance.js';
import type { NotificationLeadMinutes } from './notifications.js';

/** GET/PATCH /settings response (api-design.md §24.4): grouped per screen
 * (SCR-018 / SCR-020 / SCR-021) rather than mirroring the flat DB row. */
export interface SettingsResponse {
  /** SCR-016 通知設定 v2 (HQ指示 2026-10-05). */
  notifications: {
    push: boolean;
    indicators: boolean;
    speeches: boolean;
    /** null = すべての通貨ペア */
    fx_pairs: string[] | null;
    /** Always ordered HIGH, MEDIUM, LOW. */
    importances: Importance[];
    lead_minutes: NotificationLeadMinutes;
    /** 通知しない時間帯 (2026-10-06). Default off, 23:00〜07:00. */
    quiet_hours_enabled: boolean;
    /** "HH:MM", local time in display.timezone (inclusive). */
    quiet_start: string;
    /** "HH:MM" (exclusive). Earlier than quiet_start = wraps midnight; equal = no suppression. */
    quiet_end: string;
  };
  display: {
    language: string;
    region: string;
    timezone: string;
    /** SCR-018 (2026-10-06). Default SYSTEM. */
    theme: DisplayTheme;
    /** Default STANDARD. */
    text_size: DisplayTextSize;
    /** Default "YYYY/MM/DD". */
    date_format: DisplayDateFormat;
    /** Default "24H". */
    time_format: DisplayTimeFormat;
    /** Default JPY. */
    currency: DisplayCurrency;
    /** Default MONDAY. */
    week_start: DisplayWeekStart;
  };
  chart: {
    default_fx_pair_symbol: string | null;
    default_timeframe: string;
    /** SCR-019 (2026-10-06). Default CANDLE. */
    chart_type: ChartType;
    /** false hides every indicator regardless of the indicator_* flags. Default true. */
    show_indicators: boolean;
    /** Defaults: MA true, Bollinger false, MACD true, RSI false, Stochastic false. */
    indicator_ma: boolean;
    indicator_bollinger: boolean;
    indicator_macd: boolean;
    indicator_rsi: boolean;
    indicator_stochastic: boolean;
    /** Default true. */
    crosshair: boolean;
    /** Default true. */
    price_line: boolean;
  };
  updated_at: string;
}

export function toSettingsResponse(row: UserSettingsRow): SettingsResponse {
  return {
    notifications: {
      push: row.notify_push,
      indicators: row.notify_indicators,
      speeches: row.notify_speeches,
      fx_pairs: row.notify_fx_pair_symbols,
      importances: sortImportancesDesc(row.notify_importances),
      // Guaranteed by the DB CHECK (0, 5, 10, 15, 30, 60).
      lead_minutes: row.notify_lead_minutes as NotificationLeadMinutes,
      quiet_hours_enabled: row.notify_quiet_hours_enabled,
      quiet_start: row.notify_quiet_start,
      quiet_end: row.notify_quiet_end,
    },
    display: {
      language: row.display_language,
      region: row.display_region,
      timezone: row.display_timezone,
      theme: row.display_theme,
      text_size: row.display_text_size,
      date_format: row.display_date_format,
      time_format: row.display_time_format,
      currency: row.display_currency,
      week_start: row.display_week_start,
    },
    chart: {
      default_fx_pair_symbol: row.chart_default_fx_pair_symbol,
      default_timeframe: row.chart_default_timeframe,
      chart_type: row.chart_type,
      show_indicators: row.chart_show_indicators,
      indicator_ma: row.chart_indicator_ma,
      indicator_bollinger: row.chart_indicator_bollinger,
      indicator_macd: row.chart_indicator_macd,
      indicator_rsi: row.chart_indicator_rsi,
      indicator_stochastic: row.chart_indicator_stochastic,
      crosshair: row.chart_crosshair,
      price_line: row.chart_price_line,
    },
    updated_at: row.updated_at,
  };
}

/** Maps only the fields actually present in the PATCH body, so omitted
 * fields keep their stored value. */
export function toSettingsUpdate(body: UpdateSettingsBody): UserSettingsUpdate {
  const update: UserSettingsUpdate = {};
  const { notifications, display, chart } = body;

  if (notifications?.push !== undefined) update.notify_push = notifications.push;
  if (notifications?.indicators !== undefined) update.notify_indicators = notifications.indicators;
  if (notifications?.speeches !== undefined) update.notify_speeches = notifications.speeches;
  if (notifications?.fx_pairs !== undefined) update.notify_fx_pair_symbols = notifications.fx_pairs;
  if (notifications?.importances !== undefined) update.notify_importances = notifications.importances;
  if (notifications?.lead_minutes !== undefined) update.notify_lead_minutes = notifications.lead_minutes;
  if (notifications?.quiet_hours_enabled !== undefined) {
    update.notify_quiet_hours_enabled = notifications.quiet_hours_enabled;
  }
  if (notifications?.quiet_start !== undefined) update.notify_quiet_start = notifications.quiet_start;
  if (notifications?.quiet_end !== undefined) update.notify_quiet_end = notifications.quiet_end;

  if (display?.language !== undefined) update.display_language = display.language;
  if (display?.region !== undefined) update.display_region = display.region;
  if (display?.timezone !== undefined) update.display_timezone = display.timezone;
  if (display?.theme !== undefined) update.display_theme = display.theme;
  if (display?.text_size !== undefined) update.display_text_size = display.text_size;
  if (display?.date_format !== undefined) update.display_date_format = display.date_format;
  if (display?.time_format !== undefined) update.display_time_format = display.time_format;
  if (display?.currency !== undefined) update.display_currency = display.currency;
  if (display?.week_start !== undefined) update.display_week_start = display.week_start;

  if (chart?.default_fx_pair_symbol !== undefined) update.chart_default_fx_pair_symbol = chart.default_fx_pair_symbol;
  if (chart?.default_timeframe !== undefined) update.chart_default_timeframe = chart.default_timeframe;
  if (chart?.chart_type !== undefined) update.chart_type = chart.chart_type;
  if (chart?.show_indicators !== undefined) update.chart_show_indicators = chart.show_indicators;
  if (chart?.indicator_ma !== undefined) update.chart_indicator_ma = chart.indicator_ma;
  if (chart?.indicator_bollinger !== undefined) update.chart_indicator_bollinger = chart.indicator_bollinger;
  if (chart?.indicator_macd !== undefined) update.chart_indicator_macd = chart.indicator_macd;
  if (chart?.indicator_rsi !== undefined) update.chart_indicator_rsi = chart.indicator_rsi;
  if (chart?.indicator_stochastic !== undefined) update.chart_indicator_stochastic = chart.indicator_stochastic;
  if (chart?.crosshair !== undefined) update.chart_crosshair = chart.crosshair;
  if (chart?.price_line !== undefined) update.chart_price_line = chart.price_line;

  return update;
}
