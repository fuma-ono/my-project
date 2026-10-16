import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { deleteAllExpiredInboxNotifications } from '../../src/repositories/notificationInboxRepository.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  grantEntitlement,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

// Seed fixtures (supabase/seed.sql).
const JP_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000004'; // display_name 消費者物価指数（CPI）, USDJPY/EURJPY
const POWELL_SPEAKER_ID = '40000000-0000-0000-0000-000000000001'; // USD

// Test-only events/speeches, relative to the real clock (the inbox only
// materializes notify_at <= now). JP_CPI / Powell (HIGH, USD) only, so the
// fixed-date assertions in speeches-notifications / calendar / plan-limits
// are unaffected. Removed in afterAll.
const RELEASED_EVENT_ID = '3b000000-0000-0000-0000-000000000001'; // released 60 min ago
const SOON_EVENT_ID = '3b000000-0000-0000-0000-000000000002'; // releases in 4 min → LEAD_5 notify_at (−1 min) passed
const FUTURE_EVENT_ID = '3b000000-0000-0000-0000-000000000003'; // releases in 3 h
const CANCELLED_EVENT_ID = '3b000000-0000-0000-0000-000000000004'; // was 30 min ago, CANCELLED
const DELIVERED_SPEECH_ID = '3b000000-0000-0000-0000-000000000005'; // 20 min ago, DELIVERED

const MINUTE_MS = 60_000;
const base = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const at = (minutes: number) => new Date(base + minutes * MINUTE_MS).toISOString();
const isoSeconds = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

interface InboxItem {
  id: string;
  kind: string;
  target_id: string;
  trigger: string;
  lead_minutes: number | null;
  title: string;
  body: string | null;
  display_name: string | null;
  speaker_name: string | null;
  country_code: string | null;
  importance: string | null;
  scheduled_at: string | null;
  notify_at: string;
  read_at: string | null;
  expires_at: string;
}

/** アプリ内の通知一覧 (api-design.md §24.9-§24.11, notification-inbox-spec.md §6). */
describe.skipIf(!integration)('Notification inbox', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];

  /**
   * PRO so the saved settings apply as stored. The settings row is inserted
   * directly with updated_at 2 hours ago — materialization never goes back
   * before the settings were saved, and an UPDATE would reset updated_at.
   */
  async function newUser(
    options: { entitled?: boolean; settings?: Record<string, unknown> } = {},
  ): Promise<{ user: TestUser; headers: { authorization: string } }> {
    const user = await createTestUser(ctx);
    users.push(user);
    const entitled = options.entitled ?? true;
    // VIEW_BASIC_EVENT is a default feature (default_entitlements, HQ 2026-10-16):
    // "not entitled" needs an explicit disabled row, not just no row.
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT, { enabled: entitled });
    if (entitled) await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    await saveSettings(user.id, options.settings ?? {});
    return { user, headers: { authorization: `Bearer ${user.accessToken}` } };
  }

  async function saveSettings(userId: string, settings: Record<string, unknown>): Promise<void> {
    await ctx.serviceClient.from('user_settings').delete().eq('user_id', userId);
    const { error } = await ctx.serviceClient
      .from('user_settings')
      .insert({ user_id: userId, created_at: at(-120), updated_at: at(-120), ...settings });
    if (error) throw new Error(`Failed to insert settings: ${error.message}`);
  }

  async function list(headers: { authorization: string }, query = '') {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/notifications${query}`, headers });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  async function post(headers: { authorization: string } | undefined, path: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/notifications${path}`,
      ...(headers ? { headers } : {}),
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  async function insertRow(userId: string, overrides: Record<string, unknown>): Promise<string> {
    const { data, error } = await ctx.serviceClient
      .from('notification_inbox')
      .insert({
        user_id: userId,
        kind: 'SYSTEM',
        target_id: 'welcome',
        trigger: 'WELCOME',
        title: 'ようこそ',
        notify_at: at(-60),
        expires_at: at(60 * 24),
        ...overrides,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert inbox row: ${error.message}`);
    return data.id as string;
  }

  async function rowsFor(userId: string) {
    const { data, error } = await ctx.serviceClient.from('notification_inbox').select('*').eq('user_id', userId);
    if (error) throw error;
    return data ?? [];
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const event = (id: string, minutes: number, status: string) => ({
      id,
      indicator_id: JP_CPI_INDICATOR_ID,
      provider: 'integration-test',
      provider_event_id: `inbox-${id}`,
      release_datetime: at(minutes),
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status,
    });
    const events = await ctx.serviceClient
      .from('economic_events')
      .insert([
        event(RELEASED_EVENT_ID, -60, 'RELEASED'),
        event(SOON_EVENT_ID, 4, 'SCHEDULED'),
        event(FUTURE_EVENT_ID, 180, 'SCHEDULED'),
        event(CANCELLED_EVENT_ID, -30, 'CANCELLED'),
      ]);
    if (events.error) throw new Error(`Failed to insert test events: ${events.error.message}`);

    const speech = await ctx.serviceClient.from('speech_events').insert({
      id: DELIVERED_SPEECH_ID,
      speaker_id: POWELL_SPEAKER_ID,
      provider: 'integration-test',
      provider_event_id: 'inbox-delivered',
      title: '受信箱テスト講演',
      statement_datetime: at(-20),
      importance: 'HIGH',
      status: 'DELIVERED',
    });
    if (speech.error) throw new Error(`Failed to insert test speech: ${speech.error.message}`);
  });

  afterAll(async () => {
    await ctx.serviceClient
      .from('economic_events')
      .delete()
      .in('id', [RELEASED_EVENT_ID, SOON_EVENT_ID, FUTURE_EVENT_ID, CANCELLED_EVENT_ID]);
    await ctx.serviceClient.from('speech_events').delete().eq('id', DELIVERED_SPEECH_ID);
    // notification_inbox rows cascade from profiles → auth.users.
    for (const user of users) {
      await deleteTestUser(ctx, user.id);
    }
    await ctx.app.close();
  });

  describe('GET /notifications', () => {
    it('401s without a token and 403s without VIEW_BASIC_EVENT', async () => {
      const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications' });
      expect(anonymous.statusCode).toBe(401);

      const { headers } = await newUser({ entitled: false });
      const { status, body } = await list(headers);
      expect(status).toBe(403);
      expect(body.error.code).toBe('FEATURE_NOT_ENTITLED');
    });

    it('materializes the passed notifications of the upcoming rules, newest first, all unread', async () => {
      const { headers } = await newUser();
      const { status, body } = await list(headers);
      expect(status).toBe(200);

      const items: InboxItem[] = body.items;
      const targets = items.map((item) => item.target_id);
      expect(targets).toEqual(expect.arrayContaining([RELEASED_EVENT_ID, SOON_EVENT_ID, DELIVERED_SPEECH_ID]));
      expect(targets).not.toContain(FUTURE_EVENT_ID);
      expect(targets).not.toContain(CANCELLED_EVENT_ID);
      expect(body.unread_count).toBe(items.length);

      const notifyTimes = items.map((item) => Date.parse(item.notify_at));
      expect(notifyTimes).toEqual([...notifyTimes].sort((a, b) => b - a));

      expect(items.find((item) => item.target_id === SOON_EVENT_ID)).toEqual({
        id: expect.any(String),
        kind: 'INDICATOR',
        target_id: SOON_EVENT_ID,
        trigger: 'LEAD_5',
        lead_minutes: 5,
        title: '日本CPI(消費者物価指数)',
        body: expect.stringMatching(/^発表の5分前です（\d+\/\d+ \d+:\d{2}発表・重要度 高）$/),
        display_name: '消費者物価指数（CPI）',
        speaker_name: null,
        country_code: 'JP',
        importance: 'HIGH',
        scheduled_at: isoSeconds(at(4)),
        notify_at: isoSeconds(at(-1)),
        read_at: null,
        expires_at: isoSeconds(at(-1 + 30 * 24 * 60)),
      });
      expect(items.find((item) => item.target_id === DELIVERED_SPEECH_ID)).toMatchObject({
        kind: 'SPEECH',
        trigger: 'LEAD_5',
        title: '受信箱テスト講演',
        display_name: null,
        speaker_name: 'ジェローム・パウエル',
        country_code: 'US',
        notify_at: isoSeconds(at(-25)),
      });
    });

    it('never inserts the same event + trigger twice, but keeps LEAD_5 and AT_RELEASE apart', async () => {
      const { user, headers } = await newUser();
      const first = await list(headers);
      const second = await list(headers);
      expect(second.body.items.map((item: InboxItem) => item.id)).toEqual(
        first.body.items.map((item: InboxItem) => item.id),
      );
      expect(await rowsFor(user.id)).toHaveLength(first.body.items.length);

      // Switch to 発表時 (lead 0) with the same saved-at time.
      await saveSettings(user.id, { notify_lead_minutes: 0 });
      const { body } = await list(headers);
      const released = body.items.filter((item: InboxItem) => item.target_id === RELEASED_EVENT_ID);
      expect(released.map((item: InboxItem) => item.trigger).sort()).toEqual(['AT_RELEASE', 'LEAD_5']);
      expect(released.find((item: InboxItem) => item.trigger === 'AT_RELEASE')).toMatchObject({
        lead_minutes: 0,
        notify_at: isoSeconds(at(-60)),
        body: expect.stringMatching(/^まもなく発表です（/),
      });
      // The SOON event's AT_RELEASE notify_at (base + 4 min) hasn't passed yet.
      expect(
        body.items.filter((item: InboxItem) => item.target_id === SOON_EVENT_ID).map((item: InboxItem) => item.trigger),
      ).toEqual(['LEAD_5']);

      const rows = await rowsFor(user.id);
      const keys = rows.map((row) => `${row.kind}|${row.target_id}|${row.trigger}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('does not backfill notifications from before the settings were saved', async () => {
      const { user, headers } = await newUser();
      // Saved 10 minutes ago: RELEASED (notify −65 min) and the speech (−25 min) are older.
      await ctx.serviceClient.from('user_settings').delete().eq('user_id', user.id);
      await ctx.serviceClient
        .from('user_settings')
        .insert({ user_id: user.id, created_at: at(-10), updated_at: at(-10) });
      const targets = (await list(headers)).body.items.map((item: InboxItem) => item.target_id);
      expect(targets).toContain(SOON_EVENT_ID);
      expect(targets).not.toContain(RELEASED_EVENT_ID);
      expect(targets).not.toContain(DELIVERED_SPEECH_ID);
    });

    it('materializes nothing when push is off, but still lists existing rows', async () => {
      const { user, headers } = await newUser({ settings: { notify_push: false } });
      await insertRow(user.id, {});
      const { body } = await list(headers);
      expect(body.items.map((item: InboxItem) => item.kind)).toEqual(['SYSTEM']);
      expect(body.items[0]).toMatchObject({ trigger: 'WELCOME', lead_minutes: null, scheduled_at: null });
      expect(body.unread_count).toBe(1);
    });

    it('supports order=asc and kind=, and unread_count ignores the kind filter', async () => {
      const { headers } = await newUser();
      const all = (await list(headers)).body;

      const asc = (await list(headers, '?order=asc')).body;
      const ascTimes = asc.items.map((item: InboxItem) => Date.parse(item.notify_at));
      expect(ascTimes).toEqual([...ascTimes].sort((a, b) => a - b));
      expect(asc.items).toHaveLength(all.items.length);

      const speeches = (await list(headers, '?kind=SPEECH')).body;
      expect(speeches.items.length).toBeGreaterThanOrEqual(1);
      expect(speeches.items.every((item: InboxItem) => item.kind === 'SPEECH')).toBe(true);
      expect(speeches.unread_count).toBe(all.unread_count);

      expect((await list(headers, '?order=newest')).status).toBe(422);
      expect((await list(headers, '?kind=PUSH')).status).toBe(422);
    });

    it('deletes the caller’s expired rows and never returns them', async () => {
      const { user, headers } = await newUser({ settings: { notify_push: false } });
      const { user: other } = await newUser({ settings: { notify_push: false } });
      const expiredId = await insertRow(user.id, { target_id: 'old', expires_at: at(-1) });
      const keptId = await insertRow(user.id, { target_id: 'kept', kind: 'RATE_ALERT' });
      const othersExpiredId = await insertRow(other.id, { target_id: 'old', expires_at: at(-1) });

      const { body } = await list(headers);
      expect(body.items.map((item: InboxItem) => item.id)).toEqual([keptId]);
      expect(body.unread_count).toBe(1);

      const ids = (await rowsFor(user.id)).map((row) => row.id);
      expect(ids).not.toContain(expiredId);
      // Only the caller's rows — the job handles everyone else.
      expect((await rowsFor(other.id)).map((row) => row.id)).toContain(othersExpiredId);
    });
  });

  describe('POST /notifications/{id}/read', () => {
    it('marks one row read, idempotently, and lowers unread_count', async () => {
      const { headers } = await newUser();
      const before = (await list(headers)).body;
      const target: InboxItem = before.items[0];

      const first = await post(headers, `/${target.id}/read`);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({
        id: target.id,
        read_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      });

      const again = await post(headers, `/${target.id}/read`);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);

      const after = (await list(headers)).body;
      expect(after.unread_count).toBe(before.unread_count - 1);
      expect(after.items.find((item: InboxItem) => item.id === target.id).read_at).toBe(first.body.read_at);
    });

    it('404s another user’s row, an unknown id and an expired row; 422 for a non-uuid; 401 without a token', async () => {
      const { user: owner } = await newUser({ settings: { notify_push: false } });
      const ownersRow = await insertRow(owner.id, {});
      const { user, headers } = await newUser({ settings: { notify_push: false } });
      const expiredRow = await insertRow(user.id, { expires_at: at(-1) });

      const others = await post(headers, `/${ownersRow}/read`);
      expect(others.status).toBe(404);
      expect(others.body.error.code).toBe('NOT_FOUND');
      expect((await rowsFor(owner.id))[0]!.read_at).toBeNull();

      expect((await post(headers, '/00000000-0000-0000-0000-000000000000/read')).status).toBe(404);
      expect((await post(headers, `/${expiredRow}/read`)).status).toBe(404);
      expect((await post(headers, '/not-a-uuid/read')).status).toBe(422);
      expect((await post(undefined, `/${ownersRow}/read`)).status).toBe(401);
    });
  });

  describe('POST /notifications/read-all', () => {
    it('marks every unread, non-expired row of the caller read', async () => {
      const { user, headers } = await newUser();
      const { user: other } = await newUser({ settings: { notify_push: false } });
      const othersRow = await insertRow(other.id, {});
      const before = (await list(headers)).body;
      expect(before.unread_count).toBeGreaterThanOrEqual(3);
      await post(headers, `/${before.items[0].id}/read`);

      const result = await post(headers, '/read-all');
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ updated: before.unread_count - 1 });

      const after = (await list(headers)).body;
      expect(after.unread_count).toBe(0);
      expect(after.items.every((item: InboxItem) => item.read_at !== null)).toBe(true);
      expect((await post(headers, '/read-all')).body).toEqual({ updated: 0 });

      expect((await rowsFor(user.id)).every((row) => row.read_at !== null)).toBe(true);
      expect((await rowsFor(other.id)).find((row) => row.id === othersRow)!.read_at).toBeNull();
    });
  });

  describe('expiry job (npm run jobs:cleanup-notifications)', () => {
    it('deletes every user’s expired rows and keeps the rest', async () => {
      const { user: a } = await newUser({ settings: { notify_push: false } });
      const { user: b } = await newUser({ settings: { notify_push: false } });
      const expiredA = await insertRow(a.id, { target_id: 'old', expires_at: at(-1) });
      const expiredB = await insertRow(b.id, { target_id: 'old', expires_at: at(-60) });
      const kept = await insertRow(a.id, { target_id: 'kept' });

      const deleted = await deleteAllExpiredInboxNotifications(ctx.serviceClient);
      expect(deleted).toBeGreaterThanOrEqual(2);

      const remaining = [...(await rowsFor(a.id)), ...(await rowsFor(b.id))].map((row) => row.id);
      expect(remaining).toEqual([kept]);
      expect(remaining).not.toContain(expiredA);
      expect(remaining).not.toContain(expiredB);
    });
  });

  describe('RLS', () => {
    it('an app user can read only their own rows directly', async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const { user } = await newUser({ settings: { notify_push: false } });
      const { user: other } = await newUser({ settings: { notify_push: false } });
      const own = await insertRow(user.id, {});
      await insertRow(other.id, {});

      const asUser = createClient(ctx.supabaseUrl, ctx.anonKey, {
        global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await asUser.from('notification_inbox').select('id');
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([own]);

      const write = await asUser
        .from('notification_inbox')
        .update({ read_at: at(0) })
        .eq('id', own)
        .select('id');
      expect(write.data ?? []).toEqual([]);
    });
  });
});
