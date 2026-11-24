/**
 * 経路 B(過去点の確認)の第1段階版(設計書 ca-cpi-detailed-design.md §4.3 経路 B・§16.1・§16.15.1)。
 *
 * **第1段階では、改定を検知して書くことはしない**(revisionMode = DISABLED。event_revisions には1行も書かない。N の判定・
 * REVISION_BURST_STOP もしない)。ここは、保存済みの初回値と、今の WDS の値が違う月を、**人が見るための参考情報**として
 * 集めるだけ。書き込み・停止の根拠にしない。
 *
 * このモジュールは公表日の判定に使う項目を参照しない(経路 A と分離する。テスト 16.1-R10 がソースを検査する)。
 * 照合するのは、系列の同一性(呼び出し側)・対象月・数値・statusCode・symbolCode だけ。
 */
import { localCalendarDay } from '../firstValueWindow.js';
import { periodOfRefPer, readPointValue, type CorePoint } from '../adapters/caCoreCpi.js';

export interface ObservationTarget {
  indicatorCode: string;
  providerEventId: string;
  eventId: string;
  /** 初回値の対象月 'YYYY-MM' */
  period: string;
  /** 保存済みの初回値 */
  stored: number;
  /** 初回値を保存した時刻(ISO)。無ければ null */
  capturedAt: string | null;
}

export interface RevisionObservation {
  indicator: string;
  provider_event_id: string;
  period: string;
  stored: number;
  observed: number;
}

export interface SameDayDiff {
  event: 'same_day_diff';
  indicator: string;
  provider_event_id: string;
  event_id: string;
  period: string;
  series: string;
  snapshot_actual: number;
  observed: number;
  snapshot_captured_at: string | null;
  observed_at: string;
  local_date: string;
  action: 'NONE';
}

export type ObservationOutcome =
  | { kind: 'UNCHANGED' }
  | { kind: 'NOT_OBSERVABLE' } // 点が無い・値が不正(参考情報にしない。改定にもしない)
  | { kind: 'OBSERVATION'; observation: RevisionObservation }
  | { kind: 'SAME_DAY_DIFF'; diff: SameDayDiff };

const SAME_DAY_TIME_ZONE = 'America/Toronto';

/** 保存済みの初回値と、今の応答の同じ対象月の値を、小数第1位の値どうしで比べる。何も書かない。 */
export function observeStoredValue(
  target: ObservationTarget,
  points: readonly CorePoint[],
  seriesId: string,
  now: Date,
): ObservationOutcome {
  const point = points.find((p) => periodOfRefPer(p.refPer) === target.period);
  if (!point) return { kind: 'NOT_OBSERVABLE' };
  const observed = readPointValue(point);
  if (observed === null) return { kind: 'NOT_OBSERVABLE' };
  if (Math.round(observed * 10) === Math.round(target.stored * 10)) return { kind: 'UNCHANGED' };

  const today = localCalendarDay(now, SAME_DAY_TIME_ZONE);
  const capturedAt = target.capturedAt && !Number.isNaN(Date.parse(target.capturedAt)) ? target.capturedAt : null;
  if (capturedAt !== null && localCalendarDay(new Date(capturedAt), SAME_DAY_TIME_ZONE) === today) {
    // 同日の差は、改定と区別して人が確認する(§5.2・§15.3)。書かない
    return {
      kind: 'SAME_DAY_DIFF',
      diff: {
        event: 'same_day_diff',
        indicator: target.indicatorCode,
        provider_event_id: target.providerEventId,
        event_id: target.eventId,
        period: target.period,
        series: seriesId,
        snapshot_actual: target.stored,
        observed,
        snapshot_captured_at: capturedAt,
        observed_at: now.toISOString(),
        local_date: today,
        action: 'NONE',
      },
    };
  }
  return {
    kind: 'OBSERVATION',
    observation: {
      indicator: target.indicatorCode,
      provider_event_id: target.providerEventId,
      period: target.period,
      stored: target.stored,
      observed,
    },
  };
}
