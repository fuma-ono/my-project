import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

const GITHUB_REPO = 'example/fx-support';
const GITHUB_TOKEN = 'integration-test-token';
const ISSUE_URL = 'https://github.com/example/fx-support/issues/123';

const RESPONSE_KEYS = ['body', 'category', 'created_at', 'id', 'kind', 'replied_at', 'reply_body', 'status'];
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function githubFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

/** SCR-020 ヘルプ・お問い合わせ — POST/GET /support/requests (api-design.md §24.7/§24.8). */
describe.skipIf(!integration)('Support requests', () => {
  // GitHub configured (fake fetch answers 201), GitHub not configured, and
  // GitHub configured but failing. Nothing ever reaches the real GitHub.
  const configuredFetch = githubFetch(201, { number: 123, html_url: ISSUE_URL });
  const unconfiguredFetch = githubFetch(201, { number: 999, html_url: 'https://github.com/never/called' });
  const failingFetch = githubFetch(500, { message: 'Server Error' });
  let configured: IntegrationContext;
  let unconfigured: IntegrationContext;
  let failing: IntegrationContext;
  const users: TestUser[] = [];

  async function newUser(): Promise<{ user: TestUser; headers: { authorization: string } }> {
    const user = await createTestUser(unconfigured);
    users.push(user);
    return { user, headers: { authorization: `Bearer ${user.accessToken}` } };
  }

  function post(ctx: IntegrationContext, headers: { authorization: string }, payload: Record<string, unknown>) {
    return ctx.app.inject({ method: 'POST', url: '/api/v1/support/requests', headers, payload });
  }

  /** Arguments for calling insert_support_request() directly. */
  function rpcArgs(userId: string, text: string) {
    return {
      p_user_id: userId,
      p_kind: 'INQUIRY',
      p_category: 'OTHER',
      p_body: text,
      p_app_version: null,
      p_os_version: null,
      p_device_model: null,
      p_classification: 'VALID',
      p_status: 'REPLIED',
      p_reply_body: 'テスト返信です。',
      p_replied_at: new Date().toISOString(),
      p_max_per_hour: 5,
    };
  }

  async function storedRow(id: string) {
    const { data, error } = await unconfigured.serviceClient
      .from('support_requests')
      .select('user_id, classification, status, github_issue_number, github_issue_url, app_version, device_model')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(() => {
    const githubEnv = { GITHUB_ISSUES_TOKEN: GITHUB_TOKEN, GITHUB_ISSUES_REPO: GITHUB_REPO };
    configured = buildIntegrationContext(integration!, { env: githubEnv, githubFetch: configuredFetch });
    unconfigured = buildIntegrationContext(integration!, { githubFetch: unconfiguredFetch });
    failing = buildIntegrationContext(integration!, { env: githubEnv, githubFetch: failingFetch });
  });

  beforeEach(() => {
    configuredFetch.mockClear();
    unconfiguredFetch.mockClear();
    failingFetch.mockClear();
  });

  afterAll(async () => {
    for (const user of users) {
      await deleteTestUser(unconfigured, user.id);
    }
    await Promise.all([configured.app.close(), unconfigured.app.close(), failing.app.close()]);
  });

  describe('POST /support/requests', () => {
    it('201: a VALID inquiry is stored and auto-replied (REPLIED), without exposing internals', async () => {
      const { user, headers } = await newUser();
      const response = await post(configured, headers, {
        kind: 'INQUIRY',
        category: 'BILLING',
        body: '  解約の方法を教えてください  ',
        app_version: '1.0.0',
        os_version: 'iOS 18.0',
        device_model: 'iPhone16,1',
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS);
      expect(body).toMatchObject({
        kind: 'INQUIRY',
        category: 'BILLING',
        body: '解約の方法を教えてください',
        status: 'REPLIED',
      });
      expect(body.reply_body).toContain('App Store');
      expect(body.replied_at).toMatch(ISO_SECONDS);
      expect(body.created_at).toMatch(ISO_SECONDS);
      expect(configuredFetch).not.toHaveBeenCalled();

      expect(await storedRow(body.id)).toEqual({
        user_id: user.id,
        classification: 'VALID',
        status: 'REPLIED',
        github_issue_number: null,
        github_issue_url: null,
        app_version: '1.0.0',
        device_model: 'iPhone16,1',
      });
    });

    it('201: FEEDBACK gets the feedback reply', async () => {
      const { headers } = await newUser();
      const response = await post(configured, headers, {
        kind: 'FEEDBACK',
        category: 'OTHER',
        body: 'ダークモードがとても見やすいです',
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('REPLIED');
      expect(body.reply_body).toContain('今後の改善の参考');
      expect(configuredFetch).not.toHaveBeenCalled();
    });

    it('201: a BUG report is ESCALATED and becomes a GitHub Issue when GitHub is configured', async () => {
      const { user, headers } = await newUser();
      const response = await post(configured, headers, {
        kind: 'INQUIRY',
        category: 'BUG',
        body: 'チャート画面を開くとアプリが落ちる。連絡先 taro@example.com / 090-1234-5678',
        app_version: '1.0.0',
        os_version: 'iOS 18.0',
        device_model: 'iPhone16,1',
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS);
      expect(body.status).toBe('ESCALATED');
      expect(body.reply_body).toContain('修正対象として登録しました');
      expect(body.replied_at).toMatch(ISO_SECONDS);

      expect(configuredFetch).toHaveBeenCalledTimes(1);
      const [url, init] = configuredFetch.mock.calls[0]!;
      expect(url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/issues`);
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${GITHUB_TOKEN}`);
      const sent = JSON.parse(init?.body as string);
      expect(sent.title.startsWith('[アプリ不具合報告] チャート画面を開くとアプリが落ちる')).toBe(true);
      expect(sent.labels).toEqual(['bug', 'from-app']);
      expect(sent.body).toContain(body.id);
      expect(sent.body).toContain('| カテゴリ | BUG |');
      expect(sent.body).toContain('| アプリバージョン | 1.0.0 |');
      const sentText = `${sent.title}\n${sent.body}`;
      expect(sentText).not.toContain(user.id);
      expect(sentText).not.toContain(user.email);
      expect(sentText).not.toContain('taro@example.com');
      expect(sentText).not.toContain('090-1234-5678');

      expect(await storedRow(body.id)).toMatchObject({
        classification: 'BUG',
        status: 'ESCALATED',
        github_issue_number: 123,
        github_issue_url: ISSUE_URL,
      });
    });

    it('201: a bug keyword outside the BUG category is also escalated', async () => {
      const { headers } = await newUser();
      const response = await post(configured, headers, {
        kind: 'FEEDBACK',
        category: 'OTHER',
        body: 'スクロールすると画面がフリーズします',
      });
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body).status).toBe('ESCALATED');
      expect(configuredFetch).toHaveBeenCalledTimes(1);
    });

    it('201: a BUG report without GitHub configured is ESCALATED with no Issue and no GitHub call', async () => {
      const { headers } = await newUser();
      const response = await post(unconfigured, headers, {
        kind: 'INQUIRY',
        category: 'BUG',
        body: '通知をタップするとアプリが落ちる',
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ESCALATED');
      expect(body.reply_body).toContain('不具合のご報告ありがとうございます');
      expect(unconfiguredFetch).not.toHaveBeenCalled();
      expect(await storedRow(body.id)).toMatchObject({ github_issue_number: null, github_issue_url: null });
    });

    it('201: a GitHub failure does not fail the request (ESCALATED, no Issue)', async () => {
      const { headers } = await newUser();
      const response = await post(failing, headers, {
        kind: 'INQUIRY',
        category: 'BUG',
        body: 'ログイン後にエラーが表示されます',
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ESCALATED');
      expect(body.reply_body).not.toBeNull();
      expect(failingFetch).toHaveBeenCalledTimes(1);
      expect(await storedRow(body.id)).toMatchObject({
        status: 'ESCALATED',
        github_issue_number: null,
        github_issue_url: null,
      });
    });

    it.each([
      ['NONSENSE', 'ああああああ'],
      ['NONSENSE', 'asdfghjkl'],
      ['SPAM', 'https://spam.example.com/landing'],
    ])('201: %s (%s) is stored but IGNORED — no reply, no Issue', async (classification, text) => {
      const { headers } = await newUser();
      const response = await post(configured, headers, { kind: 'INQUIRY', category: 'BUG', body: text });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS);
      expect(body).toMatchObject({ status: 'IGNORED', reply_body: null, replied_at: null });
      expect(configuredFetch).not.toHaveBeenCalled();
      expect(await storedRow(body.id)).toMatchObject({ classification, status: 'IGNORED' });
    });

    it.each([
      ['missing kind', { category: 'OTHER', body: '質問があります' }],
      ['unknown category', { kind: 'INQUIRY', category: 'PRICE', body: '質問があります' }],
      ['empty body', { kind: 'INQUIRY', category: 'OTHER', body: '   ' }],
      ['body over 2000 characters', { kind: 'INQUIRY', category: 'OTHER', body: 'あ'.repeat(2001) }],
      ['unknown field', { kind: 'INQUIRY', category: 'OTHER', body: '質問があります', status: 'REPLIED' }],
    ])('422 VALIDATION_ERROR: %s', async (_label, payload) => {
      const { user, headers } = await newUser();
      const response = await post(configured, headers, payload);
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');

      const { count } = await unconfigured.serviceClient
        .from('support_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      expect(count).toBe(0);
    });

    it('429 RATE_LIMITED on the 6th request within an hour (ignored ones count too)', async () => {
      const { user, headers } = await newUser();
      const bodies = ['質問その1です', '質問その2です', 'ああああああ', '質問その4です', '質問その5です'];
      for (const text of bodies) {
        const response = await post(unconfigured, headers, { kind: 'INQUIRY', category: 'OTHER', body: text });
        expect(response.statusCode).toBe(201);
      }

      const sixth = await post(unconfigured, headers, { kind: 'INQUIRY', category: 'OTHER', body: '質問その6です' });
      expect(sixth.statusCode).toBe(429);
      expect(JSON.parse(sixth.body).error.code).toBe('RATE_LIMITED');

      const { count } = await unconfigured.serviceClient
        .from('support_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      expect(count).toBe(5);

      // Other users are unaffected.
      const other = await newUser();
      const payload = { kind: 'INQUIRY', category: 'OTHER', body: '質問です' };
      const otherResponse = await post(unconfigured, other.headers, payload);
      expect(otherResponse.statusCode).toBe(201);
    });

    it('429: concurrent requests cannot exceed the limit (count + insert are atomic)', async () => {
      const { user, headers } = await newUser();
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          post(unconfigured, headers, { kind: 'INQUIRY', category: 'OTHER', body: `同時送信の質問${index + 1}です` }),
        ),
      );
      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429, 429]);
      for (const response of responses.filter((r) => r.statusCode === 429)) {
        expect(JSON.parse(response.body).error.code).toBe('RATE_LIMITED');
      }

      const { count } = await unconfigured.serviceClient
        .from('support_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      expect(count).toBe(5);
    });

    it('429: a rate-limited BUG report creates no GitHub Issue', async () => {
      const { headers } = await newUser();
      for (let index = 1; index <= 5; index += 1) {
        const response = await post(configured, headers, {
          kind: 'INQUIRY',
          category: 'OTHER',
          body: `質問その${index}です`,
        });
        expect(response.statusCode).toBe(201);
      }
      const sixth = await post(configured, headers, {
        kind: 'INQUIRY',
        category: 'BUG',
        body: '起動するとアプリが落ちる',
      });
      expect(sixth.statusCode).toBe(429);
      expect(configuredFetch).not.toHaveBeenCalled();
    });

    it('insert_support_request raises P0429 at the limit (service_role)', async () => {
      const { user } = await newUser();
      for (let index = 1; index <= 5; index += 1) {
        const { error } = await unconfigured.serviceClient
          .rpc('insert_support_request', rpcArgs(user.id, `質問その${index}です`))
          .single();
        expect(error).toBeNull();
      }
      const { data, error } = await unconfigured.serviceClient
        .rpc('insert_support_request', rpcArgs(user.id, '質問その6です'))
        .single();
      expect(data).toBeNull();
      expect(error?.code).toBe('P0429');
    });

    it('401 without a token', async () => {
      const response = await configured.app.inject({
        method: 'POST',
        url: '/api/v1/support/requests',
        payload: { kind: 'INQUIRY', category: 'OTHER', body: '質問があります' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /support/requests', () => {
    it("returns only the caller's own requests, newest first, in the POST shape", async () => {
      const a = await newUser();
      const b = await newUser();
      const first = await post(unconfigured, a.headers, { kind: 'INQUIRY', category: 'CHART', body: 'RSIの見方は?' });
      const second = await post(unconfigured, a.headers, { kind: 'INQUIRY', category: 'OTHER', body: 'ああああああ' });
      await post(unconfigured, b.headers, { kind: 'FEEDBACK', category: 'OTHER', body: '使いやすいアプリです' });

      const response = await unconfigured.app.inject({
        method: 'GET',
        url: '/api/v1/support/requests',
        headers: a.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Object.keys(body)).toEqual(['data']);
      expect(body.data).toEqual([JSON.parse(second.body), JSON.parse(first.body)]);
      for (const row of body.data) {
        expect(Object.keys(row).sort()).toEqual(RESPONSE_KEYS);
      }
    });

    it('returns an empty list for a user with no requests', async () => {
      const { headers } = await newUser();
      const response = await unconfigured.app.inject({ method: 'GET', url: '/api/v1/support/requests', headers });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ data: [] });
    });

    it('RLS: app users cannot read or write support_requests directly (only via the Backend)', async () => {
      const a = await newUser();
      const created = await post(unconfigured, a.headers, {
        kind: 'INQUIRY',
        category: 'DATA',
        body: '前回値の意味を教えてください',
      });
      expect(created.statusCode).toBe(201);

      const asUserA = createClient(unconfigured.supabaseUrl, unconfigured.anonKey, {
        global: { headers: { Authorization: `Bearer ${a.user.accessToken}` } },
      });
      // classification / github_issue_* must not be readable from the client.
      const select = await asUserA.from('support_requests').select('user_id, classification, github_issue_url');
      expect(select.error).not.toBeNull();
      expect(select.data).toBeNull();

      const insert = await asUserA.from('support_requests').insert({
        user_id: a.user.id,
        kind: 'INQUIRY',
        category: 'OTHER',
        body: '直接書き込めないこと',
        classification: 'VALID',
        status: 'IGNORED',
      });
      expect(insert.error).not.toBeNull();

      // Nor can they call the insert function and skip the rate limit.
      const rpc = await asUserA.rpc('insert_support_request', rpcArgs(a.user.id, '直接呼べないこと'));
      expect(rpc.error).not.toBeNull();
    });
  });
});
