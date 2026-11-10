import type { NotificationCandidate } from '../../src/domain/notifications.js';
import type {
  PushNotificationRow,
  PushPlanItem,
  PushUserContext,
  RecordedOutcome,
} from '../../src/domain/pushNotifications.js';
import type {
  AttemptResult,
  AttemptStart,
  ClaimedPushNotification,
  PushDeviceRow,
  PushRowUpdate,
  PushStore,
} from '../../src/push/pushJobs.js';

export type MemoryRow = PushNotificationRow & {
  claim_token: string | null;
  lease_until: number | null;
  recovery_count: number;
  status_reason?: string | null;
  last_error?: string | null;
  sent_at?: string | null;
};

export interface MemoryAttempt extends AttemptStart {
  id: string;
  outcome: RecordedOutcome;
  http_status?: number | null;
  reason?: string | null;
}

/** PushStore のメモリ版(claim・持ち時間・取り直し・記録の印を DB の関数と同じ規則で)。時刻は `clock` で動かす。 */
export class MemoryPushStore implements PushStore {
  users = new Map<string, PushUserContext>();
  candidates: NotificationCandidate[] = [];
  devices: (PushDeviceRow & { is_active: boolean; disabled_reason?: string })[] = [];
  rows: MemoryRow[] = [];
  attempts: MemoryAttempt[] = [];
  clock = new Date();
  private seq = 0;

  listPushUserIds() {
    return Promise.resolve(
      [...this.users.keys()].filter(
        (id) => this.users.get(id)!.prefs.push && this.devices.some((d) => d.user_id === id && d.is_active),
      ),
    );
  }
  loadUserContext(userId: string) {
    return Promise.resolve(this.users.get(userId) ?? null);
  }
  listCandidates(fromIso: string, toIso: string, _kinds: unknown, includePast: boolean) {
    return Promise.resolve(
      this.candidates.filter(
        (c) => (includePast || c.status === 'SCHEDULED') && c.scheduled_at >= fromIso && c.scheduled_at <= toIso,
      ),
    );
  }
  listCandidatesByIds(ids: { indicators: readonly string[]; speeches: readonly string[] }) {
    return Promise.resolve(this.candidates.filter((c) => [...ids.indicators, ...ids.speeches].includes(c.id)));
  }
  enqueue(items: readonly PushPlanItem[]) {
    let inserted = 0;
    for (const i of items) {
      const dup = this.rows.some(
        (r) =>
          r.user_id === i.user_id &&
          r.push_type === i.push_type &&
          r.target_kind === i.target_kind &&
          r.target_id === i.target_id &&
          r.event_scheduled_at === i.event_scheduled_at,
      );
      if (dup) continue;
      this.rows.push({
        ...i,
        id: `n-${++this.seq}`,
        status: 'PENDING',
        attempts: 0,
        next_attempt_at: i.scheduled_send_at,
        claim_token: null,
        lease_until: null,
        recovery_count: 0,
      });
      inserted += 1;
    }
    return Promise.resolve(inserted);
  }
  expireOverdue() {
    let n = 0;
    for (const r of this.rows) {
      if (r.status === 'PENDING' && Date.parse(r.expires_at) <= this.clock.getTime()) {
        r.status = 'SKIPPED';
        r.status_reason = 'EXPIRED';
        n += 1;
      }
    }
    return Promise.resolve(n);
  }
  claimDue(limit: number, leaseSeconds: number, maxRecoveries: number) {
    const now = this.clock.getTime();
    const due = this.rows
      .filter(
        (r) =>
          (r.status === 'PENDING' && Date.parse(r.next_attempt_at) <= now && Date.parse(r.expires_at) > now) ||
          (r.status === 'SENDING' && (r.lease_until ?? 0) <= now),
      )
      .slice(0, limit);
    const out: ClaimedPushNotification[] = [];
    for (const r of due) {
      const recovered = r.status === 'SENDING';
      if (recovered) {
        for (const a of this.attempts)
          if (a.notification_id === r.id && a.outcome === 'IN_FLIGHT') a.outcome = 'UNKNOWN';
        if (r.recovery_count + 1 > maxRecoveries) {
          Object.assign(r, {
            status: 'FAILED',
            status_reason: 'STUCK_IN_SENDING',
            claim_token: null,
            lease_until: null,
          });
          r.recovery_count += 1;
          continue;
        }
        r.recovery_count += 1;
      }
      r.status = 'SENDING';
      r.claim_token = `tok-${++this.seq}`;
      r.lease_until = now + leaseSeconds * 1000;
      out.push({ ...r, claim_token: r.claim_token });
    }
    return Promise.resolve(out);
  }
  renewLease(id: string, token: string, leaseSeconds: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.claim_token !== token || r.status !== 'SENDING') return Promise.resolve(false);
    r.lease_until = this.clock.getTime() + leaseSeconds * 1000;
    return Promise.resolve(true);
  }
  listActiveDevices(userId: string) {
    return Promise.resolve(this.devices.filter((d) => d.user_id === userId && d.is_active));
  }
  listLatestOutcomes(notificationId: string) {
    const latest = new Map<string, RecordedOutcome>();
    for (const a of this.attempts.filter((x) => x.notification_id === notificationId)) {
      if (latest.get(a.device_id) === 'SUCCESS') continue;
      latest.set(a.device_id, a.outcome);
    }
    return Promise.resolve(latest);
  }
  failNextComplete = false;
  startAttempt(a: AttemptStart) {
    const id = `att-${++this.seq}`;
    this.attempts.push({ ...a, id, outcome: 'IN_FLIGHT' });
    return Promise.resolve(id);
  }
  completeAttempt(id: string, result: AttemptResult) {
    if (this.failNextComplete) {
      this.failNextComplete = false;
      return Promise.reject(new Error('DB down after APNs success'));
    }
    const a = this.attempts.find((x) => x.id === id)!;
    if (a.outcome === 'IN_FLIGHT') Object.assign(a, result);
    return Promise.resolve();
  }
  deactivateDevice(id: string, reason: string) {
    const d = this.devices.find((x) => x.id === id)!;
    d.is_active = false;
    d.disabled_reason = reason;
    return Promise.resolve();
  }
  failNextFinish = false;
  finish(id: string, token: string, update: PushRowUpdate) {
    if (this.failNextFinish) {
      this.failNextFinish = false;
      return Promise.reject(new Error('DB down before marking SENT'));
    }
    const r = this.rows.find((x) => x.id === id)!;
    if (r.status !== 'SENDING' || r.claim_token !== token) return Promise.resolve(false);
    Object.assign(r, update, { claim_token: null, lease_until: null });
    return Promise.resolve(true);
  }
}
