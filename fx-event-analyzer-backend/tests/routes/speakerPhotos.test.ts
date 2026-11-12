import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { SPEAKER_PHOTOS_DIR } from '../../src/routes/speakerPhotos.js';

const FRB_PHOTOS = ['warsh.png', 'jefferson.jpg', 'bowman.jpg', 'barr.jpg', 'cook.jpg', 'powell.jpg', 'waller.jpg'];

/** GET /api/v1/speaker-photos/{file} — public, no Supabase needed. */
describe('GET /api/v1/speaker-photos/:file', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      env: loadEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' }),
      // The route never touches Supabase.
      supabase: {} as SupabaseClient,
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves every FRB photo without auth, with the right Content-Type and Cache-Control', async () => {
    for (const file of FRB_PHOTOS) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/speaker-photos/${file}` });
      expect(response.statusCode, file).toBe(200);
      expect(response.headers['content-type']).toBe(file.endsWith('.png') ? 'image/png' : 'image/jpeg');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.rawPayload.equals(readFileSync(join(SPEAKER_PHOTOS_DIR, file)))).toBe(true);
    }
  });

  it('serves real image bytes (JPEG / PNG magic)', async () => {
    const jpg = await app.inject({ method: 'GET', url: '/api/v1/speaker-photos/powell.jpg' });
    expect([...jpg.rawPayload.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const png = await app.inject({ method: 'GET', url: '/api/v1/speaker-photos/warsh.png' });
    expect([...png.rawPayload.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('404s an unknown file', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/speaker-photos/lagarde.jpg' });
    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.body) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('never serves anything outside the directory (traversal / non-whitelisted names)', async () => {
    for (const url of [
      '/api/v1/speaker-photos/..%2F..%2Fpackage.json',
      '/api/v1/speaker-photos/..%2Fspeaker-photos%2Fpowell.jpg',
      '/api/v1/speaker-photos/%2E%2E',
      '/api/v1/speaker-photos/../../package.json',
      '/api/v1/speaker-photos/SOURCES.md',
      '/api/v1/speaker-photos/powell.JPG',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect([400, 404], url).toContain(response.statusCode);
      expect(response.headers['content-type'] ?? '', url).not.toMatch(/^image\//);
    }
  });

  it('keeps the rest of /api/v1 authenticated', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/speeches' });
    expect(response.statusCode).toBe(401);
  });
});
