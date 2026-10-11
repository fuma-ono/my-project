import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './config/env.js';
import { createGitHubBugIssueCreator, type BugIssueCreator } from './integrations/githubIssues.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerApiRoutes } from './routes/api.js';

export interface BuildAppOptions {
  env: Env;
  supabase: SupabaseClient;
  /** Disable Fastify's own request logging in tests to keep output quiet. */
  logger?: boolean;
  /** fetch used for GitHub Issue creation (SCR-020 bug reports). Defaults
   * to the global fetch; tests pass a fake so nothing reaches GitHub. */
  githubFetch?: typeof fetch;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? { level: options.env.LOG_LEVEL },
  });

  app.decorate('supabase', options.supabase);
  app.decorate('env', options.env);
  // StoreKit署名検証(signedDataVerifier)はこのポートの対象外
  // (サブスクリプション機能、HQ指示: Calendar/Settings/Accountのみ移植)の
  // ため導入しない。bugIssueCreatorのみ追加する。
  app.decorate(
    'bugIssueCreator',
    createGitHubBugIssueCreator({
      token: options.env.GITHUB_ISSUES_TOKEN,
      repo: options.env.GITHUB_ISSUES_REPO,
      fetch: options.githubFetch,
    }),
  );

  registerErrorHandler(app);

  app.get('/health', () => ({ status: 'ok' }));

  app.register(registerApiRoutes, { prefix: '/api/v1' });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseClient;
    env: Env;
    /** Resolves null when GITHUB_ISSUES_TOKEN / GITHUB_ISSUES_REPO are unset. */
    bugIssueCreator: BugIssueCreator;
  }
}
