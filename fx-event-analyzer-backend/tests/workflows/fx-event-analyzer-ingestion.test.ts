import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * .github/workflows/fx-event-analyzer-ingestion.yml は main にしか存在しない
 * (schedule: トリガーは default branch 上のファイルでしか動かないため)。
 * このテストはリポジトリ構造の都合でYAMLパーサ無しの文字列ベース検証にする
 * (HQ指示 2026-11-05「経済指標の定時取り込み対応」フェーズ3)。
 * 既存の手動実行(workflow_dispatch)が変わっていないこと・
 * 新しい定時実行が既定で無効(Repository Variable未設定)であることを守る。
 */
const workflowPath = resolve(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-ingestion.yml');
const yaml = readFileSync(workflowPath, 'utf8');

describe('fx-event-analyzer-ingestion.yml', () => {
  it('keeps the three pre-existing cron schedules untouched', () => {
    expect(yaml).toContain("- cron: '7,27,47 * * * *'");
    expect(yaml).toContain("- cron: '41 */3 * * *'");
    expect(yaml).toContain("- cron: '0 0 * * *'");
  });

  it('adds exactly one new cron schedule for the BLS due-check', () => {
    const cronLines = yaml.match(/^\s*-\s*cron:\s*'.*'$/gm) ?? [];
    expect(cronLines).toHaveLength(4);
    expect(yaml).toContain("- cron: '50 * * * *'");
  });

  it('keeps workflow_dispatch manual execution unchanged (same inputs, same default)', () => {
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain(
      "description: 'fx-prices / speeches / both / report / official-bls / official-bls-dry-run / official-eurostat / official-eurostat-dry-run / event-reactions / fomc-schedule'",
    );
    expect(yaml).toContain('default: both');
  });

  it('keeps every pre-existing step condition byte-for-byte (manual targets untouched)', () => {
    const untouchedConditions = [
      "steps.check.outputs.ready == 'true' && (github.event.schedule == '7,27,47 * * * *' || (github.event_name == 'workflow_dispatch' && (inputs.target == 'fx-prices' || inputs.target == 'both')))",
      "steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'event-reactions'",
      "steps.check.outputs.ready == 'true' && (github.event.schedule == '41 */3 * * *' || (github.event_name == 'workflow_dispatch' && (inputs.target == 'speeches' || inputs.target == 'both')))",
      "steps.check.outputs.ready == 'true' && (github.event.schedule == '0 0 * * *' || (github.event_name == 'workflow_dispatch' && inputs.target == 'report'))",
      "steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'official-bls'",
      "steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'official-bls-dry-run'",
      "steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'fomc-schedule'",
      "steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'official-eurostat-dry-run'",
      "steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'official-eurostat'",
    ];
    for (const condition of untouchedConditions) {
      expect(yaml).toContain(`if: ${condition}`);
    }
    // 対応する実行コマンドも変えていないこと。
    expect(yaml).toContain('run: npm run -s ingest:official:bls-calendar\n');
    expect(yaml).toContain('run: npm run -s ingest:official:bls-calendar -- --dry-run');
    expect(yaml).toContain('run: npm run -s ingest:fomc-schedule');
    expect(yaml).toContain('run: npm run -s ingest:official:eurostat-calendar -- --dry-run');
    expect(yaml).toContain('run: npm run -s ingest:official:eurostat-calendar\n');
  });

  it('keeps the DEV-only connection guard (steps.check) ahead of every ingestion step', () => {
    expect(yaml).toContain('接続先が社内確認用のDBではありません');
    expect(yaml).toContain('echo "ready=false" >> "$GITHUB_OUTPUT"');
  });

  it('gates the new scheduled BLS step on steps.check.outputs.ready, the new cron, AND an explicit Repository Variable', () => {
    const match = yaml.match(
      /- name: Official stats \(BLS calendar, scheduled due-check[^\n]*\n\s*if: (.+)\n\s*run: (.+)\n/,
    );
    expect(match).not.toBeNull();
    const [, condition, run] = match!;
    expect(condition).toContain("steps.check.outputs.ready == 'true'");
    expect(condition).toContain("github.event.schedule == '50 * * * *'");
    expect(condition).toContain("vars.FX_SCHEDULE_OFFICIAL_BLS_ENABLED == 'true'");
    expect(run).toBe('npm run -s ingest:official:bls-calendar -- --if-due --scheduled');
  });

  it('never flips the Repository Variable on in this file (activation is a separate, explicit step)', () => {
    // ワークフロー定義そのものが変数を宣言・設定することはできない(Settings側の操作)が、
    // 念のため「有効化した」ことにするような記述(vars.FX_SCHEDULE_OFFICIAL_BLS_ENABLED の
    // 値そのものの決め打ち)が無いことを確認する。
    expect(yaml).not.toMatch(/vars\.FX_SCHEDULE_OFFICIAL_BLS_ENABLED\s*==\s*'true'\s*\|\|\s*true/);
    // 1回目: ヘッダーコメントの説明。2回目: 新しいstepのif条件。それ以外で登場しないこと。
    expect(yaml.match(/FX_SCHEDULE_OFFICIAL_BLS_ENABLED/g)?.length).toBe(2);
  });

  it('does not add a new cron trigger for Eurostat / FOMC (manual-only steps for them are untouched)', () => {
    // Eurostat・FOMCの既存条件(手動のみ)に、新しいcron '50 * * * *' を参照する行が無いこと。
    // (concurrency行は既存の仕様で元々同じ行にeurostat/fomcとgithub.event.scheduleが混在するため、
    //  全文一致ではなく「新しいcronとeurostat/fomcが同じ条件式に出てこない」ことを見る)
    const eurostatOrFomcLines = yaml.split('\n').filter((line) => /eurostat|fomc/i.test(line) && line.includes('if:'));
    for (const line of eurostatOrFomcLines) {
      expect(line).not.toContain("'50 * * * *'");
      expect(line).toContain('workflow_dispatch');
    }
  });
});
