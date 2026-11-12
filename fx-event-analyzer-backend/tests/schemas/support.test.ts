import { describe, expect, it } from 'vitest';
import { createSupportRequestBodySchema } from '../../src/schemas/support.js';

const parse = (body: unknown) => createSupportRequestBodySchema.safeParse(body);
const valid = { kind: 'INQUIRY', category: 'NOTIFICATION', body: '通知が届きません' };

describe('createSupportRequestBodySchema', () => {
  it('accepts the minimal body and fills device info with null', () => {
    const result = parse(valid);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...valid, app_version: null, os_version: null, device_model: null });
  });

  it('trims the body and device info; blank device info becomes null', () => {
    const result = parse({ ...valid, body: '  通知が届きません \n', app_version: ' 1.0.0 ', os_version: '  ' });
    expect(result.data).toMatchObject({ body: '通知が届きません', app_version: '1.0.0', os_version: null });
  });

  it('accepts every kind and category', () => {
    for (const kind of ['INQUIRY', 'FEEDBACK']) {
      for (const category of ['ACCOUNT', 'BILLING', 'NOTIFICATION', 'CHART', 'DATA', 'BUG', 'OTHER']) {
        expect(parse({ ...valid, kind, category }).success).toBe(true);
      }
    }
  });

  it('accepts null device info', () => {
    expect(parse({ ...valid, app_version: null, os_version: null, device_model: null }).success).toBe(true);
  });

  it.each([
    ['missing kind', { category: 'OTHER', body: 'こんにちは' }],
    ['unknown kind', { ...valid, kind: 'COMPLAINT' }],
    ['unknown category', { ...valid, category: 'PRICE' }],
    ['missing body', { kind: 'INQUIRY', category: 'OTHER' }],
    ['empty body', { ...valid, body: '' }],
    ['whitespace-only body', { ...valid, body: ' \n\t ' }],
    ['body over 2000 characters', { ...valid, body: 'あ'.repeat(2001) }],
    ['device info over 100 characters', { ...valid, device_model: 'x'.repeat(101) }],
    ['non-string body', { ...valid, body: 123 }],
    ['unknown field', { ...valid, user_id: '00000000-0000-0000-0000-000000000000' }],
  ])('rejects %s', (_label, body) => {
    expect(parse(body).success).toBe(false);
  });

  it('accepts a body of exactly 2000 characters', () => {
    expect(parse({ ...valid, body: 'あ'.repeat(2000) }).success).toBe(true);
  });
});
