import { SignJWT, importPKCS8 } from 'jose';

/**
 * Sign in with Apple token revocation on account deletion
 * (App Store Review Guideline 5.1.1(v)). Best effort: this module never
 * throws and never blocks deletion. Nothing secret (key, client_secret,
 * authorization code, refresh token) and no user identifier is ever logged;
 * the refresh token lives only in memory for the duration of the call.
 */

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const CLIENT_SECRET_TTL_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 5000;

export interface AppleRevocationConfig {
  APPLE_TEAM_ID?: string | undefined;
  APPLE_KEY_ID?: string | undefined;
  APPLE_PRIVATE_KEY?: string | undefined;
  APPLE_CLIENT_ID?: string | undefined;
}

export interface RevocationLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export type RevocationResult = 'revoked' | 'skipped' | 'failed';

interface ResolvedConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  clientId: string;
}

function resolveConfig(config: AppleRevocationConfig): ResolvedConfig | null {
  const { APPLE_TEAM_ID: teamId, APPLE_KEY_ID: keyId, APPLE_PRIVATE_KEY: key, APPLE_CLIENT_ID: clientId } = config;
  if (!teamId || !keyId || !key || !clientId) return null;
  return { teamId, keyId, privateKey: key.replace(/\\n/g, '\n'), clientId };
}

/** Short-lived ES256 client_secret JWT (Apple allows up to 6 months; we use 5 minutes). */
export async function buildClientSecret(
  config: AppleRevocationConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const resolved = resolveConfig(config);
  if (!resolved) throw new Error('Apple credentials are not configured.');
  const key = await importPKCS8(resolved.privateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: resolved.keyId })
    .setIssuer(resolved.teamId)
    .setSubject(resolved.clientId)
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + CLIENT_SECRET_TTL_SECONDS)
    .sign(key);
}

class RevocationStepError extends Error {
  constructor(
    readonly step: 'client_secret' | 'token_exchange' | 'revoke',
    readonly reason: string,
    readonly status?: number,
  ) {
    super(reason);
  }
}

async function postForm(
  fetchFn: typeof fetch,
  url: string,
  form: Record<string, string>,
  step: 'token_exchange' | 'revoke',
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new RevocationStepError(step, timedOut ? 'timeout' : 'network_error');
  }
  if (!response.ok) {
    let appleError = 'http_error';
    try {
      const body = (await response.json()) as { error?: unknown };
      // Only Apple's short error code (e.g. invalid_grant) is kept, never the body.
      if (typeof body.error === 'string' && /^[a-z_]{1,40}$/.test(body.error)) appleError = body.error;
    } catch {
      // keep the generic reason
    }
    throw new RevocationStepError(step, appleError, response.status);
  }
  return response;
}

/**
 * Exchanges the one-time authorization code for a refresh token and revokes
 * it. One attempt, 5 s timeout per call. Returns 'skipped' when Apple
 * credentials are not fully configured, 'failed' on any error.
 */
export async function revokeAppleAccess(params: {
  config: AppleRevocationConfig;
  authorizationCode: string;
  logger: RevocationLogger;
  fetch?: typeof fetch | undefined;
}): Promise<RevocationResult> {
  const { logger } = params;
  const config = resolveConfig(params.config);
  if (!config) {
    logger.warn({ event: 'siwa_revoke_skipped', reason: 'apple_env_unset' }, 'Sign in with Apple revocation skipped');
    return 'skipped';
  }
  const fetchFn = params.fetch ?? fetch;
  try {
    let clientSecret: string;
    try {
      clientSecret = await buildClientSecret(params.config);
    } catch {
      throw new RevocationStepError('client_secret', 'invalid_private_key');
    }
    const base = { client_id: config.clientId, client_secret: clientSecret };

    const tokenResponse = await postForm(
      fetchFn,
      TOKEN_URL,
      { ...base, grant_type: 'authorization_code', code: params.authorizationCode },
      'token_exchange',
    );
    let refreshToken: unknown;
    try {
      refreshToken = ((await tokenResponse.json()) as { refresh_token?: unknown }).refresh_token;
    } catch {
      refreshToken = undefined;
    }
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      throw new RevocationStepError('token_exchange', 'no_refresh_token', tokenResponse.status);
    }

    await postForm(fetchFn, REVOKE_URL, { ...base, token: refreshToken, token_type_hint: 'refresh_token' }, 'revoke');
    logger.info({ event: 'siwa_revoked' }, 'Sign in with Apple token revoked');
    return 'revoked';
  } catch (error) {
    const known = error instanceof RevocationStepError ? error : null;
    logger.warn(
      {
        event: 'siwa_revoke_failed',
        step: known?.step ?? 'unexpected',
        reason: known?.reason ?? 'unexpected_error',
        status: known?.status,
      },
      'Sign in with Apple revocation failed',
    );
    return 'failed';
  }
}
