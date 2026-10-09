import { describe, expect, it } from 'vitest';
import { chartWindow } from '../../src/domain/chartWindow.js';

const release = '2026-10-09T12:30:00.000Z';

describe('chartWindow', () => {
  it('1m: 15 minutes either side of the release', () => {
    expect(chartWindow(release, '1m')).toEqual({ from: '2026-10-09T12:15:00.000Z', to: '2026-10-09T12:45:00.000Z' });
  });

  it('5m: 60 minutes either side', () => {
    expect(chartWindow(release, '5m')).toEqual({ from: '2026-10-09T11:30:00.000Z', to: '2026-10-09T13:30:00.000Z' });
  });

  it('15m: 3 hours either side', () => {
    expect(chartWindow(release, '15m')).toEqual({ from: '2026-10-09T09:30:00.000Z', to: '2026-10-09T15:30:00.000Z' });
  });

  it('other timeframes keep 30 minutes before and 60 after', () => {
    expect(chartWindow(release, '60m')).toEqual({ from: '2026-10-09T12:00:00.000Z', to: '2026-10-09T13:30:00.000Z' });
  });
});
