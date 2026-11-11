/**
 * report:fx-health の出力(HQ承認 2026-11-11「FX価格監視のワークフロー組み込み」): 注釈で WARN / ALERT を区別、
 * サマリーに判定・理由・集計・読んだ記録、監視の失敗の注釈。
 */
import { describe, expect, it } from 'vitest';
import type { FxHealthInput, FxHealthReport } from '../../src/ingestion/quality/fxHealth.js';
import {
  fxHealthAnnotations,
  fxHealthFailureAnnotation,
  fxHealthQueries,
  renderFxHealthMarkdown,
} from '../../src/ingestion/quality/fxHealthOutput.js';
import { exitCodeFor } from '../../src/jobs/reportFxHealth.js';

const input: FxHealthInput = {
  runs: [],
  credits: { automatic: 360, manual: 0, total: 360 },
  caps: { automatic: 700, total: 800 },
  unverifiedCandles: 0,
};
const summary: FxHealthReport['summary'] = {
  runs: 47,
  failures: 0,
  github_runs: [{ github_run_id: '42860175119', iterations: 17, failures: 0, first: 'a', last: 'b' }],
  longest_gap_minutes: 196,
  minutes_since_last_run: 16,
  credits: input.credits,
};
const report = (findings: FxHealthReport['findings'], level: FxHealthReport['level']): FxHealthReport => ({
  level,
  findings,
  summary,
});

describe('fxHealthAnnotations', () => {
  it('WARN → ::warning, ALERT → ::error, with the check in the title; OK → one ::notice', () => {
    const r = report(
      [
        { check: 'RUN_GAP', level: 'ALERT', message: '市場の時間に 196 分、取り込みが無かった' },
        { check: 'UNVERIFIED', level: 'WARN', message: 'UNVERIFIED の1分足が 3 本' },
      ],
      'ALERT',
    );
    expect(fxHealthAnnotations(r)).toEqual([
      '::error title=FX health ALERT RUN_GAP::市場の時間に 196 分、取り込みが無かった',
      '::warning title=FX health WARN UNVERIFIED::UNVERIFIED の1分足が 3 本',
    ]);
    expect(fxHealthAnnotations(report([], 'OK'))).toEqual(['::notice title=FX health OK::為替の定時取得に異常なし']);
  });

  it('escapes characters GitHub Actions treats specially (%, newline, : and , in the title)', () => {
    const r = report([{ check: 'CREDITS', level: 'WARN', message: '80%\n超' }], 'WARN');
    expect(fxHealthAnnotations(r)[0]).toBe('::warning title=FX health WARN CREDITS::80%25%0A超');
    expect(fxHealthFailureAnnotation(new Error('TypeError: fetch failed, retry'))).toBe(
      '::error title=FX health check failed::report:fx-health が判定できなかった — Error: TypeError: fetch failed, retry',
    );
  });
});

describe('workflow behaviour', () => {
  it('--fail-on alert: ALERT fails the workflow (Exit 1), WARN and OK do not', () => {
    expect(exitCodeFor(report([{ check: 'RUN_GAP', level: 'ALERT', message: 'x' }], 'ALERT'), 'ALERT')).toBe(1);
    expect(exitCodeFor(report([{ check: 'UNVERIFIED', level: 'WARN', message: 'x' }], 'WARN'), 'ALERT')).toBe(0);
    expect(exitCodeFor(report([], 'OK'), 'ALERT')).toBe(0);
  });
});

describe('renderFxHealthMarkdown', () => {
  it('has the level, the reasons, the aggregated values and the queries that were read', () => {
    const queries = fxHealthQueries('2026-11-10T01:00:00.000Z', '2026-11-11T01:00:00.000Z', '2026-11-11');
    const md = renderFxHealthMarkdown(
      report([{ check: 'RUN_GAP', level: 'ALERT', message: '196 分 | 取り込みなし' }], 'ALERT'),
      input,
      { at: '2026-11-11T01:00:00.000Z', hours: 24, failOn: 'ALERT', queries },
    );
    expect(md).toContain('🔴 ALERT');
    expect(md).toContain('| ALERT | RUN_GAP | 196 分 \\| 取り込みなし |');
    expect(md).toContain('ingest:fx-prices の実行: 47 回(FAILURE 0 回)');
    expect(md).toContain('今日(UTC)のクレジット: 合計 360 / 800、自動 360 / 700、手動 0');
    expect(md).toContain('| 42860175119 | 17 | 0 | a | b |');
    expect(md).toContain(
      "from ingestion_logs where job = 'ingest:fx-prices' and started_at >= '2026-11-10T01:00:00.000Z'",
    );
    expect(md).toContain('WARN は記録だけで失敗にしない');
    expect(md).toContain('schedule)の取りこぼし自体は防げない');
    expect(queries).toHaveLength(4);
    expect(queries.every((q) => q.startsWith('select '))).toBe(true); // 読むだけ
  });
});
