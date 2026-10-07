import { z } from 'zod';
import { sortImportancesDesc } from '../domain/importance.js';
import { NOTIFICATION_LEAD_MINUTES, NOTIFICATION_TIME_PATTERN } from '../domain/notifications.js';

/** IANA zone names only — rejects anything `Intl` can't resolve, so a bad
 * value never reaches timezone-scoped APIs like Home (api-design.md §6). */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// SCR-018 表示・地域設定 / SCR-019 チャート設定 (2026-10-06). The same lists
// are enforced by the DB CHECKs in
// supabase/migrations/20261006000002_display_chart_settings_v2.sql.
export const DISPLAY_THEMES = ['SYSTEM', 'DARK', 'LIGHT'] as const;
export const DISPLAY_TEXT_SIZES = ['SMALL', 'STANDARD', 'LARGE'] as const;
export const DISPLAY_DATE_FORMATS = ['YYYY/MM/DD', 'YYYY-MM-DD', 'MM/DD/YYYY', 'YYYY年M月D日'] as const;
export const DISPLAY_TIME_FORMATS = ['24H', '12H'] as const;
export const DISPLAY_CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'] as const;
export const DISPLAY_WEEK_STARTS = ['SUNDAY', 'MONDAY'] as const;
export const CHART_TYPES = ['CANDLE', 'LINE', 'BAR'] as const;

export type DisplayTheme = (typeof DISPLAY_THEMES)[number];
export type DisplayTextSize = (typeof DISPLAY_TEXT_SIZES)[number];
export type DisplayDateFormat = (typeof DISPLAY_DATE_FORMATS)[number];
export type DisplayTimeFormat = (typeof DISPLAY_TIME_FORMATS)[number];
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export type DisplayWeekStart = (typeof DISPLAY_WEEK_STARTS)[number];
export type ChartType = (typeof CHART_TYPES)[number];

/** SCR-026 ホーム通貨ペア編集 (2026-10-07): ホームに表示する通貨ペアの上限。
 * Same limit as the DB CHECK in
 * supabase/migrations/20261007000003_home_fx_pairs.sql. */
export const HOME_FX_PAIRS_MAX = 3;

/** Non-empty, duplicate-free list of fx_pairs.symbol. Whether each symbol
 * is an active fx_pairs.symbol is checked against the DB by the route
 * (422 on an unknown one). */
function fxPairSymbolsSchema(max?: number) {
  const base = z.array(z.string().min(1)).min(1);
  return (max === undefined ? base : base.max(max)).refine(
    (symbols) => new Set(symbols).size === symbols.length,
    'must not contain duplicate symbols',
  );
}

/** PATCH /settings body (api-design.md §24.4). Every field is optional —
 * only the fields present are changed — and unknown fields are rejected. */
export const updateSettingsBodySchema = z
  .object({
    notifications: z
      .object({
        push: z.boolean(),
        indicators: z.boolean(),
        speeches: z.boolean(),
        // null = すべての通貨ペア.
        fx_pairs: fxPairSymbolsSchema().nullable(),
        // Duplicates are harmless here, so they are folded rather than rejected.
        importances: z
          .array(z.enum(['HIGH', 'MEDIUM', 'LOW']))
          .min(1)
          .transform(sortImportancesDesc),
        lead_minutes: z.literal(NOTIFICATION_LEAD_MINUTES),
        // 通知しない時間帯. "HH:MM" local time in display.timezone; start ==
        // end is allowed (= suppresses nothing).
        quiet_hours_enabled: z.boolean(),
        quiet_start: z.string().regex(NOTIFICATION_TIME_PATTERN, 'must be HH:MM (00:00-23:59)'),
        quiet_end: z.string().regex(NOTIFICATION_TIME_PATTERN, 'must be HH:MM (00:00-23:59)'),
      })
      .partial()
      .strict()
      .optional(),
    display: z
      .object({
        language: z.enum(['ja', 'en']),
        region: z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code'),
        timezone: z.string().min(1).refine(isValidTimeZone, 'must be a valid IANA time zone'),
        theme: z.enum(DISPLAY_THEMES),
        text_size: z.enum(DISPLAY_TEXT_SIZES),
        date_format: z.enum(DISPLAY_DATE_FORMATS),
        time_format: z.enum(DISPLAY_TIME_FORMATS),
        currency: z.enum(DISPLAY_CURRENCIES),
        week_start: z.enum(DISPLAY_WEEK_STARTS),
      })
      .partial()
      .strict()
      .optional(),
    chart: z
      .object({
        default_fx_pair_symbol: z.string().min(1).nullable(),
        default_timeframe: z.enum(['1m', '5m', '15m', '30m', '60m']),
        chart_type: z.enum(CHART_TYPES),
        // false hides every indicator regardless of the indicator_* flags.
        show_indicators: z.boolean(),
        indicator_ma: z.boolean(),
        indicator_bollinger: z.boolean(),
        indicator_macd: z.boolean(),
        indicator_rsi: z.boolean(),
        indicator_stochastic: z.boolean(),
        crosshair: z.boolean(),
        price_line: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
    // SCR-026 ホーム通貨ペア編集. Order = display order on Home; null =
    // default (USDJPY, EURUSD, EURJPY).
    home: z
      .object({
        fx_pairs: fxPairSymbolsSchema(HOME_FX_PAIRS_MAX).nullable(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
