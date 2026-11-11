/**
 * HQ指示(2026-11-11「JP_CPI: appId 登録後すぐ接続できる状態に」): e-Stat API 3.0 の部品。応答の形は e-Stat の API 仕様
 * (3.0)の JSON の形に合わせた作りの例(本物の応答は appId を取ってから確かめる)。
 */
import { describe, expect, it } from 'vitest';
import {
  ESTAT_CPI_2025_STATS_DATA_ID,
  estatMonthCode,
  metaInfoUrl,
  parseJpCpiYoY,
  redactAppId,
  resolveJpCpiDimensions,
  statsDataUrl,
} from '../../src/ingestion/adapters/estatCpi.js';

const META = {
  GET_META_INFO: {
    RESULT: { STATUS: 0 },
    METADATA_INF: {
      CLASS_INF: {
        CLASS_OBJ: [
          {
            '@id': 'tab',
            '@name': '表章項目',
            CLASS: [
              { '@code': '1', '@name': '指数' },
              { '@code': '3', '@name': '前年同月比' },
            ],
          },
          {
            '@id': 'cat01',
            '@name': '品目',
            CLASS: [
              { '@code': '0001', '@name': '総合' },
              { '@code': '0161', '@name': '生鮮食品を除く総合' },
            ],
          },
          {
            '@id': 'area',
            '@name': '地域',
            CLASS: [
              { '@code': '00000', '@name': '全国' },
              { '@code': '13100', '@name': '東京都区部' },
            ],
          },
          { '@id': 'time', '@name': '時間軸', CLASS: { '@code': '2026001010', '@name': '2026年10月' } },
        ],
      },
    },
  },
};

const dims = resolveJpCpiDimensions(META)!;

const data = (values: Record<string, string>[]) => ({
  GET_STATS_DATA: { RESULT: { STATUS: 0 }, STATISTICAL_DATA: { DATA_INF: { VALUE: values } } },
});
const v = (overrides: Record<string, string>) => ({
  '@tab': '3',
  '@cat01': '0001',
  '@area': '00000',
  '@time': '2026001010',
  '@unit': '%',
  $: '2.9',
  ...overrides,
});

describe('e-Stat CPI (2025 base)', () => {
  it('uses the 2025-base table and the time code format', () => {
    expect(ESTAT_CPI_2025_STATS_DATA_ID).toBe('0004052037');
    expect(estatMonthCode('2026-10')).toBe('2026001010');
    expect(estatMonthCode('2026-1')).toBeNull();
  });

  it('finds the classes by code and name, not by a fixed parameter name', () => {
    expect(dims).toEqual({
      tab: { param: 'cdTab', objId: 'tab', code: '3' },
      area: { param: 'cdArea', objId: 'area', code: '00000' },
      item: { param: 'cdCat01', objId: 'cat01', code: '0001' },
      time: { param: 'cdTime', objId: 'time' },
    });
    // 名前が違う(code だけ合う)なら使わない
    const renamed = JSON.parse(JSON.stringify(META)) as typeof META;
    renamed.GET_META_INFO.METADATA_INF.CLASS_INF.CLASS_OBJ[1]!.CLASS = [{ '@code': '0001', '@name': '食料' }] as never;
    expect(resolveJpCpiDimensions(renamed)).toBeNull();
    expect(resolveJpCpiDimensions({})).toBeNull();
  });

  it('builds one-value URLs and never leaks the appId through redactAppId', () => {
    const url = statsDataUrl('SECRET123', dims, '2026-10')!;
    expect(url).toContain('statsDataId=0004052037');
    expect(url).toContain('cdTab=3');
    expect(url).toContain('cdArea=00000');
    expect(url).toContain('cdCat01=0001');
    expect(url).toContain('cdTime=2026001010');
    expect(redactAppId(url)).not.toContain('SECRET123');
    expect(redactAppId(metaInfoUrl('SECRET123'))).toBe(
      'https://api.e-stat.go.jp/rest/3.0/app/json/getMetaInfo?appId=***&statsDataId=0004052037',
    );
  });

  it('reads exactly the national all-items YoY of that month', () => {
    const body = data([
      v({}),
      v({ '@cat01': '0161', $: '3.0' }),
      v({ '@area': '13100', $: '2.5' }),
      v({ '@tab': '1', $: '101.2' }),
    ]);
    expect(parseJpCpiYoY(body, dims, '2026-10')).toBe(2.9);
    expect(parseJpCpiYoY(body, dims, '2026-09')).toBeNull();
  });

  it('no value for non-numeric marks, duplicates or an error status (never made up)', () => {
    expect(parseJpCpiYoY(data([v({ $: '-' })]), dims, '2026-10')).toBeNull();
    expect(parseJpCpiYoY(data([v({ $: '***' })]), dims, '2026-10')).toBeNull();
    expect(parseJpCpiYoY(data([v({}), v({})]), dims, '2026-10')).toBeNull();
    expect(parseJpCpiYoY({ GET_STATS_DATA: { RESULT: { STATUS: 100 } } }, dims, '2026-10')).toBeNull();
    expect(parseJpCpiYoY(data([v({ $: '-0.4' })]), dims, '2026-10')).toBe(-0.4);
  });
});
