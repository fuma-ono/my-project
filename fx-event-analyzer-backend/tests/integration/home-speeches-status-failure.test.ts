import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  grantEntitlement,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

// HQ承認(2026-10-23)「/home の鮮度情報の読み取り失敗」: ingestion_logs の読み取り
// (listSpeechIngestionRuns)だけを失敗させ、/home が 200 のまま speeches_status だけが
// { window_days: 7, last_success_at: null, stale: true } になり、events・major_fx・speeches が
// 変わらないことを確かめる。失敗させるかどうかは failRuns で切り替える(既定は本物を呼ぶ)。
const control = vi.hoisted(() => ({ failRuns: false }));

vi.mock('../../src/repositories/speechesRepository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repositories/speechesRepository.js')>();
  return {
    ...actual,
    listSpeechIngestionRuns: (...args: Parameters<typeof actual.listSpeechIngestionRuns>) =>
      control.failRuns
        ? Promise.reject(Object.assign(new Error('simulated ingestion_logs read failure'), { code: 'PGRST000' }))
        : actual.listSpeechIngestionRuns(...args),
  };
});

const integration = loadIntegrationEnv();

describe.skipIf(!integration)('GET /home when speeches_status cannot be read (v1.34)', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  let headers: { authorization: string };

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    user = await createTestUser(ctx);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    headers = { authorization: `Bearer ${user.accessToken}` };
  });

  afterAll(async () => {
    control.failRuns = false;
    await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  async function home() {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/home?date=2026-09-10&timezone=UTC',
      headers,
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  it('keeps /home 200 and returns stale with last_success_at null; events, major_fx and speeches are unchanged', async () => {
    const before = await home();
    expect(before.status).toBe(200);

    control.failRuns = true;
    const failed = await home();
    control.failRuns = false;
    const after = await home();

    expect(failed.status).toBe(200);
    expect(failed.body.speeches_status).toEqual({ window_days: 7, last_success_at: null, stale: true });
    expect(Object.keys(failed.body)).toEqual(Object.keys(before.body));
    expect(failed.body.date).toBe(before.body.date);
    expect(failed.body.timezone).toBe(before.body.timezone);
    expect(failed.body.events).toEqual(before.body.events);
    expect(failed.body.speeches).toEqual(before.body.speeches);
    // 為替は他の結合テストが並行して足す行で変わり得るので、前後どちらかの呼び出しと同じであること。
    const sameFx = [before.body.major_fx, after.body.major_fx].some(
      (fx) => JSON.stringify(fx) === JSON.stringify(failed.body.major_fx),
    );
    expect(sameFx).toBe(true);
    // 読めるようになれば、失敗の固定値ではなく実行記録からの判定に戻る(記録が無い DB なら同じ値になる)。
    expect(after.status).toBe(200);
    expect(after.body).toHaveProperty('speeches_status');
  });
});
