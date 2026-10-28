import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import {
  ECB_WEEKLY_PROVIDER,
  ecbReconcileOptions,
  parseEcbWeeklySchedule,
} from '../../src/ingestion/adapters/ecbWeeklySchedule.js';
import { ingestSpeeches } from '../../src/ingestion/pipelines/speeches.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
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

/**
 * ECB の週間予定の消えた予定(HQ判断 2026-10-28 R1・R2)を実際の Postgres で確かめる: 中止・時刻の変更が
 * DB トリガー(event_schedule_changes)に記録され、中止の行がカレンダーと通知の予定から外れること。
 * 他のテストと重ならない 2027年12月の週(カレンダーのプランの上限 = 2年後の1月1日より前)を使い、afterAll で消す。
 */
describe.skipIf(!integration)('ECB weekly schedule: reconcile against the real DB', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const now = new Date('2027-12-06T00:00:00Z');
  const RANGE = 'from=2027-12-06T00:00:00Z&to=2027-12-11T00:00:00Z';

  const day = (date: string, body: string) => `<dt>${date}</dt><dd>${body}</dd>`;
  const lagarde = (time: string) =>
    `<strong>Board member:</strong> Christine Lagarde<br><strong>Event:</strong> Keynote speech<br><strong>Time:</strong> ${time}<br>`;
  const stats = '<strong>Event:</strong> Statistics<br><strong>Time:</strong> 10:00<br>';
  const page = (...days: string[]) =>
    `<dl>${day('Monday, 6 December 2027', stats)}${days.join('')}${day('Friday, 10 December 2027', stats)}</dl>`;

  async function ingest(html: string): Promise<JobCounters> {
    const result = parseEcbWeeklySchedule(html);
    const counters = new JobCounters();
    await ingestSpeeches(
      ECB_WEEKLY_PROVIDER,
      result.speeches,
      {
        store: createIngestionRepository(ctx.serviceClient),
        now: () => now,
        reconcile: ecbReconcileOptions(result),
      },
      counters,
    );
    return counters;
  }

  async function rows() {
    const { data, error } = await ctx.serviceClient
      .from('speech_events')
      .select('id, provider_event_id, statement_datetime, status')
      .eq('provider', ECB_WEEKLY_PROVIDER)
      .like('provider_event_id', '2027-12-0%')
      .order('statement_datetime');
    if (error) throw error;
    return data as { id: string; provider_event_id: string; statement_datetime: string; status: string }[];
  }

  async function cleanup(): Promise<void> {
    const ids = (await rows()).map((row) => row.id);
    if (ids.length > 0) {
      await ctx.serviceClient.from('event_schedule_changes').delete().in('target_id', ids);
      await ctx.serviceClient.from('speech_events').delete().in('id', ids);
    }
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('moved → RESCHEDULED on the same row, deleted → CANCELLED; cancelled rows leave the calendar and the notifications', async () => {
    await ingest(
      page(
        day('Tuesday, 7 December 2027', lagarde('10:00 CET')),
        day('Thursday, 9 December 2027', lagarde('12:00 CET')),
      ),
    );
    const before = await rows();
    expect(before.map((row) => [row.provider_event_id, row.status])).toEqual([
      ['2027-12-07_1000_christine-lagarde', 'SCHEDULED'],
      ['2027-12-09_1200_christine-lagarde', 'SCHEDULED'],
    ]);

    // 1/7 は 10:00→11:30 に変更、1/9 は削除
    const counters = await ingest(page(day('Tuesday, 7 December 2027', lagarde('11:30 CET'))));
    expect(counters.details.rescheduled_speeches).toHaveLength(1);
    expect(counters.details.cancelled_speeches).toEqual(['2027-12-09_1200_christine-lagarde']);
    const after = await rows();
    expect(after.map((row) => [row.id, row.provider_event_id, Date.parse(row.statement_datetime), row.status])).toEqual(
      [
        [before[0]!.id, '2027-12-07_1130_christine-lagarde', Date.parse('2027-12-07T10:30:00Z'), 'SCHEDULED'],
        [before[1]!.id, '2027-12-09_1200_christine-lagarde', Date.parse('2027-12-09T11:00:00Z'), 'CANCELLED'],
      ],
    );

    // DB トリガーの記録(受信箱の「予定の変更」の元)
    const { data: changes, error } = await ctx.serviceClient
      .from('event_schedule_changes')
      .select('kind, target_id, change_type, old_datetime, new_datetime')
      .in('target_id', [before[0]!.id, before[1]!.id]);
    if (error) throw error;
    const byTarget = new Map((changes ?? []).map((change) => [change.target_id as string, change]));
    expect(byTarget.get(before[0]!.id)).toMatchObject({ kind: 'SPEECH', change_type: 'RESCHEDULED' });
    expect(Date.parse(byTarget.get(before[0]!.id)!.new_datetime as string)).toBe(Date.parse('2027-12-07T10:30:00Z'));
    expect(byTarget.get(before[1]!.id)).toMatchObject({ kind: 'SPEECH', change_type: 'CANCELLED', new_datetime: null });
    expect(changes).toHaveLength(2);

    const user = await createTestUser(ctx);
    users.push(user);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    const headers = { authorization: `Bearer ${user.accessToken}` };

    // カレンダー: 中止の行は出ない。変更後の時刻の1行だけ
    const calendar = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${RANGE}`, headers });
    expect(calendar.statusCode).toBe(200);
    const speechItems = (JSON.parse(calendar.body).items as { kind: string; id: string; datetime: string }[]).filter(
      (item) => item.kind === 'SPEECH' && [before[0]!.id, before[1]!.id].includes(item.id),
    );
    expect(speechItems.map((item) => [item.id, Date.parse(item.datetime)])).toEqual([
      [before[0]!.id, Date.parse('2027-12-07T10:30:00Z')],
    ]);

    // 通知の予定: 中止の行は候補にならない。変更後の時刻で1回だけ
    const upcoming = await ctx.app.inject({ method: 'GET', url: `/api/v1/notifications/upcoming?${RANGE}`, headers });
    expect(upcoming.statusCode).toBe(200);
    const notified = (JSON.parse(upcoming.body).items as { id: string; scheduled_at: string }[]).filter((item) =>
      [before[0]!.id, before[1]!.id].includes(item.id),
    );
    expect(notified.map((item) => [item.id, Date.parse(item.scheduled_at)])).toEqual([
      [before[0]!.id, Date.parse('2027-12-07T10:30:00Z')],
    ]);

    // 一覧(GET /speeches)は状態で絞らない(api-design §14.4・既存の設計)。中止の行は status: CANCELLED で返り、
    // iOS は「中止」のラベルを付けて過去の側に並べる(予定の側には出ない)
    const list = await ctx.app.inject({ method: 'GET', url: `/api/v1/speeches?${RANGE}`, headers });
    expect(list.statusCode).toBe(200);
    const listed = (JSON.parse(list.body).data as { speech_id: string; status: string }[]).filter((row) =>
      [before[0]!.id, before[1]!.id].includes(row.speech_id),
    );
    expect(Object.fromEntries(listed.map((row) => [row.speech_id, row.status]))).toEqual({
      [before[0]!.id]: 'SCHEDULED',
      [before[1]!.id]: 'CANCELLED',
    });
  });
});
