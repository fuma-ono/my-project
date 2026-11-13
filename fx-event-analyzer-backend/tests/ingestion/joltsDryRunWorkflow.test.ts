/** HQ指示(2026-11-13「US_JOLTS の dry-run」): JOLTS の dry-run のワークフローが、dry-run 固定・DEV 限定・定期実行なしであること。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(
  join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-jolts-dryrun.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('workflow fx-event-analyzer-jolts-dryrun.yml', () => {
  it('runs only on a push to verify/fx-jolts-dryrun or by hand; never on a schedule', () => {
    expect(yml).not.toMatch(/^\s*schedule:/m);
    expect(yml).toMatch(/push:\n\s+branches:\n\s+- 'verify\/fx-jolts-dryrun'\n\s+workflow_dispatch:/);
  });

  it('only ever runs the BLS calendar with --dry-run, behind the DEV check', () => {
    const commands = [...yml.matchAll(/npm run -s (\S+)(?: -- (\S+))?/g)].map((m) => [m[1], m[2]]);
    expect(commands).toEqual([['ingest:official:bls-calendar', '--dry-run']]);
    expect(yml).not.toMatch(/ingest:official:bls-calendar\s*(>|\n)/); // 本番の形(--dry-run なし)は無い
    expect(yml).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(yml).toContain('DEV_PROJECT_REF: pbemckwnqmeaoveelihd');
    expect(yml).toMatch(/permissions:\n\s+contents: read/);
  });
});
