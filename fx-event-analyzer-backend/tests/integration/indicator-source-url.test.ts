import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * migration 20261110000004(と seed.sql の同じ呼び出し): 最初の5指標の source_url(HQ指示 2026-11-10「データ品質監査」、
 * HQ レビュー: 変更前の値の特定・migration 由来の値だけを戻す・既存の値を上書きしない)。
 * 上書き・戻しの確かめは、このテスト専用の指標(is_active = false)と専用の batch で行い、終わったら消す。
 */
describe.skipIf(!integration)('economic_indicators.source_url backfill (migration 20261110000004)', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}`;
  const codes = {
    empty: `IT_SRCURL_EMPTY_${runId}`,
    blank: `IT_SRCURL_BLANK_${runId}`,
    filled: `IT_SRCURL_FILLED_${runId}`,
    touched: `IT_SRCURL_TOUCH_${runId}`,
  };
  const batch = `it-${runId}`;

  const indicator = (code: string, source_url: string | null) => ({
    code,
    name: `結合テスト用指標(source_url) ${code}`,
    country_code: 'US',
    currency_code: 'USD',
    importance: 'LOW',
    frequency: 'MONTHLY',
    unit: '%',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    is_active: false,
    source_url,
  });
  const urlOf = async (code: string) => {
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .select('source_url')
      .eq('code', code)
      .single();
    if (error) throw error;
    return data.source_url;
  };

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { error } = await ctx.serviceClient.from('economic_indicators').insert([
      indicator(codes.empty, null),
      indicator(codes.blank, '   '), // 空白だけの文字列(null ではない)
      indicator(codes.filled, 'https://example.org/manual'),
      indicator(codes.touched, null),
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('indicator_source_url_backfills').delete().eq('batch', batch);
    await ctx.serviceClient.from('economic_indicators').delete().in('code', Object.values(codes));
    await ctx.app.close();
  });

  it('the five indicators have their official page, and the backfill recorded them with previous = null', async () => {
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .select('code, source_url')
      .in('code', ['US_CPI', 'US_NFP', 'US_FOMC', 'JP_CPI', 'BOJ_RATE'])
      .order('code');
    if (error) throw error;
    expect(data).toEqual([
      { code: 'BOJ_RATE', source_url: 'https://www.boj.or.jp/mopo/mpmdeci/index.htm' },
      { code: 'JP_CPI', source_url: 'https://www.stat.go.jp/data/cpi/' },
      { code: 'US_CPI', source_url: 'https://www.bls.gov/cpi/' },
      { code: 'US_FOMC', source_url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
      { code: 'US_NFP', source_url: 'https://www.bls.gov/ces/' },
    ]);
    const log = await ctx.serviceClient
      .from('indicator_source_url_backfills')
      .select('code, previous_source_url, applied_source_url, rolled_back_at')
      .eq('batch', '20261110000004')
      .order('code');
    if (log.error) throw log.error;
    expect(log.data?.map((r) => [r.code, r.previous_source_url, r.rolled_back_at])).toEqual([
      ['BOJ_RATE', null, null],
      ['JP_CPI', null, null],
      ['US_CPI', null, null],
      ['US_FOMC', null, null],
      ['US_NFP', null, null],
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

  it('fills NULL and blank values, never overwrites an existing URL, records the real previous value, re-run is a no-op', async () => {
    const urls = [
      { code: codes.empty, source_url: 'https://example.org/empty' },
      { code: codes.blank, source_url: 'https://example.org/blank' },
      { code: codes.filled, source_url: 'https://example.org/should-not-apply' },
      { code: codes.touched, source_url: 'https://example.org/touched' },
    ];
    const first = await ctx.serviceClient.rpc('backfill_indicator_source_urls', { p_batch: batch, p_urls: urls });
    if (first.error) throw first.error;
    expect(first.data).toBe(3); // empty・blank・touched(filled は既存の URL)
    expect(await urlOf(codes.filled)).toBe('https://example.org/manual'); // 既存の値はそのまま
    expect(await urlOf(codes.empty)).toBe('https://example.org/empty');
    expect(await urlOf(codes.blank)).toBe('https://example.org/blank');

    const again = await ctx.serviceClient.rpc('backfill_indicator_source_urls', { p_batch: batch, p_urls: urls });
    if (again.error) throw again.error;
    expect(again.data).toBe(0);

    const log = await ctx.serviceClient
      .from('indicator_source_url_backfills')
      .select('code, previous_source_url, applied_source_url')
      .eq('batch', batch)
      .order('code');
    if (log.error) throw log.error;
    expect(log.data).toEqual(
      [
        { code: codes.empty, previous_source_url: null, applied_source_url: 'https://example.org/empty' },
        { code: codes.blank, previous_source_url: '   ', applied_source_url: 'https://example.org/blank' }, // 実値のまま
        { code: codes.touched, previous_source_url: null, applied_source_url: 'https://example.org/touched' },
      ].sort((a, b) => a.code.localeCompare(b.code)),
    );
  });

  it('rollback reverts only rows still exactly as the backfill left them', async () => {
    // touched: 後から人がほかの列を直した(同じ URL のまま、updated_at が変わる)
    const touch = await ctx.serviceClient
      .from('economic_indicators')
      .update({ name: `結合テスト用指標(source_url) 手で直した ${runId}` })
      .eq('code', codes.touched);
    if (touch.error) throw touch.error;

    const rollback = await ctx.serviceClient.rpc('rollback_indicator_source_url_backfill', { p_batch: batch });
    if (rollback.error) throw rollback.error;
    const byCode = Object.fromEntries(
      (rollback.data as { code: string; reverted: boolean; reason: string | null }[]).map((r) => [r.code, r]),
    );
    expect(byCode[codes.empty]).toMatchObject({ reverted: true, reason: null });
    expect(byCode[codes.blank]).toMatchObject({ reverted: true, reason: null });
    expect(byCode[codes.touched]).toMatchObject({ reverted: false, reason: 'ROW_UPDATED_AFTER_BACKFILL' });
    expect(byCode[codes.filled]).toBeUndefined(); // migration が変えていない行は対象外

    expect(await urlOf(codes.empty)).toBeNull(); // 変更前(null)に戻った
    expect(await urlOf(codes.blank)).toBe('   '); // 変更前(空白の文字列)に、そのまま戻った
    expect(await urlOf(codes.touched)).toBe('https://example.org/touched'); // 人が触った行は残す
    expect(await urlOf(codes.filled)).toBe('https://example.org/manual');
  });

  it('anon / authenticated cannot read the backfill log or call the functions', async () => {
    const anon = createClient(integration!.env.SUPABASE_URL, integration!.anonKey, { auth: { persistSession: false } });
    expect((await anon.from('indicator_source_url_backfills').select('code').limit(1)).error?.code).toBe('42501');
    const call = await anon.rpc('backfill_indicator_source_urls', { p_batch: batch, p_urls: [] });
    expect(call.error).not.toBeNull();
    const rb = await anon.rpc('rollback_indicator_source_url_backfill', { p_batch: batch });
    expect(rb.error).not.toBeNull();
  });
});
