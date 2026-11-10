/**
 * ONS・Statistics Canada の公式 API の値の読み取り(HQ指示 2026-11-10)。JSON は 2026-11-10 に API で確認した形を小さく
 * 写したもの。その回の公表日と API の公表日が一致したときだけ値を返し、それ以外は null(推測しない)。
 */
import { describe, expect, it } from 'vitest';
import {
  ONS_SERIES,
  parseOnsValueForRelease,
  parseStatcanValueForRelease,
  STATCAN_SERIES,
} from '../../src/ingestion/adapters/gbCaOfficialValues.js';

const CPI = ONS_SERIES.find((s) => s.indicatorCode === 'GB_CPI')!;
const onsBody = (overrides: Record<string, unknown> = {}) => ({
  description: {
    cdid: 'D7G7',
    title: 'CPI ANNUAL RATE 00: ALL ITEMS 2015=100',
    unit: '%',
    releaseDate: '2026-10-20T23:00:00.000Z',
  },
  months: [
    { date: '2026 AUG', value: '3.1', updateDate: '2026-09-15T23:00:00.000Z' },
    { date: '2026 SEP', value: '3.5', updateDate: '2026-10-20T23:00:00.000Z' },
  ],
  ...overrides,
});

describe('parseOnsValueForRelease', () => {
  it('returns the latest month when the series was released on that day (London date; 23:00Z = 00:00 BST next day)', () => {
    expect(parseOnsValueForRelease(CPI, onsBody(), '2026-10-21')).toEqual({
      indicatorCode: 'GB_CPI',
      seriesId: 'D7G7',
      period: '2026-09',
      value: 3.5,
      releasedOn: '2026-10-21',
      sourceUrl: 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data',
    });
  });

  it('returns null before the release (the API still shows the previous release) — never the old value as the new one', () => {
    expect(parseOnsValueForRelease(CPI, onsBody(), '2026-11-18')).toBeNull();
  });

  it('returns null for another series, a blank or non-numeric value, or a last row not updated on the release day', () => {
    expect(
      parseOnsValueForRelease(
        CPI,
        onsBody({ description: { cdid: 'DKO8', releaseDate: '2026-10-20T23:00:00.000Z' } }),
        '2026-10-21',
      ),
    ).toBeNull();
    const months = (value: string, updateDate = '2026-10-20T23:00:00.000Z') => ({
      months: [{ date: '2026 SEP', value, updateDate }],
    });
    expect(parseOnsValueForRelease(CPI, onsBody(months('')), '2026-10-21')).toBeNull();
    expect(parseOnsValueForRelease(CPI, onsBody(months('n/a')), '2026-10-21')).toBeNull();
    expect(parseOnsValueForRelease(CPI, onsBody(months('3.5', '2026-09-15T23:00:00.000Z')), '2026-10-21')).toBeNull();
    expect(parseOnsValueForRelease(CPI, { unexpected: true }, '2026-10-21')).toBeNull();
  });
});

describe('parseStatcanValueForRelease', () => {
  const LFS = STATCAN_SERIES[0]!;
  const body = (releaseTime: string, value: number | null = 6.9, status = 'SUCCESS') => [
    {
      status,
      object: {
        vectorId: 2062815,
        vectorDataPoint: [
          { refPer: '2026-09-01', value: 7.1, releaseTime: '2026-10-09T08:30' },
          { refPer: '2026-10-01', value, releaseTime },
        ],
      },
    },
  ];

  it('returns the latest point when its releaseTime is on the release day (Eastern date)', () => {
    expect(parseStatcanValueForRelease(LFS, body('2026-11-06T08:30'), '2026-11-06')).toEqual({
      indicatorCode: 'CA_UNEMPLOYMENT_RATE',
      seriesId: 'v2062815',
      period: '2026-10',
      value: 6.9,
      releasedOn: '2026-11-06',
      sourceUrl: 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods',
    });
  });

  it('returns null before the release, for a failed status, a missing value or another vector', () => {
    expect(parseStatcanValueForRelease(LFS, body('2026-11-06T08:30'), '2026-12-04')).toBeNull();
    expect(parseStatcanValueForRelease(LFS, body('2026-11-06T08:30', 6.9, 'FAILED'), '2026-11-06')).toBeNull();
    expect(parseStatcanValueForRelease(LFS, body('2026-11-06T08:30', null), '2026-11-06')).toBeNull();
    expect(parseStatcanValueForRelease({ ...LFS, vectorId: 1 }, body('2026-11-06T08:30'), '2026-11-06')).toBeNull();
    expect(parseStatcanValueForRelease(LFS, '<html>503</html>', '2026-11-06')).toBeNull();
  });
});
