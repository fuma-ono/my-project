import { describe, expect, it } from 'vitest';
import { updateAccountBodySchema } from '../../src/schemas/account.js';

const parse = (body: unknown) => updateAccountBodySchema.safeParse(body).success;

describe('updateAccountBodySchema', () => {
  it('accepts a partial body', () => {
    expect(parse({})).toBe(true);
    expect(parse({ display_name: '山田 太郎' })).toBe(true);
    expect(parse({ birth_date: '1990-01-01' })).toBe(true);
    expect(parse({ display_name: null, birth_date: null })).toBe(true);
  });

  it('rejects a blank display name', () => {
    expect(parse({ display_name: '' })).toBe(false);
    expect(parse({ display_name: '   ' })).toBe(false);
  });

  it('accepts only real calendar dates from 1900 up to today', () => {
    expect(parse({ birth_date: '1900-01-01' })).toBe(true);
    expect(parse({ birth_date: '2000-02-29' })).toBe(true);
    expect(parse({ birth_date: '1899-12-31' })).toBe(false);
    expect(parse({ birth_date: '2001-02-29' })).toBe(false);
    expect(parse({ birth_date: '1990-13-01' })).toBe(false);
    expect(parse({ birth_date: '1990/01/01' })).toBe(false);
    expect(parse({ birth_date: '9999-01-01' })).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(parse({ email: 'a@example.com' })).toBe(false);
  });
});
