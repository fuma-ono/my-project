import { X509Certificate } from 'node:crypto';
import { compactVerify, decodeProtectedHeader } from 'jose';

/**
 * Verifies App Store signed data (JWS) offline — StoreKit 2's
 * `Transaction.jwsRepresentation` / `RenewalInfo.jwsRepresentation` today,
 * and the same format App Store Server Notifications / App Store Server API
 * responses use, so those can reuse this verifier when they're added.
 *
 * Mirrors what Apple's own App Store Server Library checks, using only
 * node:crypto + jose (no extra dependency):
 * 1. header alg is ES256 and x5c carries [leaf, intermediate, (root)]
 * 2. intermediate is a CA issued and signed by the *pinned* Apple root —
 *    the root inside x5c is ignored
 * 3. leaf is issued and signed by that intermediate
 * 4. both carry Apple's marker extensions (OIDs below)
 * 5. the JWS signature verifies with the leaf's public key
 * 6. every certificate was valid at the payload's signedDate
 *
 * Not done (MVP, HQ確定 2026-10-02): online OCSP revocation checks of the
 * chain and App Store Server API look-ups.
 */

/** 1.2.840.113635.100.6.11.1 — Apple's "App Store receipt signing" leaf marker. */
const LEAF_MARKER_OID_DER = Buffer.from('060a2a864886f76364060b01', 'hex');
/** 1.2.840.113635.100.6.2.1 — Apple WWDR intermediate marker. */
const INTERMEDIATE_MARKER_OID_DER = Buffer.from('060a2a864886f76364060201', 'hex');

export type SignedDataFailureReason = 'malformed' | 'untrusted_chain' | 'invalid_signature' | 'expired_certificate';

export class SignedDataVerificationError extends Error {
  readonly reason: SignedDataFailureReason;

  constructor(reason: SignedDataFailureReason, message: string) {
    super(message);
    this.name = 'SignedDataVerificationError';
    this.reason = reason;
  }
}

export interface SignedDataVerifier {
  /** Returns the verified, decoded JWS payload. Throws
   * {@link SignedDataVerificationError} on any failure. */
  verify(jws: string): Promise<Record<string, unknown>>;
}

function parseCertificate(base64Der: unknown): X509Certificate {
  if (typeof base64Der !== 'string') {
    throw new SignedDataVerificationError('malformed', 'x5c entry is not a string.');
  }
  try {
    return new X509Certificate(Buffer.from(base64Der, 'base64'));
  } catch {
    throw new SignedDataVerificationError('malformed', 'x5c entry is not a valid certificate.');
  }
}

function isValidAt(certificate: X509Certificate, at: Date): boolean {
  const from = new Date(certificate.validFrom).getTime();
  const to = new Date(certificate.validTo).getTime();
  return at.getTime() >= from && at.getTime() <= to;
}

export function createSignedDataVerifier(trustedRootPem: string): SignedDataVerifier {
  const trustedRoot = new X509Certificate(trustedRootPem);

  return {
    async verify(jws: string): Promise<Record<string, unknown>> {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(jws);
      } catch {
        throw new SignedDataVerificationError('malformed', 'Not a JWS.');
      }
      if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length < 2) {
        throw new SignedDataVerificationError('malformed', 'Unexpected JWS header.');
      }

      const leaf = parseCertificate(header.x5c[0]);
      const intermediate = parseCertificate(header.x5c[1]);

      const chainOk =
        intermediate.ca &&
        intermediate.checkIssued(trustedRoot) &&
        intermediate.verify(trustedRoot.publicKey) &&
        leaf.checkIssued(intermediate) &&
        leaf.verify(intermediate.publicKey) &&
        leaf.raw.includes(LEAF_MARKER_OID_DER) &&
        intermediate.raw.includes(INTERMEDIATE_MARKER_OID_DER);
      if (!chainOk) {
        throw new SignedDataVerificationError('untrusted_chain', 'Certificate chain is not issued by Apple.');
      }

      let payloadBytes: Uint8Array;
      try {
        ({ payload: payloadBytes } = await compactVerify(jws, leaf.publicKey, { algorithms: ['ES256'] }));
      } catch {
        throw new SignedDataVerificationError('invalid_signature', 'JWS signature is invalid.');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(payloadBytes));
      } catch {
        throw new SignedDataVerificationError('malformed', 'JWS payload is not JSON.');
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new SignedDataVerificationError('malformed', 'JWS payload is not an object.');
      }

      const record = payload as Record<string, unknown>;
      if (typeof record.signedDate !== 'number') {
        throw new SignedDataVerificationError('malformed', 'JWS payload has no signedDate.');
      }
      const signedAt = new Date(record.signedDate);
      if (![leaf, intermediate, trustedRoot].every((certificate) => isValidAt(certificate, signedAt))) {
        throw new SignedDataVerificationError('expired_certificate', 'Certificate was not valid at signedDate.');
      }

      return record;
    },
  };
}
