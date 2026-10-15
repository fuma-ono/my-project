import { describe, expect, it } from 'vitest';
import { HttpClient, redactUrl } from '../../src/ingestion/http.js';
import { stubFetch } from '../helpers/memoryIngestionStore.js';

const SETTINGS = { minIntervalMs: 1000, timeoutMs: 50, maxRetries: 2, backoffMs: 100 };

function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

describe('HttpClient', () => {
  it('retries 5xx with exponential backoff, then succeeds', async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls += 1;
      return calls < 3 ? { status: 503, body: 'down' } : { body: '{"ok":true}' };
    });
    const c = clock();
    const http = new HttpClient(
      'test',
      { ...SETTINGS, minIntervalMs: 0 },
      { fetch: stub.fetch, sleep: c.sleep, now: c.now },
    );
    await expect(http.getJson('https://example.test/a')).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(c.sleeps).toEqual([100, 200]);
  });

  it('honours Retry-After on 429', async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls += 1;
      return calls === 1 ? { status: 429, body: '', headers: { 'retry-after': '7' } } : { body: '{}' };
    });
    const c = clock();
    const http = new HttpClient(
      'test',
      { ...SETTINGS, minIntervalMs: 0 },
      { fetch: stub.fetch, sleep: c.sleep, now: c.now },
    );
    await http.getJson('https://example.test/a');
    expect(c.sleeps).toEqual([7000]);
  });

  it('does not retry other 4xx and never puts the key in the error', async () => {
    const stub = stubFetch(() => ({ status: 401, body: 'unauthorized' }));
    const http = new HttpClient('test', SETTINGS, { fetch: stub.fetch, sleep: () => Promise.resolve() });
    await expect(http.getJson('https://example.test/a?api_key=SECRET123&x=1')).rejects.toThrow(
      'test: HTTP 401 (https://example.test/a?api_key=***&x=1)',
    );
    expect(stub.calls).toHaveLength(1);
  });

  it('gives up after maxRetries on timeouts / network errors', async () => {
    let calls = 0;
    const failing = (() => {
      calls += 1;
      return Promise.reject(new DOMException('timed out', 'TimeoutError'));
    }) as unknown as typeof fetch;
    const http = new HttpClient('test', SETTINGS, { fetch: failing, sleep: () => Promise.resolve() });
    await expect(http.getText('https://example.test/a?token=abc')).rejects.toThrow(
      'test: TimeoutError (https://example.test/a?token=***)',
    );
    expect(calls).toBe(3);
  });

  it('spaces requests by the provider rate limit', async () => {
    const stub = stubFetch(() => ({ body: '{}' }));
    const c = clock();
    const http = new HttpClient('test', SETTINGS, { fetch: stub.fetch, sleep: c.sleep, now: c.now });
    await Promise.all([
      http.getJson('https://example.test/1'),
      http.getJson('https://example.test/2'),
      http.getJson('https://example.test/3'),
    ]);
    expect(c.sleeps).toEqual([1000, 1000]);
  });

  it('redactUrl hides every credential-style parameter', () => {
    expect(redactUrl('https://x.test/p?c=KEY&f=json')).toBe('https://x.test/p?c=***&f=json');
    expect(redactUrl('https://x.test/p?apikey=1&apiKey=2&token=3&registrationkey=4')).toBe(
      'https://x.test/p?apikey=***&apiKey=***&token=***&registrationkey=***',
    );
  });
});
