import { describe, expect, it } from 'vitest';
import { resolveRevisionStatus } from '../../src/domain/revisionStatus.js';

describe('resolveRevisionStatus', () => {
  it('is NONE when no revisions exist', () => {
    expect(resolveRevisionStatus(0)).toBe('NONE');
  });
  it('is REVISED when at least one revision exists', () => {
    expect(resolveRevisionStatus(1)).toBe('REVISED');
    expect(resolveRevisionStatus(5)).toBe('REVISED');
  });
});
