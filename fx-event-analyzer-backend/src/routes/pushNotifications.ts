import type { FastifyInstance } from 'fastify';
import { resolvePlan } from '../authorization/plan.js';
import { ApiError } from '../errors/ApiError.js';
import { planLimitsFor } from '../domain/planLimits.js';
import { isApnsConfigured } from '../push/apnsSender.js';
import {
  listFavoriteCurrencies,
  listPushDevicesForUser,
  listPushHistory,
  registerPushDevice,
  replaceFavoriteCurrencies,
  unregisterPushDevice,
} from '../repositories/pushRepository.js';
import {
  pushDeviceParamsSchema,
  pushHistoryQuerySchema,
  putFavoriteCurrenciesBodySchema,
  registerPushDeviceBodySchema,
} from '../schemas/pushNotifications.js';

const HISTORY_DAYS = 7;

/**
 * プッシュ通知(サーバーからの送信)の API — HQ指示 2026-11-10、push-notifications-spec.md §3。
 * 認証が必要(/api/v1 の auth hook)。どの API も request.user.id の行だけを読み書きする(他人の端末・履歴は 404 / 見えない)。
 *   POST   /notifications/push/devices                端末の登録(201 新規 / 200 更新)
 *   GET    /notifications/push/devices                自分の端末
 *   DELETE /notifications/push/devices/{id}           端末を外す(ログアウト時など)
 *   GET    /notifications/push/favorite-currencies    お気に入り通貨
 *   PUT    /notifications/push/favorite-currencies    お気に入り通貨を置き換え(プランの上限 favorites_max)
 *   GET    /notifications/push/history                直近7日の送信の予定・結果
 *   GET    /notifications/push/status                 サーバーからの送信が使えるか(false の間、iOS はローカル通知を続ける)
 * 通知の条件は GET /settings の通知設定(SCR-016)をそのまま使う(この API では変えない)。
 */
export function registerPushNotificationRoutes(app: FastifyInstance): void {
  app.get('/notifications/push/status', () => ({ server_push_available: isApnsConfigured() }));

  app.post('/notifications/push/devices', async (request, reply) => {
    const userId = request.user!.id;
    const body = registerPushDeviceBodySchema.parse(request.body);
    const { device, created } = await registerPushDevice(app.supabase, userId, {
      device_token: body.device_token,
      environment: body.environment,
      app_version: body.app_version ?? null,
    });
    return reply.status(created ? 201 : 200).send(device);
  });

  app.get('/notifications/push/devices', async (request) => {
    const userId = request.user!.id;
    return { items: await listPushDevicesForUser(app.supabase, userId) };
  });

  app.delete('/notifications/push/devices/:id', async (request) => {
    const userId = request.user!.id;
    const { id } = pushDeviceParamsSchema.parse(request.params);
    const device = await unregisterPushDevice(app.supabase, userId, id);
    if (!device) throw ApiError.notFound('Device not found.');
    return device;
  });

  app.get('/notifications/push/favorite-currencies', async (request) => {
    const userId = request.user!.id;
    const [codes, plan] = await Promise.all([
      listFavoriteCurrencies(app.supabase, userId),
      resolvePlan(app.supabase, userId),
    ]);
    return { currency_codes: codes, limit: planLimitsFor(plan).favorites_max };
  });

  app.put('/notifications/push/favorite-currencies', async (request) => {
    const userId = request.user!.id;
    const body = putFavoriteCurrenciesBodySchema.parse(request.body);
    const unique = [...new Set(body.currency_codes)];
    const plan = await resolvePlan(app.supabase, userId);
    const max = planLimitsFor(plan).favorites_max;
    if (max !== null && unique.length > max) {
      throw ApiError.planLimitExceeded(`favorite currencies: at most ${max} on the ${plan} plan.`, 'PRO');
    }
    return { currency_codes: await replaceFavoriteCurrencies(app.supabase, userId, unique), limit: max };
  });

  app.get('/notifications/push/history', async (request) => {
    const userId = request.user!.id;
    const query = pushHistoryQuerySchema.parse(request.query);
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
    return { items: await listPushHistory(app.supabase, userId, since, query.limit) };
  });
}
