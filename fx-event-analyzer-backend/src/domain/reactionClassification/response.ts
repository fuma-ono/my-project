import type { RightsLedgerEntry } from '../technical/rightsLedger.js';
import { REQUIRED_RIGHTS } from '../technical/rightsLedger.js';
import { analyzeEvent, type WindowAnalysis } from './analyze.js';
import type { BarCloses } from './baseline.js';
import { dstMismatchCaution } from './dstCaution.js';
import { buildWindowHistory, type HistorySampleInput } from './history.js';
import { type OverlapCandidate, overlapsBeforeRelease, overlapsInWindow, relevantCandidates } from './overlap.js';
import { CLASSIFIER_VERSION, paramsHash, publicParams, type ReactionParams } from './params.js';
import { roundTo } from './stats.js';

/**
 * Builds the GET /events/{id}/reaction-analysis response body (api-design.md; docs for screen designers in
 * fx-dev-records reaction_analysis_api_schema_for_designers.txt). Pure: everything it needs is passed in.
 * The labels are descriptive of what the closes did; they are not predictions or trading advice.
 * Peak / trough times are intentionally NOT part of the response (owner decision 2026-11-27).
 */
const PIPS_DECIMALS = 2;
const RATIO_DECIMALS = 4;

export interface ReactionRowInput {
  timeframe: string;
  post_release_price: number | null;
  pips: number | null;
  max_upward_pips: number | null;
  max_downward_pips: number | null;
  data_status: string;
}

export interface BuildEventInput {
  event_id: string;
  indicator_id: string;
  indicator_code: string;
  name: string;
  country_code: string;
  currency_code: string | null;
  release_datetime: string;
  release_datetime_precision: string;
}

export interface BuildPairInput {
  fx_pair_id: string;
  symbol: string;
  pip_size: number;
  base_currency: string;
  quote_currency: string;
}

export interface HistoryEventInput {
  event_id: string;
  release_datetime: string;
  bars: BarCloses;
  /** Other scheduled items around this past event (any importance / currency; filtered here). */
  candidates: readonly OverlapCandidate[];
}

export interface BuildInput {
  event: BuildEventInput;
  pair: BuildPairInput;
  selectablePairs: { fx_pair_id: string; symbol: string; is_default: boolean }[];
  marketEvent: {
    group_key: string | null;
    indicator_count: number;
    co_released_indicators: { indicator_id: string; indicator_code: string }[];
    /** economic_events.id of every indicator in the target's simultaneous-release group (excluded from overlaps). */
    group_event_ids: readonly string[];
  };
  params: ReactionParams;
  ledgerEntry: RightsLedgerEntry;
  dataSource: string;
  reactions: readonly ReactionRowInput[];
  bars: BarCloses;
  candidates: readonly OverlapCandidate[];
  history: readonly HistoryEventInput[];
  nowMs: number;
  finalityMs: number;
}

const pips = (v: number | null): number | null => (v === null ? null : roundTo(v, PIPS_DECIMALS));
const ratio = (v: number | null): number | null => (v === null ? null : roundTo(v, RATIO_DECIMALS));

function windowValues(row: ReactionRowInput | undefined) {
  const nothing = { pips: null, close_price: null, high_pips: null, low_pips: null, range_pips: null };
  if (!row || row.data_status === 'PENDING') return { data_status: 'DATA_PENDING' as const, ...nothing };
  if (row.data_status !== 'AVAILABLE') return { data_status: 'UNAVAILABLE' as const, ...nothing };
  const high = row.max_upward_pips === null ? null : Number(row.max_upward_pips);
  const low = row.max_downward_pips === null ? null : Number(row.max_downward_pips);
  return {
    data_status: 'AVAILABLE' as const,
    pips: row.pips === null ? null : Number(row.pips),
    close_price: row.post_release_price === null ? null : Number(row.post_release_price),
    high_pips: high,
    low_pips: low,
    // range_pips = high_pips - low_pips, from the same stored values as the reaction row.
    range_pips: high === null || low === null ? null : roundTo(high - low, PIPS_DECIMALS),
  };
}

function evidenceOut(w: WindowAnalysis) {
  const e = w.evidence;
  if (!e) return null;
  return {
    initial_z: ratio(e.initial_z),
    peak_offset_pips: pips(e.peak_offset_pips),
    worst_pullback_pips: pips(e.worst_pullback_pips),
    worst_pullback_ratio: ratio(e.worst_pullback_ratio),
    final_offset_pips: pips(e.final_offset_pips),
    final_retracement_ratio: ratio(e.final_retracement_ratio),
    final_offset_in_noise_units: ratio(e.final_offset_in_noise_units),
    borderline: e.borderline,
  };
}

export function ledgerBlock(entry: RightsLedgerEntry) {
  const required = REQUIRED_RIGHTS.eventReactionAnalysis.map((k) => entry.rights[k]);
  const dates = required.map((r) => r.confirmedAt ?? '').filter((d) => d !== '');
  const urls = required.map((r) => r.evidenceUrl ?? '').filter((u) => u.trim() !== '');
  return {
    entry_id: entry.sourceId,
    provider_name: entry.providerName ?? null,
    terms_url: entry.termsUrl ?? null,
    status: 'confirmed' as const,
    features: ['eventReactionAnalysis'],
    confirmed_at: dates.length === 0 ? null : [...dates].sort().at(-1)!,
    evidence_urls: [...new Set(urls)],
  };
}

export function buildReactionAnalysis(input: BuildInput) {
  const { event, pair, params } = input;
  const releaseMs = Date.parse(event.release_datetime);
  const timeExact = event.release_datetime_precision === 'EXACT';
  const analysis = analyzeEvent({
    releaseMs,
    timeExact,
    bars: input.bars,
    params,
    pipSize: pair.pip_size,
    nowMs: input.nowMs,
    finalityMs: input.finalityMs,
  });

  const groupIds = new Set(input.marketEvent.group_event_ids);
  const pairCurrencies = [pair.base_currency, pair.quote_currency];
  const relevant = relevantCandidates(input.candidates, pairCurrencies, params.overlap.min_importance, groupIds);

  const windows = analysis.windows.map((w) => {
    const items = overlapsInWindow(relevant, releaseMs, w.minutes);
    const row = input.reactions.find((r) => r.timeframe === `${w.minutes}m`);
    const v = windowValues(row);
    return {
      minutes: w.minutes,
      data_status: v.data_status,
      pips: pips(v.pips),
      close_price: v.close_price,
      high_pips: pips(v.high_pips),
      low_pips: pips(v.low_pips),
      range_pips: v.range_pips,
      classification_status: w.classification_status,
      label: w.label,
      reason: w.reason,
      evidence: evidenceOut(w),
      overlap: { has_overlap: items.length > 0, items },
    };
  });

  // Past comparison: every past event is analysed on its own path / baseline / NY clock.
  const pastAnalyses = input.history.map((h) => {
    const t = Date.parse(h.release_datetime);
    const a = analyzeEvent({ releaseMs: t, timeExact: true, bars: h.bars, params, pipSize: pair.pip_size });
    const pastRelevant = relevantCandidates(h.candidates, pairCurrencies, params.overlap.min_importance, new Set());
    return { h, t, a, pastRelevant };
  });
  const historyWindows = params.classified_windows.map((minutes) => {
    const samples: HistorySampleInput[] = pastAnalyses.map(({ h, t, a, pastRelevant }) => {
      const w = a.windows.find((x) => x.minutes === minutes)!;
      return {
        event_id: h.event_id,
        release_datetime: new Date(t).toISOString(),
        label: w.label === null ? 'UNDETERMINED' : w.label,
        reason: w.reason,
        has_overlap: overlapsInWindow(pastRelevant, t, minutes).length > 0,
      };
    });
    return buildWindowHistory(minutes, samples, params);
  });

  return {
    event_id: event.event_id,
    available: true,
    required_entitlement: null,
    event: {
      indicator_id: event.indicator_id,
      indicator_code: event.indicator_code,
      name: event.name,
      country_code: event.country_code,
      currency_code: event.currency_code,
      release_datetime: new Date(releaseMs).toISOString(),
      release_datetime_precision: event.release_datetime_precision,
    },
    fx_pair: { fx_pair_id: pair.fx_pair_id, symbol: pair.symbol, pip_size: pair.pip_size },
    selectable_pairs: input.selectablePairs,
    market_event: {
      group_key: input.marketEvent.group_key,
      independent_market_events: 1,
      indicator_count: input.marketEvent.indicator_count,
      co_released_indicators: input.marketEvent.co_released_indicators,
      label_shared: input.marketEvent.indicator_count > 1,
    },
    meta: metaBlock(input, analysis.barsAsOfMs),
    dst_mismatch_caution: dstMismatchCaution(releaseMs),
    reference: {
      pre_release_price: analysis.preReleasePrice,
      pre_release_bar_closed_at: analysis.preReleasePrice === null ? null : new Date(releaseMs).toISOString(),
    },
    baseline: {
      kind: params.baseline.kind,
      source: analysis.baseline.source,
      sigma_pips: ratio(analysis.sigmaPips.sigma),
      sigma_own_pips: ratio(analysis.sigmaPips.own),
      sigma_typical_pips: ratio(analysis.sigmaPips.typical),
      typical_session_count: analysis.baseline.sessionsUsed,
      clock_mismatch_sessions: analysis.baseline.clockMismatchSessions,
      pre_window_overlaps: overlapsBeforeRelease(relevant, releaseMs, params.baseline.lookback_minutes),
    },
    initial: {
      window_minutes: analysis.initial.window_minutes,
      signed_pips: pips(analysis.initial.signed_pips),
      direction: analysis.initial.direction,
      z0: ratio(analysis.initial.z0),
    },
    windows,
    history: { windows: historyWindows },
  };
}

export function metaBlock(
  input: Pick<BuildInput, 'params' | 'ledgerEntry' | 'dataSource' | 'nowMs'>,
  barsAsOfMs: number | null,
) {
  const { params } = input;
  return {
    param_set_id: params.param_set_id,
    param_set_status: params.status,
    params_hash: paramsHash(params),
    params: publicParams(params),
    classifier_version: CLASSIFIER_VERSION,
    data_source: input.dataSource,
    bars_as_of: barsAsOfMs === null ? null : new Date(barsAsOfMs).toISOString(),
    computed_at: new Date(input.nowMs).toISOString(),
    time_basis: { event_times: 'UTC', baseline_clock: params.baseline.clock },
    rights_ledger: ledgerBlock(input.ledgerEntry),
    history_limits: { max_samples: params.history.max_samples, min_required: params.history.min_determined },
  };
}
