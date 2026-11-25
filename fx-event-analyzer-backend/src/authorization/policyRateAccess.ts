import type { SupabaseClient } from '@supabase/supabase-js';
import { pastReleasesMaxFor } from '../domain/pastReleaseAccess.js';
import type { Plan } from '../domain/planLimits.js';
import { listRecordedFomcMeetings } from '../repositories/eventsRepository.js';

/** FOMC の会合(政策金利を持つ指標)。routes/events.ts の POLICY_RATE_INDICATOR_CODE と同じ。 */
export const POLICY_RATE_INDICATOR = 'US_FOMC';

/**
 * 発表の indicator_code の実行時の検査(HQ 指示 2026-11-19、C のレビュー P2: **検査をここに集約**)。
 * 型(`UnlockableEvent.indicator_code: string`)は、コンパイル時の防止。これは、型を迂回した呼び出し(any・JS・JSON の応答など)でも、
 * FOMC のロックが**黙って素通りしない**ための、実行時の防止。undefined・null・空・空白だけ・文字列でない値(数値・オブジェクト・配列)は、
 * 指標が分からない = FOMC かどうか判定できないので、**判定を省略せず、エラー(プログラムの誤り。500)にする**。
 * 判定する関数(isPolicyRateLockedForPlan)と、子リソースのロック(requireUnlockedEvent・requireUnlockedEventForPlan)の両方が、これを呼ぶ。
 */
export function assertEventIndicatorCode(code: unknown): asserts code is string {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('indicator_code is required (the FOMC policy-rate lock cannot be skipped)');
  }
}

/**
 * 過去の FOMC の政策金利のロック(HQ 指示 2026-11-19「FOMC の FREE/PRO 制御」)。
 *
 * 既存のロック(HQ 判断 2026-10-22。FREE は指標ごとに直近 3 回の発表だけ値を見られる)は、**RELEASED の発表だけ**を数える
 * (resolvePastReleaseAccessForPlan)。FOMC の会合は、政策金利を記録した実行で RELEASED になる(設計 S1)が、記録前の会合や、
 * 補正前の過去の会合は SCHEDULED のまま残り得る。また政策金利は専用の表 fomc_policy_decisions に入り、既存のロックは
 * その表を見ない。そのままだと、**FREE でも過去の記録済みの会合の政策金利が、既存のロックの数え方の差で見えてしまう**ことがある。
 * そこで、記録済み(fomc_policy_decisions に行がある)の会合を、RELEASED かどうかに関係なく新しい順に並べ、FREE(past_releases_max = 3)は直近 3 回だけ、PRO(上限なし)は全部を見られるとする。
 *   - 対象: 指標が US_FOMC で、その会合に政策金利が記録されているとき。記録が無い会合(これからの会合・まだ記録が無い会合)は
 *     隠す値が無いので、ロックしない。
 *   - ロックされた会合は、GET /events/{id} が、既存のロックと同じ形(locked: true、値を null)で返す。policy_rate は null。
 * 戻り値: true = ロック(政策金利を返さない)。
 */
export async function isPolicyRateLockedForPlan(
  supabase: SupabaseClient,
  plan: Plan,
  event: { id: string; indicator_id: string; indicator_code: string },
): Promise<boolean> {
  // 実行時の検査(PRO でも先に行う。型を迂回した呼び出しで、判定が素通りしないように)
  assertEventIndicatorCode(event.indicator_code);
  // 大文字小文字・前後の空白の違いで、FOMC の判定をすり抜けない(正規化して比べる)
  if (event.indicator_code.trim().toUpperCase() !== POLICY_RATE_INDICATOR) return false;
  const max = pastReleasesMaxFor(plan);
  if (max === null) return false; // PRO: 上限なし。読み取りもしない
  const meetings = await listRecordedFomcMeetings(supabase, event.indicator_id);
  const index = meetings.findIndex((meeting) => meeting.event_id === event.id);
  if (index === -1) return false; // 政策金利が記録されていない会合: 隠す値が無い
  return index >= max;
}
