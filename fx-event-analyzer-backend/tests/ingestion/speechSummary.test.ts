/** HQ指示(2026-11-11「要人発言: 要約生成」): 原文からの抜粋の要約と、要約を作る工程。 */
import { describe, expect, it } from 'vitest';
import { JobCounters } from '../../src/ingestion/runner.js';
import {
  ingestSpeechSummaries,
  type SpeechForSummary,
  type SpeechSummaryPatch,
  type SpeechSummaryStore,
} from '../../src/ingestion/pipelines/speechSummaries.js';
import {
  splitSentences,
  summarizeExtractive,
  SUMMARY_MAX_CHARACTERS,
  SUMMARY_MAX_SENTENCES,
} from '../../src/ingestion/speechSummary.js';

const BODY = [
  'Thank you for the opportunity to speak with you today.',
  '',
  'Inflation has come down substantially from its peak, but inflation remains above our 2 percent objective.',
  'The labor market has cooled, and labor market conditions are now broadly in balance.',
  'I went to the U.S. Capitol last week to meet with colleagues from several committees.',
  '',
  'Monetary policy is well positioned, and the Committee will adjust policy as inflation and the labor market evolve.',
  'Our policy decisions will continue to depend on incoming data on inflation and the labor market.',
  '',
  'The views expressed here are my own and not necessarily those of the Federal Open Market Committee.',
].join('\n');

describe('splitSentences', () => {
  it('splits on sentence ends and paragraphs, but not after U.S. or Mr.', () => {
    const out = splitSentences('Mr. Powell spoke. The U.S. economy grew.\n\nInflation fell! Did it?');
    expect(out).toEqual(['Mr. Powell spoke.', 'The U.S. economy grew.', 'Inflation fell!', 'Did it?']);
  });
});

describe('summarizeExtractive', () => {
  it('picks up to 3 sentences, verbatim and in the original order, skipping greetings and disclaimers', () => {
    const result = summarizeExtractive(BODY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sentences = splitSentences(BODY);
    const picked = sentences.filter((s) => result.summary.includes(s));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    // そのままの文を本文の順につないだもの(言い換え・足しなし)
    expect(result.summary).toBe(picked.join(' '));
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARACTERS);
    expect(result.summary).not.toMatch(/Thank you|views expressed/);
    expect(result.summary).toMatch(/inflation/i);
  });

  it('does not pick headings (no sentence-ending punctuation)', () => {
    const body = `Labor Market Conditions And The Outlook For Inflation In The Months Ahead\n\n${BODY}`;
    const result = summarizeExtractive(body);
    expect(result.ok && result.summary).not.toMatch(/Labor Market Conditions/);
  });

  it('is deterministic', () => {
    expect(summarizeExtractive(BODY)).toEqual(summarizeExtractive(BODY));
  });

  it('BODY_TOO_SHORT for a short body, NO_SENTENCES when only boilerplate is left', () => {
    expect(summarizeExtractive('Thank you for having me.')).toEqual({ ok: false, reason: 'BODY_TOO_SHORT' });
    const boilerplate = Array.from(
      { length: 12 },
      (_, i) => `Thank you very much to everyone in the room number ${i}.`,
    ).join(' ');
    expect(summarizeExtractive(boilerplate)).toEqual({ ok: false, reason: 'NO_SENTENCES' });
  });

  it('never exceeds the character cap even with long sentences', () => {
    const long = Array.from(
      { length: 8 },
      (_, i) =>
        `Inflation and employment outcomes in district ${i} ${'remain closely watched by policymakers '.repeat(8)}today.`,
    ).join(' ');
    const result = summarizeExtractive(long);
    if (result.ok) expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARACTERS);
  });
});

function fakeStore(rows: SpeechForSummary[]) {
  const updates: Array<{ id: string; patch: SpeechSummaryPatch }> = [];
  const calls: Array<{ sinceIso: string | null; limit: number }> = [];
  const store: SpeechSummaryStore = {
    listSpeechesNeedingSummary(sinceIso, limit) {
      calls.push({ sinceIso, limit });
      return Promise.resolve(rows);
    },
    updateSpeechSummary(id, patch) {
      updates.push({ id, patch });
      return Promise.resolve();
    },
  };
  return { store, updates, calls };
}

describe('ingestSpeechSummaries', () => {
  const now = new Date('2026-11-11T06:00:00Z');
  const row = (id: string, body: string): SpeechForSummary => ({
    id,
    provider: 'frb_calendar',
    statement_datetime: '2026-11-05T15:00:00Z',
    speech_body: body,
  });

  it('writes READY summaries with method and time, and FAILED reasons without a summary', async () => {
    const { store, updates } = fakeStore([row('a', BODY), row('b', 'Thank you for having me.')]);
    const counters = new JobCounters();
    const result = await ingestSpeechSummaries(store, { pastDays: 30, maxSpeeches: 200 }, now, counters);
    expect(result).toEqual({ ready: 1, failed: 1 });
    expect(updates[0]!.id).toBe('a');
    expect(updates[0]!.patch).toMatchObject({
      summary_method: 'EXTRACTIVE_EN',
      summary_generated_at: '2026-11-11T06:00:00.000Z',
      summary_error: null,
    });
    expect(updates[0]!.patch.summary).toEqual((summarizeExtractive(BODY) as { summary: string }).summary);
    expect(updates[1]).toEqual({
      id: 'b',
      patch: { summary: null, summary_method: null, summary_generated_at: null, summary_error: 'BODY_TOO_SHORT' },
    });
    expect(counters.skipReasons).toMatchObject({ BODY_TOO_SHORT: 1 });
  });

  it('asks for the last 30 days by default, and for all past speeches when pastDays is null', async () => {
    const a = fakeStore([]);
    await ingestSpeechSummaries(a.store, { pastDays: 30, maxSpeeches: 200 }, now, new JobCounters());
    expect(a.calls).toEqual([{ sinceIso: '2026-10-12T06:00:00.000Z', limit: 200 }]);
    const b = fakeStore([]);
    await ingestSpeechSummaries(b.store, { pastDays: null, maxSpeeches: 50 }, now, new JobCounters());
    expect(b.calls).toEqual([{ sinceIso: null, limit: 50 }]);
  });
});
