import { describe, expect, it, vi } from 'vitest';
import {
  createTwelveDataProvider,
  fetchTwelveDataCandles,
  toTwelveDataSymbol,
  TwelveDataError,
} from '../../src/integrations/twelveDataProvider.js';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

const okBody = {
  status: 'ok',
  values: [
    { datetime: '2026-10-15 09:02:00', open: '154.71', high: '154.73', low: '154.70', close: '154.72', volume: '120' },
    { datetime: '2026-10-15 09:01:00', open: '154.70', high: '154.72', low: '154.69', close: '154.71', volume: '110' },
  ],
};

describe('toTwelveDataSymbol', () => {
  it('inserts a slash between the base and quote currency', () => {
    expect(toTwelveDataSymbol('USDJPY')).toBe('USD/JPY');
    expect(toTwelveDataSymbol('EURUSD')).toBe('EUR/USD');
  });

  it('rejects a symbol that is not exactly 6 uppercase letters', () => {
    expect(() => toTwelveDataSymbol('usdjpy')).toThrow(TwelveDataError);
    expect(() => toTwelveDataSymbol('USD/JPY')).toThrow(TwelveDataError);
    expect(() => toTwelveDataSymbol('USDJP')).toThrow(TwelveDataError);
  });
});

describe('fetchTwelveDataCandles', () => {
  it('resolves [] without calling fetch when no API key is configured', async () => {
    const fetch = fakeFetch(200, okBody);
    const result = await fetchTwelveDataCandles({ symbol: 'USDJPY', timeframe: '1m', outputsize: 30 }, { fetch });
    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests the right URL and normalizes candles oldest-first', async () => {
    const fetch = fakeFetch(200, okBody);
    const result = await fetchTwelveDataCandles(
      { symbol: 'USDJPY', timeframe: '1m', outputsize: 30 },
      { apiKey: 'test-key', fetch },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = fetch.mock.calls[0]!;
    const parsed = url as URL;
    expect(parsed.origin + parsed.pathname).toBe('https://api.twelvedata.com/time_series');
    expect(parsed.searchParams.get('symbol')).toBe('USD/JPY');
    expect(parsed.searchParams.get('interval')).toBe('1min');
    expect(parsed.searchParams.get('outputsize')).toBe('30');
    expect(parsed.searchParams.get('timezone')).toBe('UTC');
    expect(parsed.searchParams.get('apikey')).toBe('test-key');

    expect(result).toEqual([
      {
        timestamp: new Date('2026-10-15T09:01:00Z'),
        open: 154.7,
        high: 154.72,
        low: 154.69,
        close: 154.71,
        volume: 110,
      },
      {
        timestamp: new Date('2026-10-15T09:02:00Z'),
        open: 154.71,
        high: 154.73,
        low: 154.7,
        close: 154.72,
        volume: 120,
      },
    ]);
  });

  it('maps every db-design.md timeframe to its Twelve Data interval', async () => {
    const cases: [string, string][] = [
      ['1m', '1min'],
      ['5m', '5min'],
      ['15m', '15min'],
      ['30m', '30min'],
      ['60m', '1h'],
    ];
    for (const [timeframe, interval] of cases) {
      const fetch = fakeFetch(200, { status: 'ok', values: [] });
      await fetchTwelveDataCandles(
        { symbol: 'USDJPY', timeframe: timeframe as never, outputsize: 1 },
        { apiKey: 'k', fetch },
      );
      const [url] = fetch.mock.calls[0]!;
      expect((url as URL).searchParams.get('interval')).toBe(interval);
    }
  });

  it('throws TwelveDataError on a non-2xx response', async () => {
    const fetch = fakeFetch(429, { message: 'rate limit' });
    const result = fetchTwelveDataCandles(
      { symbol: 'USDJPY', timeframe: '1m', outputsize: 30 },
      { apiKey: 'k', fetch },
    );
    await expect(result).rejects.toBeInstanceOf(TwelveDataError);
  });

  it('throws TwelveDataError on a Twelve Data error body', async () => {
    const fetch = fakeFetch(200, { status: 'error', message: 'invalid API key' });
    const result = fetchTwelveDataCandles(
      { symbol: 'USDJPY', timeframe: '1m', outputsize: 30 },
      { apiKey: 'bad', fetch },
    );
    await expect(result).rejects.toThrow('invalid API key');
  });

  it('throws TwelveDataError on a malformed candle', async () => {
    const fetch = fakeFetch(200, { status: 'ok', values: [{ datetime: '2026-10-15 09:01:00', open: 'not-a-number' }] });
    const result = fetchTwelveDataCandles(
      { symbol: 'USDJPY', timeframe: '1m', outputsize: 30 },
      { apiKey: 'k', fetch },
    );
    await expect(result).rejects.toBeInstanceOf(TwelveDataError);
  });
});

describe('createTwelveDataProvider', () => {
  it('exposes the provider name and delegates fetchCandles', async () => {
    const fetch = fakeFetch(200, { status: 'ok', values: [] });
    const provider = createTwelveDataProvider({ apiKey: 'k', fetch });
    expect(provider.name).toBe('twelvedata');
    await expect(provider.fetchCandles({ symbol: 'USDJPY', timeframe: '1m', outputsize: 5 })).resolves.toEqual([]);
  });
});
