/**
 * HQ指示 2026-11-18(公式統計の定時実行化): 取り込みの workflow の、official-values と JP CPI の定時実行の条件。
 *   - official-values: cron `23 1,8,14,21 * * *`(UTC)で有効。JP CPI の値: cron `53 0,3,6 * * *` は**無効**(コメントのまま。
 *     2026-11-20 の初回の確認と HQ の承認の後に有効にする)
 *   - 専用の concurrency group。既存の為替・要人発言・日次レポートの group と、手動の target の振り分けは変えない
 *   - 手動の target は従来どおり
 * このファイルは、settings の workflow(全体)と、main の workflow(最小の変更)の両方で通る形にしてある。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(
  join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-ingestion.yml'),
  'utf8',
).replace(/\r\n/g, '\n');
const steps = yml.split('\n      - name: ').slice(1);
const stepNamed = (prefix: string) => {
  const found = steps.filter((s) => s.startsWith(prefix));
  expect(found, prefix).toHaveLength(1);
  return found[0]!;
};

const OFFICIAL_CRON = '23 1,8,14,21 * * *';
const JP_CRON = '53 0,3,6 * * *';

describe('cron entries', () => {
  const onBlock = yml.slice(yml.indexOf('\non:\n'), yml.indexOf('\n  workflow_dispatch:'));
  const active = [...onBlock.matchAll(/^ {4}- cron: '([^']+)'/gm)].map((m) => m[1]);

  it('the active crons are the three existing ones plus official-values only (JP CPI is not active)', () => {
    expect(active).toEqual(['13 * * * *', '41 */3 * * *', '0 0 * * *', OFFICIAL_CRON]);
    expect(active).not.toContain(JP_CRON);
  });

  it('the JP CPI cron is kept as a comment, ready to enable after the first-release check', () => {
    expect(onBlock).toMatch(new RegExp(`^ {4}# - cron: '${JP_CRON.replace(/\*/g, '\\*')}'`, 'm'));
  });

  it('official-values slots are 01:23 / 08:23 / 14:23 / 21:23 UTC — after each release, away from :00 / :13 / :41', () => {
    const [minute, hours] = OFFICIAL_CRON.split(' ');
    expect(minute).toBe('23');
    const slots = hours!.split(',').map(Number);
    expect(slots).toEqual([1, 8, 14, 21]);
    // 発表(UTC): 豪州 ABS 00:30(AEDT 11:30)・英国 ONS 07:00(冬時間。夏時間は 06:00)・カナダ 13:30(冬時間。夏時間は 12:30)
    const after = (release: number) => slots.find((h) => h * 60 + 23 >= release + 30);
    expect(after(0 * 60 + 30)).toBe(1);
    expect(after(7 * 60)).toBe(8);
    expect(after(13 * 60 + 30)).toBe(14);
    // 他の cron の起動の分(毎時 13・3 時間ごとの 41・00:00)と同じ分にならない
    expect(Number(minute)).not.toBe(13);
    expect(Number(minute)).not.toBe(41);
    expect(Number(minute)).not.toBe(0);
  });

  it('JP CPI slots (00:53 / 03:53 / 06:53 UTC) come at least 80 minutes after the 08:30 JST (= 23:30 UTC) release', () => {
    const [minute, hours] = JP_CRON.split(' ');
    const slots = hours!.split(',').map(Number);
    expect(slots).toEqual([0, 3, 6]);
    const releaseMinuteOfDay = 23 * 60 + 30 - 24 * 60; // 前日の 23:30 = −30 分
    for (const h of slots) expect(h * 60 + Number(minute) - releaseMinuteOfDay).toBeGreaterThanOrEqual(80);
  });
});

describe('concurrency group', () => {
  const line = yml.split('\n').find((l) => l.startsWith('  group: ${{'))!;
  const expression = line.replace(/^ {2}group: \$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  // GitHub の式を評価する小さな評価器(この式で使うものだけ: 文字列・識別子・startsWith(a, b)・==・&&・||・括弧)。
  // && と || は、JS と同じく値(オペランド)を返す。eval / Function は使わない(lint で禁止)。
  type Value = string | boolean | undefined;
  type Context = { schedule?: string; event: string; target?: string };
  const evaluate = (source: string, ctx: Context): Value => {
    const matches = [...source.matchAll(/\s*('[^']*'|==|&&|\|\||\(|\)|,|[A-Za-z_][A-Za-z0-9_.]*)/g)];
    const tokens = matches.map((m) => m[1]!);
    // 取りこぼしなく、先頭から末尾まで連続して区切れていること(読めない記号が混ざっていないこと)
    let end = 0;
    for (const m of matches) {
      expect(m.index, 'tokens are contiguous').toBe(end);
      end = m.index + m[0].length;
    }
    expect(end, 'the whole expression is tokenized').toBe(source.trimEnd().length);
    let pos = 0;
    const peek = () => tokens[pos];
    const take = () => tokens[pos++]!;
    const lookup = (name: string): Value => {
      if (name === 'github.event.schedule') return ctx.schedule;
      if (name === 'github.event_name') return ctx.event;
      if (name === 'inputs.target') return ctx.target;
      throw new Error(`unknown identifier ${name}`);
    };
    const primary = (): Value => {
      const token = take();
      if (token === '(') {
        const value = or();
        expect(take()).toBe(')');
        return value;
      }
      if (token.startsWith("'")) return token.slice(1, -1);
      if (peek() === '(') {
        take();
        const args: Value[] = [or()];
        while (peek() === ',') {
          take();
          args.push(or());
        }
        expect(take()).toBe(')');
        expect(token).toBe('startsWith');
        return typeof args[0] === 'string' && typeof args[1] === 'string' && args[0].startsWith(args[1]);
      }
      return lookup(token);
    };
    const equality = (): Value => {
      const left = primary();
      if (peek() !== '==') return left;
      take();
      return left === primary();
    };
    const and = (): Value => {
      let left = equality();
      while (peek() === '&&') {
        take();
        const right = equality();
        left = left ? right : left;
      }
      return left;
    };
    const or = (): Value => {
      let left = and();
      while (peek() === '||') {
        take();
        const right = and();
        left = left ? left : right;
      }
      return left;
    };
    const value = or();
    expect(pos, 'every token is consumed').toBe(tokens.length);
    return value;
  };
  const groupOf = (ctx: Context) => evaluate(expression, ctx) as string;
  const dispatch = (target: string) => groupOf({ event: 'workflow_dispatch', target });

  it('scheduled runs: FX loop / speeches / daily report keep their groups; the two new schedules get their own', () => {
    expect(groupOf({ event: 'schedule', schedule: '13 * * * *' })).toBe('fx-prices-loop');
    expect(groupOf({ event: 'schedule', schedule: '41 */3 * * *' })).toBe('fx-ingestion-speeches');
    expect(groupOf({ event: 'schedule', schedule: '0 0 * * *' })).toBe('fx-ingestion');
    expect(groupOf({ event: 'schedule', schedule: OFFICIAL_CRON })).toBe('fx-ingestion-official-values');
    expect(groupOf({ event: 'schedule', schedule: JP_CRON })).toBe('fx-ingestion-jp-cpi-values');
  });

  it('manual runs of the same target share the scheduled group (no overlap of the same target)', () => {
    expect(dispatch('official-values')).toBe('fx-ingestion-official-values');
    expect(dispatch('official-values-dry-run')).toBe('fx-ingestion-official-values');
    expect(dispatch('jp-cpi-values')).toBe('fx-ingestion-jp-cpi-values');
    expect(dispatch('jp-cpi-values-dry-run')).toBe('fx-ingestion-jp-cpi-values');
  });

  it('official-values and JP CPI are independent groups, and the JP schedule target is not in the values group', () => {
    expect(dispatch('official-values')).not.toBe(dispatch('jp-cpi-values'));
    expect(dispatch('jp-cpi-schedule')).toBe('fx-ingestion');
    expect(dispatch('jp-cpi-schedule-dry-run')).toBe('fx-ingestion');
  });

  it('every other manual target keeps its previous group (FX / BLS / reactions / Eurostat / speeches unaffected)', () => {
    for (const target of [
      'fx-prices',
      'both',
      'report',
      'official-bls',
      'official-bls-dry-run',
      'event-reactions',
      'fomc-schedule',
      'fomc-policy-rate',
      'retail-sales-schedule',
    ])
      expect(dispatch(target), target).toBe('fx-ingestion');
    expect(dispatch('speeches')).toBe('fx-ingestion-speeches');
    expect(dispatch('official-eurostat')).toBe('fx-ingestion-eurostat');
    expect(dispatch('official-eurostat-dry-run')).toBe('fx-ingestion-eurostat');
    if (yml.includes("startsWith(inputs.target, 'speech-')"))
      expect(dispatch('speech-bodies')).toBe('fx-ingestion-speeches');
  });

  it('runs are queued, never cancelled; the timeout of scheduled official runs stays at 10 minutes', () => {
    expect(yml).toMatch(/cancel-in-progress: false/);
    expect(yml).toMatch(/timeout-minutes: \$\{\{ github\.event\.schedule == '13 \* \* \* \*' && 355 \|\| 10 \}\}/);
  });
});

describe('steps', () => {
  it('the scheduled official-values step runs only on its exact cron, after the DEV check, with the real command', () => {
    const s = stepNamed('GB/AU/CA official values (scheduled)');
    expect(s).toContain("steps.check.outputs.ready == 'true'");
    expect(s).toContain("github.event_name == 'schedule'");
    expect(s).toContain(`github.event.schedule == '${OFFICIAL_CRON}'`);
    expect(s).not.toContain('workflow_dispatch');
    expect(s).not.toContain('--dry-run');
    expect(s).not.toContain('ESTAT_APP_ID');
    expect(s.trimEnd().endsWith('run: npm run -s ingest:official-values')).toBe(true);
  });

  it('the scheduled JP CPI step is bound to the (disabled) JP cron and is the only one reading ESTAT_APP_ID there', () => {
    const s = stepNamed('JP CPI values (scheduled');
    expect(s).toContain("steps.check.outputs.ready == 'true'");
    expect(s).toContain("github.event_name == 'schedule'");
    expect(s).toContain(`github.event.schedule == '${JP_CRON}'`);
    expect(s).not.toContain('--dry-run');
    expect(s).toContain('ESTAT_APP_ID: ${{ secrets.ESTAT_APP_ID }}');
    expect(s.trimEnd().endsWith('run: npm run -s ingest:official:jp-cpi-values')).toBe(true);
    // 無効の cron なので、この step は定時では動かない(cron が有効になるまで)
    const onBlock = yml.slice(yml.indexOf('\non:\n'), yml.indexOf('\n  workflow_dispatch:'));
    expect(onBlock).not.toMatch(new RegExp(`^ {4}- cron: '${JP_CRON.replace(/\*/g, '\\*')}'`, 'm'));
  });

  it('no other step is triggered by the new crons (each cron string appears in exactly one step condition)', () => {
    const conditionsWith = (cron: string) =>
      yml.split('\n').filter((l) => l.trim().startsWith('if:') && l.includes(`'${cron}'`));
    expect(conditionsWith(OFFICIAL_CRON)).toHaveLength(1);
    expect(conditionsWith(JP_CRON)).toHaveLength(1);
  });

  it('the manual targets still exist and stay manual-only (the exact target + workflow_dispatch, no schedule)', () => {
    for (const target of ['official-values-dry-run', 'official-values', 'jp-cpi-values-dry-run', 'jp-cpi-values']) {
      const found = steps.filter((s) => s.includes(`inputs.target == '${target}'`));
      expect(found, target).toHaveLength(1);
      expect(found[0]).toContain("github.event_name == 'workflow_dispatch'");
      expect(found[0]).not.toContain('github.event.schedule');
      expect(found[0]).toContain("steps.check.outputs.ready == 'true'");
    }
    expect(steps.find((s) => s.includes("inputs.target == 'official-values-dry-run'"))).toContain('--dry-run');
    expect(steps.find((s) => s.includes("inputs.target == 'jp-cpi-values-dry-run'"))).toContain('--dry-run');
  });

  it('every ingest / report step is gated by a dispatch target or an exact cron (nothing runs on a bare schedule)', () => {
    for (const s of steps) {
      if (!/run: .*npm run -s (ingest|report):/.test(s) && !/run: \|[\s\S]*npm run -s ingest:fx-prices/.test(s))
        continue;
      const condition = s.split('\n').find((l) => l.trim().startsWith('if:')) ?? '';
      const gated =
        condition.includes("github.event_name == 'workflow_dispatch'") ||
        /github\.event\.schedule == '/.test(condition) ||
        condition.includes("github.event_name == 'schedule'");
      expect(gated, s.split('\n')[0]).toBe(true);
    }
  });

  it('the job-level env does not carry the e-Stat secret', () => {
    const jobEnv = yml.slice(yml.indexOf('    env:\n'), yml.indexOf('    steps:\n'));
    expect(jobEnv).not.toContain('ESTAT_APP_ID');
  });

  it('the DEV check stays: a key that is not for the DEV project stops the job', () => {
    expect(yml).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(yml).toContain('DEV_PROJECT_REF: pbemckwnqmeaoveelihd');
  });
});
