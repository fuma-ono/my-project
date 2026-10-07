import type { FastifyInstance } from 'fastify';
import { formatIsoSeconds } from '../domain/notifications.js';
import { buildAutoReply, buildBugIssue, classifySupportRequest, statusForClassification } from '../domain/support.js';
import {
  insertSupportRequest,
  listSupportRequests,
  setSupportRequestIssue,
  type SupportRequestRow,
} from '../repositories/supportRequestsRepository.js';
import { createSupportRequestBodySchema } from '../schemas/support.js';

/** At most this many requests per user in any rolling hour (IGNORED ones
 * included). Checked atomically with the insert (insert_support_request()). */
export const SUPPORT_REQUESTS_PER_HOUR = 5;

/** Timestamps without fractional seconds — iOS decodes with `.iso8601`. */
function toSupportRequestResponse(row: SupportRequestRow): SupportRequestRow {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    body: row.body,
    status: row.status,
    reply_body: row.reply_body,
    replied_at: row.replied_at === null ? null : formatIsoSeconds(new Date(row.replied_at)),
    created_at: formatIsoSeconds(new Date(row.created_at)),
  };
}

/**
 * SCR-020 ヘルプ・お問い合わせ — POST/GET /support/requests (api-design.md
 * §24.7/§24.8). Scoped to request.user.id. Every request is stored; the
 * reply is chosen by rules + templates (src/domain/support.ts), nonsense
 * and spam get no reply, and bug reports also become a GitHub Issue. The
 * classification and the Issue are never returned to the client.
 */
export function registerSupportRoutes(app: FastifyInstance): void {
  app.post('/support/requests', async (request, reply) => {
    const userId = request.user!.id;
    const body = createSupportRequestBodySchema.parse(request.body);

    const now = new Date();
    const classification = classifySupportRequest(body);
    const replyBody = buildAutoReply(classification, body.kind, body.category);
    const row = await insertSupportRequest(
      app.supabase,
      userId,
      {
        kind: body.kind,
        category: body.category,
        body: body.body,
        app_version: body.app_version,
        os_version: body.os_version,
        device_model: body.device_model,
        classification,
        status: statusForClassification(classification),
        reply_body: replyBody,
        replied_at: replyBody === null ? null : now.toISOString(),
      },
      SUPPORT_REQUESTS_PER_HOUR,
    );

    if (classification === 'BUG') {
      // Best effort: the report is already stored and replied to, so a
      // GitHub outage / bad token must not fail the user's request. The row
      // stays ESCALATED with github_issue_* = null.
      try {
        const issue = await app.bugIssueCreator(
          buildBugIssue({
            id: row.id,
            kind: body.kind,
            category: body.category,
            body: body.body,
            app_version: body.app_version,
            os_version: body.os_version,
            device_model: body.device_model,
          }),
        );
        if (issue) {
          await setSupportRequestIssue(app.supabase, row.id, issue);
        }
      } catch (error) {
        request.log.error({ err: error, supportRequestId: row.id }, 'Failed to create GitHub Issue for bug report');
      }
    }

    reply.status(201);
    return toSupportRequestResponse(row);
  });

  app.get('/support/requests', async (request) => {
    const rows = await listSupportRequests(app.supabase, request.user!.id);
    return { data: rows.map(toSupportRequestResponse) };
  });
}
