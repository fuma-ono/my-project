/**
 * Creates GitHub Issues for in-app bug reports (SCR-020, api-design.md
 * §24.7). GITHUB_ISSUES_TOKEN / GITHUB_ISSUES_REPO are optional: when
 * either is unset nothing is sent and the result is null. The token is
 * server-only and is never logged or returned to the client.
 */

export interface BugIssueInput {
  title: string;
  body: string;
  labels: string[];
}

export interface CreatedIssue {
  number: number;
  url: string;
}

export interface GitHubIssuesConfig {
  token?: string | undefined;
  /** "owner/name" */
  repo?: string | undefined;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch | undefined;
}

/** Creates a bug Issue; resolves null when not configured. Injected into
 * the app (src/app.ts) so tests can replace it. */
export type BugIssueCreator = (input: BugIssueInput) => Promise<CreatedIssue | null>;

export class GitHubIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubIssueError';
  }
}

const GITHUB_API_BASE_URL = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** Throws GitHubIssueError on a non-2xx response or an unexpected body —
 * the caller decides that this must not fail the user's request. */
export async function createBugIssue(input: BugIssueInput, config: GitHubIssuesConfig): Promise<CreatedIssue | null> {
  const { token, repo } = config;
  if (!token || !repo) return null;

  const fetchImpl = config.fetch ?? fetch;
  const response = await fetchImpl(`${GITHUB_API_BASE_URL}/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'fx-event-analyzer-backend',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new GitHubIssueError(`GitHub Issue creation failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as { number?: unknown; html_url?: unknown };
  if (typeof data.number !== 'number' || typeof data.html_url !== 'string') {
    throw new GitHubIssueError('GitHub Issue creation returned an unexpected response body');
  }
  return { number: data.number, url: data.html_url };
}

export function createGitHubBugIssueCreator(config: GitHubIssuesConfig): BugIssueCreator {
  return (input) => createBugIssue(input, config);
}
