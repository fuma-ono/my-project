/**
 * 要人発言の本文・要約のジョブの引数(HQ承認 2026-11-11「要人発言の定期実行」)。
 *   (なし)        直近30日(今までの手動の既定)
 *   --scheduled   定期実行: 発言日時が直近14日(SCHEDULED_PAST_DAYS)
 *   --all         過去のすべて(手動だけ)
 *   --dry-run     書かない(上のどれとも組み合わせられる)
 * --scheduled と --all を同時に指定したら止める(どちらの範囲か決められない)。
 */
export const SCHEDULED_PAST_DAYS = 14;
export const DEFAULT_PAST_DAYS = 30;

export interface SpeechJobOptions {
  mode: 'default' | 'scheduled' | 'all';
  /** null = 過去のすべて */
  pastDays: number | null;
  dryRun: boolean;
}

export function parseSpeechJobOptions(argv: readonly string[]): SpeechJobOptions {
  const scheduled = argv.includes('--scheduled');
  const all = argv.includes('--all');
  if (scheduled && all) throw new Error('--scheduled and --all cannot be used together');
  const dryRun = argv.includes('--dry-run');
  if (scheduled) return { mode: 'scheduled', pastDays: SCHEDULED_PAST_DAYS, dryRun };
  if (all) return { mode: 'all', pastDays: null, dryRun };
  return { mode: 'default', pastDays: DEFAULT_PAST_DAYS, dryRun };
}
