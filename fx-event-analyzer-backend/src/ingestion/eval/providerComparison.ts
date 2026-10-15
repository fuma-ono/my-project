/**
 * Comparison harness for the paid candidates (`npm run eval:providers`,
 * data-sources.md §7). Pure functions: given normalized provider output
 * and an official resolver, build a report of
 * - actual vs official mismatches (rounding-aware),
 * - missing forecasts,
 * - release-time differences (vs the agency's schedule, vs FRED release
 *   dates, and between providers),
 * - FX minute close differences between two sources (pips statistics).
 * Nothing here writes to the database.
 */
import {
  FRED_RELEASE_IDS,
  buildMappingIndex,
  type CalendarProviderId,
  type IndicatorMapping,
} from '../mappings/indicators.js';
import { toPips } from '../mappings/fxPairs.js';
import { localDate } from '../time.js';
import type { NormalizedCalendarRelease, NormalizedCandle } from '../types.js';
import { localReleaseTime, validateRelease, withReferencePeriod } from '../validation/economicRelease.js';
import { compareWithOfficial, type OfficialValueResolver } from '../verification/official.js';
import { roundTo } from '../values.js';

export interface CalendarRowReport {
  providerEventId: string;
  indicator: string;
  period: string | null;
  periodInferred: boolean;
  releaseAt: string;
  localReleaseTime: string;
  actual: number | null;
  forecast: number | null;
  official: number | null;
  officialSource: string | null;
  officialMatch: boolean | null;
  difference: number | null;
  issues: string[];
}

export interface CalendarProviderReport {
  provider: CalendarProviderId;
  fetched: number;
  mapped: number;
  unmappedKeys: string[];
  rows: CalendarRowReport[];
  summary: {
    withActual: number;
    officialCompared: number;
    officialMismatches: number;
    officialUnavailable: number;
    missingForecasts: number;
    releaseTimeIssues: number;
    otherIssues: number;
  };
}

export async function compareCalendarProvider(
  provider: CalendarProviderId,
  releases: readonly NormalizedCalendarRelease[],
  mappings: readonly IndicatorMapping[],
  resolver: OfficialValueResolver,
): Promise<CalendarProviderReport> {
  const index = buildMappingIndex(provider, mappings);
  const unmapped = new Set<string>();
  const rows: CalendarRowReport[] = [];
  for (const providerRelease of releases) {
    const mapping = index.get(providerRelease.providerIndicatorKey);
    if (!mapping) {
      unmapped.add(`${providerRelease.providerIndicatorKey} (${providerRelease.eventName})`);
      continue;
    }
    const { release, inferred } = withReferencePeriod(providerRelease, mapping);
    const validation = validateRelease(release, mapping, { futureActualToleranceMs: 60_000 });
    const actual = validation.values.actual;
    let official: number | null = null;
    let officialSource: string | null = null;
    let officialMatch: boolean | null = null;
    let difference: number | null = null;
    if (actual !== null && release.referencePeriod !== null) {
      const resolved = await resolver.resolve(
        mapping,
        release.referencePeriod,
        localDate(new Date(release.releaseAt), mapping.release.timeZone),
      );
      if (resolved) {
        const comparison = compareWithOfficial(actual, resolved.value, mapping.decimals, mapping.officialTolerance);
        official = comparison.officialRounded;
        officialSource = resolved.sourceRef;
        officialMatch = comparison.match;
        difference = comparison.difference;
      }
    }
    rows.push({
      providerEventId: release.providerEventId,
      indicator: mapping.code,
      period: release.referencePeriod,
      periodInferred: inferred,
      releaseAt: release.releaseAt,
      localReleaseTime: localReleaseTime(release.releaseAt, mapping.release.timeZone),
      actual,
      forecast: validation.values.forecast,
      official,
      officialSource,
      officialMatch,
      difference,
      issues: validation.issues,
    });
  }
  const withActual = rows.filter((row) => row.actual !== null);
  const timeIssues = new Set(['MISSING_EXACT_TIME', 'RELEASE_TIME_UNEXPECTED']);
  return {
    provider,
    fetched: releases.length,
    mapped: rows.length,
    unmappedKeys: [...unmapped].sort().slice(0, 50),
    rows,
    summary: {
      withActual: withActual.length,
      officialCompared: withActual.filter((row) => row.officialMatch !== null).length,
      officialMismatches: withActual.filter((row) => row.officialMatch === false).length,
      officialUnavailable: withActual.filter((row) => row.officialMatch === null).length,
      missingForecasts: rows.filter((row) => row.forecast === null).length,
      releaseTimeIssues: rows.filter((row) => row.issues.some((issue) => timeIssues.has(issue))).length,
      otherIssues: rows.filter((row) => row.issues.some((issue) => !timeIssues.has(issue))).length,
    },
  };
}

export interface CrossProviderTimeDiff {
  indicator: string;
  period: string;
  releaseAt: Record<string, string>;
  maxDiffMinutes: number;
}

/** Same indicator + period seen by several providers: how far apart are their release instants? */
export function compareReleaseTimesAcrossProviders(
  reports: readonly CalendarProviderReport[],
): CrossProviderTimeDiff[] {
  const byKey = new Map<string, Record<string, string>>();
  for (const report of reports) {
    for (const row of report.rows) {
      if (row.period === null) continue;
      const key = `${row.indicator}|${row.period}`;
      const entry = byKey.get(key) ?? {};
      entry[report.provider] = row.releaseAt;
      byKey.set(key, entry);
    }
  }
  const diffs: CrossProviderTimeDiff[] = [];
  for (const [key, releaseAt] of byKey) {
    const times = Object.values(releaseAt).map((iso) => Date.parse(iso));
    if (times.length < 2) continue;
    const [indicator = '', period = ''] = key.split('|');
    diffs.push({ indicator, period, releaseAt, maxDiffMinutes: (Math.max(...times) - Math.min(...times)) / 60_000 });
  }
  return diffs.sort((a, b) => b.maxDiffMinutes - a.maxDiffMinutes);
}

export interface FredReleaseDateCheck {
  indicator: string;
  provider: string;
  providerDate: string;
  inFredReleaseDates: boolean;
}

/** Provider release dates (agency-local) vs FRED's release calendar. */
export function checkAgainstFredReleaseDates(
  reports: readonly CalendarProviderReport[],
  mappings: readonly IndicatorMapping[],
  fredDates: ReadonlyMap<number, ReadonlySet<string>>,
): FredReleaseDateCheck[] {
  const checks: FredReleaseDateCheck[] = [];
  for (const report of reports) {
    for (const row of report.rows) {
      const releaseId = FRED_RELEASE_IDS[row.indicator];
      const mapping = mappings.find((m) => m.code === row.indicator);
      const dates = releaseId === undefined ? undefined : fredDates.get(releaseId);
      if (!mapping || !dates) continue;
      const providerDate = localDate(new Date(row.releaseAt), mapping.release.timeZone);
      checks.push({
        indicator: row.indicator,
        provider: report.provider,
        providerDate,
        inFredReleaseDates: dates.has(providerDate),
      });
    }
  }
  return checks;
}

export interface FxComparison {
  symbol: string;
  primary: string;
  secondary: string;
  primaryMinutes: number;
  secondaryMinutes: number;
  matchedMinutes: number;
  onlyInPrimary: number;
  onlyInSecondary: number;
  absDiffPips: { mean: number | null; p50: number | null; p95: number | null; max: number | null };
  overThreshold: number;
  thresholdPips: number;
  worstMinutes: { minute: string; primaryClose: number; secondaryClose: number; diffPips: number }[];
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function compareFxSeries(
  symbol: string,
  pipSize: number,
  primary: readonly NormalizedCandle[],
  secondary: readonly NormalizedCandle[],
  thresholdPips: number,
): FxComparison {
  const a = new Map(primary.map((c) => [new Date(c.openTime).toISOString(), c]));
  const b = new Map(secondary.map((c) => [new Date(c.openTime).toISOString(), c]));
  const diffs: { minute: string; primaryClose: number; secondaryClose: number; diffPips: number }[] = [];
  for (const [minute, candle] of a) {
    const other = b.get(minute);
    if (!other) continue;
    diffs.push({
      minute,
      primaryClose: candle.close,
      secondaryClose: other.close,
      diffPips: roundTo(toPips(candle.close - other.close, pipSize), 2),
    });
  }
  const abs = diffs.map((d) => Math.abs(d.diffPips)).sort((x, y) => x - y);
  const mean = abs.length === 0 ? null : roundTo(abs.reduce((sum, v) => sum + v, 0) / abs.length, 2);
  return {
    symbol,
    primary: primary[0]?.provider ?? 'primary',
    secondary: secondary[0]?.provider ?? 'secondary',
    primaryMinutes: a.size,
    secondaryMinutes: b.size,
    matchedMinutes: diffs.length,
    onlyInPrimary: [...a.keys()].filter((k) => !b.has(k)).length,
    onlyInSecondary: [...b.keys()].filter((k) => !a.has(k)).length,
    absDiffPips: { mean, p50: percentile(abs, 50), p95: percentile(abs, 95), max: abs.at(-1) ?? null },
    overThreshold: abs.filter((v) => v > thresholdPips).length,
    thresholdPips,
    worstMinutes: [...diffs].sort((x, y) => Math.abs(y.diffPips) - Math.abs(x.diffPips)).slice(0, 10),
  };
}

export interface ProviderEvalReport {
  generatedAt: string;
  range: { from: string; to: string };
  officialSources: string[];
  calendar: CalendarProviderReport[];
  crossProviderReleaseTimes: CrossProviderTimeDiff[];
  fredReleaseDates: FredReleaseDateCheck[];
  fredReleaseIdChecks: { seriesId: string; expected: number; actual: number | null }[];
  fx: FxComparison[];
  fxSingleSource: { provider: string; symbol: string; minutes: number; expectedMinutes: number }[];
  errors: string[];
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return String(value).replace(/\|/g, '\\|');
}

export function renderMarkdownReport(report: ProviderEvalReport): string {
  const lines: string[] = [];
  lines.push(`# Provider comparison report`, '');
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push(`- range: ${report.range.from} 〜 ${report.range.to}`);
  lines.push(`- official sources: ${report.officialSources.join(', ') || 'none'}`, '');

  lines.push('## Economic calendar', '');
  if (report.calendar.length === 0) lines.push('No calendar provider key set.', '');
  for (const provider of report.calendar) {
    const s = provider.summary;
    lines.push(`### ${provider.provider}`, '');
    lines.push(
      `fetched ${provider.fetched} / mapped ${provider.mapped} / with actual ${s.withActual} / compared with official ${s.officialCompared} / **mismatches ${s.officialMismatches}** / official unavailable ${s.officialUnavailable} / missing forecasts ${s.missingForecasts} / release-time issues ${s.releaseTimeIssues} / other issues ${s.otherIssues}`,
      '',
    );
    if (provider.rows.length > 0) {
      lines.push('| indicator | period | release (UTC) | local | actual | forecast | official | match | issues |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      for (const row of provider.rows) {
        lines.push(
          `| ${cell(row.indicator)} | ${cell(row.period)}${row.periodInferred ? ' (inferred)' : ''} | ${cell(row.releaseAt)} | ${cell(row.localReleaseTime)} | ${cell(row.actual)} | ${cell(row.forecast)} | ${cell(row.official)} | ${row.officialMatch === null ? '—' : row.officialMatch ? 'OK' : '**NG**'} | ${cell(row.issues.join(', '))} |`,
        );
      }
      lines.push('');
    }
    if (provider.unmappedKeys.length > 0) {
      lines.push(
        `Unmapped rows (first ${provider.unmappedKeys.length}): ${provider.unmappedKeys.map(cell).join(', ')}`,
        '',
      );
    }
  }
  if (report.crossProviderReleaseTimes.length > 0) {
    lines.push('### Release time differences between providers', '');
    lines.push('| indicator | period | max diff (min) | times |', '|---|---|---|---|');
    for (const diff of report.crossProviderReleaseTimes) {
      lines.push(
        `| ${diff.indicator} | ${diff.period} | ${diff.maxDiffMinutes} | ${cell(
          Object.entries(diff.releaseAt)
            .map(([p, t]) => `${p}=${t}`)
            .join(' '),
        )} |`,
      );
    }
    lines.push('');
  }
  if (report.fredReleaseDates.length > 0) {
    const misses = report.fredReleaseDates.filter((check) => !check.inFredReleaseDates);
    lines.push(
      `### FRED release calendar check`,
      '',
      `${report.fredReleaseDates.length - misses.length}/${report.fredReleaseDates.length} provider dates are FRED release dates.`,
    );
    for (const miss of misses) lines.push(`- NG: ${miss.provider} ${miss.indicator} ${miss.providerDate}`);
    lines.push('');
  }
  if (report.fredReleaseIdChecks.length > 0) {
    lines.push('### FRED release id check (mappings/indicators.ts FRED_RELEASE_IDS)', '');
    for (const check of report.fredReleaseIdChecks) {
      lines.push(
        `- ${check.seriesId}: expected ${check.expected}, FRED says ${cell(check.actual)} ${check.actual === check.expected ? 'OK' : '**NG**'}`,
      );
    }
    lines.push('');
  }

  lines.push('## FX 1-minute candles', '');
  if (report.fx.length === 0 && report.fxSingleSource.length === 0) lines.push('No FX provider key set.', '');
  if (report.fx.length > 0) {
    lines.push(
      '| pair | primary vs secondary | matched | only primary | only secondary | mean | p50 | p95 | max | > threshold |',
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const fx of report.fx) {
      lines.push(
        `| ${fx.symbol} | ${fx.primary} vs ${fx.secondary} | ${fx.matchedMinutes} | ${fx.onlyInPrimary} | ${fx.onlyInSecondary} | ${cell(fx.absDiffPips.mean)} | ${cell(fx.absDiffPips.p50)} | ${cell(fx.absDiffPips.p95)} | ${cell(fx.absDiffPips.max)} | ${fx.overThreshold} (>${fx.thresholdPips} pips) |`,
      );
    }
    lines.push('');
  }
  for (const single of report.fxSingleSource) {
    lines.push(
      `- ${single.provider} ${single.symbol}: ${single.minutes}/${single.expectedMinutes} minutes (no second source to compare)`,
    );
  }
  if (report.errors.length > 0) {
    lines.push('', '## Errors', '');
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  lines.push('');
  return lines.join('\n');
}
