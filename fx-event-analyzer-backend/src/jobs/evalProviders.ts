import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BlsAdapter } from '../ingestion/adapters/bls.js';
import { FinnhubAdapter } from '../ingestion/adapters/finnhub.js';
import { FmpAdapter } from '../ingestion/adapters/fmp.js';
import { FredAdapter } from '../ingestion/adapters/fred.js';
import { PolygonAdapter } from '../ingestion/adapters/polygon.js';
import { TradingEconomicsAdapter } from '../ingestion/adapters/tradingEconomics.js';
import { TWELVE_DATA_PROVIDER, TwelveDataAdapter } from '../ingestion/adapters/twelveData.js';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { API_CREDIT_CAPS, INGESTION_SETTINGS, loadIngestionEnv } from '../ingestion/config.js';
import { CreditGate } from '../ingestion/http.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';
import {
  checkAgainstFredReleaseDates,
  compareCalendarProvider,
  compareFxSeries,
  compareReleaseTimesAcrossProviders,
  renderMarkdownReport,
  type ProviderEvalReport,
} from '../ingestion/eval/providerComparison.js';
import { findFxPairMapping } from '../ingestion/mappings/fxPairs.js';
import { FRED_RELEASE_IDS, INDICATOR_MAPPINGS, type CalendarProviderId } from '../ingestion/mappings/indicators.js';
import { createLiveOfficialResolver, type OfficialProviders } from '../ingestion/pipelines/officialStats.js';
import type { EconomicCalendarProvider, FxPriceProvider } from '../ingestion/providers.js';
import type { NormalizedCandle } from '../ingestion/types.js';
import { checkCandles } from '../ingestion/validation/fxCandles.js';

/**
 * Compares the paid candidates whose keys are set (data-sources.md §7).
 * Reads only; writes a JSON + Markdown report. The only DB access: when
 * TWELVE_DATA_API_KEY is set, every Twelve Data HTTP attempt first reserves
 * a credit in the shared ledger (api_credit_usage, manual cap 800/day —
 * data-sources.md §6.4), so this needs SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY too. Without them, or when the ledger cannot
 * be reached, Twelve Data is NOT called (the other providers still are).
 *
 *   npm run eval:providers -- --from 2026-09-01 --to 2026-10-14 --fx-pairs USDJPY,EURUSD --fx-hours 6 --out eval-reports
 *
 * Keys (any subset): TRADING_ECONOMICS_API_KEY, FINNHUB_API_KEY, FMP_API_KEY
 * (calendar), TWELVE_DATA_API_KEY, POLYGON_API_KEY (FX), FRED_API_KEY /
 * BLS_API_KEY (official values). With no paid key it exits 0 with a message.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const keys = loadIngestionEnv();
  const calendarProviders: { id: CalendarProviderId; adapter: EconomicCalendarProvider }[] = [];
  if (keys.TRADING_ECONOMICS_API_KEY) {
    calendarProviders.push({
      id: 'tradingeconomics',
      adapter: new TradingEconomicsAdapter(keys.TRADING_ECONOMICS_API_KEY),
    });
  }
  if (keys.FINNHUB_API_KEY)
    calendarProviders.push({ id: 'finnhub', adapter: new FinnhubAdapter(keys.FINNHUB_API_KEY) });
  if (keys.FMP_API_KEY) calendarProviders.push({ id: 'fmp', adapter: new FmpAdapter(keys.FMP_API_KEY) });
  const fxProviders: FxPriceProvider[] = [];
  const setupErrors: string[] = [];
  if (keys.TWELVE_DATA_API_KEY) {
    const gate = await twelveDataCreditGate();
    if (gate instanceof CreditGate) {
      fxProviders.push(new TwelveDataAdapter(keys.TWELVE_DATA_API_KEY, { beforeAttempt: gate.beforeAttempt }));
    } else {
      setupErrors.push(`twelvedata: not called — ${gate}`);
      console.error(JSON.stringify({ job: 'eval:providers', twelvedata: `not called — ${gate}` }));
    }
  }
  if (keys.POLYGON_API_KEY) fxProviders.push(new PolygonAdapter(keys.POLYGON_API_KEY));

  if (calendarProviders.length === 0 && fxProviders.length === 0) {
    console.log(
      'eval:providers: no paid provider key is set (TRADING_ECONOMICS_API_KEY / FINNHUB_API_KEY / FMP_API_KEY / TWELVE_DATA_API_KEY / POLYGON_API_KEY). Nothing to compare — see docs/projects/fx-event-analyzer/data-sources.md §7.',
    );
    return;
  }

  const now = new Date();
  const to = arg('to') ?? isoDate(now);
  const from = arg('from') ?? isoDate(new Date(now.getTime() - 45 * 86_400_000));
  const fxPairs = (arg('fx-pairs') ?? 'USDJPY,EURUSD,EURJPY')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fxHours = Number(arg('fx-hours') ?? '6');
  const outDir = resolve(arg('out') ?? 'eval-reports');

  const errors: string[] = [...setupErrors];
  const officialProviders: OfficialProviders = { BLS: new BlsAdapter(keys.BLS_API_KEY) };
  const fred = keys.FRED_API_KEY ? new FredAdapter(keys.FRED_API_KEY) : null;
  if (fred) officialProviders.FRED = fred;
  const resolver = createLiveOfficialResolver(officialProviders, (ref, error) =>
    errors.push(`official ${ref.source}:${ref.seriesId}: ${error instanceof Error ? error.message : String(error)}`),
  );

  const report: ProviderEvalReport = {
    generatedAt: now.toISOString(),
    range: { from, to },
    officialSources: Object.keys(officialProviders),
    calendar: [],
    crossProviderReleaseTimes: [],
    fredReleaseDates: [],
    fredReleaseIdChecks: [],
    fx: [],
    fxSingleSource: [],
    errors,
  };

  for (const { id, adapter } of calendarProviders) {
    try {
      const releases = await adapter.fetchCalendar({ from, to });
      report.calendar.push(await compareCalendarProvider(id, releases, INDICATOR_MAPPINGS, resolver));
    } catch (error) {
      errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  report.crossProviderReleaseTimes = compareReleaseTimesAcrossProviders(report.calendar);

  if (fred) {
    const fredDates = new Map<number, Set<string>>();
    for (const releaseId of new Set(Object.values(FRED_RELEASE_IDS))) {
      try {
        fredDates.set(releaseId, new Set(await fred.fetchReleaseDates(releaseId, from, to)));
      } catch (error) {
        errors.push(`FRED release ${releaseId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    report.fredReleaseDates = checkAgainstFredReleaseDates(report.calendar, INDICATOR_MAPPINGS, fredDates);
    for (const mapping of INDICATOR_MAPPINGS) {
      const expected = FRED_RELEASE_IDS[mapping.code];
      const series = mapping.official.find((ref) => ref.source === 'FRED');
      if (expected === undefined || !series) continue;
      try {
        const release = await fred.fetchSeriesRelease(series.seriesId);
        report.fredReleaseIdChecks.push({ seriesId: series.seriesId, expected, actual: release?.id ?? null });
      } catch (error) {
        errors.push(
          `FRED series/release ${series.seriesId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // FX: the last `fxHours` complete hours.
  const fxTo = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const range = { from: new Date(fxTo.getTime() - fxHours * 3_600_000).toISOString(), to: fxTo.toISOString() };
  for (const symbol of fxPairs) {
    const mapping = findFxPairMapping(symbol);
    if (!mapping) {
      errors.push(`FX ${symbol}: not in mappings/fxPairs.ts`);
      continue;
    }
    const series: NormalizedCandle[][] = [];
    for (const provider of fxProviders) {
      try {
        const candles = await provider.fetchOneMinuteCandles(symbol, range);
        const checked = checkCandles(candles, {
          pipSize: mapping.pipSize,
          now,
          maxJumpPips: INGESTION_SETTINGS.fxMaxJumpPips,
          maxDiffPips: INGESTION_SETTINGS.fxCrossCheckMaxDiffPips,
        });
        series.push(checked.accepted.map((c) => c.candle));
        report.fxSingleSource.push({
          provider: provider.name,
          symbol,
          minutes: checked.accepted.length,
          expectedMinutes: fxHours * 60,
        });
      } catch (error) {
        errors.push(`${provider.name} ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const [primary, secondary] = series;
    if (primary && secondary) {
      report.fx.push(
        compareFxSeries(symbol, mapping.pipSize, primary, secondary, INGESTION_SETTINGS.fxCrossCheckMaxDiffPips),
      );
    }
  }

  await mkdir(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `provider-eval-${stamp}.json`);
  const mdPath = join(outDir, `provider-eval-${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({ job: 'eval:providers', json: jsonPath, markdown: mdPath, errors: errors.length }));
}

/** The credit gate for Twelve Data, or why Twelve Data must not be called (no Supabase env / ledger unreachable). */
async function twelveDataCreditGate(): Promise<CreditGate | string> {
  let store;
  try {
    store = createIngestionRepository(createSupabaseClient(loadEnv()));
  } catch {
    return 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are needed for the API-credit ledger';
  }
  try {
    await store.todayApiCredits(TWELVE_DATA_PROVIDER);
  } catch (error) {
    return `API-credit ledger unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return new CreditGate(store, {
    provider: TWELVE_DATA_PROVIDER,
    job: 'eval:providers',
    runId: `${process.env.GITHUB_RUN_ID ?? 'local'}:${randomUUID()}`,
    dailyCap: API_CREDIT_CAPS.twelvedata.manual,
  });
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'eval:providers', error: String(error) }));
  process.exit(1);
});
