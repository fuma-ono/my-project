import { z } from 'zod';
import { ApiError } from '../errors/ApiError.js';
import { isProProductId, type ProProductId } from './products.js';

/** The subset of Apple's JWSTransactionDecodedPayload this Backend reads.
 * Unknown fields are kept (passthrough) so nothing Apple adds breaks parsing. */
const transactionPayloadSchema = z
  .object({
    transactionId: z.string().min(1),
    originalTransactionId: z.string().min(1),
    bundleId: z.string(),
    productId: z.string(),
    type: z.string(),
    environment: z.string(),
    purchaseDate: z.number(),
    originalPurchaseDate: z.number(),
    expiresDate: z.number().optional(),
    revocationDate: z.number().optional(),
    appAccountToken: z.string().optional(),
    offerType: z.number().optional(),
    offerDiscountType: z.string().optional(),
  })
  .passthrough();

/** The subset of Apple's JWSRenewalInfoDecodedPayload this Backend reads. */
const renewalInfoPayloadSchema = z
  .object({
    originalTransactionId: z.string().min(1),
    environment: z.string(),
    autoRenewStatus: z.number(),
  })
  .passthrough();

export type TransactionPayload = z.infer<typeof transactionPayloadSchema>;
export type RenewalInfoPayload = z.infer<typeof renewalInfoPayloadSchema>;

export type AppStoreEnvironment = 'Production' | 'Sandbox';
export type SubscriptionStatus = 'ACTIVE' | 'CANCELED' | 'EXPIRED' | 'TRIAL';

export interface AppStoreSubscriptionState {
  originalTransactionId: string;
  transactionId: string;
  productId: ProProductId;
  environment: AppStoreEnvironment;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string;
  autoRenew: boolean | null;
  revokedAt: string | null;
}

const AUTO_RENEWABLE_SUBSCRIPTION = 'Auto-Renewable Subscription';
const INTRODUCTORY_OFFER = 1;

export interface ResolveOptions {
  expectedBundleId: string;
  userId: string;
  now: Date;
}

function invalid(message: string): ApiError {
  return ApiError.validation(message);
}

/**
 * Turns a verified transaction (+ optional verified renewal info) into the
 * subscription state to store, rejecting anything that isn't one of our
 * own Pro subscriptions bought by this user.
 *
 * Ownership: the iOS client purchases with `appAccountToken` = the Supabase
 * user id, so a transaction can only ever be applied to the account that
 * bought it — replaying someone else's signed transaction is rejected.
 *
 * Status (api-design.md §26):
 * - revoked (refund / Family Sharing removal) or past expiresDate → EXPIRED
 * - auto-renew turned off but still within the period → CANCELED
 * - free-trial introductory offer → TRIAL
 * - otherwise → ACTIVE
 */
export function resolveSubscriptionState(
  rawTransaction: Record<string, unknown>,
  rawRenewalInfo: Record<string, unknown> | null,
  options: ResolveOptions,
): AppStoreSubscriptionState {
  const parsed = transactionPayloadSchema.safeParse(rawTransaction);
  if (!parsed.success) {
    throw invalid('signed_transaction: payload is missing required fields');
  }
  const transaction = parsed.data;

  if (transaction.bundleId !== options.expectedBundleId) {
    throw invalid('signed_transaction: bundleId does not match this app');
  }
  if (transaction.type !== AUTO_RENEWABLE_SUBSCRIPTION || !isProProductId(transaction.productId)) {
    throw invalid('signed_transaction: not an FX Event Analyzer Pro subscription');
  }
  if (transaction.environment !== 'Production' && transaction.environment !== 'Sandbox') {
    throw invalid('signed_transaction: unsupported environment');
  }
  if (transaction.expiresDate === undefined) {
    throw invalid('signed_transaction: subscription has no expiresDate');
  }
  if (transaction.appAccountToken?.toLowerCase() !== options.userId.toLowerCase()) {
    throw ApiError.forbidden('This purchase was not made with this account.');
  }

  let renewalInfo: RenewalInfoPayload | null = null;
  if (rawRenewalInfo) {
    const parsedRenewal = renewalInfoPayloadSchema.safeParse(rawRenewalInfo);
    if (!parsedRenewal.success) {
      throw invalid('signed_renewal_info: payload is missing required fields');
    }
    renewalInfo = parsedRenewal.data;
    if (
      renewalInfo.originalTransactionId !== transaction.originalTransactionId ||
      renewalInfo.environment !== transaction.environment
    ) {
      throw invalid('signed_renewal_info: does not belong to signed_transaction');
    }
  }

  const autoRenew = renewalInfo ? renewalInfo.autoRenewStatus === 1 : null;
  const expired = transaction.revocationDate !== undefined || transaction.expiresDate <= options.now.getTime();

  let status: SubscriptionStatus;
  if (expired) {
    status = 'EXPIRED';
  } else if (autoRenew === false) {
    status = 'CANCELED';
  } else if (transaction.offerType === INTRODUCTORY_OFFER && transaction.offerDiscountType === 'FREE_TRIAL') {
    status = 'TRIAL';
  } else {
    status = 'ACTIVE';
  }

  return {
    originalTransactionId: transaction.originalTransactionId,
    transactionId: transaction.transactionId,
    productId: transaction.productId,
    environment: transaction.environment,
    status,
    startedAt: new Date(transaction.originalPurchaseDate).toISOString(),
    expiresAt: new Date(transaction.expiresDate).toISOString(),
    autoRenew,
    revokedAt: transaction.revocationDate !== undefined ? new Date(transaction.revocationDate).toISOString() : null,
  };
}
