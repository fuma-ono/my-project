import { z } from 'zod';

/** An optional variable, where an empty value (`NAME=` in .env) also counts as unset. */
function optionalString(schema: z.ZodString) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

/**
 * Required server configuration. Unlike the iOS client (which must run
 * safely with no Supabase project configured — Phase 1), the Backend
 * server has no meaningful degraded mode: without a real Supabase project
 * it cannot serve anything, so it fails fast and loudly at startup instead
 * of limping along with undefined behavior.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // StoreKit 2 transactions are only accepted for this bundle id
  // (POST /subscription/verify, api-design.md §25.1).
  APP_STORE_BUNDLE_ID: z.string().min(1).default('com.fumaono.fxeventanalyzer'),
  // SCR-020 不具合報告 → GitHub Issue (api-design.md §24.7). Optional: when
  // either is unset, bug reports are still stored and auto-replied, just
  // without an Issue. Server-only — never shipped in the iOS app.
  GITHUB_ISSUES_TOKEN: optionalString(z.string().min(1)),
  // "owner/name"
  GITHUB_ISSUES_REPO: optionalString(z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be "owner/name"')),
  // Public origin of this API (e.g. "https://api.example.com"), used to build
  // absolute URLs such as speaker photo URLs (api-design.md §14.7). Optional:
  // when unset, the request's own protocol://host is used.
  PUBLIC_BASE_URL: optionalString(z.string().url()),
  // GET /api/v1/quality-report (HQ判断 2026-10-17: 実機テスト中に品質レポートを
  // 見られるようにする)。未設定ならルートは404(既定で無効)。設定したら
  // ?token=<この値> を付けてスマホのブラウザで開く。社内限定・READ-ONLY。
  INTERNAL_REPORT_TOKEN: optionalString(z.string().min(1)),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
