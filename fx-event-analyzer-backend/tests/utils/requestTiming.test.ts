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

  it('with a request logger: one structured line (same message text) with stage times — no request data', async () => {
    const info = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await withTiming(
      'GET /home',
      (mark) => {
        mark('events');
        mark('parallel');
        mark('major_fx');
        return Promise.resolve('ok');
      },
      { info },
    );
    expect(result).toBe('ok');
    expect(logSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const [fields, message] = info.mock.calls[0]! as [Record<string, unknown>, string];
    expect(message).toMatch(/^\[timing\] route=GET \/home duration_ms=\d+ process_uptime_s=\d+\.\d$/);
    expect(Object.keys(fields).sort()).toEqual(['duration_ms', 'event', 'process_uptime_s', 'route', 'stages_ms']);
    expect(fields).toMatchObject({ event: 'route_timing', route: 'GET /home' });
    expect(Object.keys(fields.stages_ms as object)).toEqual(['events', 'parallel', 'major_fx']);
    for (const value of Object.values(fields.stages_ms as Record<string, number>))
      expect(value).toBeGreaterThanOrEqual(0);
    logSpy.mockRestore();
  });

  it('with a request logger and no marks: no stages_ms field; still logs when the function throws', async () => {
    const info = vi.fn();
    await expect(withTiming('GET /home', () => Promise.reject(new Error('boom')), { info })).rejects.toThrow('boom');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).not.toHaveProperty('stages_ms');
  });
});
