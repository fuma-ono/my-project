import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLS_ATTRIBUTION } from '../../src/domain/attribution.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

const BLS_DISCLAIMER =
  'BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.';

/**
 * HQ決定(2026-11-10「取得日の表示 案a」・「出典対応」): FREE で値がロックされた BLS の発表でも、出典・免責文(全文)・
 * 取得日(captured_at)が返ることを、本物の Postgres で確かめる。指標は migration で入る US_JOLTS(ほかの結合テストが
 * 使っていない)。発表は 1990 年代(どのテストでも「直近の発表」にならず、FREE では一番古い発表が必ずロックされる)。
 * RELEASE の snapshot は消せないので、行は残る(CI は毎回 DB を作り直す)。
 */
describe.skipIf(!integration)('BLS attribution and retrieval date for FREE (locked releases)', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;
  let joltsId = '';
  const releases = [0, 1, 2, 3].map((n) => ({
    id: randomUUID(),
    at: `199${n}-03-10T15:00:00.000Z`,
    capturedAt: `199${n}-03-10T15:05:00.000Z`,
    actual: 7000 + n,
  }));
  const oldest = releases[0]!;

  async function freeHeaders() {
    const user = await createTestUser(ctx);
    users.push(user);
    return { authorization: `Bearer ${user.accessToken}` };
  }
  async function get(url: string, headers: { authorization: string }) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .select('id')
      .eq('code', 'US_JOLTS')
      .single();
    if (error) throw error;
    joltsId = data.id;
    const { error: eventError } = await ctx.serviceClient.from('economic_events').insert(
      releases.map((r) => ({
        id: r.id,
        indicator_id: joltsId,
        provider: 'integration-test',
        provider_event_id: `bls-attr-${runId}-${r.id}`,
        release_datetime: r.at,
        release_datetime_precision: 'EXACT',
        importance: 'MEDIUM',
        status: 'RELEASED',
        data_status: 'AVAILABLE',
      })),
    );
    if (eventError) throw eventError;
    const { error: snapshotError } = await ctx.serviceClient.from('event_snapshots').insert(
      releases.map((r) => ({
        event_id: r.id,
        snapshot_type: 'RELEASE',
        forecast: r.actual - 10,
        actual: r.actual,
        previous: r.actual - 5,
        unit: '千件',
        source: 'integration-test',
        captured_at: r.capturedAt,
      })),
    );
    if (snapshotError) throw snapshotError;
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('GET /events/{id}: a locked BLS release still returns the BLS source, the full disclaimer and snapshot.captured_at', async () => {
    const { status, body } = await get(`/events/${oldest.id}`, await freeHeaders());
    expect(status).toBe(200);
    expect(body.event.locked).toBe(true);
    expect(body.event.attribution).toEqual(BLS_ATTRIBUTION);
    expect(body.event.attribution.notice).toContain(BLS_DISCLAIMER); // 全文(短くしない)
    expect(Date.parse(body.snapshot.captured_at)).toBe(Date.parse(oldest.capturedAt));
    // 値はロックされたまま(取得日・出典だけが見える)
    expect(body.snapshot.actual).toBeNull();
    expect(body.snapshot.forecast).toBeNull();
  });

  it('GET /indicators/{id}/events: each release row has captured_at, also when locked (values hidden)', async () => {
    const { status, body } = await get(
      `/indicators/${joltsId}/events?status=RELEASED&from=1990-01-01T00:00:00Z&to=1994-01-01T00:00:00Z&order=asc`,
      await freeHeaders(),
    );
    expect(status).toBe(200);
    const rows = body.data as { event_id: string; captured_at: string | null; actual: unknown; locked: boolean }[];
    const row = rows.find((r) => r.event_id === oldest.id);
    expect(row).toBeDefined();
    expect(row!.locked).toBe(true);
    expect(row!.actual).toBeNull();
    expect(Date.parse(row!.captured_at!)).toBe(Date.parse(oldest.capturedAt));
    for (const r of releases) {
      const found = rows.find((x) => x.event_id === r.id);
      expect(Date.parse(found!.captured_at!), r.id).toBe(Date.parse(r.capturedAt));
    }
  });

  it('GET /indicators/{id}: the indicator detail carries the BLS attribution for FREE', async () => {
    const { status, body } = await get(`/indicators/${joltsId}`, await freeHeaders());
    expect(status).toBe(200);
    expect(body.attribution).toEqual(BLS_ATTRIBUTION);
  });
});
