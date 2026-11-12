import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { isSpeakerPhotoFileName, speakerPhotoContentType } from '../domain/speakerPhotos.js';

/** <package root>/assets/speaker-photos — this file is src/routes/*.ts under
 * tsx/vitest and dist/routes/*.js when built, two levels below the root either way. */
export const SPEAKER_PHOTOS_DIR = fileURLToPath(new URL('../../assets/speaker-photos/', import.meta.url));

/**
 * GET /api/v1/speaker-photos/{file} (api-design.md §14.7) — the self-hosted
 * FRB official portraits. Public: registered outside the authenticated
 * /api/v1 context (an AsyncImage request carries no JWT). Only file names
 * matching SPEAKER_PHOTO_FILE_PATTERN are read, so nothing outside the
 * directory can be reached.
 */
export function registerSpeakerPhotoRoutes(app: FastifyInstance): void {
  app.get<{ Params: { file: string } }>('/speaker-photos/:file', async (request, reply) => {
    const { file } = request.params;
    if (!isSpeakerPhotoFileName(file)) {
      throw ApiError.notFound('Speaker photo not found.');
    }

    let body: Buffer;
    try {
      body = await readFile(join(SPEAKER_PHOTOS_DIR, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw ApiError.notFound('Speaker photo not found.');
      }
      throw error;
    }

    return reply
      .header('Content-Type', speakerPhotoContentType(file))
      .header('Cache-Control', 'public, max-age=86400')
      .send(body);
  });
}
