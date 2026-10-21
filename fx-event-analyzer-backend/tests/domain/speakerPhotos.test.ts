import { describe, expect, it } from 'vitest';
import {
  isSpeakerPhotoFileName,
  resolvePublicBaseUrl,
  resolveSpeakerPhotoUrl,
  speakerPhotoContentType,
  withResolvedSpeakerPhoto,
} from '../../src/domain/speakerPhotos.js';

describe('isSpeakerPhotoFileName', () => {
  it('accepts lower-case .jpg / .png names', () => {
    for (const file of ['powell.jpg', 'warsh.png', 'vice-chair-1.jpg']) {
      expect(isSpeakerPhotoFileName(file)).toBe(true);
    }
  });

  it('rejects traversal, other extensions, upper case and odd characters', () => {
    for (const file of [
      '../package.json',
      '..',
      '..%2Fsrc.jpg',
      'a/b.jpg',
      'a\\b.jpg',
      '.jpg',
      'powell.jpeg',
      'powell.JPG',
      'Powell.jpg',
      'powell.jpg.txt',
      'powell.svg',
      'SOURCES.md',
      'powell .jpg',
      '',
    ]) {
      expect(isSpeakerPhotoFileName(file)).toBe(false);
    }
  });
});

describe('speakerPhotoContentType', () => {
  it('maps .png to image/png and .jpg to image/jpeg', () => {
    expect(speakerPhotoContentType('warsh.png')).toBe('image/png');
    expect(speakerPhotoContentType('powell.jpg')).toBe('image/jpeg');
  });
});

describe('resolvePublicBaseUrl', () => {
  const request = { protocol: 'http', host: '127.0.0.1:3000' };

  it('prefers PUBLIC_BASE_URL (without a trailing slash)', () => {
    expect(resolvePublicBaseUrl('https://api.example.com', request)).toBe('https://api.example.com');
    expect(resolvePublicBaseUrl('https://api.example.com/', request)).toBe('https://api.example.com');
  });

  it("falls back to the request's protocol://host", () => {
    expect(resolvePublicBaseUrl(undefined, request)).toBe('http://127.0.0.1:3000');
  });
});

describe('resolveSpeakerPhotoUrl', () => {
  const base = 'https://api.example.com';

  it('returns null for null / undefined / empty', () => {
    expect(resolveSpeakerPhotoUrl(null, base)).toBeNull();
    expect(resolveSpeakerPhotoUrl(undefined, base)).toBeNull();
    expect(resolveSpeakerPhotoUrl('', base)).toBeNull();
  });

  it('passes an absolute URL through unchanged', () => {
    const url = 'https://www.federalreserve.gov/aboutthefed/images/x.jpg';
    expect(resolveSpeakerPhotoUrl(url, base)).toBe(url);
  });

  it('turns a speaker-photos/ key into an absolute URL (PUBLIC_BASE_URL)', () => {
    expect(resolveSpeakerPhotoUrl('speaker-photos/powell.jpg', base)).toBe(
      'https://api.example.com/api/v1/speaker-photos/powell.jpg',
    );
  });

  it('turns a key into an absolute URL on the request host when PUBLIC_BASE_URL is unset', () => {
    const requestBase = resolvePublicBaseUrl(undefined, { protocol: 'http', host: 'localhost:3000' });
    expect(resolveSpeakerPhotoUrl('speaker-photos/warsh.png', requestBase)).toBe(
      'http://localhost:3000/api/v1/speaker-photos/warsh.png',
    );
  });

  it('returns null for a malformed key or an unknown form', () => {
    expect(resolveSpeakerPhotoUrl('speaker-photos/../secret.jpg', base)).toBeNull();
    expect(resolveSpeakerPhotoUrl('speaker-photos/', base)).toBeNull();
    expect(resolveSpeakerPhotoUrl('powell.jpg', base)).toBeNull();
    expect(resolveSpeakerPhotoUrl('javascript:alert(1)', base)).toBeNull();
  });
});

describe('withResolvedSpeakerPhoto', () => {
  it('resolves only speaker.photo_url and leaves the input untouched', () => {
    const speech = {
      speech_id: 's1',
      speaker: { name: 'ジェローム・パウエル', photo_url: 'speaker-photos/powell.jpg' },
    };
    const resolved = withResolvedSpeakerPhoto(speech, 'https://api.example.com');
    expect(resolved).toEqual({
      speech_id: 's1',
      speaker: { name: 'ジェローム・パウエル', photo_url: 'https://api.example.com/api/v1/speaker-photos/powell.jpg' },
    });
    expect(speech.speaker.photo_url).toBe('speaker-photos/powell.jpg');
  });
});
