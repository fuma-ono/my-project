/**
 * HQ指示(2026-11-13「承認した範囲だけ実行」): DEV への反映の安全装置。dry-run の出力が承認した内容とぴったり一致したときだけ
 * 書く。反映済みなら何もしない。一致しなければ止まる。書き込みのコマンドは承認された3つだけ。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = join(process.cwd(), '..');
const script = join(root, '.github', 'scripts', 'guarded_apply.py');
const workflow = readFileSync(join(root, '.github', 'workflows', 'fx-event-analyzer-dev-apply.yml'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

const python = (() => {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('python is not available');
})();

const dir = mkdtempSync(join(tmpdir(), 'guard-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const RULES = {
  jolts:
    '{"apply":{"plan.scheduled_insert":12,"plan.scheduled_reschedule":0,"plan.released_insert":0,"plan.released_update":0,"plan.row_cancelled":0},"noop":{"plan.scheduled_insert":0,"plan.released_insert":0,"plan.released_update":0},"empty":["errors","resolver_errors"],"null":["credit_refusal"]}',
  schedule:
    '{"apply":{"would_insert":27,"would_update":0,"past":0},"noop":{"would_insert":0,"would_update":0},"empty":["errors","removed"],"null":[]}',
};

function decide(name: string, rules: string, output: unknown) {
  const file = join(dir, `${name}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, typeof output === 'string' ? output : `noise line\n${JSON.stringify(output)}\n`);
  const outFile = join(dir, 'gh-output');
  writeFileSync(outFile, '');
  const result = spawnSync(python, [script, 'decide', name, file, rules], {
    env: { ...process.env, GITHUB_OUTPUT: outFile },
    encoding: 'utf8',
  });
  const out = readFileSync(outFile, 'utf8').trim();
  return { status: result.status, decision: out.replace('decision=', ''), stdout: result.stdout };
}

const joltsDry = (plan: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  job: 'ingest:official:bls-calendar',
  dry_run: true,
  plan: {
    scheduled_insert: 12,
    scheduled_reschedule: 0,
    scheduled_unchanged: 94,
    released_insert: 0,
    released_update: 0,
    released_unchanged: 83,
    row_cancelled: 0,
    ...plan,
  },
  errors: [],
  resolver_errors: [],
  credit_refusal: null,
  ...extra,
});

describe('guarded_apply.py decide', () => {
  it('JOLTS: exactly the approved 12 inserts and nothing else → apply (exit 0)', () => {
    expect(decide('jolts', RULES.jolts, joltsDry({}))).toMatchObject({ status: 0, decision: 'apply' });
  });

  it('JOLTS: already applied (no inserts, nothing released) → noop, nothing is written again', () => {
    expect(decide('jolts', RULES.jolts, joltsDry({ scheduled_insert: 0, scheduled_unchanged: 106 }))).toMatchObject({
      status: 0,
      decision: 'noop',
    });
  });

  it('JOLTS: anything unexpected → stop (exit 1): another count, a new release, a reschedule, an error, a credit refusal', () => {
    const cases: [string, unknown][] = [
      ['13 inserts', joltsDry({ scheduled_insert: 13 })],
      ['11 inserts', joltsDry({ scheduled_insert: 11 })],
      ['a value would be published', joltsDry({ released_insert: 1 })],
      ['a value would be updated', joltsDry({ released_update: 1 })],
      ['a reschedule', joltsDry({ scheduled_reschedule: 1 })],
      ['a cancelled row', joltsDry({ row_cancelled: 1 })],
      ['an error', joltsDry({}, { errors: ['x'] })],
      ['a resolver error', joltsDry({}, { resolver_errors: ['x'] })],
      ['a credit refusal', joltsDry({}, { credit_refusal: 'cap' })],
      ['not a dry run', joltsDry({}, { dry_run: false })],
      ['garbage', 'not json at all'],
    ];
    for (const [label, output] of cases) {
      expect(decide('jolts', RULES.jolts, output), label).toMatchObject({ status: 1, decision: 'stop' });
    }
  });

  it('schedules: 27 inserts → apply; 0 inserts → noop; anything else (26, an update, a past row, an error, removed rows) → stop', () => {
    const dry = (extra: Record<string, unknown>) => ({
      job: 'ingest:gb-au-ca-schedules',
      dry_run: true,
      would_insert: 27,
      would_update: 0,
      unchanged: 0,
      past: 0,
      removed: [],
      errors: [],
      ...extra,
    });
    expect(decide('gbauca', RULES.schedule, dry({}))).toMatchObject({ status: 0, decision: 'apply' });
    expect(decide('gbauca', RULES.schedule, dry({ would_insert: 0, unchanged: 27 }))).toMatchObject({
      decision: 'noop',
    });
    for (const extra of [
      { would_insert: 26 },
      { would_update: 1 },
      { past: 1 },
      { errors: ['x'] },
      { removed: ['a'] },
    ]) {
      expect(decide('gbauca', RULES.schedule, dry(extra)), JSON.stringify(extra)).toMatchObject({
        status: 1,
        decision: 'stop',
      });
    }
  });

  it('prints only counts and the decision (no keys exist in the input; the note is a single line)', () => {
    const { stdout } = decide('jolts', RULES.jolts, joltsDry({}));
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(stdout).toContain('::notice title=apply jolts decision::');
  });
});

describe('workflow fx-event-analyzer-dev-apply.yml', () => {
  it('runs only on a push to apply/fx-dev-* or by hand; never on a schedule', () => {
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).toMatch(/push:\n\s+branches:\n\s+- 'apply\/fx-dev-\*'\n\s+workflow_dispatch:/);
  });

  it('writes only with the three approved commands; every one is preceded by its own dry run and decision', () => {
    const commands = [...workflow.matchAll(/npm run -s (\S+)(?: -- (\S+))?/g)].map(
      (m) => `${m[1]}${m[2] ? ' ' + m[2] : ''}`,
    );
    expect(commands).toEqual([
      'ingest:official:bls-calendar --dry-run',
      'ingest:official:bls-calendar',
      'ingest:gb-au-ca-schedules --dry-run',
      'ingest:gb-au-ca-schedules',
      'ingest:jp-cpi-schedule --dry-run',
      'ingest:jp-cpi-schedule',
      'ingest:official:jp-cpi-values --dry-run',
    ]);
    // 値の取り込み(official-values・jp-cpi-values の本番)と、定期実行用の指定は無い
    expect(workflow).not.toMatch(/ingest:official-values/);
    expect(workflow).not.toMatch(/--scheduled/);
    // 書き込むステップは、decision == 'apply' のときだけ
    const applySteps = workflow
      .split('\n      - name: ')
      .filter((s) => /apply/i.test(s.split('\n')[0]!) && !/dry run/i.test(s.split('\n')[0]!));
    expect(applySteps).toHaveLength(3);
    for (const step of applySteps) expect(step).toContain(".outputs.decision == 'apply'");
  });

  it('the DEV check stops when the key is not for DEV; only the e-Stat dry run gets ESTAT_APP_ID', () => {
    expect(workflow).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(workflow).toContain('DEV_PROJECT_REF: pbemckwnqmeaoveelihd');
    expect([...workflow.matchAll(/secrets\.ESTAT_APP_ID/g)]).toHaveLength(1);
    expect(workflow).toMatch(/permissions:\n\s+contents: read/);
  });
});
