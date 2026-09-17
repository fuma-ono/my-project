import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors/ApiError.js';

describe('ApiError', () => {
  it('maps each factory to the status code api-design.md §4 specifies', () => {
    expect(ApiError.unauthorized().statusCode).toBe(401);
    expect(ApiError.forbidden().statusCode).toBe(403);
    expect(ApiError.notFound().statusCode).toBe(404);
    expect(ApiError.validation('bad input').statusCode).toBe(422);
    expect(ApiError.featureNotEntitled().statusCode).toBe(403);
    expect(ApiError.internal().statusCode).toBe(500);
  });

  it('maps domain-specific not-found codes to 404', () => {
    expect(new ApiError('EVENT_NOT_FOUND', 'x').statusCode).toBe(404);
    expect(new ApiError('INDICATOR_NOT_FOUND', 'x').statusCode).toBe(404);
    expect(new ApiError('FX_PAIR_NOT_FOUND', 'x').statusCode).toBe(404);
  });

  it('carries the code and message through for the error handler to read', () => {
    const error = ApiError.validation('fx_pair_id is required.');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('fx_pair_id is required.');
    expect(error).toBeInstanceOf(Error);
  });
});
