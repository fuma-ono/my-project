/**
 * Reclassification report: label transitions between two parameter sets over a fixed series file.
 *
 * Run (from fx-event-analyzer-backend/):
 *   npx tsx scripts/reclass-report.ts [series.json] [A] [B]
 *
 *   series.json  an array of { id, closes[61], sigma } or an object with `classify_cases` (default: the synthetic
 *                tests/fixtures/reaction-analysis/cross_impl.json). Never point this at real event series that have
 *                not been cleared by the data rights ledger.
 *   A, B         'rx-v1' (a registered set) or a JSON file with partial overrides of rx-v1, e.g.
 *                {"param_set_id": "rx-v2-draft", "classified_windows": [5, 15, 30, 60]}
 *                (default: A = rx-v1, B = rx-v1, which must show no change).
 */
import { readFileSync } from 'node:fs';
import { deriveParams, getParamSet, RX_V1, type ParamOverrides } from '../src/domain/reactionClassification/params.js';
import {
  formatReclassReport,
  reclassify,
  type ReclassSeries,
} from '../src/domain/reactionClassification/reclassify.js';

function loadParams(arg: string | undefined) {
  if (arg === undefined || arg === 'rx-v1') return getParamSet('rx-v1');
  const overrides = JSON.parse(readFileSync(arg, 'utf8')) as ParamOverrides;
  return deriveParams(RX_V1, overrides);
}

const [seriesPath = 'tests/fixtures/reaction-analysis/cross_impl.json', a, b] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(seriesPath, 'utf8')) as ReclassSeries[] | { classify_cases: ReclassSeries[] };
const series = Array.isArray(raw) ? raw : raw.classify_cases;
process.stdout.write(formatReclassReport(reclassify(series, loadParams(a), loadParams(b))));
