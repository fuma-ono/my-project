/**
 * 品質レポート 第11章: 要人発言の本文と要約(HQ承認 2026-11-11「品質レポートに未実行・PENDING滞留・FAILEDを追加」)。
 * 判定と Markdown だけ(DB は読まない — 読むのは reader.ts の speechPipelineStatus)。第1〜10章は変えない。
 *
 * 見るもの(どれも自動の対象と同じ、発言日時が直近14日の発言済みの行):
 * - 未実行: ingest:speech-bodies・ingest:speech-summaries の最後の実行が無い、または RUN_GAP_HOURS 時間より前
 *   (定期は3時間ごとなので、2回続けて抜けたら注意)。最後の実行が SUCCESS でなければ注意
 * - PENDING の滞留: URL があるのに、発言から PENDING_STALE_HOURS 時間を過ぎても PENDING の行(URL の無い行 = 原稿の無い
 *   討論・記者会見などは数えない)
 * - 本文の FAILED: まだ自動で取り直す行(回数 < 3)と、上限に達した行(人の確認が要る)
 * - 要約の FAILED と、本文があるのに要約がまだ無い行
 */

export const SPEECH_PIPELINE_WINDOW_DAYS = 14;
export const RUN_GAP_HOURS = 6;
export const PENDING_STALE_HOURS = 24;

export type SpeechPipelineJob = 'ingest:speech-bodies' | 'ingest:speech-summaries';

export interface SpeechPipelineStatus {
  lastRuns: { job: SpeechPipelineJob; startedAt: string | null; status: string | null }[];
  pendingWithUrlStale: number;
  bodyFailedRetrying: number;
  bodyFailedAtCap: number;
  summaryFailed: number;
  fetchedWithoutSummary: number;
}

export type SpeechPipelineJudgement = 'OK' | 'INFO' | 'WARN';

export interface SpeechPipelineFinding {
  judgement: SpeechPipelineJudgement;
  item: string;
  detail: string;
}

const JOB_LABEL: Record<SpeechPipelineJob, string> = {
  'ingest:speech-bodies': '本文の取得',
  'ingest:speech-summaries': '要約の作成',
};

export function judgeSpeechPipeline(status: SpeechPipelineStatus, now: Date): SpeechPipelineFinding[] {
  const out: SpeechPipelineFinding[] = [];
  for (const run of status.lastRuns) {
    const label = JOB_LABEL[run.job];
    if (!run.startedAt) {
      out.push({ judgement: 'WARN', item: `未実行: ${label}`, detail: `${run.job} の実行の記録が無い` });
      continue;
    }
    const ageHours = (now.getTime() - Date.parse(run.startedAt)) / 3_600_000;
    if (ageHours > RUN_GAP_HOURS) {
      out.push({
        judgement: 'WARN',
        item: `未実行: ${label}`,
        detail: `最後の実行は ${Math.floor(ageHours)} 時間前(${run.startedAt})。${RUN_GAP_HOURS} 時間を超えて実行が無い`,
      });
    } else if (run.status !== 'SUCCESS') {
      out.push({
        judgement: 'WARN',
        item: `失敗: ${label}`,
        detail: `最後の実行が ${run.status ?? '不明'}(${run.startedAt})`,
      });
    } else {
      out.push({ judgement: 'OK', item: `実行: ${label}`, detail: `最後の実行 ${run.startedAt}(SUCCESS)` });
    }
  }
  const counted = (
    n: number,
    judgement: SpeechPipelineJudgement,
    item: string,
    detail: string,
  ): SpeechPipelineFinding =>
    n > 0 ? { judgement, item, detail: `${n} 件。${detail}` } : { judgement: 'OK', item, detail: '0 件' };
  out.push(
    counted(
      status.pendingWithUrlStale,
      'WARN',
      'PENDING の滞留',
      `URL があるのに、発言から ${PENDING_STALE_HOURS} 時間を過ぎても本文が無い`,
    ),
    counted(
      status.bodyFailedAtCap,
      'WARN',
      '本文の FAILED(上限)',
      '3回失敗して自動の対象から外れた。原因を確かめる(手順書 7.3)',
    ),
    counted(status.bodyFailedRetrying, 'INFO', '本文の FAILED(取り直し中)', '次の定期の回で取り直す'),
    counted(status.summaryFailed, 'INFO', '要約の FAILED', '自動では取り直さない(同じ本文からは同じ結果)'),
    counted(
      status.fetchedWithoutSummary,
      'INFO',
      '要約の未作成',
      '本文があり、要約も理由もまだ無い(次の定期の回で作る)',
    ),
  );
  return out;
}

const LABEL: Record<SpeechPipelineJudgement, string> = { OK: '正常', INFO: '情報', WARN: '注意' };

/** null = 読めなかった(migration 20261112000001 の前など)。 */
export function renderSpeechPipelineMarkdown(status: SpeechPipelineStatus | null, now: Date): string {
  const lines: string[] = ['## 11. 要人発言の本文と要約', ''];
  lines.push(
    `対象は、発言日時が直近 ${SPEECH_PIPELINE_WINDOW_DAYS} 日の発言済みの行(自動の対象と同じ)。本文は FRB だけ(ECB は権利が未確認のため保存しない)。`,
  );
  lines.push('');
  if (!status) {
    lines.push('判定: 注意(本文・要約の状態を読めなかった。migration 20261112000001 の適用を確かめる)');
    lines.push('');
    return lines.join('\n');
  }
  const findings = judgeSpeechPipeline(status, now);
  const worst = findings.some((f) => f.judgement === 'WARN')
    ? 'WARN'
    : findings.some((f) => f.judgement === 'INFO')
      ? 'INFO'
      : 'OK';
  lines.push(`判定: ${LABEL[worst]}`);
  lines.push('');
  lines.push('| 区分 | 項目 | 内容 |', '|---|---|---|');
  for (const f of findings) lines.push(`| ${LABEL[f.judgement]} | ${f.item} | ${f.detail.replace(/\|/g, '/')} |`);
  lines.push('');
  return lines.join('\n');
}
