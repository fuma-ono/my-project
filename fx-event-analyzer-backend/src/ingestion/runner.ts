/**
 * Job runner: wraps one fetch → normalize → validate → upsert run and
 * always records an ingestion_logs row (provider, job, started/finished,
 * counts, errors) — also when the job throws. Error messages are stored
 * as-is, so anything that may contain a URL must already be redacted
 * (HttpClient errors are).
 */
import type { IngestionLogRow, IngestionStore } from './store.js';

export class JobCounters {
  fetched = 0;
  success = 0;
  errors = 0;
  skipped = 0;
  review = 0;
  readonly errorMessages: string[] = [];
  readonly skipReasons: Record<string, number> = {};
  readonly details: Record<string, unknown> = {};

  skip(reason: string): void {
    this.skipped += 1;
    this.skipReasons[reason] = (this.skipReasons[reason] ?? 0) + 1;
  }

  error(message: string): void {
    this.errors += 1;
    if (this.errorMessages.length < 20) this.errorMessages.push(message);
  }

  /** Appends to a list in details (capped, for the log). */
  note(key: string, value: unknown): void {
    const list = (this.details[key] as unknown[] | undefined) ?? [];
    if (list.length < 50) list.push(value);
    this.details[key] = list;
  }
}

export interface JobSpec {
  provider: string;
  dataType: IngestionLogRow['data_type'];
  job: string;
}

export interface JobResult {
  status: IngestionLogRow['status'];
  counters: JobCounters;
}

export function resolveJobStatus(counters: JobCounters, crashed: boolean): IngestionLogRow['status'] {
  if (crashed) return counters.success > 0 ? 'PARTIAL' : 'FAILURE';
  if (counters.errors === 0) return 'SUCCESS';
  return counters.success > 0 ? 'PARTIAL' : 'FAILURE';
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function runIngestionJob(
  store: IngestionStore,
  spec: JobSpec,
  body: (counters: JobCounters) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<JobResult> {
  const counters = new JobCounters();
  const startedAt = now().toISOString();
  let crashed = false;
  try {
    await body(counters);
  } catch (error) {
    crashed = true;
    counters.error(message(error));
  }
  const status = resolveJobStatus(counters, crashed);
  await store.insertIngestionLog({
    provider: spec.provider,
    data_type: spec.dataType,
    job: spec.job,
    started_at: startedAt,
    completed_at: now().toISOString(),
    status,
    fetched_count: counters.fetched,
    success_count: counters.success,
    error_count: counters.errors,
    skipped_count: counters.skipped,
    review_count: counters.review,
    error_message: counters.errorMessages.length > 0 ? counters.errorMessages.join('\n') : null,
    details: { skip_reasons: counters.skipReasons, ...counters.details },
  });
  return { status, counters };
}
