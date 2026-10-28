/**
 * ECB の週間予定の実データの再現(HQ判断 2026-10-28「統合前レビュー」A5)。DB にも取得元にもつながない。
 * 保存したページ(ファイル名 `YYYYMMDDTHHMMZ.html` = 取得した時刻)を古い順に、メモリ上のストアへジョブと同じ設定で
 * 取り込み、取り込みごとの中止・時刻の変更・保留・安全弁と、行の状態を出す。
 *
 *   ECB_REPLAY_DIR=<保存したページのフォルダ> npx vitest run tests/ingestion/ecbWeeklyReplay.test.ts --reporter=verbose
 *
 * ECB_REPLAY_DIR が無ければ何もしない(CI では動かない)。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ECB_WEEKLY_PROVIDER,
  ecbReconcileOptions,
  parseEcbWeeklySchedule,
} from '../../src/ingestion/adapters/ecbWeeklySchedule.js';
import { SPEAKER_ALIASES } from '../../src/ingestion/mappings/speakers.js';
import { ingestSpeeches } from '../../src/ingestion/pipelines/speeches.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const dir = process.env.ECB_REPLAY_DIR;
const SNAPSHOT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z\.html$/;

describe.skipIf(!dir)('ECB weekly schedule: replay saved pages (real data, no DB)', () => {
  it('replays every snapshot in order and prints what the job would do', async () => {
    const files = (await readdir(dir!)).filter((name) => SNAPSHOT.test(name)).sort();
    expect(files.length).toBeGreaterThan(0);
    const store = new MemoryIngestionStore();
    store.speakers = SPEAKER_ALIASES.filter((alias) => alias.organization === 'ECB').map((alias, index) => ({
      id: `ecb-${index}`,
      name: alias.nameJa,
      organization: 'ECB',
    }));
    const speakerName = new Map(store.speakers.map((speaker) => [speaker.id, speaker.name]));
    for (const file of files) {
      const [, y, m, d, hh, mm] = SNAPSHOT.exec(file)!;
      const now = new Date(`${y}-${m}-${d}T${hh}:${mm}:00Z`);
      const result = parseEcbWeeklySchedule(await readFile(join(dir!, file), 'utf8'));
      const counters = new JobCounters();
      await ingestSpeeches(
        ECB_WEEKLY_PROVIDER,
        result.speeches,
        { store, now: () => now, reconcile: ecbReconcileOptions(result) },
        counters,
      );
      const pick = (key: string) => counters.details[key] ?? [];
      console.log(
        JSON.stringify({
          snapshot: file,
          coverage: result.coverage,
          parsed: result.speeches.length,
          feed_skipped: result.skipped.map((s) => `${s.day ?? '?'} ${s.reason} ${s.title}`),
          uncertain_days: result.uncertainDays,
          page_anomaly: result.pageAnomaly,
          pipeline_skips: counters.skipReasons,
          cancelled: pick('cancelled_speeches'),
          rescheduled: pick('rescheduled_speeches'),
          held: pick('held_disappearances'),
          cancel_suppressed: pick('cancel_suppressed'),
          rows: store.speeches.map(
            (row) => `${row.statement_datetime} ${row.status} ${speakerName.get(row.speaker_id)} ${row.provider_event_id}`,
          ),
        }),
      );
      expect(counters.errorMessages).toEqual([]);
    }
  });
});
