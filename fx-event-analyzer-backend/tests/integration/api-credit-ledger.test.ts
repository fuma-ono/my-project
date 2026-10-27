import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * API クレジット予約台帳(migration 20261016000003、HQ判断 2026-10-16)を本物の Postgres で確かめる:
 * 上限は DB の api_credit_limits が決める(呼び出し側は自動/手動だけを渡す)、全モードの合計で判定する、
 * 同時に予約しても上限を超えない、上限の無い取得元は予約できない、利用者のロールからは呼べない。
 * 取得元の名前は実行ごとに変える(本物の 'twelvedata' の行には触らない)。
 */
describe.skipIf(!integration)('API credit ledger (reserve_api_credits)', () => {
  let ctx: IntegrationContext;
  const provider = `it-credit-${Date.now()}`;

  const reserve = (mode: 'AUTOMATIC' | 'MANUAL', runId: string) =>
    createIngestionRepository(ctx.serviceClient).reserveApiCredits({
      provider,
      job: 'integration-test',
      runId,
      credits: 1,
      mode,
    });

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    // 合計 8 / 自動 7(本番の 800 / 700 を 1/100 にしたもの)。
    const { error } = await ctx.serviceClient
      .from('api_credit_limits')
      .insert({ provider, daily_total_cap: 8, automatic_cap: 7 });
    if (error) throw error;
  });

  afterAll(async () => {
    await ctx.serviceClient.from('api_credit_usage').delete().eq('provider', provider);
    await ctx.serviceClient.from('api_credit_limits').delete().eq('provider', provider);
    await ctx.app.close();
  });

  it('applies the DB limits: total of all modes ≤ 8, automatic only while the total < 7, under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => reserve(i % 2 === 0 ? 'AUTOMATIC' : 'MANUAL', `r${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(8);
    const { data, error } = await ctx.serviceClient
      .from('api_credit_usage')
      .select('mode, credits, cap')
      .eq('provider', provider)
      .order('id', { ascending: true });
    if (error) throw error;
    const rows = data as { mode: string; credits: number; cap: number }[];
    expect(rows.reduce((n, r) => n + r.credits, 0)).toBe(8);
    let total = 0;
    for (const row of rows) {
      if (row.mode === 'AUTOMATIC') {
        expect(row.cap).toBe(7);
        expect(total + row.credits).toBeLessThanOrEqual(7);
      } else {
        expect(row.cap).toBe(8);
      }
      total += row.credits;
    }
    expect(await reserve('MANUAL', 'after')).toBe(false);
    expect(await reserve('AUTOMATIC', 'after')).toBe(false);
    const used = await createIngestionRepository(ctx.serviceClient).todayApiCredits(provider);
    expect(used).toBe(8);
  });

  it('refuses a provider without a configured limit and an invalid mode', async () => {
    await expect(
      createIngestionRepository(ctx.serviceClient).reserveApiCredits({
        provider: `${provider}-none`,
        job: 'integration-test',
        runId: 'x',
        credits: 1,
        mode: 'MANUAL',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('no credit limit configured') });
    const { error } = await ctx.serviceClient.rpc('reserve_api_credits', {
      p_provider: provider,
      p_job: 'integration-test',
      p_run_id: 'x',
      p_credits: 1,
      p_mode: 'BOTH',
    });
    expect(error?.message).toContain('p_mode must be AUTOMATIC or MANUAL');
  });

  it('cannot be called or read by app users (anon key)', async () => {
    const anon = createClient(ctx.supabaseUrl, ctx.anonKey);
    const { error } = await anon.rpc('reserve_api_credits', {
      p_provider: provider,
      p_job: 'x',
      p_run_id: 'x',
      p_credits: 1,
      p_mode: 'MANUAL',
    });
    expect(error).not.toBeNull();
    const { data } = await anon.from('api_credit_usage').select('id').eq('provider', provider);
    expect(data ?? []).toEqual([]);
  });

  it('ships the Twelve Data limits 800 / 700', async () => {
    const { data, error } = await ctx.serviceClient
      .from('api_credit_limits')
      .select('daily_total_cap, automatic_cap')
      .eq('provider', 'twelvedata')
      .single();
    if (error) throw error;
    expect(data).toEqual({ daily_total_cap: 800, automatic_cap: 700 });
  });

  // HQ指示 2026-10-27「BLS定時実行」(migration 20261027000002): BLS v1 の 25/日に1残す。定期は1日2回(8×2)まで。
  it('ships the BLS limits 24 / 16', async () => {
    const { data, error } = await ctx.serviceClient
      .from('api_credit_limits')
      .select('daily_total_cap, automatic_cap')
      .eq('provider', 'bls')
      .single();
    if (error) throw error;
    expect(data).toEqual({ daily_total_cap: 24, automatic_cap: 16 });
  });
});
