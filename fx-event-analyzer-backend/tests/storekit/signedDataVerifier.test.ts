import { describe, expect, it } from 'vitest';
import { APPLE_ROOT_CA_G3_PEM } from '../../src/storekit/appleRootCertificates.js';
import { createSignedDataVerifier, SignedDataVerificationError } from '../../src/storekit/signedDataVerifier.js';
import { createTestSignedDataVerifier, signAppStorePayload, UNTRUSTED_ROOT_PEM } from '../helpers/storekitFixtures.js';
import { tamperSignature } from '../helpers/tamperSignature.js';

const payload = { transactionId: '1', signedDate: Date.now() };

async function expectFailure(promise: Promise<unknown>, reason: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SignedDataVerificationError);
  expect((error as SignedDataVerificationError).reason).toBe(reason);
}

describe('createSignedDataVerifier', () => {
  it('returns the payload of a JWS signed by a chain under the trusted root', async () => {
    const jws = await signAppStorePayload(payload);
    await expect(createTestSignedDataVerifier().verify(jws)).resolves.toEqual(payload);
  });

  it('rejects a chain under a different root (the x5c root is ignored)', async () => {
    const jws = await signAppStorePayload(payload);
    await expectFailure(createSignedDataVerifier(UNTRUSTED_ROOT_PEM).verify(jws), 'untrusted_chain');
  });

  it('rejects test-signed data against the pinned Apple root', async () => {
    const jws = await signAppStorePayload(payload);
    await expectFailure(createSignedDataVerifier(APPLE_ROOT_CA_G3_PEM).verify(jws), 'untrusted_chain');
  });

  it('rejects a leaf without the App Store marker extension', async () => {
    const jws = await signAppStorePayload(payload, { leafWithoutMarker: true });
    await expectFailure(createTestSignedDataVerifier().verify(jws), 'untrusted_chain');
  });

  it('rejects a tampered signature', async () => {
    const jws = tamperSignature(await signAppStorePayload(payload));
    await expectFailure(createTestSignedDataVerifier().verify(jws), 'invalid_signature');
  });

  it('rejects a payload swapped under the original signature', async () => {
    const [header, , signature] = (await signAppStorePayload(payload)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, transactionId: '2' })).toString('base64url');
    await expectFailure(createTestSignedDataVerifier().verify(`${header}.${forged}.${signature}`), 'invalid_signature');
  });

  it('rejects input that is not a JWS', async () => {
    await expectFailure(createTestSignedDataVerifier().verify('not-a-jws'), 'malformed');
  });

  it('rejects a payload without signedDate', async () => {
    const jws = await signAppStorePayload({ transactionId: '1' });
    await expectFailure(createTestSignedDataVerifier().verify(jws), 'malformed');
  });

  it('rejects data signed at a time the certificates were not valid', async () => {
    const jws = await signAppStorePayload({ transactionId: '1', signedDate: Date.UTC(1990, 0, 1) });
    await expectFailure(createTestSignedDataVerifier().verify(jws), 'expired_certificate');
  });
});
