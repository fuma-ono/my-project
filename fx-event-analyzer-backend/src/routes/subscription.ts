import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { applyAppStoreSubscription, getActiveSubscription } from '../repositories/subscriptionsRepository.js';
import { verifySubscriptionBodySchema } from '../schemas/subscription.js';
import { resolveSubscriptionState } from '../storekit/appStoreTransaction.js';
import { PRO_ONLY_FEATURE_CODES } from '../storekit/products.js';
import { SignedDataVerificationError } from '../storekit/signedDataVerifier.js';

export function registerSubscriptionRoutes(app: FastifyInstance): void {
  app.get('/subscription', async (request) => {
    const userId = request.user!.id;
    const subscription = await getActiveSubscription(app.supabase, userId);

    if (!subscription) {
      // No subscriptions row at all is a legitimate state (never
      // subscribed) — api-design.md §25/§26 don't define this edge case
      // explicitly, so the safest, most defensible default is: report the
      // implicit FREE tier rather than a 404 (this is not an error state).
      // Flagged as a minor design-clarification candidate in the Phase 2
      // report, not applied as a silent spec change.
      return { plan: 'FREE', status: null, started_at: null, expires_at: null, product_id: null };
    }

    return subscription;
  });

  /**
   * POST /subscription/verify (api-design.md §25.1, HQ確定 2026-10-02).
   * The client sends what StoreKit 2 gave it after a purchase / restore /
   * on launch; the Backend re-verifies Apple's signature itself (never
   * trusting the client's own verification), then stores the result. The
   * response has the same shape as GET /subscription, and the Backend's
   * stored state — not StoreKit on the device — is what Pro gating uses.
   */
  app.post('/subscription/verify', async (request) => {
    const userId = request.user!.id;
    const body = verifySubscriptionBodySchema.parse(request.body);

    const verify = async (field: string, jws: string) => {
      try {
        return await app.signedDataVerifier.verify(jws);
      } catch (error) {
        if (error instanceof SignedDataVerificationError) {
          throw ApiError.validation(`${field}: ${error.message}`);
        }
        throw error;
      }
    };

    const transaction = await verify('signed_transaction', body.signed_transaction);
    const renewalInfo = body.signed_renewal_info ? await verify('signed_renewal_info', body.signed_renewal_info) : null;

    const state = resolveSubscriptionState(transaction, renewalInfo, {
      expectedBundleId: app.env.APP_STORE_BUNDLE_ID,
      userId,
      now: new Date(),
    });

    return applyAppStoreSubscription(app.supabase, userId, state, PRO_ONLY_FEATURE_CODES);
  });
}
