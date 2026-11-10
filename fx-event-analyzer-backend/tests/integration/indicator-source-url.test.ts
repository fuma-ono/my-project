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
    race: `IT_SRCURL_RACE_${runId}`,
    dlBackfillFirst: `IT_SRCURL_DL1_${runId}`,
    dlRollbackFirst: `IT_SRCURL_DL2_${runId}`,
    filled: `IT_SRCURL_FILLED_${runId}`,
    touched: `IT_SRCURL_TOUCH_${runId}`,
  };
  const batch = `it-${runId}`;
  const raceBatch = `it-race-${runId}`;
  const dlBatch1 = `it-dl1-${runId}`;
  const dlBatch2 = `it-dl2-${runId}`;

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
      indicator(codes.race, null), // 同時更新のテスト用(別の batch)
      indicator(codes.dlBackfillFirst, null), // バックフィルとロールバックの同時実行(バックフィルが先)
      indicator(codes.dlRollbackFirst, null), // 同(ロールバックが先)
      indicator(codes.filled, 'https://example.org/manual'),
      indicator(codes.touched, null),
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient
      .from('indicator_source_url_backfills')
      .delete()
      .in('batch', [batch, raceBatch, dlBatch1, dlBatch2]);
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

  it('rollback locks the row (FOR UPDATE): a concurrent update waits for it and is not lost', async () => {
    const backfill = await ctx.serviceClient.rpc('backfill_indicator_source_urls', {
      p_batch: raceBatch,
      p_urls: [{ code: codes.race, source_url: 'https://example.org/race' }],
    });
    if (backfill.error) throw backfill.error;
    expect(backfill.data).toBe(1);

    // ロールバックは行をロックした後、比べる前に2秒待つ(検証用の p_hold_seconds)。その間に別の接続から同じ行を変える。
    // supabase-js の問い合わせは then されるまで送られないので、.then() で今すぐ送る
    const rollback = ctx.serviceClient
      .rpc('rollback_indicator_source_url_backfill', { p_batch: raceBatch, p_hold_seconds: 2 })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const startedAt = Date.now();
    const concurrent = await ctx.serviceClient
      .from('economic_indicators')
      .update({ source_url: 'https://example.org/concurrent' })
      .eq('code', codes.race);
    const waitedMs = Date.now() - startedAt;
    if (concurrent.error) throw concurrent.error;
    const result = await rollback;
    if (result.error) throw result.error;

    // ロールバックは、ロックを取った時点の値(backfill のまま)を比べて戻した
    expect(result.data).toEqual([{ code: codes.race, reverted: true, reason: null }]);
    // 同時の更新はロックが外れるまで待たされ、その後に適用された — 復元で上書きされて消えていない
    expect(waitedMs).toBeGreaterThanOrEqual(1_000);
    expect(await urlOf(codes.race)).toBe('https://example.org/concurrent');

    // 2回目のロールバックは、もう戻した行を対象にしない
    const again = await ctx.serviceClient.rpc('rollback_indicator_source_url_backfill', { p_batch: raceBatch });
    if (again.error) throw again.error;
    expect(again.data).toEqual([]);
  }, 20_000);

  it('p_hold_seconds outside 0..5 is rejected', async () => {
    const r = await ctx.serviceClient.rpc('rollback_indicator_source_url_backfill', {
      p_batch: raceBatch,
      p_hold_seconds: 6,
    });
    expect(r.error?.code).toBe('22023');
    const b = await ctx.serviceClient.rpc('backfill_indicator_source_urls', {
      p_batch: raceBatch,
      p_urls: [],
      p_hold_seconds: -1,
    });
    expect(b.error?.code).toBe('22023');
  });

  /** 指標の行と、その batch の記録を読む(整合の確認用)。 */
  const stateOf = async (code: string, b: string) => {
    const row = await ctx.serviceClient
      .from('economic_indicators')
      .select('source_url, updated_at')
      .eq('code', code)
      .single();
    if (row.error) throw row.error;
    const log = await ctx.serviceClient
      .from('indicator_source_url_backfills')
      .select('previous_source_url, applied_source_url, applied_updated_at, rolled_back_at')
      .eq('batch', b)
      .eq('code', code)
      .single();
    if (log.error) throw log.error;
    return { row: row.data, log: log.data };
  };
  const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

  it('backfill first, rollback concurrently (the order that could deadlock): no deadlock, consistent result', async () => {
    const code = codes.dlBackfillFirst;
    // 記録が残ったまま、人が source_url を空に戻した状態を作る(バックフィルがもう一度この行を埋め、記録を更新する)
    const first = await ctx.serviceClient.rpc('backfill_indicator_source_urls', {
      p_batch: dlBatch1,
      p_urls: [{ code, source_url: 'https://example.org/dl1-first' }],
    });
    if (first.error) throw first.error;
    const cleared = await ctx.serviceClient.from('economic_indicators').update({ source_url: null }).eq('code', code);
    if (cleared.error) throw cleared.error;

    // バックフィル: 指標の行をロックして変えた後、記録の前に2秒待つ。その間にロールバックを始める。
    // アドバイザリーロックが無ければ、ロールバックが記録の行をロックして指標の行を待ち、バックフィルが記録の行を待って
    // デッドロック(40P01)になる順。
    const backfill = ctx.serviceClient
      .rpc('backfill_indicator_source_urls', {
        p_batch: dlBatch1,
        p_urls: [{ code, source_url: 'https://example.org/dl1-second' }],
        p_hold_seconds: 2,
      })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const startedAt = Date.now();
    const rollback = await ctx.serviceClient.rpc('rollback_indicator_source_url_backfill', { p_batch: dlBatch1 });
    const rollbackWaitedMs = Date.now() - startedAt;
    const backfillResult = await backfill;

    expect(backfillResult.error).toBeNull(); // デッドロックで打ち切られていない
    expect(rollback.error).toBeNull();
    expect(backfillResult.data).toBe(1);
    expect(rollbackWaitedMs).toBeGreaterThanOrEqual(1_000); // ロールバックはバックフィルが終わるまで待った
    // ロールバックはバックフィルの後に動き、バックフィルが入れた値のまま(updated_at も同じ)なので戻した
    expect(rollback.data).toEqual([{ code, reverted: true, reason: null }]);

    const { row, log } = await stateOf(code, dlBatch1);
    expect(row.source_url).toBeNull(); // バックフィルの前の値(null)に戻った
    expect(log).toMatchObject({ previous_source_url: null, applied_source_url: 'https://example.org/dl1-second' });
    expect(log.rolled_back_at).not.toBeNull();
  }, 20_000);

  it('rollback first, backfill concurrently: no deadlock, consistent result', async () => {
    const code = codes.dlRollbackFirst;
    const first = await ctx.serviceClient.rpc('backfill_indicator_source_urls', {
      p_batch: dlBatch2,
      p_urls: [{ code, source_url: 'https://example.org/dl2-first' }],
    });
    if (first.error) throw first.error;

    // ロールバック: 記録と指標の行をロックした後、比べる前に2秒待つ。その間にバックフィルを始める。
    const rollback = ctx.serviceClient
      .rpc('rollback_indicator_source_url_backfill', { p_batch: dlBatch2, p_hold_seconds: 2 })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const startedAt = Date.now();
    const backfill = await ctx.serviceClient.rpc('backfill_indicator_source_urls', {
      p_batch: dlBatch2,
      p_urls: [{ code, source_url: 'https://example.org/dl2-second' }],
    });
    const backfillWaitedMs = Date.now() - startedAt;
    const rollbackResult = await rollback;

    expect(rollbackResult.error).toBeNull();
    expect(backfill.error).toBeNull();
    expect(backfillWaitedMs).toBeGreaterThanOrEqual(1_000); // バックフィルはロールバックが終わるまで待った
    expect(rollbackResult.data).toEqual([{ code, reverted: true, reason: null }]); // 先にロールバック(null に戻す)
    expect(backfill.data).toBe(1); // その後、空になった行を埋めた

    const { row, log } = await stateOf(code, dlBatch2);
    expect(row.source_url).toBe('https://example.org/dl2-second');
    // 記録は最後のバックフィルのもの: 変更前 null、入れた値・updated_at が今の行と一致、ロールバック済みの印は消えている
    expect(log).toMatchObject({
      previous_source_url: null,
      applied_source_url: 'https://example.org/dl2-second',
      rolled_back_at: null,
    });
    expect(sameInstant(log.applied_updated_at, row.updated_at)).toBe(true);
  }, 20_000);

  it('anon / authenticated cannot read the backfill log or call the functions', async () => {
    const anon = createClient(integration!.env.SUPABASE_URL, integration!.anonKey, { auth: { persistSession: false } });
    expect((await anon.from('indicator_source_url_backfills').select('code').limit(1)).error?.code).toBe('42501');
    const call = await anon.rpc('backfill_indicator_source_urls', { p_batch: batch, p_urls: [] });
    expect(call.error).not.toBeNull();
    const rb = await anon.rpc('rollback_indicator_source_url_backfill', { p_batch: batch });
    expect(rb.error).not.toBeNull();
  });
});
