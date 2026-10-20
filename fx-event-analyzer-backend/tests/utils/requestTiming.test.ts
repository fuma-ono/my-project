import { describe, expect, it, vi } from 'vitest';
import { withTiming } from '../../src/utils/requestTiming.js';

describe('withTiming', () => {
  it('resolves with the wrapped function result, unchanged', async () => {
    await expect(withTiming('GET /home', () => Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it('propagates a rejection from the wrapped function unchanged, instead of swallowing it', async () => {
    const error = new Error('boom');
    await expect(withTiming('GET /home', () => Promise.reject(error))).rejects.toBe(error);
  });

  it('logs one line with the route name, a numeric duration, and process uptime — no request data', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await withTiming('GET /calendar', () => Promise.resolve('result'));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    expect(line).toContain('route=GET /calendar');
    expect(line).toMatch(/duration_ms=\d+/);
    expect(line).toMatch(/process_uptime_s=\d+\.\d/);
    logSpy.mockRestore();
  });

  it('still logs when the wrapped function throws (finally runs before the rejection propagates)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(withTiming('GET /speeches', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});
