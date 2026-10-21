import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { evaluateAllRateAlerts } from '../../src/repositories/rateAlertsRepository.js';
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
const USDJPY_ID = '20000000-0000-0000-0000-000000000001';
const EURJPY_ID = '20000000-0000-0000-0000-000000000003';
const JP_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000004'; // display_name 消費者物価指数（CPI）, USDJPY/EURJPY
const POWELL_SPEAKER_ID = '40000000-0000-0000-0000-000000000001'; // ジェローム・パウエル / FRB理事, USD

// Test-only events/speeches, relative to the real clock, removed in
// afterAll. All LOW importance: the other integration files' users keep the
// default importances (HIGH, MEDIUM), so these never show up in their inbox
// or upcoming lists while the files run in parallel.
const RESCHEDULED_EVENT_ID = '3c000000-0000-0000-0000-000000000001';
const RELEASED_EVENT_ID = '3c000000-0000-0000-0000-000000000002';
const CANCELLED_SPEECH_ID = '3c000000-0000-0000-0000-000000000003';
const HOME_RECENT_SPEECH_ID = '3c000000-0000-0000-0000-000000000004'; // DELIVERED 1 min ago
const HOME_OLD_SPEECH_ID = '3c000000-0000-0000-0000-000000000005'; // DELIVERED 8 days ago
const HOME_SCHEDULED_SPEECH_ID = '3c000000-0000-0000-0000-000000000006'; // SCHEDULED 2 min ago (not yet marked delivered)
const EVENT_IDS = [RESCHEDULED_EVENT_ID, RELEASED_EVENT_ID];
const SPEECH_IDS = [CANCELLED_SPEECH_ID, HOME_RECENT_SPEECH_ID, HOME_OLD_SPEECH_ID, HOME_SCHEDULED_SPEECH_ID];

const MINUTE_MS = 60_000;
const base = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const at = (minutes: number) => new Date(base + minutes * MINUTE_MS).toISOString();
const isoSeconds = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

type Headers = { authorization: string };

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

/** レートアラート (§24.12-§24.14) / カレンダー更新 (§24.9) / GET /home speeches (§12), api-design.md v1.27. */
describe.skipIf(!integration)('Rate alerts / calendar updates / Home speeches', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  let usdJpyPrice: number;

  async function newUser(
    options: { plan?: 'FREE' | 'PRO'; settings?: Record<string, unknown> | null } = {},
  ): Promise<{ user: TestUser; headers: Headers }> {
    const user = await createTestUser(ctx);
    users.push(user);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    if ((options.plan ?? 'FREE') === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    if (options.settings !== null && options.settings !== undefined) {
      // Saved 2 hours ago (the inbox never backfills before user_settings.updated_at).
      const { error } = await ctx.serviceClient
        .from('user_settings')
        .insert({ user_id: user.id, created_at: at(-120), updated_at: at(-120), ...options.settings });
      if (error) throw new Error(`Failed to insert settings: ${error.message}`);
    }
    return { user, headers: { authorization: `Bearer ${user.accessToken}` } };
  }

  async function call(method: 'GET' | 'POST' | 'DELETE', url: string, headers?: Headers, payload?: object) {
    const response = await ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(headers ? { headers } : {}),
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
  }

  async function inbox(headers: Headers, kind?: string): Promise<InboxItem[]> {
    const { status, body } = await call('GET', `/notifications${kind ? `?kind=${kind}` : ''}`, headers);
    expect(status).toBe(200);
    return body.items;
  }

  async function alertRow(id: string) {
    const { data, error } = await ctx.serviceClient.from('rate_alerts').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  async function changesFor(targetId: string) {
    const { data, error } = await ctx.serviceClient
      .from('event_schedule_changes')
      .select('*')
      .eq('target_id', targetId)
      .order('changed_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);

    const latest = await ctx.serviceClient
      .from('fx_prices')
      .select('close')
      .eq('fx_pair_id', USDJPY_ID)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();
    if (latest.error) throw new Error(`No USDJPY price in the seed: ${latest.error.message}`);
    usdJpyPrice = Number(latest.data.close);

    const event = (id: string, minutes: number, status: string) => ({
      id,
      indicator_id: JP_CPI_INDICATOR_ID,
      provider: 'integration-test',
      provider_event_id: `calendar-update-${id}`,
      release_datetime: at(minutes),
      release_datetime_precision: 'EXACT',
      importance: 'LOW',
      status,
    });
    const events = await ctx.serviceClient
      .from('economic_events')
      .insert([event(RESCHEDULED_EVENT_ID, 3 * 24 * 60, 'SCHEDULED'), event(RELEASED_EVENT_ID, -30, 'SCHEDULED')]);
    if (events.error) throw new Error(`Failed to insert test events: ${events.error.message}`);

    const speech = (id: string, minutes: number, status: string, summary: string | null = null) => ({
      id,
      speaker_id: POWELL_SPEAKER_ID,
      provider: 'integration-test',
      provider_event_id: `calendar-update-${id}`,
      title: `テスト講演 ${id.slice(-1)}`,
      summary,
      statement_datetime: at(minutes),
      importance: 'LOW',
      status,
    });
    const speeches = await ctx.serviceClient
      .from('speech_events')
      .insert([
        speech(CANCELLED_SPEECH_ID, 2 * 24 * 60, 'SCHEDULED'),
        speech(HOME_RECENT_SPEECH_ID, -1, 'DELIVERED', '物価の動向について説明した。'),
        speech(HOME_OLD_SPEECH_ID, -8 * 24 * 60, 'DELIVERED'),
        speech(HOME_SCHEDULED_SPEECH_ID, -2, 'SCHEDULED'),
      ]);
    if (speeches.error) throw new Error(`Failed to insert test speeches: ${speeches.error.message}`);
  });

  afterAll(async () => {
    await ctx.serviceClient
      .from('event_schedule_changes')
      .delete()
      .in('target_id', [...EVENT_IDS, ...SPEECH_IDS]);
    await ctx.serviceClient.from('economic_events').delete().in('id', EVENT_IDS);
    await ctx.serviceClient.from('speech_events').delete().in('id', SPEECH_IDS);
    // rate_alerts / notification_inbox cascade from profiles → auth.users.
    for (const user of users) {
      await deleteTestUser(ctx, user.id);
    }
    await ctx.app.close();
  });

  describe('GET /home speeches', () => {
    it('returns the latest DELIVERED speeches of the last 7 days, newest first, max 3, in the mock shape', async () => {
      const { headers } = await newUser();
      const { status, body } = await call('GET', '/home?date=2026-09-10&timezone=UTC', headers);
      expect(status).toBe(200);
      const speeches: Array<Record<string, unknown>> = body.speeches;
      expect(speeches.length).toBeLessThanOrEqual(3);
      const times = speeches.map((item) => Date.parse(item.statement_datetime as string));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      const ids = speeches.map((item) => item.speech_id);
      expect(ids).not.toContain(HOME_OLD_SPEECH_ID);
      expect(ids).not.toContain(HOME_SCHEDULED_SPEECH_ID);
      expect(speeches.find((item) => item.speech_id === HOME_RECENT_SPEECH_ID)).toEqual({
        speech_id: HOME_RECENT_SPEECH_ID,
        country_code: 'US',
        speaker_name: 'パウエルFRB理事',
        statement_datetime: isoSeconds(at(-1)),
        headline: '物価の動向について説明した。',
        organization: 'FRB',
        speaker_photo_url: expect.stringMatching(/^https?:\/\/[^/]+\/api\/v1\/speaker-photos\/powell\.jpg$/),
        reaction_fx_symbol: null,
        reaction_price_before: null,
        reaction_price_after: null,
        reaction_pips: null,
      });
    });
  });

  describe('/rate-alerts', () => {
    it('401s without a token', async () => {
      expect((await call('GET', '/rate-alerts')).status).toBe(401);
      expect((await call('POST', '/rate-alerts', undefined, {})).status).toBe(401);
    });

    it('creates, lists and deletes; FREE may have 1 active alert (403 PLAN_LIMIT_EXCEEDED beyond)', async () => {
      const { headers } = await newUser();
      expect((await call('GET', '/rate-alerts', headers)).body).toEqual({
        items: [],
        limit: { max_for_plan: 1, pro_max: 10 },
      });

      const created = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: EURJPY_ID,
        direction: 'ABOVE',
        target_price: 999,
      });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        fx_pair_id: EURJPY_ID,
        symbol: 'EURJPY',
        direction: 'ABOVE',
        target_price: 999,
        is_active: true,
        triggered_at: null,
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      });

      const second = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: USDJPY_ID,
        direction: 'BELOW',
        target_price: 1,
      });
      expect(second.status).toBe(403);
      expect(second.body.error).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', required_plan: 'PRO' });

      expect((await call('GET', '/rate-alerts', headers)).body.items).toEqual([created.body]);

      expect((await call('DELETE', `/rate-alerts/${created.body.id}`, headers)).status).toBe(204);
      expect((await call('DELETE', `/rate-alerts/${created.body.id}`, headers)).status).toBe(404);
      expect((await call('GET', '/rate-alerts', headers)).body.items).toEqual([]);
      // Room again after the delete.
      expect(
        (await call('POST', '/rate-alerts', headers, { fx_pair_id: USDJPY_ID, direction: 'BELOW', target_price: 1 }))
          .status,
      ).toBe(201);
    });

    it('PRO may have 10 active alerts; the 11th is 422 (no plan allows it)', async () => {
      const { headers } = await newUser({ plan: 'PRO' });
      expect((await call('GET', '/rate-alerts', headers)).body.limit).toEqual({ max_for_plan: 10, pro_max: 10 });
      for (let index = 0; index < 10; index += 1) {
        const created = await call('POST', '/rate-alerts', headers, {
          fx_pair_id: EURJPY_ID,
          direction: 'ABOVE',
          target_price: 900 + index,
        });
        expect(created.status).toBe(201);
      }
      const eleventh = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: EURJPY_ID,
        direction: 'ABOVE',
        target_price: 999,
      });
      expect(eleventh.status).toBe(422);
      expect(eleventh.body.error.code).toBe('VALIDATION_ERROR');
      expect((await call('GET', '/rate-alerts', headers)).body.items).toHaveLength(10);
    });

    it('validates the body (422) and only deletes the owner’s alert (404 otherwise)', async () => {
      const { headers } = await newUser();
      const { headers: otherHeaders } = await newUser();
      const bad = [
        { fx_pair_id: '00000000-0000-0000-0000-000000000000', direction: 'ABOVE', target_price: 150 },
        { fx_pair_id: USDJPY_ID, direction: 'UP', target_price: 150 },
        { fx_pair_id: USDJPY_ID, direction: 'ABOVE', target_price: 0 },
        { fx_pair_id: USDJPY_ID, direction: 'ABOVE', target_price: '150' },
        { fx_pair_id: 'not-a-uuid', direction: 'ABOVE', target_price: 150 },
      ];
      for (const payload of bad) {
        expect((await call('POST', '/rate-alerts', headers, payload)).status).toBe(422);
      }

      const created = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: EURJPY_ID,
        direction: 'ABOVE',
        target_price: 999,
      });
      const others = await call('DELETE', `/rate-alerts/${created.body.id}`, otherHeaders);
      expect(others.status).toBe(404);
      expect(others.body.error.code).toBe('NOT_FOUND');
      expect((await alertRow(created.body.id)).is_active).toBe(true);
      expect((await call('DELETE', '/rate-alerts/not-a-uuid', headers)).status).toBe(422);
      expect((await call('GET', '/rate-alerts', otherHeaders)).body.items).toEqual([]);
    });
  });

  describe('RATE_ALERT notifications', () => {
    it('GET /notifications fires a crossed alert into the inbox once and deactivates it', async () => {
      const { headers } = await newUser({ plan: 'PRO' });
      const crossed = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: USDJPY_ID,
        direction: 'ABOVE',
        target_price: Math.floor(usdJpyPrice) - 1,
      });
      const notYet = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: USDJPY_ID,
        direction: 'BELOW',
        target_price: Math.floor(usdJpyPrice) - 1,
      });
      const noPrice = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: EURJPY_ID,
        direction: 'BELOW',
        target_price: 999,
      });

      const first = await inbox(headers, 'RATE_ALERT');
      expect(first).toHaveLength(1);
      const target = (Math.floor(usdJpyPrice) - 1).toFixed(2);
      expect(first[0]).toEqual({
        id: expect.any(String),
        kind: 'RATE_ALERT',
        target_id: crossed.body.id,
        trigger: 'CROSSED',
        lead_minutes: null,
        title: `USD/JPY が ${target} を上回りました`,
        body: `現在 ${usdJpyPrice.toFixed(2)}（アラート: ${target} 以上）`,
        display_name: null,
        speaker_name: null,
        country_code: null,
        importance: 'HIGH',
        scheduled_at: null,
        notify_at: expect.stringMatching(/Z$/),
        read_at: null,
        expires_at: expect.stringMatching(/Z$/),
      });
      expect(Date.parse(first[0]!.expires_at) - Date.parse(first[0]!.notify_at)).toBe(7 * 24 * 60 * MINUTE_MS);

      // Again: still exactly one, and the alert is spent.
      expect(await inbox(headers, 'RATE_ALERT')).toEqual(first);
      const listed = (await call('GET', '/rate-alerts', headers)).body.items as Array<Record<string, unknown>>;
      expect(listed.find((item) => item.id === crossed.body.id)).toMatchObject({
        is_active: false,
        triggered_at: expect.stringMatching(/Z$/),
      });
      expect(listed.find((item) => item.id === notYet.body.id)).toMatchObject({ is_active: true, triggered_at: null });
      expect(listed.find((item) => item.id === noPrice.body.id)).toMatchObject({ is_active: true });
    });

    it('a fired alert frees the FREE slot', async () => {
      const { headers } = await newUser();
      await call('POST', '/rate-alerts', headers, { fx_pair_id: USDJPY_ID, direction: 'ABOVE', target_price: 1 });
      expect(await inbox(headers, 'RATE_ALERT')).toHaveLength(1);
      const next = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: USDJPY_ID,
        direction: 'ABOVE',
        target_price: 999,
      });
      expect(next.status).toBe(201);
    });

    it('push off: nothing fires and the alert stays active', async () => {
      const { headers } = await newUser({ settings: { notify_push: false } });
      const created = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: USDJPY_ID,
        direction: 'ABOVE',
        target_price: 1,
      });
      expect(await inbox(headers, 'RATE_ALERT')).toEqual([]);
      expect(await alertRow(created.body.id)).toMatchObject({ is_active: true, triggered_at: null });
    });

    it('the job (npm run jobs:evaluate-rate-alerts) fires for users who never open the inbox, once', async () => {
      const { user, headers } = await newUser();
      const created = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: USDJPY_ID,
        direction: 'ABOVE',
        target_price: 1,
      });
      const { user: pushOff, headers: pushOffHeaders } = await newUser({ settings: { notify_push: false } });
      const kept = await call('POST', '/rate-alerts', pushOffHeaders, {
        fx_pair_id: USDJPY_ID,
        direction: 'ABOVE',
        target_price: 1,
      });

      const result = await evaluateAllRateAlerts(ctx.serviceClient, new Date());
      expect(result.fired).toBeGreaterThanOrEqual(1);
      await evaluateAllRateAlerts(ctx.serviceClient, new Date());

      const { data } = await ctx.serviceClient
        .from('notification_inbox')
        .select('kind, target_id, trigger')
        .eq('user_id', user.id);
      expect(data).toEqual([{ kind: 'RATE_ALERT', target_id: created.body.id, trigger: 'CROSSED' }]);
      expect((await alertRow(created.body.id)).is_active).toBe(false);

      const pushOffRows = await ctx.serviceClient.from('notification_inbox').select('id').eq('user_id', pushOff.id);
      expect(pushOffRows.data).toEqual([]);
      expect((await alertRow(kept.body.id)).is_active).toBe(true);
    });
  });

  describe('CALENDAR_UPDATE notifications', () => {
    // PRO with LOW enabled — the fixtures are LOW so no other test file sees them.
    const LOW_SETTINGS = { notify_importances: ['LOW'] };

    it('DB triggers log reschedules / cancellations of scheduled events only', async () => {
      // SCHEDULED → RELEASED at the same time: not a calendar change.
      await ctx.serviceClient.from('economic_events').update({ status: 'RELEASED' }).eq('id', RELEASED_EVENT_ID);
      // A RELEASED event's time corrected: not logged either.
      await ctx.serviceClient
        .from('economic_events')
        .update({ release_datetime: at(-29) })
        .eq('id', RELEASED_EVENT_ID);
      expect(await changesFor(RELEASED_EVENT_ID)).toEqual([]);
    });

    it('a rescheduled indicator produces exactly one CALENDAR_UPDATE item', async () => {
      const { headers } = await newUser({ plan: 'PRO', settings: LOW_SETTINGS });
      const { headers: highOnly } = await newUser({ plan: 'PRO', settings: { notify_importances: ['HIGH'] } });

      const moved = await ctx.serviceClient
        .from('economic_events')
        .update({ release_datetime: at(4 * 24 * 60) })
        .eq('id', RESCHEDULED_EVENT_ID);
      expect(moved.error).toBeNull();
      const changes = await changesFor(RESCHEDULED_EVENT_ID);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ kind: 'INDICATOR', change_type: 'RESCHEDULED' });

      const first = await inbox(headers, 'CALENDAR_UPDATE');
      const mine = first.filter((item) => item.target_id === changes[0].id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toEqual({
        id: expect.any(String),
        kind: 'CALENDAR_UPDATE',
        target_id: changes[0].id,
        trigger: 'RESCHEDULED',
        lead_minutes: null,
        title: '日本の消費者物価指数（CPI）の発表日時が変更されました',
        body: expect.stringMatching(/^発表日時 \d+\/\d+ \d+:\d{2} → \d+\/\d+ \d+:\d{2}（重要度 低）$/),
        display_name: '消費者物価指数（CPI）',
        speaker_name: null,
        country_code: 'JP',
        importance: 'LOW',
        scheduled_at: isoSeconds(at(4 * 24 * 60)),
        notify_at: isoSeconds(changes[0].changed_at),
        read_at: null,
        expires_at: expect.stringMatching(/Z$/),
      });

      // Calling again never duplicates it.
      const again = await inbox(headers, 'CALENDAR_UPDATE');
      expect(again.filter((item) => item.target_id === changes[0].id)).toEqual(mine);

      // Not notified about LOW events → no calendar update either.
      expect((await inbox(highOnly, 'CALENDAR_UPDATE')).some((item) => item.target_id === changes[0].id)).toBe(false);
    });

    it('a cancelled speech produces a CANCELLED item; not for push off or changes before the settings were saved', async () => {
      const { headers } = await newUser({ plan: 'PRO', settings: LOW_SETTINGS });
      const { headers: pushOff } = await newUser({ plan: 'PRO', settings: { ...LOW_SETTINGS, notify_push: false } });

      await ctx.serviceClient.from('speech_events').update({ status: 'CANCELLED' }).eq('id', CANCELLED_SPEECH_ID);
      const changes = await changesFor(CANCELLED_SPEECH_ID);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ kind: 'SPEECH', change_type: 'CANCELLED', new_datetime: null });

      const items = (await inbox(headers, 'CALENDAR_UPDATE')).filter((item) => item.target_id === changes[0].id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        trigger: 'CANCELLED',
        title: 'パウエルFRB理事の発言が中止されました',
        body: expect.stringMatching(/^\d+\/\d+ \d+:\d{2}の発言は行われません（重要度 低）$/),
        display_name: null,
        speaker_name: 'ジェローム・パウエル',
        country_code: 'US',
        importance: 'LOW',
        scheduled_at: isoSeconds(at(2 * 24 * 60)),
      });

      expect(await inbox(pushOff, 'CALENDAR_UPDATE')).toEqual([]);

      // Settings saved after the change: no backfill.
      const { user: late, headers: lateHeaders } = await newUser({ plan: 'PRO' });
      await ctx.serviceClient
        .from('user_settings')
        .insert({ user_id: late.id, notify_importances: ['LOW'], created_at: at(10), updated_at: at(10) });
      expect((await inbox(lateHeaders, 'CALENDAR_UPDATE')).some((item) => item.target_id === changes[0].id)).toBe(
        false,
      );
    });
  });

  describe('RLS', () => {
    it('an app user can read only their own rate alerts', async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const { user, headers } = await newUser();
      const { headers: otherHeaders } = await newUser();
      const own = await call('POST', '/rate-alerts', headers, {
        fx_pair_id: EURJPY_ID,
        direction: 'ABOVE',
        target_price: 999,
      });
      await call('POST', '/rate-alerts', otherHeaders, {
        fx_pair_id: EURJPY_ID,
        direction: 'ABOVE',
        target_price: 999,
      });

      const asUser = createClient(ctx.supabaseUrl, ctx.anonKey, {
        global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await asUser.from('rate_alerts').select('id');
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([own.body.id]);

      const write = await asUser.from('rate_alerts').update({ is_active: false }).eq('id', own.body.id).select('id');
      expect(write.data ?? []).toEqual([]);
    });
  });
});
