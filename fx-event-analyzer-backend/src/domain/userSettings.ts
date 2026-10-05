import type { UserSettingsRow, UserSettingsUpdate } from '../repositories/userSettingsRepository.js';
import type { UpdateSettingsBody } from '../schemas/settings.js';
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
  };
  display: {
    language: string;
    region: string;
    timezone: string;
  };
  chart: {
    default_fx_pair_symbol: string | null;
    default_timeframe: string;
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
    },
    display: {
      language: row.display_language,
      region: row.display_region,
      timezone: row.display_timezone,
    },
    chart: {
      default_fx_pair_symbol: row.chart_default_fx_pair_symbol,
      default_timeframe: row.chart_default_timeframe,
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

  if (display?.language !== undefined) update.display_language = display.language;
  if (display?.region !== undefined) update.display_region = display.region;
  if (display?.timezone !== undefined) update.display_timezone = display.timezone;

  if (chart?.default_fx_pair_symbol !== undefined) update.chart_default_fx_pair_symbol = chart.default_fx_pair_symbol;
  if (chart?.default_timeframe !== undefined) update.chart_default_timeframe = chart.default_timeframe;

  return update;
}
