/**
 * 人が公式ページを読んで書いた公表予定の表 → economic_events(HQ指示 2026-11-10「6地域の経済指標拡張・実装準備」)。
 * US_RETAIL_SALES・JP_CPI と同じ決まりを、複数の指標・取得元の表で使えるようにしたもの(mappings/gbAuCaSchedule.ts)。
 *
 * - provider = 表の provider、provider_event_id = `<provider>:<指標コード>:<key>`(key は公式の対象月、無ければ公表日)
 * - release_datetime = releaseDate の time を timeZone の壁時計として UTC に変換(夏時間を考える。zonedWallTimeToUtc)
 * - SCHEDULED・EXACT(entry.precision が DATE_ONLY の回は DATE_ONLY)・値なし(data_status PENDING)。値はこの処理では入れない(公表予定と実績値は別の処理)
 * - 冪等: 同じ表を何度流しても変わらない。表の日時が変わったら同じ行の release_datetime を更新する(DB のトリガーが
 *   RESCHEDULED を記録する)
 * - 公表時刻を過ぎた回は作らない。既にある過去の行・RELEASED の行は変えない(過去のデータを守る)
 * - 表から消えた回(DB にあり、未来・SCHEDULED)は記録だけで、消さない
 * - 会合の期間(entry.meeting)は release_datetime とは別に economic_event_meetings へ upsert(event_id で一意)。
 *   日程の変更は同じ key のまま日付を書き換える(同じ行を更新)・中止は entry.cancelled(status CANCELLED。行は消さない)・
 *   暫定は entry.provisional(is_provisional)。値(政策金利の決定値)は書かない
 * - 指標の行が無い表は、何も書かずにエラー(ほかの表は続ける)。外部へのアクセスは無い
 */
import type { OfficialScheduleEntry, OfficialScheduleTable } from '../mappings/gbAuCaSchedule.js';
import type { JobCounters } from '../runner.js';
import type { EventPatch, IngestionStore, ProviderEventRow } from '../store.js';
import { zonedWallTimeToUtc } from '../time.js';

/** UTC の時刻を日本時間の 'YYYY-MM-DD HH:mm JST' にする(表示用。夏時間の影響は UTC への変換の側で済んでいる)。 */
export function formatJst(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = (type: string) => parts.find((x) => x.type === type)!.value;
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')} JST`;
}

export function officialScheduleProviderEventId(provider: string, entry: OfficialScheduleEntry): string {
  return `${provider}:${entry.indicatorCode}:${entry.key}`;
}

/** 公表の時刻(UTC)。日付・時刻の形が正しくないか、存在しない日付なら null(推測しない)。 */
export function officialScheduleUtc(entry: OfficialScheduleEntry): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.releaseDate);
  const time = /^(\d{2}):(\d{2})$/.exec(entry.time);
  if (!date || !time) return null;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const [hour, minute] = [Number(time[1]), Number(time[2])];
  if (hour > 23 || minute > 59) return null;
  return zonedWallTimeToUtc(year, month, day, hour, minute, entry.timeZone);
}

export type OfficialSchedulePlanAction = 'INSERT' | 'UPDATE' | 'UNCHANGED';

export interface OfficialSchedulePlanItem {
  provider_event_id: string;
  indicator: string;
  action: OfficialSchedulePlanAction;
  release_datetime: string;
  /** release_datetime を日本時間(Asia/Tokyo)で表したもの('YYYY-MM-DD HH:mm JST')。確認用の表示で、保存するのは UTC。 */
  release_datetime_jst: string;
  /** 会合の期間(あれば) */
  meeting?: { startDate: string; endDate: string };
  /** UPDATE のとき: 今の値 → 新しい値 */
  from?: string;
}

export interface OfficialScheduleResult {
  inserted: number;
  updated: number;
  unchanged: number;
  past: number;
  removed: string[];
  /** 各エントリで何をする(した)か。dry-run では、これだけを返して何も書かない */
  plan: OfficialSchedulePlanItem[];
}

export async function ingestOfficialScheduleTables(
  deps: {
    store: IngestionStore;
    tables: readonly OfficialScheduleTable[];
    now?: () => Date;
    /** true = dry-run(HQ指示 2026-11-13): DB に書かない。plan と件数だけ返す */
    dryRun?: boolean;
  },
  counters: JobCounters,
): Promise<OfficialScheduleResult> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const result: OfficialScheduleResult = { inserted: 0, updated: 0, unchanged: 0, past: 0, removed: [], plan: [] };

  for (const table of deps.tables) {
    counters.fetched += table.entries.length;
    const codes = [...new Set(table.entries.map((e) => e.indicatorCode))];
    const indicators = await deps.store.findIndicatorsByCode(codes);
    const missing = codes.filter((code) => !indicators.has(code));
    if (missing.length > 0) {
      counters.error(`${table.provider}: economic_indicators has no ${missing.join(', ')} row`);
      continue; // この表は何も書かない(ほかの表は続ける)
    }
    const existing = new Map<string, ProviderEventRow>();
    for (const row of await deps.store.listEventsByProvider(table.provider)) existing.set(row.provider_event_id, row);

    const seen = new Set<string>();
    for (const entry of table.entries) {
      const providerEventId = officialScheduleProviderEventId(table.provider, entry);
      if (seen.has(providerEventId)) {
        counters.error(`duplicate schedule entry ${providerEventId}`);
        continue;
      }
      seen.add(providerEventId);
      const releaseAt = officialScheduleUtc(entry);
      if (!releaseAt) {
        counters.error(
          `invalid release date/time ${providerEventId}: ${entry.releaseDate} ${entry.time} ${entry.timeZone}`,
        );
        continue;
      }
      const row = existing.get(providerEventId);
      if (releaseAt.getTime() <= now || (row && Date.parse(row.release_datetime) <= now)) {
        result.past += 1;
        counters.skip('past_release');
        continue;
      }
      if (row?.status === 'RELEASED') {
        counters.skip('already_released');
        continue;
      }
      if (entry.cancelled && !row) {
        counters.skip('cancelled_not_in_db');
        continue;
      }
      const indicator = indicators.get(entry.indicatorCode)!;
      const precision = entry.precision ?? 'EXACT';
      const provisional = entry.provisional === true;
      const meetingFields = entry.meeting ? { meeting: entry.meeting } : {};
      const writeMeeting = async (eventId: string) => {
        if (!entry.meeting || deps.dryRun) return;
        await deps.store.upsertEventMeeting({
          event_id: eventId,
          meeting_start_date: entry.meeting.startDate,
          meeting_end_date: entry.meeting.endDate,
          source_url: entry.sources[0]!,
          checked_at: entry.checkedAt,
        });
      };
      try {
        if (!row) {
          result.plan.push({
            provider_event_id: providerEventId,
            indicator: entry.indicatorCode,
            action: 'INSERT',
            release_datetime: releaseAt.toISOString(),
            release_datetime_jst: formatJst(releaseAt.toISOString()),
            ...meetingFields,
          });
          if (!deps.dryRun) {
            const inserted = await deps.store.insertEvent({
              indicator_id: indicator.id,
              provider: table.provider,
              provider_event_id: providerEventId,
              release_datetime: releaseAt.toISOString(),
              release_datetime_precision: precision,
              importance: indicator.importance,
              status: 'SCHEDULED',
              data_status: 'PENDING',
              ...(provisional ? { is_provisional: true } : {}),
            });
            await writeMeeting(inserted.id);
          }
          result.inserted += 1;
          counters.success += 1;
          continue;
        }
        const patch: EventPatch = {};
        if (Date.parse(row.release_datetime) !== releaseAt.getTime()) patch.release_datetime = releaseAt.toISOString();
        if (row.release_datetime_precision !== precision) patch.release_datetime_precision = precision;
        const wantedStatus = entry.cancelled ? 'CANCELLED' : 'SCHEDULED';
        if (row.status !== wantedStatus) patch.status = wantedStatus;
        if (row.is_provisional !== provisional) patch.is_provisional = provisional;
        if (Object.keys(patch).length === 0) {
          result.unchanged += 1;
          result.plan.push({
            provider_event_id: providerEventId,
            indicator: entry.indicatorCode,
            action: 'UNCHANGED',
            release_datetime: row.release_datetime,
            release_datetime_jst: formatJst(row.release_datetime),
            ...meetingFields,
          });
        } else {
          result.plan.push({
            provider_event_id: providerEventId,
            indicator: entry.indicatorCode,
            action: 'UPDATE',
            release_datetime: releaseAt.toISOString(),
            release_datetime_jst: formatJst(releaseAt.toISOString()),
            from: row.release_datetime,
            ...meetingFields,
          });
          if (!deps.dryRun) await deps.store.updateEvent(row.id, patch);
          result.updated += 1;
          if (patch.release_datetime) {
            counters.note('rescheduled', {
              provider_event_id: providerEventId,
              from: row.release_datetime,
              to: patch.release_datetime,
            });
          }
        }
        await writeMeeting(row.id);
        counters.success += 1;
      } catch (error) {
        counters.error(`${providerEventId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const [providerEventId, row] of existing) {
      if (seen.has(providerEventId)) continue;
      if (row.status !== 'SCHEDULED' || Date.parse(row.release_datetime) <= now) continue;
      result.removed.push(providerEventId);
    }
  }
  result.removed.sort();
  counters.details.inserted = result.inserted;
  counters.details.updated = result.updated;
  counters.details.unchanged = result.unchanged;
  counters.details.past = result.past;
  counters.details.removed = result.removed;
  return result;
}
