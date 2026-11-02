import { FX_FETCH_SETTINGS } from '../ingestion/config.js';
import { availableTimeframes, type ReleaseDatetimePrecision, type Timeframe } from './dataQuality.js';

/**
 * 相場反応の行が「計算されたか」(HQ判断 2026-10-30 P1-1 段階1、api-design v1.44)。
 * 既存の `analysis_status` は値も意味も変えない(行が無ければ今までどおり DATA_PENDING)。その横に、
 * 行が無い理由を「事実で言える範囲だけ」付け足す任意の項目。行が無いことだけを理由に「取得できない」とは言わない。
 *
 * - CALCULATED: event_price_reactions に行がある(相場反応のジョブが計算した。結果は analysis_status のとおり)
 * - NOT_DUE: まだ計算できない(発表前、または発表から N 分が経っていない)
 * - NOT_CALCULATED: 計算できる時刻を過ぎたが、行が無い(ジョブがまだ計算していない)
 * - null: 対象外(発表時刻の精度でこの時間枠を分析しない = NOT_ANALYZABLE、または中止の発表)
 */
export type ReactionState = 'CALCULATED' | 'NOT_DUE' | 'NOT_CALCULATED';

export interface ReactionStateFields {
  reaction_state: ReactionState | null;
  /**
   * NOT_CALCULATED のときだけ true / false: 相場反応のジョブが自動で見る範囲(発表から
   * FX_FETCH_SETTINGS.repairHorizonDays 日)の中か。ジョブが実際に動く予定(定期実行)を意味しない —
   * 「取得中」と出す根拠には使わない(HQ判断 2026-10-30)。それ以外の状態は null。
   */
  retry_scheduled: boolean | null;
}

const NOT_APPLICABLE: ReactionStateFields = { reaction_state: null, retry_scheduled: null };

/** 時間枠の分(speechReactions.TIMEFRAME_MINUTES と同じ値。speechReactions → majorFxReactions → ここ の循環を避けるため持つ)。 */
const TIMEFRAME_MINUTES: Readonly<Record<Timeframe, number>> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60 };

export function resolveReactionState(input: {
  timeframe: Timeframe;
  precision: ReleaseDatetimePrecision;
  /** economic_events.status(SCHEDULED / RELEASED / CANCELLED)。 */
  eventStatus: string;
  releaseDatetime: string;
  /** event_price_reactions にこのペア・時間枠の行があるか。 */
  hasRow: boolean;
  now: Date;
  horizonDays?: number;
}): ReactionStateFields {
  if (!availableTimeframes(input.precision).includes(input.timeframe)) return NOT_APPLICABLE;
  if (input.eventStatus === 'CANCELLED') return NOT_APPLICABLE;
  if (input.hasRow) return { reaction_state: 'CALCULATED', retry_scheduled: null };
  // ジョブは RELEASED の発表だけを計算する(ingestionRepository.listReleasedEventsForReactions)。
  if (input.eventStatus !== 'RELEASED') return { reaction_state: 'NOT_DUE', retry_scheduled: null };
  const releaseMs = Date.parse(input.releaseDatetime);
  const dueMs = releaseMs + TIMEFRAME_MINUTES[input.timeframe] * 60_000;
  if (dueMs > input.now.getTime()) return { reaction_state: 'NOT_DUE', retry_scheduled: null };
  const horizonMs = (input.horizonDays ?? FX_FETCH_SETTINGS.repairHorizonDays) * 86_400_000;
  // ジョブの範囲と同じ判定(eventReactions.ts: release_datetime >= now − horizon)。
  return { reaction_state: 'NOT_CALCULATED', retry_scheduled: releaseMs >= input.now.getTime() - horizonMs };
}
