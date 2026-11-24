import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { isPriceFeaturesEnabled, runIfPriceFeaturesEnabled } from '../../src/config/priceFeatures.js';

const required = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' };

describe('PRICE_FEATURES_ENABLED (オーナー決定 2026-11-24)', () => {
  it("is enabled only by the exact string 'true'; unset / empty / anything else is disabled", () => {
    expect(isPriceFeaturesEnabled({ PRICE_FEATURES_ENABLED: 'true' })).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true']) {
      expect(isPriceFeaturesEnabled({ PRICE_FEATURES_ENABLED: value }), String(value)).toBe(false);
    }
    expect(isPriceFeaturesEnabled({})).toBe(false);
  });

  it('loadEnv defaults to false and reads true', () => {
    expect(loadEnv(required).PRICE_FEATURES_ENABLED).toBe(false);
    expect(loadEnv({ ...required, PRICE_FEATURES_ENABLED: 'true' }).PRICE_FEATURES_ENABLED).toBe(true);
    expect(loadEnv({ ...required, PRICE_FEATURES_ENABLED: 'false' }).PRICE_FEATURES_ENABLED).toBe(false);
    expect(loadEnv({ ...required, PRICE_FEATURES_ENABLED: '' }).PRICE_FEATURES_ENABLED).toBe(false);
    expect(loadEnv(required).PURCHASES_ENABLED).toBe(false);
    expect(loadEnv({ ...required, PURCHASES_ENABLED: 'true' }).PURCHASES_ENABLED).toBe(true);
    expect(loadEnv({ ...required, PURCHASES_ENABLED: '1' }).PURCHASES_ENABLED).toBe(false);
  });

  it('runIfPriceFeaturesEnabled logs price_features_disabled and returns false when off; silent and true when on', () => {
    const lines: string[] = [];
    expect(runIfPriceFeaturesEnabled('ingest:fx-prices', {}, (line) => lines.push(line))).toBe(false);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { job: 'ingest:fx-prices', skipped: 'price_features_disabled' },
    ]);

    const quiet: string[] = [];
    expect(
      runIfPriceFeaturesEnabled('ingest:fx-prices', { PRICE_FEATURES_ENABLED: 'true' }, (l) => quiet.push(l)),
    ).toBe(true);
    expect(quiet).toEqual([]);
  });
});

/**
 * 実際のジョブを、PRICE_FEATURES_ENABLED 無し・SUPABASE_* 無し・API キー無しで起動する。DB にも外部にも
 * 接続できない環境で exit 0 かつ price_features_disabled を出す = 何も取得・書き込みをせずに止まる証拠
 * (Actions のジョブにはこの変数が無いので、未設定 = 停止)。
 */
describe('price jobs stop when the flag is off (unset)', () => {
  const root = join(__dirname, '..', '..');
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  it.each([
    ['src/jobs/ingestFxPrices.ts', 'ingest:fx-prices'],
    ['src/jobs/ingestEventReactions.ts', 'ingest:event-reactions'],
    ['src/jobs/evaluateRateAlerts.ts', 'evaluate-rate-alerts'],
  ])('%s exits 0 with skipped=price_features_disabled', (file, job) => {
    const output = execFileSync(process.execPath, [tsx, join(root, file)], {
      cwd: join(root, 'tests'), // .env を読ませない
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const line = output
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('{'));
    expect(JSON.parse(line!)).toEqual({ job, skipped: 'price_features_disabled' });
  });
});
