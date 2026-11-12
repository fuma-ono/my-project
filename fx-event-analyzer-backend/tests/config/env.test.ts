import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const required = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' };

describe('loadEnv — GitHub Issues (SCR-020)', () => {
  it('leaves GITHUB_ISSUES_TOKEN / GITHUB_ISSUES_REPO unset when absent or empty', () => {
    const absent = loadEnv(required);
    expect(absent.GITHUB_ISSUES_TOKEN).toBeUndefined();
    expect(absent.GITHUB_ISSUES_REPO).toBeUndefined();
    const env = loadEnv({ ...required, GITHUB_ISSUES_TOKEN: '', GITHUB_ISSUES_REPO: '' });
    expect(env.GITHUB_ISSUES_TOKEN).toBeUndefined();
    expect(env.GITHUB_ISSUES_REPO).toBeUndefined();
  });

  it('reads them when set', () => {
    const env = loadEnv({ ...required, GITHUB_ISSUES_TOKEN: 'token', GITHUB_ISSUES_REPO: 'example/fx-support' });
    expect(env.GITHUB_ISSUES_TOKEN).toBe('token');
    expect(env.GITHUB_ISSUES_REPO).toBe('example/fx-support');
  });

  it('rejects a repository that is not "owner/name"', () => {
    expect(() => loadEnv({ ...required, GITHUB_ISSUES_REPO: 'fx-support' })).toThrow(/GITHUB_ISSUES_REPO/);
  });
});
