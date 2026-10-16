import { describe, expect, it, vi } from 'vitest';
import {
  createBugIssue,
  createGitHubBugIssueCreator,
  GitHubIssueError,
  type BugIssueInput,
} from '../../src/integrations/githubIssues.js';

const input: BugIssueInput = {
  title: '[アプリ不具合報告] チャート画面で落ちる',
  body: '## アプリからの不具合報告',
  labels: ['bug', 'from-app'],
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

const created = { number: 42, html_url: 'https://github.com/example/fx-support/issues/42' };

describe('createBugIssue', () => {
  it('POSTs the Issue to the configured repository with the bearer token', async () => {
    const fetch = fakeFetch(201, created);
    const result = await createBugIssue(input, { token: 'test-token', repo: 'example/fx-support', fetch });

    expect(result).toEqual({ number: 42, url: 'https://github.com/example/fx-support/issues/42' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/example/fx-support/issues');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers.Accept).toBe('application/vnd.github+json');
    const sent = JSON.parse(init?.body as string) as unknown;
    expect(sent).toEqual(input);
  });

  it.each([
    { token: undefined, repo: 'example/fx-support' },
    { token: 'test-token', repo: undefined },
    { token: '', repo: '' },
  ])('skips and resolves null when not configured (%o)', async (config) => {
    const fetch = fakeFetch(201, created);
    expect(await createBugIssue(input, { ...config, fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws GitHubIssueError on a non-2xx response', async () => {
    const fetch = fakeFetch(401, { message: 'Bad credentials' });
    const result = createBugIssue(input, { token: 'bad', repo: 'example/fx-support', fetch });
    await expect(result).rejects.toBeInstanceOf(GitHubIssueError);
  });

  it('throws GitHubIssueError on an unexpected response body', async () => {
    const fetch = fakeFetch(201, { id: 1 });
    const result = createBugIssue(input, { token: 't', repo: 'example/fx-support', fetch });
    await expect(result).rejects.toBeInstanceOf(GitHubIssueError);
  });

  it('never puts the token in the error message', async () => {
    const fetch = fakeFetch(500, {});
    const result = createBugIssue(input, { token: 'secret-token', repo: 'example/fx-support', fetch });
    await expect(result).rejects.toThrow(/^(?!.*secret-token).*HTTP 500/);
  });
});

describe('createGitHubBugIssueCreator', () => {
  it('binds the config', async () => {
    const fetch = fakeFetch(201, created);
    const create = createGitHubBugIssueCreator({ token: 'test-token', repo: 'example/fx-support', fetch });
    expect(await create(input)).toEqual({ number: 42, url: created.html_url });
  });
});
