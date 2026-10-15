/**
 * The one HTTP entry point for every provider adapter: per-provider rate
 * limit (minimum interval between requests), per-request timeout, and
 * retry with exponential backoff on network errors / 429 / 5xx (honouring
 * Retry-After). Other 4xx are not retried — they mean the request itself
 * is wrong (bad key, bad parameters).
 *
 * API keys travel in query strings for most providers, so every URL that
 * can end up in an error message or ingestion log goes through
 * redactUrl() first.
 */

export interface ProviderHttpSettings {
  /** Minimum milliseconds between two requests to this provider (rate limit). */
  minIntervalMs: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Retries after the first attempt. */
  maxRetries: number;
  /** First backoff; doubles each retry. */
  backoffMs: number;
}

export interface HttpClientDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const SECRET_QUERY_PARAMS = new Set(['api_key', 'apikey', 'apiKey', 'token', 'c', 'registrationkey', 'key']);

/** Replaces the value of any credential-looking query parameter with "***". */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_PARAMS.has(name)) parsed.searchParams.set(name, '***');
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:api_key|apikey|apiKey|token|c|registrationkey|key)=)[^&]*/g, '$1***');
  }
}

/** Some official JSON feeds (federalreserve.gov) start with a UTF-8 BOM. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private nextAllowedAt = 0;
  /** Serializes requests so the rate limit holds even with concurrent callers. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly provider: string,
    private readonly settings: ProviderHttpSettings,
    deps: HttpClientDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? Date.now;
  }

  async getText(url: string, init: RequestInit = {}): Promise<string> {
    const response = await this.request(url, init);
    return response.text();
  }

  async getJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const text = await this.getText(url, init);
    try {
      return JSON.parse(stripBom(text)) as unknown;
    } catch {
      throw new HttpError(`${this.provider}: response is not JSON (${redactUrl(url)})`, null, false);
    }
  }

  private async waitForSlot(): Promise<void> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    const waitMs = this.nextAllowedAt - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    this.nextAllowedAt = this.now() + this.settings.minIntervalMs;
    release();
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const safeUrl = redactUrl(url);
    let lastError: HttpError = new HttpError(`${this.provider}: request failed (${safeUrl})`, null, true);
    for (let attempt = 0; attempt <= this.settings.maxRetries; attempt += 1) {
      await this.waitForSlot();
      let retryDelay = this.settings.backoffMs * 2 ** attempt;
      try {
        const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.settings.timeoutMs) });
        if (response.ok) return response;
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new HttpError(`${this.provider}: HTTP ${response.status} (${safeUrl})`, response.status, retryable);
        if (!retryable) throw lastError;
        retryDelay = retryAfterMs(response.headers.get('retry-after')) ?? retryDelay;
      } catch (error) {
        if (error instanceof HttpError && !error.retryable) throw error;
        if (!(error instanceof HttpError)) {
          const reason = error instanceof Error ? error.name : 'error';
          lastError = new HttpError(`${this.provider}: ${reason} (${safeUrl})`, null, true);
        }
      }
      if (attempt < this.settings.maxRetries) await this.sleep(retryDelay);
    }
    throw lastError;
  }
}
