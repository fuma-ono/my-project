/**
 * revision_status is never a DB column — always computed dynamically from
 * whether any event_revisions rows exist for the event (api-design.md
 * §14.3, L-6).
 */
export type RevisionStatus = 'NONE' | 'REVISED';

export function resolveRevisionStatus(revisionCount: number): RevisionStatus {
  return revisionCount > 0 ? 'REVISED' : 'NONE';
}
