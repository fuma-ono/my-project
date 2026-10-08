import { z } from 'zod';

/** SCR-010 経済指標カレンダー: the requested range is capped (no pagination). */
export const MAX_CALENDAR_RANGE_DAYS = 62;
const DAY_MS = 24 * 60 * 60 * 1000;

/** GET /calendar (api-design.md §14.6). `from` inclusive, `to` exclusive (§6),
 * both required. `importance` / `currency` are single values, same as
 * GET /speeches (§14.4). */
export const calendarQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    importance: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code')
      .optional(),
  })
  .superRefine((query, ctx) => {
    const span = Date.parse(query.to) - Date.parse(query.from);
    if (span <= 0) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be later than from.' });
    } else if (span > MAX_CALENDAR_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `The from/to range must be ${MAX_CALENDAR_RANGE_DAYS} days or less.`,
      });
    }
  });

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
