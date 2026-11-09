import { describe, expect, it } from 'vitest';
import { effectiveIsProvisional } from '../../src/domain/provisional.js';

/** API の is_provisional は「DB が true かつ日時が今より先」のときだけ true(HQ指示 2026-10-22 Task 3)。 */
describe('effectiveIsProvisional', () => {
  const dec = '2026-12-09T19:00:00+00:00';

  it('true only while a provisional datetime is in the future', () => {
    expect(effectiveIsProvisional(true, dec, new Date('2026-10-22T00:00:00Z'))).toBe(true);
    expect(effectiveIsProvisional(true, dec, new Date('2026-12-09T18:59:59.999Z'))).toBe(true);
    expect(effectiveIsProvisional(true, dec, new Date('2026-12-09T19:00:00Z'))).toBe(false);
    expect(effectiveIsProvisional(true, dec, new Date('2026-12-10T00:00:00Z'))).toBe(false);
  });

  it('false when the DB flag is false / absent, or the datetime is unreadable', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    expect(effectiveIsProvisional(false, dec, now)).toBe(false);
    expect(effectiveIsProvisional(undefined, dec, now)).toBe(false);
    expect(effectiveIsProvisional(null, dec, now)).toBe(false);
    expect(effectiveIsProvisional(true, 'not-a-date', now)).toBe(false);
  });
});
