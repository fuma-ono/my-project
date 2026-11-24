/**
 * 設計書 ca-cpi-detailed-design.md §15.2(L1〜L9)・§16.7(V1〜V8)・第1段階 G7 / G10。
 * 初回値の受付期間 firstValueWindow(公表日から Toronto の暦日で7日)と、設定漏れの起動時検出。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CA_FIRST_VALUE_WINDOW,
  FIRST_VALUE_WINDOW_EXEMPT,
  FirstValueWindowError,
  isFirstValueWindowExpired,
  localDaysAfter,
  validateFirstValueWindows,
} from '../../src/ingestion/firstValueWindow.js';
import {
  CA_CORE_SOURCES,
  validateCaCoreSources,
  type CaCoreSource,
} from '../../src/ingestion/pipelines/caCoreCpiValues.js';
import { OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';

const D = new Date('2026-11-16T13:30:00Z'); // 公表日 D = 2026-11-16 08:30 ET
const expired = (now: string, release = D) => isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, release, new Date(now));

describe('受付期間(Toronto の暦日。L1〜L9)', () => {
  it('L1 D 08:31 は受け付ける', () => expect(expired('2026-11-16T13:31:00Z')).toBe(false));
  it('L2 D+7 23:59:59(11/23 Toronto)は受け付ける', () => {
    expect(localDaysAfter(D, new Date('2026-11-24T04:59:59Z'), 'America/Toronto')).toBe(7);
    expect(expired('2026-11-24T04:59:59Z')).toBe(false);
  });
  it('L3 D+8 00:00:00(11/24 Toronto)は受け付けない', () => expect(expired('2026-11-24T05:00:00Z')).toBe(true));
  it('L4 UTC では D+8 でも Toronto では D+7(11/23 20:00 Toronto = 11/24 01:00Z)なら受け付ける', () =>
    expect(expired('2026-11-24T01:00:00Z')).toBe(false));
  it('L5 Toronto 11/24 00:30(= 05:30Z)は受け付けない', () => expect(expired('2026-11-24T05:30:00Z')).toBe(true));
  it('L6 夏時間の開始(2027-03-14)をまたぐ: 暦日方式は 3/17 23:59 を受け付け、経過時間方式は 1 時間ずれる入力でも判定が変わらない', () => {
    const release = new Date('2027-03-10T13:30:00Z'); // EST 08:30
    const now = new Date('2027-03-18T03:59:00Z'); // 3/17 23:59 EDT(経過 6 日と 14 時間 29 分)
    expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, release, now)).toBe(false);
    expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, release, new Date('2027-03-18T04:00:00Z'))).toBe(true);
    // 公表 08:30 + 7 日 = 3/17 08:30 EDT = 12:30Z。ミリ秒方式なら 3/17 午後は期限切れだが、暦日方式は 23:59 まで受け付ける
    expect(isFirstValueWindowExpired({ days: 7, basis: 'ELAPSED' }, release, new Date('2027-03-17T20:00:00Z'))).toBe(
      true,
    );
    expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, release, new Date('2027-03-17T20:00:00Z'))).toBe(false);
  });
  it('L7 夏時間の終了(2026-11-01)をまたいでも暦日の差は崩れない', () => {
    const release = new Date('2026-10-28T12:30:00Z'); // EDT 08:30
    expect(localDaysAfter(release, new Date('2026-11-04T04:59:59Z'), 'America/Toronto')).toBe(6);
    expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, release, new Date('2026-11-05T04:59:59Z'))).toBe(false); // D+7 23:59:59 EST
    expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, release, new Date('2026-11-05T05:00:00Z'))).toBe(true);
  });
  it('O9 5回の公表日の D+7 の暦日(夏時間・曜日に依存しない)', () => {
    const rows: [string, string, string][] = [
      ['2026-11-16T13:30:00Z', '2026-11-24T04:59:59Z', '2026-11-24T05:00:00Z'],
      ['2026-12-14T13:30:00Z', '2026-12-22T04:59:59Z', '2026-12-22T05:00:00Z'],
      ['2027-01-18T13:30:00Z', '2027-01-26T04:59:59Z', '2027-01-26T05:00:00Z'],
      ['2027-02-16T13:30:00Z', '2027-02-24T04:59:59Z', '2027-02-24T05:00:00Z'],
      ['2027-03-15T12:30:00Z', '2027-03-23T03:59:59Z', '2027-03-23T04:00:00Z'], // 夏時間
    ];
    for (const [release, last, first] of rows) {
      expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, new Date(release), new Date(last)), release).toBe(false);
      expect(isFirstValueWindowExpired(CA_FIRST_VALUE_WINDOW, new Date(release), new Date(first)), release).toBe(true);
    }
  });
  it('ELAPSED は既存の ABS の挙動(経過ミリ秒 > 7 日で期限切れ)を変えない', () => {
    const w = { days: 7, basis: 'ELAPSED' as const };
    expect(isFirstValueWindowExpired(w, D, new Date(D.getTime() + 7 * 86_400_000))).toBe(false);
    expect(isFirstValueWindowExpired(w, D, new Date(D.getTime() + 7 * 86_400_000 + 1))).toBe(true);
  });
});

describe('設定漏れの検出(V1〜V8・G7)と revisionMode(G10)', () => {
  it('V1 コア2指標の設定は { days: 7, basis: LOCAL_CALENDAR, timeZone: America/Toronto }', () => {
    expect(CA_CORE_SOURCES.map((s) => s.indicatorCode).sort()).toEqual(['CA_CPI_MEDIAN', 'CA_CPI_TRIM']);
    for (const s of CA_CORE_SOURCES) {
      expect(s.firstValueWindow).toEqual({ days: 7, basis: 'LOCAL_CALENDAR', timeZone: 'America/Toronto' });
    }
  });
  it('V2・V3 コアの設定を1つ削除すると、どれでも FIRST_VALUE_WINDOW_MISSING で止まる', () => {
    for (const target of CA_CORE_SOURCES) {
      const broken = CA_CORE_SOURCES.map((s): CaCoreSource =>
        s === target ? { ...s, firstValueWindow: undefined } : s,
      );
      expect(() => validateCaCoreSources(broken), target.indicatorCode).toThrow(/FIRST_VALUE_WINDOW_MISSING/);
    }
  });
  it('V4 免除リストにも設定にもない新しい系列は止まる', () => {
    expect(() => validateFirstValueWindows([{ indicatorCode: 'XX_NEW' }])).toThrow(FirstValueWindowError);
  });
  it('V5 LOCAL_CALENDAR で timeZone が無い・days が 0 / 負 / 小数なら例外', () => {
    const bad = [
      { days: 7, basis: 'LOCAL_CALENDAR' as const },
      { days: 0, basis: 'ELAPSED' as const },
      { days: -1, basis: 'ELAPSED' as const },
      { days: 1.5, basis: 'ELAPSED' as const },
      { days: 7, basis: 'LOCAL_CALENDAR' as const, timeZone: 'Not/AZone' },
    ];
    for (const w of bad) {
      expect(() => validateFirstValueWindows([{ indicatorCode: 'X', firstValueWindow: w }]), JSON.stringify(w)).toThrow(
        /FIRST_VALUE_WINDOW_INVALID/,
      );
    }
  });
  it('V6 旧称の設定名は、初回値の取り込みのコードに残っていない', () => {
    for (const file of [
      'src/ingestion/pipelines/officialValues.ts',
      'src/ingestion/pipelines/caCoreCpiValues.ts',
      'src/ingestion/firstValueWindow.ts',
      'src/ingestion/adapters/caCoreCpi.ts',
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/maxDaysAfterRelease|maxLocalDaysAfterRelease/);
    }
  });
  it('V7 ABS の3系列は { days: 7, basis: ELAPSED }(挙動不変)', () => {
    const abs = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode.startsWith('AU_'));
    expect(abs).toHaveLength(3);
    for (const s of abs) expect(s.firstValueWindow).toEqual({ days: 7, basis: 'ELAPSED' });
  });
  it('V8 免除リストは GB の5系列と CA_UNEMPLOYMENT_RATE だけ。既存の取得元はすべて免除か設定のどちらかを満たす', () => {
    expect([...FIRST_VALUE_WINDOW_EXEMPT].sort()).toEqual(
      [
        'CA_UNEMPLOYMENT_RATE',
        'GB_CORE_CPI',
        'GB_CPI',
        'GB_GDP_MOM',
        'GB_RETAIL_SALES_MOM',
        'GB_UNEMPLOYMENT_RATE',
      ].sort(),
    );
    expect(() => validateFirstValueWindows(OFFICIAL_VALUE_SOURCES)).not.toThrow();
  });
  it('G10 revisionMode は 2 系列とも DISABLED。他の値は、固定記録の保存先が無いので起動時に止まる', () => {
    expect(CA_CORE_SOURCES.every((s) => s.revisionMode === 'DISABLED')).toBe(true);
    const enabled = CA_CORE_SOURCES.map((s) => ({ ...s, revisionMode: 'REVISE' }) as unknown as CaCoreSource);
    expect(() => validateCaCoreSources(enabled)).toThrow(/REVISION_MODE_NOT_SUPPORTED_STAGE1/);
  });
});
