/** HQ指示(2026-11-13): JP_CPI の値の dry-run のワークフローが、dry-run 固定・DEV 限定・定期実行なしであること。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(
  join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-jpcpi-values-dryrun.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('workflow fx-event-analyzer-jpcpi-values-dryrun.yml', () => {
  it('runs only on a push to verify/fx-jpcpi-values-dryrun or by hand; never on a schedule', () => {
    expect(yml).not.toMatch(/^\s*schedule:/m);
    expect(yml).toMatch(/push:\n\s+branches:\n\s+- 'verify\/fx-jpcpi-values-dryrun'\n\s+workflow_dispatch:/);
  });

  it('only runs the dry run of the JP_CPI values, with the e-Stat Secret on that step only, behind the DEV check', () => {
    const commands = [...yml.matchAll(/npm run -s (\S+)(?: -- (\S+))?/g)].map((m) => [m[1], m[2]]);
    expect(commands).toEqual([['ingest:official:jp-cpi-values', '--dry-run']]);
    expect(yml.match(/npm run -s ingest:/g)).toHaveLength(1);
    expect([...yml.matchAll(/secrets\.ESTAT_APP_ID/g)]).toHaveLength(1);
    expect(yml).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(yml).toMatch(/permissions:\n\s+contents: read/);
  });
});
