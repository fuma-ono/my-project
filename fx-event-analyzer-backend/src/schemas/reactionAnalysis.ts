import { z } from 'zod';

// z.guid() (not z.uuid()): seed / DEV ids such as 20000000-0000-0000-0000-000000000002 must be accepted, like the
// other routes (strategy-analysis, speeches).
export const reactionAnalysisParamsSchema = z.object({ event_id: z.guid() });

/** Unknown query keys are ignored (zod objects strip them). */
export const reactionAnalysisQuerySchema = z.object({ fx_pair_id: z.guid().optional() });
