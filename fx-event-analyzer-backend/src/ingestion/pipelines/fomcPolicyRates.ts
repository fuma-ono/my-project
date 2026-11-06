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
 *
 * 訂正の検知(HQ指示 2026-11-06「NY連銀の規約対応」。規約「Users are responsible for monitoring the Website for any
 * changes, updates, or corrections relevant to Content you choose to use.」): 記録済みの会合(発表から MAX_LOOKBACK_DAYS
 * 以内)も、同じ1回の取得で NY連銀の今の値と突き合わせる。違いは details.conflicts に記録するだけで、記録した値も
 * 会合への結びつけも変えない(行は不変。人が確認して DB を直すか決める — dev-environment.md 15.4)。
 * - VALUE_DIFFERS: 記録した effective_date の NY連銀の下限・上限が、記録と違う
 * - EFFECTIVE_DATE_DIFFERS: 今の NY連銀の記録で同じ決まりを当てはめると、別の effective_date になる
 * 記録した effective_date の値が API に無い・読めないときは比べられないので、conflicts ではなく details.unverified。
 * API が取れなければ比べない(details.conflicts_checked = false。取得の失敗は従来どおりエラー)。
 *
 * 実行をまたいだ重複の防止(HQ指示 2026-11-06「NY Fed 食い違いログの重複防止」): 新しい表は作らず、このジョブの前回のログと比べる。
 * - 食い違いは「会合・違いの種類・DB の値・NY連銀の値」で識別する(conflictKey)。1つの会合に2種類の違いがあれば別の食い違い。
 * - 突き合わせができた実行(details.conflicts_checked = true)は、その時点で続いている食い違いの識別子だけを
 *   details.open_conflicts に残す(詳細は残さない)。次の実行は、このジョブ(job・provider で絞る。他のジョブのログは見ない)の
 *   conflicts_checked = true の直近の1行の open_conflicts を前回の状態として読む(取得に失敗した実行は前回の状態にならない)。
 * - details.conflicts = 新しく出た食い違い(詳細つき、1回だけ)。続いているものは details.continuing_conflicts に件数だけ。
 *   details.resolved_conflicts = 解消した食い違い(1回だけ)。解消の後にまた出たら、新しい発生として conflicts に出る。
 * - 解消とみなすのは、その会合のその種類の比較が今回できて、違いが無かったときだけ。比べられなかった会合(API に値が無い・
 *   読めない・発表から MAX_LOOKBACK_DAYS を過ぎた)の前回の食い違いは、解消とせずに open_conflicts に持ち越す。
 */
import { NY_FED_SOURCE } from '../../domain/attribution.js';
import { nyFedEffrSearchUrl, type NyFedTargetRangeResult } from '../adapters/nyFedRates.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore, ProviderEventRow, StoredFomcPolicyDecision } from '../store.js';
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
  /** 今回新しく出た食い違い(記録は変えない)。前回から続いているものは入れない。 */
  conflicts: FomcPolicyRateConflict[];
  /** 前回から続いている食い違いの数。 */
  continuingConflicts: number;
  /** 今回解消した食い違い。 */
  resolvedConflicts: { key: string; provider_event_id: string; difference: FomcPolicyRateDifference }[];
  /** 今回の時点で続いている食い違いの識別子(次の実行の前回の状態)。突き合わせなかった実行では null。 */
  openConflicts: string[] | null;
  /** 記録済みの会合で、比べられなかったもの(記録した effective_date の値が API に無い・読めない)。 */
  unverified: { provider_event_id: string; reason: 'MISSING_IN_SOURCE' | 'UNREADABLE_IN_SOURCE' }[];
}

export type FomcPolicyRateDifference = 'VALUE_DIFFERS' | 'EFFECTIVE_DATE_DIFFERS';

export interface FomcPolicyRateConflict {
  /** 食い違いの識別子(conflictKey)。実行をまたいで同じ食い違いを見分ける。 */
  key: string;
  provider_event_id: string;
  difference: FomcPolicyRateDifference;
  /** DB の記録(変えていない)。 */
  stored: { lower: number; upper: number; effective_date: string };
  /** NY連銀の今の値。VALUE_DIFFERS は記録した effective_date の値、EFFECTIVE_DATE_DIFFERS は今の決まりで選んだ記録。 */
  source: { lower: number; upper: number; effective_date: string };
  source_url: string;
}

const sameRate = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** 食い違いの識別子: 会合・違いの種類・DB の値・NY連銀の値(同じ食い違いなら実行をまたいで同じ文字列)。 */
export function conflictKey(
  providerEventId: string,
  difference: FomcPolicyRateDifference,
  stored: FomcPolicyRateConflict['stored'],
  source: FomcPolicyRateConflict['source'],
): string {
  const part = (v: { lower: number; upper: number; effective_date: string }) =>
    `${Number(v.lower)}/${Number(v.upper)}/${v.effective_date}`;
  return `${providerEventId}|${difference}|${part(stored)}|${part(source)}`;
}

/** ingestion_logs の job・provider(このジョブのログだけを前回の状態として読む)。 */
export const FOMC_POLICY_RATE_JOB = 'ingest:fomc-policy-rate';
export const FOMC_POLICY_RATE_LOG_PROVIDER = 'nyfed_effr';

type Pick =
  | { kind: 'range'; range: NyFedTargetRangeResult['ranges'][number] }
  | { kind: 'awaiting' }
  | { kind: 'unreadable' }
  | { kind: 'outside' };

/** 発表日(date)より後の最初の記録を、上の条件で選ぶ(新規の取り込みと訂正の検知で同じ決まりを使う)。 */
function pickRange(feed: NyFedTargetRangeResult, date: string, nextDate: string | null): Pick {
  const first = feed.ranges.find((range) => range.effectiveDate > date);
  const unreadableBefore = feed.skipped.some(
    (s) => s.effectiveDate !== null && s.effectiveDate > date && (!first || s.effectiveDate <= first.effectiveDate),
  );
  if (unreadableBefore) return { kind: 'unreadable' };
  if (!first) return { kind: 'awaiting' };
  const inWindow =
    first.effectiveDate <= addDays(date, MAX_DAYS_AFTER_ANNOUNCEMENT) &&
    (nextDate === null || first.effectiveDate < nextDate);
  return inWindow ? { kind: 'range', range: first } : { kind: 'outside' };
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
  const result: FomcPolicyRateResult = {
    recorded: [],
    awaiting: [],
    unmatched: [],
    alreadyRecorded: 0,
    conflicts: [],
    continuingConflicts: 0,
    resolvedConflicts: [],
    openConflicts: null,
    unverified: [],
  };
  const writeDetails = (extra: Record<string, unknown> = {}) => {
    counters.details.recorded = result.recorded;
    counters.details.awaiting = result.awaiting;
    counters.details.unmatched = result.unmatched;
    counters.details.already_recorded = result.alreadyRecorded;
    counters.details.conflicts = result.conflicts;
    counters.details.continuing_conflicts = result.continuingConflicts;
    counters.details.resolved_conflicts = result.resolvedConflicts;
    counters.details.unverified = result.unverified;
    if (result.openConflicts !== null) counters.details.open_conflicts = result.openConflicts;
    Object.assign(counters.details, extra);
  };

  const indicator = (await deps.store.findIndicatorsByCode([FOMC_INDICATOR_CODE])).get(FOMC_INDICATOR_CODE);
  if (!indicator) {
    counters.error(`economic_indicators has no ${FOMC_INDICATOR_CODE} row`);
    writeDetails({ conflicts_checked: false });
    return result;
  }

  const meetings = (await deps.store.listEventsByProvider(FOMC_SCHEDULE_PROVIDER))
    .filter((row) => row.indicator_id === indicator.id && row.status !== 'CANCELLED')
    .sort((a, b) => Date.parse(a.release_datetime) - Date.parse(b.release_datetime));
  const recorded = new Map((await deps.store.listFomcPolicyDecisions()).map((d) => [d.event_id, d]));
  const today = localDate(now, NEW_YORK);
  const lookbackStart = addDays(today, -MAX_LOOKBACK_DAYS);

  type Target = { row: ProviderEventRow; date: string; nextDate: string | null };
  const pending: Target[] = [];
  const toVerify: (Target & { stored: StoredFomcPolicyDecision })[] = [];
  meetings.forEach((row, index) => {
    if (Date.parse(row.release_datetime) > now.getTime()) return;
    const date = localDate(new Date(row.release_datetime), NEW_YORK);
    const next = meetings[index + 1];
    const nextDate = next ? localDate(new Date(next.release_datetime), NEW_YORK) : null;
    const stored = recorded.get(row.id);
    if (stored) {
      result.alreadyRecorded += 1;
      // 発表から MAX_LOOKBACK_DAYS を過ぎた記録は突き合わせない(取得の期間に入れない)。
      if (date >= lookbackStart) toVerify.push({ row, date, nextDate, stored });
      return;
    }
    if (date < lookbackStart) {
      result.unmatched.push({ provider_event_id: row.provider_event_id, reason: 'OUTSIDE_LOOKBACK' });
      return;
    }
    pending.push({ row, date, nextDate });
  });
  counters.fetched += pending.length;
  if (pending.length === 0 && toVerify.length === 0) {
    writeDetails({ conflicts_checked: false });
    return result;
  }

  // 前回の状態(このジョブの、突き合わせができた直近の実行の open_conflicts。無ければ空)。
  const previousOpen = new Set(await deps.store.latestFomcPolicyRateOpenConflicts());
  const earliest = [...pending, ...toVerify].map((t) => t.date).sort()[0]!;
  const startDate = addDays(earliest, 1);
  const sourceUrl = nyFedEffrSearchUrl(startDate, today);
  let feed: NyFedTargetRangeResult;
  try {
    feed = await deps.fetchRanges(startDate, today);
  } catch (error) {
    // 推測の値は入れない。会合は data preparing のまま、次の実行で取り直す。
    counters.error(`NY Fed EFFR: ${error instanceof Error ? error.message : String(error)}`);
    result.awaiting.push(...pending.map((p) => p.row.provider_event_id));
    // 取れなかったときは比べない(訂正の検知と取得の失敗を混ぜない)。
    writeDetails({ source_status: 'UNAVAILABLE', source_url: sourceUrl, conflicts_checked: false });
    return result;
  }
  const fetchedAt = now.toISOString();

  for (const { row, date, nextDate } of pending) {
    const pick = pickRange(feed, date, nextDate);
    if (pick.kind === 'unreadable') {
      result.unmatched.push({ provider_event_id: row.provider_event_id, reason: 'FIRST_RECORD_UNREADABLE' });
      continue;
    }
    if (pick.kind === 'awaiting') {
      result.awaiting.push(row.provider_event_id);
      counters.skip('not_published_yet');
      continue;
    }
    if (pick.kind === 'outside') {
      result.unmatched.push({ provider_event_id: row.provider_event_id, reason: 'NO_RECORD_IN_WINDOW' });
      continue;
    }
    const first = pick.range;
    try {
      await deps.store.insertFomcPolicyDecision({
        event_id: row.id,
        target_range_lower: first.lower,
        target_range_upper: first.upper,
        announced_at: row.release_datetime,
        effective_date: first.effectiveDate,
        source: NY_FED_SOURCE,
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
  // 訂正の検知: 記録済みの会合を、NY連銀の今の値と突き合わせる(記録は変えない)。
  const detected: FomcPolicyRateConflict[] = [];
  /** 今回比べられた「会合|違いの種類」(前回の食い違いを解消とみなしてよいもの)。 */
  const checked = new Set<string>();
  for (const { row, date, nextDate, stored } of toVerify) {
    const storedValue = {
      lower: stored.target_range_lower,
      upper: stored.target_range_upper,
      effective_date: stored.effective_date,
    };
    const push = (difference: FomcPolicyRateDifference, source: FomcPolicyRateConflict['source']) =>
      detected.push({
        key: conflictKey(row.provider_event_id, difference, storedValue, source),
        provider_event_id: row.provider_event_id,
        difference,
        stored: storedValue,
        source,
        source_url: sourceUrl,
      });
    const atStored = feed.ranges.find((range) => range.effectiveDate === stored.effective_date);
    if (atStored) {
      checked.add(`${row.provider_event_id}|VALUE_DIFFERS`);
      if (
        !sameRate(atStored.lower, stored.target_range_lower) ||
        !sameRate(atStored.upper, stored.target_range_upper)
      ) {
        push('VALUE_DIFFERS', { lower: atStored.lower, upper: atStored.upper, effective_date: atStored.effectiveDate });
      }
    } else {
      const unreadable = feed.skipped.some((skip) => skip.effectiveDate === stored.effective_date);
      result.unverified.push({
        provider_event_id: row.provider_event_id,
        reason: unreadable ? 'UNREADABLE_IN_SOURCE' : 'MISSING_IN_SOURCE',
      });
    }
    const pick = pickRange(feed, date, nextDate);
    if (pick.kind === 'range') {
      checked.add(`${row.provider_event_id}|EFFECTIVE_DATE_DIFFERS`);
      if (pick.range.effectiveDate !== stored.effective_date) {
        push('EFFECTIVE_DATE_DIFFERS', {
          lower: pick.range.lower,
          upper: pick.range.upper,
          effective_date: pick.range.effectiveDate,
        });
      }
    }
  }
  // 前回の状態と比べる: 新しく出たもの・続いているもの・解消したもの。比べられなかったものは持ち越す。
  const detectedKeys = new Set(detected.map((c) => c.key));
  result.conflicts = detected.filter((c) => !previousOpen.has(c.key));
  result.continuingConflicts = detected.length - result.conflicts.length;
  const open = new Set(detectedKeys);
  for (const key of previousOpen) {
    if (detectedKeys.has(key)) continue;
    const [providerEventId, difference] = key.split('|') as [string, FomcPolicyRateDifference];
    if (checked.has(`${providerEventId}|${difference}`)) {
      result.resolvedConflicts.push({ key, provider_event_id: providerEventId, difference });
    } else {
      open.add(key);
    }
  }
  result.openConflicts = [...open].sort();

  writeDetails({
    source_status: 'OK',
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    unreadable_records: feed.skipped.length,
    conflicts_checked: true,
    verified: toVerify.length,
  });
  return result;
}
