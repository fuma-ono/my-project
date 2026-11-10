/**
 * APNs(Apple Push Notification service)への送信 — HQ指示 2026-11-10「プッシュ通知バックエンド実装」。
 * 新しい依存・有料サービスなし(Node の http2・crypto だけ)。トークン方式の認証(.p8 の鍵、ES256 の JWT)。
 *
 * 実際に送るのに必要なもの(どれも未設定。HQ の承認なしに追加しない — push-notifications-spec.md「実送信の条件」):
 *   APNS_KEY_ID・APNS_TEAM_ID・APNS_PRIVATE_KEY(.p8 の中身の PEM)・APNS_BUNDLE_ID(省略時は APP_STORE_BUNDLE_ID)
 * そろっていなければ createApnsSenderFromEnv は null を返し、送信のジョブは何も送らない(行は PENDING のまま期限で SKIPPED)。
 *
 * 応答の分類(Apple の「Handling notification responses from APNs」):
 *   200 → SUCCESS(apns-id)
 *   410(Unregistered)・400 の BadDeviceToken / DeviceTokenNotForTopic → INVALID_TOKEN(端末を無効にする)
 *   429(TooManyRequests・TooManyProviderTokenUpdates)・500・503・通信の失敗・タイムアウト → RETRYABLE_ERROR
 *     (タイムアウトは、APNs が受け取った後かもしれない — 結果は不明。再試行するので二重に届くことがある。push-notifications-spec.md §5.2)
 *   403 ExpiredProviderToken → JWT を作り直して、その場で1回だけ送り直す(それでも 403 なら CONFIG_ERROR)
 *   403 のほか(InvalidProviderToken・MissingProviderToken・BadCertificate など)→ CONFIG_ERROR(鍵・設定の問題。
 *     通知ごとに再試行しても直らないので、送信のジョブはその回の送信を止め、取り出した行を差し戻す)
 *   それ以外の 4xx(BadPath・PayloadTooLarge・BadTopic など)→ PERMANENT_ERROR(再試行しない)
 */
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { DeliveryOutcome } from '../domain/pushNotifications.js';

export interface PushMessage {
  /** apns-collapse-id にも使う(64バイト以下) */
  notificationId: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  /** これを過ぎたら APNs も配信をやめる */
  expiresAt: string;
}

export interface PushDevice {
  id: string;
  device_token: string;
  environment: 'SANDBOX' | 'PRODUCTION';
}

export interface SendResult {
  outcome: DeliveryOutcome;
  httpStatus: number | null;
  apnsId: string | null;
  reason: string | null;
}

export interface PushSender {
  send(device: PushDevice, message: PushMessage): Promise<SendResult>;
  close?(): void;
}

export interface ApnsRequest {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface ApnsResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface ApnsTransport {
  post(request: ApnsRequest): Promise<ApnsResponse>;
  close?(): void;
}

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** .p8 の中身(PEM) */
  privateKey: string;
  bundleId: string;
}

export const APNS_ORIGINS = {
  PRODUCTION: 'https://api.push.apple.com',
  SANDBOX: 'https://api.sandbox.push.apple.com',
} as const;

/** Apple: 認証トークンは 20 分〜60 分の間で作り直す。50 分で作り直す。 */
const TOKEN_TTL_MS = 50 * 60_000;

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** ES256 の JWT(header: alg・kid、claims: iss・iat)。署名は IEEE P1363(r||s、64バイト)。 */
export function createApnsJwt(config: Pick<ApnsConfig, 'keyId' | 'teamId'>, key: KeyObject, now: Date): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now.getTime() / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${base64url(signature)}`;
}

export function classifyApnsResponse(status: number, reason: string | null): DeliveryOutcome {
  if (status === 200) return 'SUCCESS';
  if (status === 410) return 'INVALID_TOKEN';
  if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) return 'INVALID_TOKEN';
  if (status === 403) return 'CONFIG_ERROR';
  if (status === 429 || status >= 500) return 'RETRYABLE_ERROR';
  return 'PERMANENT_ERROR';
}

/** 送信のタイムアウト(Http2ApnsTransport の reject の印)。 */
export class ApnsTimeoutError extends Error {
  constructor(ms: number) {
    super(`APNs did not respond within ${ms} ms`);
    this.name = 'ApnsTimeoutError';
  }
}

/** APNs の本文(aps.alert と、アプリが画面を開くための fx)。 */
export function apnsBody(message: PushMessage): string {
  return JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
    fx: { notification_id: message.notificationId, ...message.payload },
  });
}

export class ApnsSender implements PushSender {
  private readonly key: KeyObject;
  private token: { value: string; createdAtMs: number } | null = null;

  constructor(
    private readonly config: ApnsConfig,
    private readonly transport: ApnsTransport = new Http2ApnsTransport(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = createPrivateKey(config.privateKey);
  }

  private providerToken(forceNew = false): string {
    const nowMs = this.now().getTime();
    if (forceNew || !this.token || nowMs - this.token.createdAtMs >= TOKEN_TTL_MS) {
      this.token = { value: createApnsJwt(this.config, this.key, this.now()), createdAtMs: nowMs };
    }
    return this.token.value;
  }

  async send(device: PushDevice, message: PushMessage): Promise<SendResult> {
    const first = await this.sendOnce(device, message);
    if (first.httpStatus === 403 && first.reason === 'ExpiredProviderToken') {
      // JWT を作り直して1回だけ送り直す(ExpiredProviderToken は通知の失敗ではない)
      this.token = null;
      return this.sendOnce(device, message);
    }
    return first;
  }

  private async sendOnce(device: PushDevice, message: PushMessage): Promise<SendResult> {
    const expiration = Math.floor(Date.parse(message.expiresAt) / 1000);
    const request: ApnsRequest = {
      origin: APNS_ORIGINS[device.environment],
      path: `/3/device/${device.device_token}`,
      headers: {
        authorization: `bearer ${this.providerToken()}`,
        'apns-topic': this.config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Number.isFinite(expiration) ? expiration : 0),
        'apns-collapse-id': message.notificationId.slice(0, 64),
        'content-type': 'application/json',
      },
      body: apnsBody(message),
    };
    let response: ApnsResponse;
    try {
      response = await this.transport.post(request);
    } catch (error) {
      return {
        outcome: 'RETRYABLE_ERROR',
        httpStatus: null,
        apnsId: null,
        reason:
          error instanceof ApnsTimeoutError
            ? 'TIMEOUT'
            : `NETWORK: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    let reason: string | null = null;
    if (response.status !== 200) {
      try {
        reason = (JSON.parse(response.body) as { reason?: string }).reason ?? null;
      } catch {
        reason = null;
      }
    }
    if (response.status === 403) this.token = null; // 次は JWT を作り直す
    return {
      outcome: classifyApnsResponse(response.status, reason),
      httpStatus: response.status,
      apnsId: response.headers['apns-id'] ?? null,
      reason,
    };
  }

  close(): void {
    this.transport.close?.();
  }
}

/** HTTP/2 で APNs につなぐ(環境ごとに1本の接続を使い回す)。 */
export class Http2ApnsTransport implements ApnsTransport {
  private readonly sessions = new Map<string, ClientHttp2Session>();

  constructor(private readonly timeoutMs = 10_000) {}

  private session(origin: string): ClientHttp2Session {
    const existing = this.sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const created = connect(origin);
    created.on('error', () => this.sessions.delete(origin));
    created.on('close', () => this.sessions.delete(origin));
    this.sessions.set(origin, created);
    return created;
  }

  post(request: ApnsRequest): Promise<ApnsResponse> {
    return new Promise((resolve, reject) => {
      const stream = this.session(request.origin).request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: request.path,
        ...request.headers,
      });
      let status = 0;
      let timedOut = false;
      stream.setTimeout(this.timeoutMs, () => {
        timedOut = true;
        stream.close(constants.NGHTTP2_CANCEL);
        reject(new ApnsTimeoutError(this.timeoutMs));
      });
      const headers: Record<string, string | undefined> = {};
      const chunks: Buffer[] = [];
      stream.on('response', (h) => {
        status = Number(h[constants.HTTP2_HEADER_STATUS]);
        const id = h['apns-id'];
        headers['apns-id'] = Array.isArray(id) ? id[0] : id;
      });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
      stream.on('close', () => {
        if (status === 0 && !timedOut) reject(new Error('APNs stream closed without a response'));
      });
      stream.end(request.body);
    });
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}

/** APNs の送信に必要な環境変数がそろっているか(鍵の中身は読まない)。GET /notifications/push/status。 */
export function isApnsConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(source.APNS_KEY_ID?.trim() && source.APNS_TEAM_ID?.trim() && source.APNS_PRIVATE_KEY?.trim());
}

/** 環境変数がそろっていれば ApnsSender、そうでなければ null(送らない)。 */
export function createApnsSenderFromEnv(source: NodeJS.ProcessEnv = process.env): ApnsSender | null {
  const keyId = source.APNS_KEY_ID?.trim();
  const teamId = source.APNS_TEAM_ID?.trim();
  const privateKey = source.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const bundleId = (source.APNS_BUNDLE_ID ?? source.APP_STORE_BUNDLE_ID ?? 'com.fumaono.fxeventanalyzer').trim();
  if (!keyId || !teamId || !privateKey || !bundleId) return null;
  return new ApnsSender({ keyId, teamId, privateKey, bundleId });
}
