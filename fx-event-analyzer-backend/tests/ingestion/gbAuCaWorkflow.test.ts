/** HQ指示(2026-11-13「GB/AU/CA の dry-run と手動 target」): 手動の target だけ。dry-run は --dry-run を付ける。定期実行には入れない。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(
  join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-ingestion.yml'),
  'utf8',
).replace(/\r\n/g, '\n');
const steps = yml.split('\n      - name: ').slice(1);

describe('GB/AU/CA manual targets in the ingestion workflow', () => {
  const cases: [string, string, string][] = [
    ['gb-au-ca-schedules-dry-run', 'npm run -s ingest:gb-au-ca-schedules -- --dry-run', 'dry'],
    ['gb-au-ca-schedules', 'npm run -s ingest:gb-au-ca-schedules', 'real'],
    ['official-values-dry-run', 'npm run -s ingest:official-values -- --dry-run', 'dry'],
    ['official-values', 'npm run -s ingest:official-values', 'real'],
  ];

  it.each(cases)(
    'target %s: manual only (workflow_dispatch + the exact target), after the DEV check',
    (target, command) => {
      const matching = steps.filter((s) => s.includes(`run: ${command}\n`) || s.endsWith(`run: ${command}`));
      expect(matching, command).toHaveLength(1);
      const step = matching[0]!;
      expect(step).toContain("steps.check.outputs.ready == 'true'");
      expect(step).toContain("github.event_name == 'workflow_dispatch'");
      expect(step).toContain(`inputs.target == '${target}'`);
      expect(step).not.toContain('github.event.schedule');
    },
  );

  it('the dry-run steps are the only ones with --dry-run, and the real ones never carry it', () => {
    for (const [, command, kind] of cases) {
      expect(command.includes('--dry-run')).toBe(kind === 'dry');
    }
  });

  it('none of the four jobs runs on a schedule', () => {
    for (const s of steps) {
      if (/ingest:(gb-au-ca-schedules|official-values)/.test(s)) expect(s).not.toContain('github.event.schedule');
    }
    expect(yml).toContain(
      'gb-au-ca-schedules-dry-run / gb-au-ca-schedules / official-values-dry-run / official-values',
    );
  });
});

describe('workflow fx-event-analyzer-gbauca-dryrun.yml (DEV evidence run)', () => {
  const dry = readFileSync(
    join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-gbauca-dryrun.yml'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('runs only on a push to verify/fx-gbauca-dryrun or by hand; never on a schedule', () => {
    expect(dry).not.toMatch(/^\s*schedule:/m);
    expect(dry).toMatch(/push:\n\s+branches:\n\s+- 'verify\/fx-gbauca-dryrun'\n\s+workflow_dispatch:/);
  });

  it('only ever runs the two dry-run commands, behind the DEV check', () => {
    const commands = [...dry.matchAll(/npm run -s (\S+) -- (\S+)/g)].map((m) => [m[1], m[2]]);
    expect(commands).toEqual([
      ['ingest:gb-au-ca-schedules', '--dry-run'],
      ['ingest:official-values', '--dry-run'],
    ]);
    expect(dry.match(/npm run -s ingest:/g)).toHaveLength(2); // 本番の形(--dry-run なし)は無い
    expect(dry).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(dry).toContain('DEV_PROJECT_REF: pbemckwnqmeaoveelihd');
  });
});
