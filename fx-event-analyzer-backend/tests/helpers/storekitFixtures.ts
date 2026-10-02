import { execFileSync } from 'node:child_process';
import { createPrivateKey, X509Certificate, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompactSign } from 'jose';
import { createSignedDataVerifier, type SignedDataVerifier } from '../../src/storekit/signedDataVerifier.js';

/**
 * Signs App Store–shaped JWS with a throwaway chain that stands in for
 * Apple's root → WWDR intermediate → App Store leaf and carries the same
 * marker OIDs, so the real verifier can be exercised end-to-end without
 * Apple's keys.
 *
 * The chain is generated with OpenSSL on every run instead of being
 * committed: the repo's .gitignore deliberately excludes *.pem / *.key, and
 * a generated key can never be mistaken for a real secret. OpenSSL is
 * preinstalled on the CI runners and ships with Git for Windows.
 */
const LEAF_MARKER = '1.2.840.113635.100.6.11.1=ASN1:NULL';
const INTERMEDIATE_MARKER = '1.2.840.113635.100.6.2.1=ASN1:NULL';
const CA_EXTENSIONS = ['basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign'];
const VALIDITY_DAYS = '36500';

interface TestChain {
  rootPem: string;
  untrustedRootPem: string;
  intermediatePem: string;
  leaf: { pem: string; key: KeyObject };
  leafWithoutMarker: { pem: string; key: KeyObject };
}

function generateChain(): TestChain {
  const dir = mkdtempSync(join(tmpdir(), 'fx-storekit-'));
  const path = (name: string) => join(dir, name);
  const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' });
  const newKeyArgs = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];

  const selfSignedRoot = (name: string) => {
    openssl(
      'req',
      '-x509',
      ...newKeyArgs,
      '-keyout',
      path(`${name}.key`),
      '-out',
      path(`${name}.pem`),
      '-days',
      VALIDITY_DAYS,
      '-subj',
      `/CN=FX Event Analyzer Test ${name}`,
      ...CA_EXTENSIONS.flatMap((extension) => ['-addext', extension]),
    );
  };

  let serial = 1;
  const issue = (name: string, issuer: string, extensions: string[]) => {
    openssl(
      'req',
      '-new',
      ...newKeyArgs,
      '-keyout',
      path(`${name}.key`),
      '-out',
      path(`${name}.csr`),
      '-subj',
      `/CN=${name}`,
    );
    writeFileSync(path(`${name}.ext`), `${extensions.join('\n')}\n`);
    serial += 1;
    openssl(
      'x509',
      '-req',
      '-in',
      path(`${name}.csr`),
      '-CA',
      path(`${issuer}.pem`),
      '-CAkey',
      path(`${issuer}.key`),
      '-set_serial',
      String(serial),
      '-days',
      VALIDITY_DAYS,
      '-extfile',
      path(`${name}.ext`),
      '-out',
      path(`${name}.pem`),
    );
  };

  try {
    selfSignedRoot('root');
    selfSignedRoot('untrusted-root');
    issue('intermediate', 'root', [...CA_EXTENSIONS, INTERMEDIATE_MARKER]);
    issue('leaf', 'intermediate', [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature',
      LEAF_MARKER,
    ]);
    issue('leaf-no-marker', 'intermediate', [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature',
    ]);

    const read = (name: string) => readFileSync(path(name), 'utf8');
    const signer = (name: string) => ({ pem: read(`${name}.pem`), key: createPrivateKey(read(`${name}.key`)) });
    return {
      rootPem: read('root.pem'),
      untrustedRootPem: read('untrusted-root.pem'),
      intermediatePem: read('intermediate.pem'),
      leaf: signer('leaf'),
      leafWithoutMarker: signer('leaf-no-marker'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const chain = generateChain();

function derBase64(pem: string): string {
  return new X509Certificate(pem).raw.toString('base64');
}

export const UNTRUSTED_ROOT_PEM = chain.untrustedRootPem;

/** A verifier that trusts the generated test root instead of Apple's. */
export function createTestSignedDataVerifier(): SignedDataVerifier {
  return createSignedDataVerifier(chain.rootPem);
}

export interface SignOptions {
  /** Sign with the leaf that lacks Apple's marker extension. */
  leafWithoutMarker?: boolean;
}

export async function signAppStorePayload(
  payload: Record<string, unknown>,
  options: SignOptions = {},
): Promise<string> {
  const leaf = options.leafWithoutMarker ? chain.leafWithoutMarker : chain.leaf;
  const x5c = [derBase64(leaf.pem), derBase64(chain.intermediatePem), derBase64(chain.rootPem)];
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'ES256', x5c })
    .sign(leaf.key);
}

export const TEST_BUNDLE_ID = 'com.fumaono.fxeventanalyzer';
export const MONTHLY_PRODUCT_ID = 'com.fumaono.fxeventanalyzer.pro.monthly';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A JWSTransactionDecodedPayload for an active monthly Pro subscription. */
export function transactionPayload(
  userId: string,
  overrides: Record<string, unknown> = {},
  now: number = Date.now(),
): Record<string, unknown> {
  return {
    transactionId: '2000000000000002',
    originalTransactionId: '2000000000000001',
    bundleId: TEST_BUNDLE_ID,
    productId: MONTHLY_PRODUCT_ID,
    type: 'Auto-Renewable Subscription',
    environment: 'Sandbox',
    purchaseDate: now - DAY_MS,
    originalPurchaseDate: now - 2 * DAY_MS,
    expiresDate: now + 29 * DAY_MS,
    appAccountToken: userId,
    signedDate: now,
    ...overrides,
  };
}

/** A JWSRenewalInfoDecodedPayload matching {@link transactionPayload}. */
export function renewalInfoPayload(
  overrides: Record<string, unknown> = {},
  now: number = Date.now(),
): Record<string, unknown> {
  return {
    originalTransactionId: '2000000000000001',
    environment: 'Sandbox',
    autoRenewStatus: 1,
    signedDate: now,
    ...overrides,
  };
}
