import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './config/env.js';
import { createGitHubBugIssueCreator, type BugIssueCreator } from './integrations/githubIssues.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerApiRoutes } from './routes/api.js';
import { APPLE_ROOT_CA_G3_PEM } from './storekit/appleRootCertificates.js';
import { createSignedDataVerifier, type SignedDataVerifier } from './storekit/signedDataVerifier.js';

export interface BuildAppOptions {
  env: Env;
  supabase: SupabaseClient;
  /** Disable Fastify's own request logging in tests to keep output quiet. */
  logger?: boolean;
  /** Verifies App Store signed data. Defaults to the pinned Apple root;
   * tests pass a verifier that trusts their own test root instead. */
  signedDataVerifier?: SignedDataVerifier;
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
  app.decorate('signedDataVerifier', options.signedDataVerifier ?? createSignedDataVerifier(APPLE_ROOT_CA_G3_PEM));
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
    signedDataVerifier: SignedDataVerifier;
    /** Resolves null when GITHUB_ISSUES_TOKEN / GITHUB_ISSUES_REPO are unset. */
    bugIssueCreator: BugIssueCreator;
  }
}
