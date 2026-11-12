/** HQ指示(2026-11-12「Actions の既存 Secrets を利用する読み取り専用確認 target」): 集計・指紋・出力の安全性。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readOnly } from '../../src/ingestion/verify/readOnlyDb.js';
import {
  annotation,
  buildSpeechDevReport,
  fingerprints,
  md5,
  pgTimestampText,
  summarizeRuns,
  type VerifySpeechRow,
} from '../../src/ingestion/verify/speechDevReport.js';

const BODY = 'SECRET-BODY-TEXT Inflation has eased.';
const SUMMARY = 'SECRET-SUMMARY-TEXT Inflation has eased.';
const row = (o: Partial<VerifySpeechRow>): VerifySpeechRow => ({
  id: '00000000-0000-0000-0000-000000000001',
  provider: 'frb_calendar',
  status: 'DELIVERED',
  body_status: 'PENDING',
  body_error: null,
  source_url: null,
  body_attempts: 0,
  body_last_attempt_at: null,
  body_fetched_at: null,
  summary_method: null,
  summary_error: null,
  summary_generated_at: null,
  statement_datetime: '2026-11-10T20:30:00+00:00',
  speech_body: null,
  summary: null,
  ...o,
});

describe('pgTimestampText (PostgREST JSON → timestamptz::text in a UTC session)', () => {
  it('converts the forms PostgREST returns', () => {
    expect(pgTimestampText('2026-11-11T08:54:40.354+00:00')).toBe('2026-11-11 08:54:40.354+00');
    expect(pgTimestampText('2026-11-11T09:24:46.443+00:00')).toBe('2026-11-11 09:24:46.443+00');
    expect(pgTimestampText('2026-11-11T17:25:32.325819+00:00')).toBe('2026-11-11 17:25:32.325819+00');
    expect(pgTimestampText('2026-11-11T08:00:00+00:00')).toBe('2026-11-11 08:00:00+00');
    expect(pgTimestampText(null)).toBeNull();
    expect(() => pgTimestampText('2026-11-11 08:00:00+09:00')).toThrow();
  });
});

describe('fingerprints (same expression as the SQL used on DEV)', () => {
  it('per provider, ordered by id, with md5 of body/summary and empty strings for NULL', () => {
    const a = row({
      id: '00000000-0000-0000-0000-00000000000b',
      body_status: 'FETCHED',
      source_url: 'https://www.federalreserve.gov/newsevents/speech/x.htm',
      speech_body: BODY,
      summary: SUMMARY,
      summary_method: 'EXTRACTIVE_EN',
      body_fetched_at: '2026-11-11T08:54:40.354+00:00',
      summary_generated_at: '2026-11-11T09:28:40.872+00:00',
    });
    const b = row({ id: '00000000-0000-0000-0000-00000000000a' });
    const c = row({ id: '00000000-0000-0000-0000-00000000000c', provider: 'ecb_press_rss' });
    const expected = md5(
      [
        [b.id, 'DELIVERED', 'PENDING', '', '', '', '', '', '', '', '', '0', ''].join('|'),
        [
          a.id,
          'DELIVERED',
          'FETCHED',
          a.source_url,
          md5(BODY),
          md5(SUMMARY),
          'EXTRACTIVE_EN',
          '',
          '',
          '2026-11-11 08:54:40.354+00',
          '2026-11-11 09:28:40.872+00',
          '0',
          '',
        ].join('|'),
      ].join(','),
    );
    const fp = fingerprints([a, c, b]);
    expect(Object.keys(fp)).toEqual(['ecb_press_rss', 'frb_calendar']);
    expect(fp.frb_calendar).toEqual({ n: 2, fingerprint: expected });
    expect(fp.ecb_press_rss!.n).toBe(1);
  });

  it('changes when anything checked changes (attempts, URL, body)', () => {
    const base = [row({})];
    const f0 = fingerprints(base).frb_calendar!.fingerprint;
    expect(fingerprints([row({ body_attempts: 1 })]).frb_calendar!.fingerprint).not.toBe(f0);
    expect(
      fingerprints([row({ source_url: 'https://www.federalreserve.gov/x.htm' })]).frb_calendar!.fingerprint,
    ).not.toBe(f0);
    expect(fingerprints([row({ speech_body: 'x' })]).frb_calendar!.fingerprint).not.toBe(f0);
  });
});

describe('buildSpeechDevReport', () => {
  const now = new Date('2026-11-12T07:00:00Z');
  const rows = [
    row({
      id: 'f-fetched-1',
      body_status: 'FETCHED',
      speech_body: BODY,
      summary: SUMMARY,
      summary_method: 'EXTRACTIVE_EN',
      source_url: 'https://www.federalreserve.gov/newsevents/speech/bowman20261110a.htm',
    }),
    row({ id: 'f-pending', statement_datetime: '2026-11-09T13:40:00+00:00' }),
    row({ id: 'f-future', status: 'SCHEDULED', statement_datetime: '2026-11-12T15:00:00+00:00' }),
    row({
      id: 'e-ok',
      provider: 'ecb_press_rss',
      body_status: 'NOT_APPLICABLE',
      body_error: 'RIGHTS_UNCONFIRMED',
      source_url: 'https://www.ecb.europa.eu/press/key/x.html',
    }),
    row({ id: 'e-pending', provider: 'ecb_press_rss', source_url: 'https://www.ecb.europa.eu/press/key/y.html' }),
  ];
  const report = buildSpeechDevReport(rows, now);

  it('counts by provider/status/body_status, attempts, ECB and future FRB rows', () => {
    expect(report.total).toBe(5);
    expect(report.byState).toEqual({
      'frb_calendar/DELIVERED/FETCHED': 1,
      'frb_calendar/DELIVERED/PENDING': 1,
      'frb_calendar/SCHEDULED/PENDING': 1,
      'ecb_press_rss/DELIVERED/NOT_APPLICABLE': 1,
      'ecb_press_rss/DELIVERED/PENDING': 1,
    });
    expect(report.attempts).toEqual({ '0': 5 });
    expect(report.ecb).toMatchObject({
      n: 2,
      notApplicableRightsUnconfirmed: 1,
      bodyNull: 2,
      summaryNull: 2,
      attemptsNonZero: 0,
    });
    expect(report.ecb.other).toEqual([
      { id: 'e-pending', status: 'DELIVERED', body_status: 'PENDING', body_error: null },
    ]);
    expect(report.frbFuture).toEqual({
      n: 1,
      withBodyOrAttempt: 0,
      rows: [
        { id: 'f-future', at: '2026-11-12T15:00:00+00:00', status: 'SCHEDULED', body_status: 'PENDING', attempts: 0 },
      ],
    });
    expect(report.frbRows[report.frbRows.length - 1]![0]).toBe('f-future');
  });

  it('never contains the body or summary text (only short md5)', () => {
    const out = JSON.stringify(report);
    expect(out).not.toContain('SECRET-BODY-TEXT');
    expect(out).not.toContain('SECRET-SUMMARY-TEXT');
    const fetched = report.frbRows.find((r) => r[0] === 'f-fetche')!;
    expect(fetched[6]).toBe(md5(BODY).slice(0, 8));
    expect(fetched[7]).toBe(md5(SUMMARY).slice(0, 8));
  });
});

describe('summarizeRuns and annotation', () => {
  it('keeps counts and skip reasons only', () => {
    expect(
      summarizeRuns([
        {
          job: 'ingest:speech-bodies',
          started_at: '2026-11-12T06:45:00Z',
          status: 'SUCCESS',
          fetched_count: 12,
          success_count: 0,
          error_count: 0,
          details: {
            skip_reasons: { RIGHTS_UNCONFIRMED: 6 },
            failed: [{ speech_id: 'x', url: 'u' }],
            fetched: [{ x: 1 }],
          },
        },
      ]),
    ).toEqual([
      {
        job: 'ingest:speech-bodies',
        started_at: '2026-11-12T06:45:00Z',
        status: 'SUCCESS',
        fetched: 12,
        success: 0,
        errors: 0,
        skip_reasons: { RIGHTS_UNCONFIRMED: 6 },
        ready: null,
        failed: 1,
      },
    ]);
  });

  it('formats a single-line ::notice and escapes newlines and %', () => {
    const line = annotation('verify, 1: x', { a: 'line1\nline2 100%' });
    expect(line.startsWith('::notice title=verify  1  x::')).toBe(true);
    expect(line).not.toContain('\n');
    expect(line).toContain('line1\\nline2'); // JSON の中で改行は \n の2文字になる(本物の改行は入らない)
    expect(line).toContain('100%25');
  });
});

describe('readOnly (select only)', () => {
  it('reaches only select on the allowed tables; no write method is exposed', () => {
    const calls: string[] = [];
    const fake = {
      from: (t: string) => ({
        select: (c: string) => {
          calls.push(`select ${t} ${c}`);
          return 'q';
        },
        insert: () => calls.push('insert'),
        update: () => calls.push('update'),
        delete: () => calls.push('delete'),
        upsert: () => calls.push('upsert'),
      }),
      rpc: () => calls.push('rpc'),
    } as unknown as SupabaseClient;
    const db = readOnly(fake);
    expect(Object.keys(db)).toEqual(['from']);
    const t = db.from('speech_events');
    expect(Object.keys(t)).toEqual(['select']);
    t.select('id');
    expect(calls).toEqual(['select speech_events id']);
    expect(() => db.from('speakers' as never)).toThrow('table not allowed');
  });
});

describe('workflow fx-event-analyzer-dev-verify.yml', () => {
  const yml = readFileSync(
    join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-dev-verify.yml'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('runs only on a push to verify/fx-dev-readonly or by hand; never on a schedule', () => {
    expect(yml).not.toMatch(/^\s*schedule:/m);
    expect(yml).toMatch(/push:\n\s+branches:\n\s+- 'verify\/fx-dev-readonly'\n\s+workflow_dispatch:/);
    expect(yml).not.toContain('pull_request');
  });

  it('read-only permissions, the DEV check, the existing DEV secrets, and only the verify job', () => {
    expect(yml).toMatch(/permissions:\n\s+contents: read/);
    expect(yml).toContain('"$KEY_REF" != "$DEV_PROJECT_REF"');
    expect(yml).toContain('DEV_PROJECT_REF: pbemckwnqmeaoveelihd');
    expect(yml).toContain('secrets.FX_DEV_SUPABASE_SERVICE_ROLE_KEY');
    const runs = [...yml.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map((m) => m[1]!);
    expect(runs).toEqual(['|', 'npm ci --no-audit --no-fund', 'npm run -s verify:speeches-dev']);
    expect(yml).not.toMatch(/ingest:|migration|supabase db|psql/);
  });
});
