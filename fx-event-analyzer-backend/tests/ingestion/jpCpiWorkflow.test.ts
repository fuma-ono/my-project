/** HQ指示(2026-11-12・11-13「JP_CPI の事前準備」): JP_CPI の手動 target と接続確認のワークフローの条件。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const wf = (name: string) =>
  readFileSync(join(process.cwd(), '..', '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');
const ingestion = wf('fx-event-analyzer-ingestion.yml');
const steps = ingestion.split('\n      - name: ').slice(1);
const stepFor = (target: string) => {
  const found = steps.filter((s) => s.includes(`inputs.target == '${target}'`));
  expect(found, target).toHaveLength(1);
  return found[0]!;
};

describe('JP_CPI targets in the ingestion workflow', () => {
  const cases: [string, string, boolean][] = [
    ['jp-cpi-schedule-dry-run', 'npm run -s ingest:jp-cpi-schedule -- --dry-run', false],
    ['jp-cpi-schedule', 'npm run -s ingest:jp-cpi-schedule', false],
    ['jp-cpi-values-dry-run', 'npm run -s ingest:official:jp-cpi-values -- --dry-run', true],
    ['jp-cpi-values', 'npm run -s ingest:official:jp-cpi-values', true],
  ];

  it.each(cases)(
    'target %s: manual only, after the DEV check; ESTAT_APP_ID only where the e-Stat API is called',
    (target, command, needsAppId) => {
      const step = stepFor(target);
      expect(step).toContain("steps.check.outputs.ready == 'true'");
      expect(step).toContain("github.event_name == 'workflow_dispatch'");
      expect(step).not.toContain('github.event.schedule');
      expect(step.endsWith(`run: ${command}`) || step.includes(`run: ${command}\n`)).toBe(true);
      expect(step.includes('ESTAT_APP_ID: ${{ secrets.ESTAT_APP_ID }}')).toBe(needsAppId);
    },
  );

  it('the secret is not in the job-level env (it never reaches steps that do not need it)', () => {
    const jobEnv = ingestion.slice(ingestion.indexOf('    env:\n'), ingestion.indexOf('    steps:\n'));
    expect(jobEnv).not.toContain('ESTAT_APP_ID');
    expect([...ingestion.matchAll(/secrets\.ESTAT_APP_ID/g)]).toHaveLength(2);
  });
});

describe('workflow fx-event-analyzer-estat-check.yml', () => {
  const check = wf('fx-event-analyzer-estat-check.yml');

  it('runs only on a push to verify/fx-estat-check or by hand; never on a schedule; no Supabase secret', () => {
    expect(check).not.toMatch(/^\s*schedule:/m);
    expect(check).toMatch(/push:\n\s+branches:\n\s+- 'verify\/fx-estat-check'\n\s+workflow_dispatch:/);
    expect(check).not.toMatch(/SUPABASE/);
    expect(check).toMatch(/permissions:\n\s+contents: read/);
  });

  it('only calls e-Stat and the rehearsal (dry run, in-memory events)', () => {
    const runs = [...check.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1]);
    expect(runs).toEqual(expect.arrayContaining(['npm run -s rehearse:jp-cpi']));
    expect(check).not.toMatch(/ingest:/);
  });
});
