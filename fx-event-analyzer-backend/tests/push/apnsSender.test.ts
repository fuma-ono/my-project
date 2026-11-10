/**
 * APNs への送信(認証情報は使わない。鍵はテストで作る EC P-256、送信は偽の transport)。
 */
import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApnsSender,
  ApnsTimeoutError,
  apnsBody,
  classifyApnsResponse,
  createApnsJwt,
  createApnsSenderFromEnv,
  isApnsConfigured,
  type ApnsRequest,
  type ApnsResponse,
  type ApnsTransport,
} from '../../src/push/apnsSender.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const config = { keyId: 'KEY1234567', teamId: 'TEAM123456', privateKey: pem, bundleId: 'com.example.fx' };
const token = 'ab'.repeat(32);
const device = { id: 'dev-1', device_token: token, environment: 'SANDBOX' as const };
const message = {
  notificationId: '6b0b7c1e-1111-4222-8333-944455556666',
  title: '消費者物価指数（CPI）(US)',
  body: '11/12 22:30 に発表予定です',
  payload: { type: 'PRE_RELEASE', target_kind: 'INDICATOR', target_id: 'ev-1' },
  expiresAt: '2026-11-12T13:32:00.000Z',
};

class FakeTransport implements ApnsTransport {
  requests: ApnsRequest[] = [];
  constructor(private readonly responses: (ApnsResponse | Error)[]) {}
  post(request: ApnsRequest): Promise<ApnsResponse> {
    this.requests.push(request);
    const next = this.responses.shift() ?? { status: 200, headers: { 'apns-id': 'id' }, body: '' };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

describe('createApnsJwt', () => {
  it('is an ES256 JWT (kid, iss, iat) whose P1363 signature verifies with the public key', () => {
    const jwt = createApnsJwt(config, privateKey, new Date('2026-11-12T00:00:00Z'));
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1794441600 });
    const signature = Buffer.from(s!, 'base64url');
    expect(signature).toHaveLength(64);
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(
      true,
    );
  });
});

describe('ApnsSender', () => {
  it('posts to the environment host with the APNs headers and an alert payload', async () => {
    const transport = new FakeTransport([{ status: 200, headers: { 'apns-id': 'apns-123' }, body: '' }]);
    const sender = new ApnsSender(config, transport, () => new Date('2026-11-12T13:25:00Z'));
    const result = await sender.send(device, message);
    expect(result).toEqual({ outcome: 'SUCCESS', httpStatus: 200, apnsId: 'apns-123', reason: null });
    const [req] = transport.requests;
    expect(req!.origin).toBe('https://api.sandbox.push.apple.com');
    expect(req!.path).toBe(`/3/device/${token}`);
    expect(req!.headers).toMatchObject({
      'apns-topic': 'com.example.fx',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Date.parse(message.expiresAt) / 1000),
      'apns-collapse-id': message.notificationId,
    });
    expect(req!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(req!.body)).toEqual({
      aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
      fx: { notification_id: message.notificationId, ...message.payload },
    });
    expect(apnsBody(message)).toBe(req!.body);
    const prod = new FakeTransport([]);
    await new ApnsSender(config, prod).send({ ...device, environment: 'PRODUCTION' }, message);
    expect(prod.requests[0]!.origin).toBe('https://api.push.apple.com');
  });

  it('reuses the provider token; 403 ExpiredProviderToken makes a new one and re-sends once at once; 50 minutes also renew', async () => {
    let now = new Date('2026-11-12T13:00:00Z');
    const transport = new FakeTransport([
      { status: 200, headers: {}, body: '' },
      { status: 403, headers: {}, body: '{"reason":"ExpiredProviderToken"}' },
      { status: 200, headers: { 'apns-id': 'after-renew' }, body: '' },
      { status: 200, headers: {}, body: '' },
    ]);
    const sender = new ApnsSender(config, transport, () => now);
    await sender.send(device, message);
    now = new Date('2026-11-12T13:00:01Z');
    // 403 ExpiredProviderToken → その場で作り直して送り直し、成功
    expect(await sender.send(device, message)).toMatchObject({ outcome: 'SUCCESS', apnsId: 'after-renew' });
    const auth = transport.requests.map((r) => r.headers.authorization);
    expect(auth[1]).toBe(auth[0]); // 使い回し
    expect(auth[2]).not.toBe(auth[1]); // 403 の後は作り直す
    now = new Date('2026-11-12T13:51:00Z');
    await sender.send(device, message);
    expect(transport.requests[3]!.headers.authorization).not.toBe(auth[2]); // 50分で作り直す
  });

  it('a second ExpiredProviderToken, or any other 403, is CONFIG_ERROR (not retried per notification)', async () => {
    const twice = new FakeTransport([
      { status: 403, headers: {}, body: '{"reason":"ExpiredProviderToken"}' },
      { status: 403, headers: {}, body: '{"reason":"ExpiredProviderToken"}' },
    ]);
    expect(await new ApnsSender(config, twice).send(device, message)).toMatchObject({
      outcome: 'CONFIG_ERROR',
      httpStatus: 403,
      reason: 'ExpiredProviderToken',
    });
    expect(twice.requests).toHaveLength(2); // 送り直しは1回だけ
    const invalid = new FakeTransport([{ status: 403, headers: {}, body: '{"reason":"InvalidProviderToken"}' }]);
    expect((await new ApnsSender(config, invalid).send(device, message)).outcome).toBe('CONFIG_ERROR');
    expect(invalid.requests).toHaveLength(1);
  });

  it('a timeout is RETRYABLE_ERROR with reason TIMEOUT', async () => {
    const sender = new ApnsSender(config, new FakeTransport([new ApnsTimeoutError(10_000)]));
    expect(await sender.send(device, message)).toEqual({
      outcome: 'RETRYABLE_ERROR',
      httpStatus: null,
      apnsId: null,
      reason: 'TIMEOUT',
    });
  });

  it('classifies APNs responses and network failures', async () => {
    expect(classifyApnsResponse(200, null)).toBe('SUCCESS');
    expect(classifyApnsResponse(410, 'Unregistered')).toBe('INVALID_TOKEN');
    expect(classifyApnsResponse(400, 'BadDeviceToken')).toBe('INVALID_TOKEN');
    expect(classifyApnsResponse(400, 'DeviceTokenNotForTopic')).toBe('INVALID_TOKEN');
    expect(classifyApnsResponse(400, 'PayloadTooLarge')).toBe('PERMANENT_ERROR');
    expect(classifyApnsResponse(429, 'TooManyRequests')).toBe('RETRYABLE_ERROR');
    expect(classifyApnsResponse(503, 'ServiceUnavailable')).toBe('RETRYABLE_ERROR');
    expect(classifyApnsResponse(403, 'InvalidProviderToken')).toBe('CONFIG_ERROR');
    expect(classifyApnsResponse(403, 'BadCertificateEnvironment')).toBe('CONFIG_ERROR');
    expect(classifyApnsResponse(429, 'TooManyProviderTokenUpdates')).toBe('RETRYABLE_ERROR');
    expect(classifyApnsResponse(500, 'InternalServerError')).toBe('RETRYABLE_ERROR');
    expect(classifyApnsResponse(413, 'PayloadTooLarge')).toBe('PERMANENT_ERROR');
    expect(classifyApnsResponse(400, 'BadTopic')).toBe('PERMANENT_ERROR');
    const sender = new ApnsSender(
      config,
      new FakeTransport([new Error('ECONNRESET'), { status: 410, headers: {}, body: '{"reason":"Unregistered"}' }]),
    );
    expect(await sender.send(device, message)).toMatchObject({
      outcome: 'RETRYABLE_ERROR',
      httpStatus: null,
      reason: 'NETWORK: ECONNRESET',
    });
    expect(await sender.send(device, message)).toMatchObject({
      outcome: 'INVALID_TOKEN',
      httpStatus: 410,
      reason: 'Unregistered',
    });
  });
});

describe('createApnsSenderFromEnv', () => {
  it('returns null unless key id, team id and private key are all set (no credentials are bundled)', () => {
    expect(createApnsSenderFromEnv({})).toBeNull();
    expect(createApnsSenderFromEnv({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' })).toBeNull();
    expect(createApnsSenderFromEnv({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: pem })).toBeInstanceOf(
      ApnsSender,
    );
    // .env の1行の形(\n をエスケープ)も読める
    expect(
      createApnsSenderFromEnv({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: pem.replace(/\n/g, '\\n') }),
    ).toBeInstanceOf(ApnsSender);
  });
});

describe('isApnsConfigured', () => {
  it('is true only when key id, team id and private key are all set', () => {
    expect(isApnsConfigured({})).toBe(false);
    expect(isApnsConfigured({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: ' ' })).toBe(false);
    expect(isApnsConfigured({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRIVATE_KEY: 'pem' })).toBe(true);
  });
});
