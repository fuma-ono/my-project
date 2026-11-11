/** HQ決定(2026-11-10「要人発言の要約機能改善」、api-design v1.51): 要約の状態。 */
import { describe, expect, it } from 'vitest';
import { SPEECH_SUMMARY_STATUSES, speechSummaryStatus } from '../../src/repositories/speechesRepository.js';

describe('speechSummaryStatus', () => {
  it('READY when there is a summary', () => {
    expect(speechSummaryStatus('政策金利の据え置きを説明した。')).toBe('READY');
  });

  it('NOT_AVAILABLE when there is none (null, undefined, empty or blank) — no summary is made up', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(speechSummaryStatus(value), JSON.stringify(value)).toBe('NOT_AVAILABLE');
    }
  });

  it('the API values are exactly NOT_AVAILABLE / GENERATING / READY / FAILED (the last two are reserved)', () => {
    expect([...SPEECH_SUMMARY_STATUSES]).toEqual(['NOT_AVAILABLE', 'GENERATING', 'READY', 'FAILED']);
  });
});
