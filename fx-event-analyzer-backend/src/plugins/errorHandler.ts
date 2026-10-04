import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '../errors/ApiError.js';

/** Maps every thrown error to api-design.md §4's `{ error: { code, message } }`
 * shape. Never leaks internal error detail (stack traces, DB errors) to the
 * client — only ApiError's own message, or a generic message for anything
 * unexpected (logged in full server-side via request.log). */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
        },
      });
      return;
    }

    // Fastify's own request validation (route schema) failures.
    if ('validation' in error && error.validation) {
      reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  });
}
