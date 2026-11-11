/**
 * HQ承認(2026-11-11「要人発言の定期実行」1日目): DEV の確認、ジョブの引数、要約の二重の実行の防止、品質レポート第11章、
 * ワークフローの条件(本文が失敗しても要約は動く・DEV の確認・定期の回だけ)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertDevTarget, NotDevTargetError } from '../../src/ingestion/devTarget.js';
import {
  ingestSpeechSummaries,
  type SpeechForSummary,
  type SpeechSummaryStore,
} from '../../src/ingestion/pipelines/speechSummaries.js';
import { judgeSpeechPipeline, renderSpeechPipelineMarkdown } from '../../src/ingestion/quality/speechPipeline.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { parseSpeechJobOptions } from '../../src/ingestion/speechJobOptions.js';

const REF = 'pbemckwnqmeaoveelihd';
const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`;

describe('assertDevTarget (nothing starts unless the target is DEV)', () => {
  const ok = {
    DEV_PROJECT_REF: REF,
    SUPABASE_URL: `https://${REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF }),
  };

  it('passes for the DEV project (trailing slash allowed)', () => {
    expect(assertDevTarget(ok)).toEqual({ ref: REF });
    expect(assertDevTarget({ ...ok, SUPABASE_URL: `https://${REF}.supabase.co/` })).toEqual({ ref: REF });
  });

  it('stops without DEV_PROJECT_REF, for another URL, or for a key of another project', () => {
    const cases: Record<string, string | undefined>[] = [
      { ...ok, DEV_PROJECT_REF: undefined },
      { ...ok, DEV_PROJECT_REF: 'short' },
      { ...ok, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' },
      { ...ok, SUPABASE_URL: `http://${REF}.supabase.co` },
      { ...ok, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: 'abcdefghijklmnopqrst' }) },
      { ...ok, SUPABASE_SERVICE_ROLE_KEY: 'not-a-jwt' },
      { ...ok, SUPABASE_SERVICE_ROLE_KEY: undefined },
    ];
    for (const env of cases)
      expect(() => assertDevTarget(env), JSON.stringify(Object.keys(env))).toThrow(NotDevTargetError);
  });

  it('the error message never contains the key or the URL', () => {
    const key = jwt({ ref: 'abcdefghijklmnopqrst', secret: 'x' });
    try {
      assertDevTarget({ ...ok, SUPABASE_SERVICE_ROLE_KEY: key });
      throw new Error('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain(key);
      expect(String(error)).not.toContain('supabase.co');
    }
  });
});

describe('parseSpeechJobOptions', () => {
  it('--scheduled = last 14 days, --all = everything, default = 30 days; --dry-run combines', () => {
    expect(parseSpeechJobOptions(['--scheduled'])).toEqual({ mode: 'scheduled', pastDays: 14, dryRun: false });
    expect(parseSpeechJobOptions(['--scheduled', '--dry-run'])).toEqual({
      mode: 'scheduled',
      pastDays: 14,
      dryRun: true,
    });
    expect(parseSpeechJobOptions(['--all'])).toEqual({ mode: 'all', pastDays: null, dryRun: false });
    expect(parseSpeechJobOptions([])).toEqual({ mode: 'default', pastDays: 30, dryRun: false });
    expect(() => parseSpeechJobOptions(['--all', '--scheduled'])).toThrow();
  });
});

describe('ingestSpeechSummaries: an existing summary or failure reason is not overwritten', () => {
  it('a write refused by the store (another run wrote first) is not counted', async () => {
    const rows: SpeechForSummary[] = [
      { id: 'a', provider: 'frb_calendar', statement_datetime: '2026-11-15T15:00:00Z', speech_body: 'Thank you.' },
    ];
    const store: SpeechSummaryStore = {
      listSpeechesNeedingSummary: () => Promise.resolve(rows),
      updateSpeechSummary: () => Promise.resolve(false),
    };
    const counters = new JobCounters();
    const r = await ingestSpeechSummaries(
      store,
      { pastDays: 14, maxSpeeches: 200 },
      new Date('2026-11-20T06:00:00Z'),
      counters,
    );
    expect(r).toMatchObject({ ready: 0, failed: 0 });
    expect(counters.skipReasons).toEqual({ CONCURRENT_UPDATE: 1 });
  });

  it('asks only for the last 14 days in the scheduled mode', async () => {
    const calls: (string | null)[] = [];
    const store: SpeechSummaryStore = {
      listSpeechesNeedingSummary: (sinceIso) => {
        calls.push(sinceIso);
        return Promise.resolve([]);
      },
      updateSpeechSummary: () => Promise.resolve(true),
    };
    await ingestSpeechSummaries(
      store,
      { pastDays: 14, maxSpeeches: 200 },
      new Date('2026-11-20T06:00:00Z'),
      new JobCounters(),
    );
    expect(calls).toEqual(['2026-11-06T06:00:00.000Z']);
  });
});

describe('quality report 第11章 (speech bodies and summaries)', () => {
  const now = new Date('2026-11-20T06:00:00Z');
  const base = {
    lastRuns: [
      { job: 'ingest:speech-bodies' as const, startedAt: '2026-11-20T03:41:00Z', status: 'SUCCESS' },
      { job: 'ingest:speech-summaries' as const, startedAt: '2026-11-20T03:42:00Z', status: 'SUCCESS' },
    ],
    pendingWithUrlStale: 0,
    bodyFailedRetrying: 0,
    bodyFailedAtCap: 0,
    summaryFailed: 0,
    fetchedWithoutSummary: 0,
  };

  it('all good → 正常', () => {
    expect(renderSpeechPipelineMarkdown(base, now)).toContain('判定: 正常');
  });

  it('未実行: no run, or the last run more than 6 hours ago; a failed last run is 注意', () => {
    const none = judgeSpeechPipeline(
      { ...base, lastRuns: [{ ...base.lastRuns[0]!, startedAt: null, status: null }] },
      now,
    );
    expect(none[0]).toMatchObject({ judgement: 'WARN', item: '未実行: 本文の取得' });
    const old = judgeSpeechPipeline(
      { ...base, lastRuns: [{ ...base.lastRuns[0]!, startedAt: '2026-11-19T23:41:00Z' }] },
      now,
    );
    expect(old[0]).toMatchObject({ judgement: 'WARN', item: '未実行: 本文の取得' });
    const failed = judgeSpeechPipeline({ ...base, lastRuns: [{ ...base.lastRuns[1]!, status: 'FAILED' }] }, now);
    expect(failed[0]).toMatchObject({ judgement: 'WARN', item: '失敗: 要約の作成' });
  });

  it('PENDING 滞留 and FAILED at the cap are 注意; retrying and summary FAILED are 情報', () => {
    const md = renderSpeechPipelineMarkdown(
      { ...base, pendingWithUrlStale: 2, bodyFailedAtCap: 1, bodyFailedRetrying: 3, summaryFailed: 1 },
      now,
    );
    expect(md).toContain('判定: 注意');
    expect(md).toContain('| 注意 | PENDING の滞留 | 2 件。');
    expect(md).toContain('| 注意 | 本文の FAILED(上限) | 1 件。');
    expect(md).toContain('| 情報 | 本文の FAILED(取り直し中) | 3 件。');
    expect(md).toContain('| 情報 | 要約の FAILED | 1 件。');
    expect(renderSpeechPipelineMarkdown({ ...base, summaryFailed: 1 }, now)).toContain('判定: 情報');
  });

  it('unreadable (before the migration) → 注意 with the reason', () => {
    expect(renderSpeechPipelineMarkdown(null, now)).toContain('判定: 注意(本文・要約の状態を読めなかった');
  });
});

describe('workflow: scheduled speech bodies and summaries', () => {
  const yml = readFileSync(
    join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-ingestion.yml'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const steps = yml.split('\n      - name: ').slice(1);
  const step = (prefix: string) => {
    const found = steps.filter((s) => s.startsWith(prefix));
    expect(found, prefix).toHaveLength(1);
    return found[0]!;
  };
  const names = steps.map((s) => s.split('\n')[0]!);

  it('both steps run only on the 3-hourly schedule, after the DEV check, even if an earlier step failed', () => {
    for (const prefix of ['Speech bodies (scheduled', 'Speech summaries (scheduled']) {
      const s = step(prefix);
      expect(s).toContain('!cancelled()');
      expect(s).toContain("steps.check.outputs.ready == 'true'");
      expect(s).toContain("github.event_name == 'schedule'");
      expect(s).toContain("github.event.schedule == '41 */3 * * *'");
      expect(s).not.toContain('continue-on-error'); // 失敗はジョブの失敗として残す(通知される)
      expect(s).not.toContain('failure()');
    }
    expect(step('Speech bodies (scheduled')).toContain('run: npm run -s ingest:speech-bodies -- --scheduled');
    expect(step('Speech summaries (scheduled')).toContain('run: npm run -s ingest:speech-summaries -- --scheduled');
  });

  it('order: speeches → bodies → summaries (summaries run even when bodies fail: !cancelled())', () => {
    const iSpeeches = names.indexOf('Speeches');
    const iBodies = names.findIndex((n) => n.startsWith('Speech bodies (scheduled'));
    const iSummaries = names.findIndex((n) => n.startsWith('Speech summaries (scheduled'));
    expect(iSpeeches).toBeGreaterThanOrEqual(0);
    expect(iBodies).toBe(iSpeeches + 1);
    expect(iSummaries).toBe(iBodies + 1);
  });

  it('the DEV check stops when the key is not for DEV, and the 3-hourly run is in the speeches concurrency group', () => {
    const check = step('Check secrets and target');
    expect(check).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(yml).toContain('DEV_PROJECT_REF: pbemckwnqmeaoveelihd');
    expect(yml).toMatch(/github\.event\.schedule == '41 \*\/3 \* \* \*' \|\|[^\n]*'fx-ingestion-speeches'/);
    expect(yml).toContain('cancel-in-progress: false');
  });
});
