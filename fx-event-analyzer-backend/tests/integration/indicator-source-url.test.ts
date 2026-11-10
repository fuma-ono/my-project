import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * migration 20261110000004(と seed.sql の同じ update): 最初の5指標の source_url(HQ指示 2026-11-10「データ品質監査」)。
 * DEV の監査 SQL ②の「5b 指標の出典なし」と同じ条件で、有効な指標に出典名・出典 URL の欠けが無いことも確かめる。
 */
describe.skipIf(!integration)('economic_indicators.source_url for the first five indicators', () => {
  let ctx: IntegrationContext;

  beforeAll(() => {
    ctx = buildIntegrationContext(integration!);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('the five indicators have their official page as source_url', async () => {
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .select('code, source, source_url')
      .in('code', ['US_CPI', 'US_NFP', 'US_FOMC', 'JP_CPI', 'BOJ_RATE'])
      .order('code');
    if (error) throw error;
    expect(data).toEqual([
      { code: 'BOJ_RATE', source: 'Bank of Japan', source_url: 'https://www.boj.or.jp/mopo/mpmdeci/index.htm' },
      { code: 'JP_CPI', source: 'Statistics Bureau of Japan', source_url: 'https://www.stat.go.jp/data/cpi/' },
      {
        code: 'US_CPI',
        source: 'U.S. Bureau of Labor Statistics',
        source_url: 'https://www.bls.gov/cpi/',
      },
      {
        code: 'US_FOMC',
        source: 'Federal Reserve',
        source_url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
      },
      { code: 'US_NFP', source: 'U.S. Bureau of Labor Statistics', source_url: 'https://www.bls.gov/ces/' },
    ]);
  });

  it('no active indicator is left without a source name or a source URL (audit check 5b)', async () => {
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .select('code, source, source_url')
      .eq('is_active', true);
    if (error) throw error;
    const missing = (data ?? []).filter(
      (r: { source: string | null; source_url: string | null }) => !r.source?.trim() || !r.source_url?.trim(),
    );
    expect(missing).toEqual([]);
  });
});
