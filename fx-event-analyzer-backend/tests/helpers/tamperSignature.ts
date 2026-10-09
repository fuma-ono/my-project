/** Flips one base64url character in the middle of a JWT's signature
 * segment. Flipping the *last* character is not safe for this: ECDSA
 * signature lengths aren't a multiple of 3 bytes, so the final base64url
 * character of the segment carries left-over padding bits that some
 * decoders don't check strictly — certain last-character swaps decode to
 * the exact same signature bytes and verification wrongly still passes
 * (caught for real by tests/auth/jwt.test.ts before this helper existed).
 * A middle character always sits inside a full 3-byte/4-character group. */
export function tamperSignature(token: string): string {
  const [header, payload, signature] = token.split('.');
  const chars = signature!.split('');
  const i = Math.floor(chars.length / 2);
  chars[i] = chars[i] === 'A' ? 'B' : 'A';
  return `${header}.${payload}.${chars.join('')}`;
}
