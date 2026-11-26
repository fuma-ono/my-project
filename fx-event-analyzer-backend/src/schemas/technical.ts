import { z } from 'zod';

/** API timeframe names ('60m' is the stored name; the engine calls it '1h'; '1d' is the NY17 FX day). */
export const TECHNICAL_TIMEFRAMES = ['5m', '15m', '30m', '60m', '4h', '1d'] as const;
export type TechnicalTimeframe = (typeof TECHNICAL_TIMEFRAMES)[number];

export const TECHNICAL_DEFAULT_LIMIT = 300;
export const TECHNICAL_MAX_LIMIT = 1500;
export const TECHNICAL_MAX_INDICATORS = 8;

export type IndicatorSpec =
  | { kind: 'sma' | 'ema' | 'rsi' | 'atr'; period: number; key: string }
  | { kind: 'macd' | 'bollinger' | 'stoch'; key: string };

/** `sma20` / `ema50` / `rsi14` / `atr14` (period 2-400) or the fixed `macd` (12,26,9) / `bollinger` (20, 2σ) / `stoch` (14,3,3). */
export function parseIndicatorToken(token: string): IndicatorSpec | null {
  if (token === 'macd' || token === 'bollinger' || token === 'stoch') return { kind: token, key: token };
  const m = /^(sma|ema|rsi|atr)(\d{1,3})$/.exec(token);
  if (!m) return null;
  const period = Number(m[2]);
  if (period < 2 || period > 400) return null;
  return { kind: m[1] as 'sma' | 'ema' | 'rsi' | 'atr', period, key: `${m[1]}${period}` };
}

/** GET /fx-pairs/{fx_pair_id}/technical */
export const technicalParamsSchema = z.object({ fx_pair_id: z.guid() });

export const technicalQuerySchema = z.object({
  timeframe: z.enum(TECHNICAL_TIMEFRAMES),
  limit: z.coerce.number().int().min(1).max(TECHNICAL_MAX_LIMIT).default(TECHNICAL_DEFAULT_LIMIT),
  indicators: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return [] as IndicatorSpec[];
      const specs = new Map<string, IndicatorSpec>();
      for (const token of raw.split(',').map((t) => t.trim())) {
        const spec = parseIndicatorToken(token);
        if (!spec) {
          ctx.addIssue({ code: 'custom', message: `unknown indicator: ${token}` });
          return z.NEVER;
        }
        specs.set(spec.key, spec);
      }
      if (specs.size > TECHNICAL_MAX_INDICATORS) {
        ctx.addIssue({ code: 'custom', message: `at most ${TECHNICAL_MAX_INDICATORS} indicators` });
        return z.NEVER;
      }
      return [...specs.values()];
    }),
});
