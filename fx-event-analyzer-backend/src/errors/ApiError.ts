/**
 * Error codes from api-design.md §4 (Error Response). DATA_PENDING /
 * DATA_UNAVAILABLE / NOT_ANALYZABLE are deliberately absent — those are
 * never HTTP errors, they are a 200 response with a status field
 * (api-design.md §4/§7).
 */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'EVENT_NOT_FOUND'
  | 'INDICATOR_NOT_FOUND'
  | 'FX_PAIR_NOT_FOUND'
  | 'SPEECH_NOT_FOUND'
  | 'SUBSCRIPTION_REQUIRED'
  | 'FEATURE_NOT_ENTITLED'
  | 'PLAN_LIMIT_EXCEEDED';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  EVENT_NOT_FOUND: 404,
  INDICATOR_NOT_FOUND: 404,
  FX_PAIR_NOT_FOUND: 404,
  SPEECH_NOT_FOUND: 404,
  SUBSCRIPTION_REQUIRED: 403,
  FEATURE_NOT_ENTITLED: 403,
  PLAN_LIMIT_EXCEEDED: 403,
};

/** Thrown anywhere in the request lifecycle; the global error handler
 * (src/plugins/errorHandler.ts) maps it to api-design.md §4's
 * `{ error: { code, message } }` body and the matching HTTP status.
 * `details` are extra fields merged into that `error` object (e.g.
 * PLAN_LIMIT_EXCEEDED's `required_plan`). */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }

  static unauthorized(message = 'Authentication required.'): ApiError {
    return new ApiError('UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have permission to access this resource.'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found.'): ApiError {
    return new ApiError('NOT_FOUND', message);
  }

  static validation(message: string): ApiError {
    return new ApiError('VALIDATION_ERROR', message);
  }

  static featureNotEntitled(message = 'This feature requires a higher plan.'): ApiError {
    return new ApiError('FEATURE_NOT_ENTITLED', message);
  }

  /** 403: the user's plan doesn't allow this, but `requiredPlan` would
   * (api-design.md §4 / §28.1). */
  static planLimitExceeded(message: string, requiredPlan: string): ApiError {
    return new ApiError('PLAN_LIMIT_EXCEEDED', message, { required_plan: requiredPlan });
  }

  static rateLimited(message = 'Too many requests. Please try again later.'): ApiError {
    return new ApiError('RATE_LIMITED', message);
  }

  static internal(message = 'Internal server error.'): ApiError {
    return new ApiError('INTERNAL_ERROR', message);
  }
}
