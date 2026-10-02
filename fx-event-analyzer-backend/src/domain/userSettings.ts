import type { UserSettingsRow, UserSettingsUpdate } from '../repositories/userSettingsRepository.js';
import type { UpdateSettingsBody } from '../schemas/settings.js';

/** GET/PATCH /settings response (api-design.md §24.4): grouped per screen
 * (SCR-018 / SCR-020 / SCR-021) rather than mirroring the flat DB row. */
export interface SettingsResponse {
  notifications: {
    pre_release: boolean;
    result: boolean;
    favorites: boolean;
    min_importance: number;
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
      pre_release: row.notify_pre_release,
      result: row.notify_result,
      favorites: row.notify_favorites,
      min_importance: row.notify_min_importance,
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

  if (notifications?.pre_release !== undefined) update.notify_pre_release = notifications.pre_release;
  if (notifications?.result !== undefined) update.notify_result = notifications.result;
  if (notifications?.favorites !== undefined) update.notify_favorites = notifications.favorites;
  if (notifications?.min_importance !== undefined) update.notify_min_importance = notifications.min_importance;

  if (display?.language !== undefined) update.display_language = display.language;
  if (display?.region !== undefined) update.display_region = display.region;
  if (display?.timezone !== undefined) update.display_timezone = display.timezone;

  if (chart?.default_fx_pair_symbol !== undefined) update.chart_default_fx_pair_symbol = chart.default_fx_pair_symbol;
  if (chart?.default_timeframe !== undefined) update.chart_default_timeframe = chart.default_timeframe;

  return update;
}
