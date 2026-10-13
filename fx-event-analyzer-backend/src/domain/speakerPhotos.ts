/**
 * 要人の公式写真 (HQ指示 2026-10-13「FRBは公式写真で、そのほかは頭文字と機関の色で」).
 *
 * The photos are FRB Board portraits (public domain, federalreserve.gov —
 * cite the Board as the source; framing is not allowed, so they are
 * self-hosted under assets/speaker-photos/ rather than hotlinked). The DB
 * (`speakers.photo_url`) holds either null, an absolute https URL, or a
 * storage key `speaker-photos/<file>`; the API always answers with an
 * absolute URL or null.
 */

export const SPEAKER_PHOTO_KEY_PREFIX = 'speaker-photos/';

/** Lower-case name + .jpg/.png only — no dots, slashes or `..` (path traversal). */
export const SPEAKER_PHOTO_FILE_PATTERN = /^[a-z0-9-]+\.(jpg|png)$/;

export function isSpeakerPhotoFileName(file: string): boolean {
  return SPEAKER_PHOTO_FILE_PATTERN.test(file);
}

/** Content-Type for a whitelisted file name (see isSpeakerPhotoFileName). */
export function speakerPhotoContentType(file: string): 'image/jpeg' | 'image/png' {
  return file.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/** `PUBLIC_BASE_URL` when configured (behind a proxy / CDN), else the
 * request's own `protocol://host`. No trailing slash. */
export function resolvePublicBaseUrl(
  publicBaseUrl: string | undefined,
  request: { protocol: string; host: string },
): string {
  const base = publicBaseUrl ?? `${request.protocol}://${request.host}`;
  return base.replace(/\/+$/, '');
}

/**
 * - null / empty → null (the app shows initials + the organization's color)
 * - absolute http(s) URL → unchanged
 * - `speaker-photos/<file>` → `${baseUrl}/api/v1/speaker-photos/<file>`
 * - anything else (an unknown or malformed key) → null, never a broken link
 */
export function resolveSpeakerPhotoUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith(SPEAKER_PHOTO_KEY_PREFIX)) {
    const file = value.slice(SPEAKER_PHOTO_KEY_PREFIX.length);
    if (isSpeakerPhotoFileName(file)) return `${baseUrl}/api/v1/speaker-photos/${file}`;
  }
  return null;
}

/** A copy of `speech` whose `speaker.photo_url` is resolved (see resolveSpeakerPhotoUrl). */
export function withResolvedSpeakerPhoto<T extends { speaker: { photo_url?: string | null | undefined } }>(
  speech: T,
  baseUrl: string,
): T {
  return {
    ...speech,
    speaker: { ...speech.speaker, photo_url: resolveSpeakerPhotoUrl(speech.speaker.photo_url, baseUrl) },
  };
}
