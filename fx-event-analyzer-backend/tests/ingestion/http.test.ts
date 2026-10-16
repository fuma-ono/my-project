import { describe, expect, it } from 'vitest';
import { CreditBudgetExceededError, CreditGate, HttpClient, HttpError, redactUrl } from '../../src/ingestion/http.js';
import { MemoryIngestionStore, stubFetch } from '../helpers/memoryIngestionStore.js';

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

describe('HttpClient credit hooks', () => {
  it('calls onAttempt and beforeAttempt for every attempt, retries included', async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls += 1;
      return calls < 3 ? { status: 503, body: 'down' } : { body: '{}' };
    });
    let attempts = 0;
    let reservations = 0;
    const http = new HttpClient('test', SETTINGS, {
      fetch: stub.fetch,
      sleep: () => Promise.resolve(),
      onAttempt: () => (attempts += 1),
      beforeAttempt: () => {
        reservations += 1;
        return Promise.resolve(true);
      },
    });
    await http.getJson('https://example.test/a');
    expect([calls, attempts, reservations]).toEqual([3, 3, 3]);
  });

  it('does not send the request when the reservation is refused (also on a retry)', async () => {
    const stub = stubFetch(() => ({ status: 503, body: 'down' }));
    let allowed = 1;
    const http = new HttpClient('test', SETTINGS, {
      fetch: stub.fetch,
      sleep: () => Promise.resolve(),
      beforeAttempt: () => Promise.resolve(allowed-- > 0),
    });
    const error = await http.getJson('https://example.test/a?apikey=SECRET').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CreditBudgetExceededError);
    expect((error as CreditBudgetExceededError).reason).toBe('CAP_REACHED');
    expect((error as Error).message).not.toContain('SECRET');
    expect(stub.calls).toHaveLength(1);
  });

  it('treats an unreachable ledger as "not sent"', async () => {
    const stub = stubFetch(() => ({ body: '{}' }));
    const http = new HttpClient('test', SETTINGS, {
      fetch: stub.fetch,
      beforeAttempt: () => Promise.reject(new Error('connection refused')),
    });
    const error = await http.getJson('https://example.test/a').catch((e: unknown) => e);
    expect((error as CreditBudgetExceededError).reason).toBe('LEDGER_UNAVAILABLE');
    expect(stub.calls).toHaveLength(0);
  });

  it('marks timeouts as TIMEOUT', async () => {
    const failing = (() => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as unknown as typeof fetch;
    const http = new HttpClient('test', { ...SETTINGS, maxRetries: 0 }, { fetch: failing });
    const error = await http.getText('https://example.test/a').catch((e: unknown) => e);
    expect((error as HttpError).kind).toBe('TIMEOUT');
  });
});

describe('CreditGate + ledger', () => {
  it('reserves one credit per attempt and stops at the daily cap and the run cap', async () => {
    const store = new MemoryIngestionStore();
    const daily = new CreditGate(store, { provider: 'twelvedata', job: 'j', runId: 'r1', dailyCap: 2 });
    expect([await daily.beforeAttempt(), await daily.beforeAttempt(), await daily.beforeAttempt()]).toEqual([
      true,
      true,
      false,
    ]);
    expect(daily.refusal).toBe('DAILY_CAP');
    expect(await store.todayApiCredits('twelvedata')).toBe(2);

    const run = new CreditGate(store, { provider: 'other', job: 'j', runId: 'r2', dailyCap: 10, runCap: 1 });
    expect([await run.beforeAttempt(), await run.beforeAttempt()]).toEqual([true, false]);
    expect(run.refusal).toBe('RUN_CAP');
  });

  it('cannot be overrun by concurrent reservations', async () => {
    const store = new MemoryIngestionStore();
    const gates = [1, 2, 3].map(
      (i) => new CreditGate(store, { provider: 'twelvedata', job: 'j', runId: `r${i}`, dailyCap: 10 }),
    );
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => gates[i % 3]!.beforeAttempt()));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await store.todayApiCredits('twelvedata')).toBe(10);
  });

  it('counts per UTC day', async () => {
    const store = new MemoryIngestionStore();
    store.clock = () => new Date('2026-10-16T23:59:00Z');
    const gate = new CreditGate(store, { provider: 'twelvedata', job: 'j', runId: 'r', dailyCap: 1 });
    expect(await gate.beforeAttempt()).toBe(true);
    expect(await gate.beforeAttempt()).toBe(false);
    store.clock = () => new Date('2026-10-17T00:00:00Z');
    expect(await gate.beforeAttempt()).toBe(true);
  });
});
