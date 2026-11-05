/**
 * FOMC の政策決定(誘導目標レンジ)→ fomc_policy_decisions(HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A)。
 *
 * 対象: US_FOMC の会合の予定(economic_events、provider 'fomc_schedule')のうち、発表時刻を過ぎていて、中止でなく、
 * まだ fomc_policy_decisions に行が無いもの。
 *
 * 値: NY連銀 Markets Data API の EFFR の記録の targetRateFrom(下限)・targetRateTo(上限)をそのまま入れる
 * (1つの金利に変換しない。percentRate = EFFR の実績は入れない)。
 *
 * 会合への結びつけ: 発表日(ニューヨークの日付 D)より後の、最初の effectiveDate の記録。新しいレンジは発表の
 * 翌営業日から有効になる(2026-09-16 の発表 → 09-17 から 3.75〜4.00、API で確認)。次の条件のどれかに当たれば
 * 書かない(推測で埋めない):
 * - D より後の記録がまだ無い(その日の値は翌営業日の 9:00 ごろ公開)→ awaiting(まだ公開されていない)
 * - 最初の記録が D から MAX_DAYS_AFTER_ANNOUNCEMENT 日より後、または次の会合の発表日以降 → NO_RECORD_IN_WINDOW
 * - D と最初の記録の間に、値の読めない記録がある(本当の最初の日の値が分からない)→ FIRST_RECORD_UNREADABLE
 *
 * 書くのは fomc_policy_decisions だけ。economic_events・event_snapshots は変えない(data_status は PENDING のまま)。
 * 一度書いた行は変えない・消さない(DB のトリガー)。同じ会合は1行だけ(既にあれば読まずに飛ばす。DB の一意制約)。
 * API が取れなければ何も書かず、エラーとして記録する(次の実行で取り直す)。
 *
 * 制約(api-design v1.47 にも記載): 発表から MAX_LOOKBACK_DAYS(180日)を超えて記録の無い会合は処理しない
 * (OUTSIDE_LOOKBACK)。DB に会合の予定の行が無い会合は対象外。記録した値は NY連銀の後日の改定を反映しない。
 * 翌営業日の記録が API に無い(読めない記録でもない)ときは、上の条件の範囲でその次の記録を使う。
 */
import { NY_FED_ATTRIBUTION } from '../../domain/attribution.js';
import { nyFedEffrSearchUrl, type NyFedTargetRangeResult } from '../adapters/nyFedRates.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore, ProviderEventRow } from '../store.js';
import { localDate } from '../time.js';
import { FOMC_INDICATOR_CODE, FOMC_SCHEDULE_PROVIDER } from './fomcSchedule.js';

const NEW_YORK = 'America/New_York';
/** 発表からこの日数より後の記録は、その会合の決定として使わない(祝日が続いても翌営業日は1週間以内)。 */
export const MAX_DAYS_AFTER_ANNOUNCEMENT = 7;
/** 一度に見る期間の上限(日)。これより古い未記録の会合は、この期間の外として記録だけする。 */
export const MAX_LOOKBACK_DAYS = 180;

export interface FomcPolicyRateResult {
  recorded: { provider_event_id: string; effective_date: string; lower: number; upper: number }[];
  /** NY連銀にまだ発表後の記録が無い会合(data preparing のまま)。 */
  awaiting: string[];
  unmatched: {
    provider_event_id: string;
    reason: 'NO_RECORD_IN_WINDOW' | 'FIRST_RECORD_UNREADABLE' | 'OUTSIDE_LOOKBACK';
  }[];
  alreadyRecorded: number;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function ingestFomcPolicyRates(
  deps: {
    store: IngestionStore;
    fetchRanges: (startDate: string, endDate: string) => Promise<NyFedTargetRangeResult>;
    now?: () => Date;
  },
  counters: JobCounters,
): Promise<FomcPolicyRateResult> {
  const now = deps.now?.() ?? new Date();
  const result: FomcPolicyRateResult = { recorded: [], awaiting: [], unmatched: [], alreadyRecorded: 0 };
  const writeDetails = (extra: Record<string, unknown> = {}) => {
    counters.details.recorded = result.recorded;
    counters.details.awaiting = result.awaiting;
    counters.details.unmatched = result.unmatched;
    counters.details.already_recorded = result.alreadyRecorded;
    Object.assign(counters.details, extra);
  };

  const indicator = (await deps.store.findIndicatorsByCode([FOMC_INDICATOR_CODE])).get(FOMC_INDICATOR_CODE);
  if (!indicator) {
    counters.error(`economic_indicators has no ${FOMC_INDICATOR_CODE} row`);
    writeDetails();
    return result;
  }

  const meetings = (await deps.store.listEventsByProvider(FOMC_SCHEDULE_PROVIDER))
    .filter((row) => row.indicator_id === indicator.id && row.status !== 'CANCELLED')
    .sort((a, b) => Date.parse(a.release_datetime) - Date.parse(b.release_datetime));
  const recordedIds = new Set(await deps.store.listFomcPolicyDecisionEventIds());
  const today = localDate(now, NEW_YORK);
  const lookbackStart = addDays(today, -MAX_LOOKBACK_DAYS);

  const pending: { row: ProviderEventRow; date: string; nextDate: string | null }[] = [];
  meetings.forEach((row, index) => {
    if (Date.parse(row.release_datetime) > now.getTime()) return;
    if (recordedIds.has(row.id)) {
      result.alreadyRecorded += 1;
      return;
    }
    const date = localDate(new Date(row.release_datetime), NEW_YORK);
    if (date < lookbackStart) {
      result.unmatched.push({ provider_event_id: row.provider_event_id, reason: 'OUTSIDE_LOOKBACK' });
      return;
    }
    const next = meetings[index + 1];
    pending.push({ row, date, nextDate: next ? localDate(new Date(next.release_datetime), NEW_YORK) : null });
  });
  counters.fetched += pending.length;
  if (pending.length === 0) {
    writeDetails();
    return result;
  }

  const startDate = addDays(pending[0]!.date, 1);
  const sourceUrl = nyFedEffrSearchUrl(startDate, today);
  let feed: NyFedTargetRangeResult;
  try {
    feed = await deps.fetchRanges(startDate, today);
  } catch (error) {
    // 推測の値は入れない。会合は data preparing のまま、次の実行で取り直す。
    counters.error(`NY Fed EFFR: ${error instanceof Error ? error.message : String(error)}`);
    result.awaiting.push(...pending.map((p) => p.row.provider_event_id));
    writeDetails({ source_status: 'UNAVAILABLE', source_url: sourceUrl });
    return result;
  }
  const fetchedAt = now.toISOString();

  for (const { row, date, nextDate } of pending) {
    const first = feed.ranges.find((range) => range.effectiveDate > date);
    const unreadableBefore = feed.skipped.some(
      (s) => s.effectiveDate !== null && s.effectiveDate > date && (!first || s.effectiveDate <= first.effectiveDate),
    );
    if (unreadableBefore) {
      result.unmatched.push({ provider_event_id: row.provider_event_id, reason: 'FIRST_RECORD_UNREADABLE' });
      continue;
    }
    if (!first) {
      result.awaiting.push(row.provider_event_id);
      counters.skip('not_published_yet');
      continue;
    }
    const inWindow =
      first.effectiveDate <= addDays(date, MAX_DAYS_AFTER_ANNOUNCEMENT) &&
      (nextDate === null || first.effectiveDate < nextDate);
    if (!inWindow) {
      result.unmatched.push({ provider_event_id: row.provider_event_id, reason: 'NO_RECORD_IN_WINDOW' });
      continue;
    }
    try {
      await deps.store.insertFomcPolicyDecision({
        event_id: row.id,
        target_range_lower: first.lower,
        target_range_upper: first.upper,
        announced_at: row.release_datetime,
        effective_date: first.effectiveDate,
        source: NY_FED_ATTRIBUTION.source,
        source_url: sourceUrl,
        fetched_at: fetchedAt,
      });
      counters.success += 1;
      result.recorded.push({
        provider_event_id: row.provider_event_id,
        effective_date: first.effectiveDate,
        lower: first.lower,
        upper: first.upper,
      });
    } catch (error) {
      counters.error(`${row.provider_event_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  writeDetails({
    source_status: 'OK',
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    unreadable_records: feed.skipped.length,
  });
  return result;
}
