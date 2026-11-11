import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateFxHealth } from '../../src/ingestion/quality/fxHealth.js';
import { loadFxHealthInput } from '../../src/jobs/reportFxHealth.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * report:fx-health の読み取り(ingestion_logs・api_credit_usage・api_credit_limits・fx_prices)を本物の DB で確かめる
 * (HQ指示 2026-11-11)。2099-01-07(水)の記録だけを使い(ほかのテストの期間に入らない)、終わったら消す。
 */
describe.skipIf(!integration)('report:fx-health reads the real tables', () => {
  let ctx: IntegrationContext;
  const day = '2099-01-07';
  const t = (hhmm: string) => `${day}T${hhmm}:00.000Z`;

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const log = (startedAt: string, status: string, githubRunId: string, unrecovered = 0) => ({
      provider: 'twelvedata',
      data_type: 'FX_PRICE',
      job: 'ingest:fx-prices',
      started_at: startedAt,
      completed_at: startedAt,
      status,
      details: { github_run_id: githubRunId, unrecovered_total: unrecovered, api_requests: 9 },
    });
    const { error } = await ctx.serviceClient.from('ingestion_logs').insert([
      log(t('08:13'), 'SUCCESS', '9001'),
      log(t('08:33'), 'SUCCESS', '9001'),
      log(t('08:53'), 'FAILURE', '9001'),
      // 194 分の空白(定時起動の取りこぼし)
      log(t('12:07'), 'SUCCESS', '9002', 2),
    ]);
    if (error) throw error;
    const credits = await ctx.serviceClient.from('api_credit_usage').insert([
      {
        provider: 'twelvedata',
        usage_date: day,
        job: 'ingest:fx-prices',
        run_id: '9001:a',
        mode: 'AUTOMATIC',
        credits: 600,
        cap: 700,
      },
      {
        provider: 'twelvedata',
        usage_date: day,
        job: 'ingest:fx-prices',
        run_id: 'm:b',
        mode: 'MANUAL',
        credits: 60,
        cap: 800,
      },
    ]);
    if (credits.error) throw credits.error;
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('ingestion_logs').delete().eq('job', 'ingest:fx-prices').gte('started_at', t('00:00'));
    await ctx.serviceClient.from('api_credit_usage').delete().eq('usage_date', day);
    await ctx.app.close();
  });

  it('loads runs (with github_run_id / unrecovered), today credits by mode and the caps, then evaluates', async () => {
    const now = new Date(t('12:20'));
    const input = await loadFxHealthInput(ctx.serviceClient, now, 24);
    expect(input.runs.map((r) => [r.started_at, r.status, r.github_run_id, r.unrecovered_total])).toEqual([
      [t('08:13'), 'SUCCESS', '9001', 0],
      [t('08:33'), 'SUCCESS', '9001', 0],
      [t('08:53'), 'FAILURE', '9001', 0],
      [t('12:07'), 'SUCCESS', '9002', 2],
    ]);
    expect(input.credits).toEqual({ automatic: 600, manual: 60, total: 660 });
    expect(input.caps).toEqual({ automatic: 700, total: 800 }); // api_credit_limits の値
    expect(input.unverifiedCandles).toBe(0);

    const report = evaluateFxHealth(input, now);
    expect(report.level).toBe('ALERT');
    expect(report.findings.map((f) => f.check).sort()).toEqual(['CREDITS', 'FAILURES', 'RUN_GAP', 'UNRECOVERED']);
    expect(report.findings.find((f) => f.check === 'RUN_GAP')).toMatchObject({ level: 'ALERT' });
    expect(report.findings.find((f) => f.check === 'FAILURES')).toMatchObject({ level: 'WARN' }); // 次の実行で回復
    expect(report.findings.find((f) => f.check === 'CREDITS')).toMatchObject({ level: 'WARN' }); // 660/800 = 83%
  });

  it('only reads: the same call twice gives the same rows (nothing is written)', async () => {
    const now = new Date(t('12:20'));
    const a = await loadFxHealthInput(ctx.serviceClient, now, 24);
    const b = await loadFxHealthInput(ctx.serviceClient, now, 24);
    expect(b).toEqual(a);
  });
});
