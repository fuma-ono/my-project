import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseObservationLog,
  renderObservationReport,
  summarizeObservation,
  summarizeReplay,
  type ReplaySummary,
  type RunStep,
  type WorkflowRun,
} from '../observation/ecbObservation.js';

/**
 * ECB 週間予定の2週間観測の確認(HQ指示 2026-10-28「ECB週間予定・観測確認スクリプト」)。読むだけ。
 *
 *   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=<プロキシ> NODE_OPTIONS=--use-system-ca npm run check:ecb-observation
 *
 * 1. GitHub Actions の実行の履歴(観測のワークフロー)と、失敗した実行の段階を読む
 * 2. ブランチ ecb-weekly-snapshots の state.json・log.jsonl を読み、予定の時刻(09:30 / 17:30 JST)ごとに突き合わせる
 * 3. 保存ページを一時フォルダに取り出し、既存の再現テスト(tests/ingestion/ecbWeeklyReplay.test.ts)に流す。
 *    一時フォルダは最後に必ず消す(社内PCに観測データを残さない)
 * 4. レポート(Markdown)を標準出力に出すだけ(ファイルには書かない)。ページの本文・連絡先は写さない
 *
 * 書き込みは一切しない(ブランチ・ログ・ワークフローの有効/無効を変えない)。DB・API(DEV・本番)にはつながない。
 * GitHub API はキーなしで読む(1時間あたりの回数に上限がある。社内のプロキシでは他の人と共有のため当たりやすい。
 * 読めないときは「集計不能」と出す)。環境変数 GITHUB_TOKEN があれば読み取りに使う(社内PCでは使わない。値は出力しない)。
 */
const REPO = 'fuma-ono/my-project';
const BRANCH = 'ecb-weekly-snapshots';
const WORKFLOW = 'fx-ecb-weekly-snapshot.yml';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API = `https://api.github.com/repos/${REPO}`;

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    'User-Agent': 'fx-ecb-observation-check',
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getText(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: headers() });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function getJson<T>(url: string): Promise<T> {
  const text = await getText(url);
  if (text === null) throw new Error('HTTP 404');
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const now = new Date();

  let state: { started_at: string; stop_after: string } | null = null;
  let stateError: string | null = null;
  try {
    const text = await getText(`${RAW}/state.json`);
    if (text === null) stateError = 'state.json が無い';
    else state = JSON.parse(text) as { started_at: string; stop_after: string };
  } catch (error) {
    stateError = String(error);
  }

  let logText: string | null;
  try {
    logText = await getText(`${RAW}/log.jsonl`);
  } catch {
    logText = null;
  }
  const log = parseObservationLog(logText, now);

  let runs: WorkflowRun[] | null;
  let workflowState: string | null = null;
  let apiError: string | null = null;
  const failedSteps = new Map<number, RunStep[]>();
  try {
    workflowState = (await getJson<{ state: string }>(`${API}/actions/workflows/${WORKFLOW}`)).state;
    runs = (await getJson<{ workflow_runs: WorkflowRun[] }>(`${API}/actions/workflows/${WORKFLOW}/runs?per_page=100`))
      .workflow_runs;
    for (const run of runs.filter((r) => r.status === 'completed' && r.conclusion !== 'success')) {
      const jobs = await getJson<{ jobs: { steps: RunStep[] }[] }>(`${API}/actions/runs/${run.id}/jobs`);
      failedSteps.set(
        run.id,
        jobs.jobs.flatMap((job) => job.steps),
      );
    }
  } catch (error) {
    runs = null;
    apiError = `GitHub API: ${String(error)}`;
  }

  const summary = summarizeObservation({
    start: new Date(state?.started_at ?? now.toISOString()),
    stop: new Date(state?.stop_after ?? now.toISOString()),
    now,
    runs,
    failedSteps,
    log,
  });

  let replay: ReplaySummary | null = null;
  let replayError: string | null = null;
  const snapshots = log.records.map((r) => r.record.snapshot).filter((name): name is string => !!name);
  if (snapshots.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), 'ecb-observation-'));
    try {
      for (const name of snapshots) {
        const text = await getText(`${RAW}/snapshots/${name}`);
        if (text !== null) writeFileSync(join(dir, name), text, 'utf8');
      }
      const result = spawnSync(
        process.execPath,
        ['node_modules/vitest/vitest.mjs', 'run', 'tests/ingestion/ecbWeeklyReplay.test.ts', '--reporter=verbose'],
        {
          cwd: process.cwd(),
          env: { ...process.env, ECB_REPLAY_DIR: dir },
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        },
      );
      replay = summarizeReplay(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, result.status, snapshots);
    } catch (error) {
      replayError = String(error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  process.stdout.write(
    renderObservationReport({ now, state, stateError, workflowState, apiError, summary, log, replay, replayError }),
  );
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'check:ecb-observation', error: String(error) }));
  process.exit(1);
});
