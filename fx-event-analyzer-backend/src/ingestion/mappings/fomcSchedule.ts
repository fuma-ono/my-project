/**
 * FOMC(米連邦公開市場委員会)の会合日程と政策発表(声明)の時刻 — HQ承認
 * 2026-10-22 Task 3。CODE-REVIEWED CONFIG(mappings/blsSchedule.ts と同じ):
 * 人が公式ページを読んで書く表で、規則から推測して日付を作らない。
 * `npm run ingest:fomc-schedule`(pipelines/fomcSchedule.ts)がこの表から
 * economic_events(指標 US_FOMC、provider 'fomc_schedule')を作る。
 *
 * 公式の取得元(2026-10-22 01:17 UTC に取得、02:08 UTC に再確認。ログイン・キー不要):
 * - 会合日程: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   (ページの Last Update: 2026-10-07。2026年・2027年の会合、* = 経済見通し(SEP)あり)
 * - FRBのカレンダー: https://www.federalreserve.gov/json/calendar.json
 *   (会合2日目に type "FOMC"・title "FOMC Meeting"・time "2:00 p.m." と
 *   "FOMC Press Conference" "2:30 p.m." が載る。2026-10-28・2026-12-09 を確認。
 *   このJSONは再確認時点で 2026-12 までしか無く、2027年の会合は載っていない)
 *
 * 暫定(tentative)のルール: 会合日程のページに "Each meeting date is tentative
 * until confirmed at the meeting immediately preceding it." とある。この表の
 * `provisional` は次のどちらかなら true にする:
 *   (a) 直前の会合がまだ開かれていない(= その会合の日程はまだ確認されていない)
 *   (b) calendar.json にその会合の 14:00 の "FOMC Meeting" がまだ載っていない
 * 2026-10-22 時点では 10/27-28 だけが確定(9月の会合で確認済み・JSONにも有り)。
 * 12/8-9 は JSON には載っているが 10月の会合での確認前なので暫定。2027年は
 * JSON に無く、14:00 は FRB の通常の発表時刻を当てはめただけなので暫定。
 *
 * 時刻の変換: `announcement` は America/New_York の壁時計の時刻で、会合2日目
 * (meetingEnd)の 14:00(FRBの声明公表)。保存する release_datetime は
 * time.ts の zonedWallTimeToUtc で UTC に直す(夏時間を考慮。固定の時差は
 * 使わない): 夏時間(EDT, UTC-4)の 2026-10-28 14:00 → 18:00Z、標準時
 * (EST, UTC-5)の 2026-12-09 14:00 → 19:00Z。会合の日付と発表の日時は
 * 別のフィールドとして持つ(会合は2日間、発表はその2日目の決まった時刻)。
 *
 * 人が更新する手順(data-sources.md §15 にも同じ手順):
 * 1. 上の2つのページを開き、会合日程ページの日付・* と calendar.json の
 *    "FOMC Meeting" の日付・時刻を見比べる。
 * 2. 日付が変わった会合は meetingStart / meetingEnd を直す(行は消さない —
 *    provider_event_id は meetingEnd から作るため、日付を直すと別の行になる。
 *    同じ行の日時を変えたいときは `eventKey` に元の meetingEnd を残す)。
 * 3. 直前の会合が終わり、calendar.json に 14:00 が載った会合は
 *    provisional を false にする。
 * 4. 中止になった会合は `cancelled: { note }` を足す(行は消さない)。
 * 5. checkedAt を確認した日に直し、npm test を通してからレビューに出す。
 * このジョブはどこにも定期実行として登録していない(手動で実行する)。
 */

export const FOMC_MEETINGS_PAGE_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const FRB_CALENDAR_JSON_URL = 'https://www.federalreserve.gov/json/calendar.json';

/** The time zone of meetingStart / meetingEnd / announcement. */
export const FOMC_TIME_ZONE = 'America/New_York';
/** The policy statement is released at 14:00 New York time on the second day of the meeting. */
export const FOMC_ANNOUNCEMENT_TIME = '14:00';

export interface FomcScheduleEntry {
  /** 'YYYY-MM-DD', first day of the meeting (New York date). */
  meetingStart: string;
  /** 'YYYY-MM-DD', second (last) day of the meeting (New York date). */
  meetingEnd: string;
  /** Policy announcement, a New York wall-clock date and time — kept apart from the meeting dates. */
  announcement: { date: string; time: string; timeZone: string };
  /** true = Summary of Economic Projections at this meeting (* on the meetings page). */
  sep: boolean;
  /** true = not yet confirmed officially (see the tentative rule in the header). */
  provisional: boolean;
  /**
   * The meetingEnd this entry was FIRST published with, when it has since moved
   * (provider_event_id stays `fomc_schedule:<eventKey>` so the same row is
   * updated and the DB records RESCHEDULED). Omit when the date never moved.
   */
  eventKey?: string;
  /** Set when the FRB cancels the meeting; the row becomes CANCELLED. */
  cancelled?: { note: string };
  sources: readonly string[];
  /** 'YYYY-MM-DD' a human last compared this entry with the sources. */
  checkedAt: string;
}

const SOURCES = [FOMC_MEETINGS_PAGE_URL, FRB_CALENDAR_JSON_URL] as const;
const CHECKED_AT = '2026-10-22';

function meeting(meetingStart: string, meetingEnd: string, sep: boolean, provisional: boolean): FomcScheduleEntry {
  return {
    meetingStart,
    meetingEnd,
    announcement: { date: meetingEnd, time: FOMC_ANNOUNCEMENT_TIME, timeZone: FOMC_TIME_ZONE },
    sep,
    provisional,
    sources: SOURCES,
    checkedAt: CHECKED_AT,
  };
}

/** Meetings from 2026-10 on (earlier 2026 meetings are past and are never created). */
export const FOMC_SCHEDULE: readonly FomcScheduleEntry[] = [
  meeting('2026-10-27', '2026-10-28', false, false),
  meeting('2026-12-08', '2026-12-09', true, true),
  meeting('2027-01-26', '2027-01-27', false, true),
  meeting('2027-03-16', '2027-03-17', true, true),
  meeting('2027-04-27', '2027-04-28', false, true),
  meeting('2027-06-08', '2027-06-09', true, true),
  meeting('2027-07-27', '2027-07-28', false, true),
  meeting('2027-09-14', '2027-09-15', true, true),
  meeting('2027-10-26', '2027-10-27', false, true),
  meeting('2027-12-07', '2027-12-08', true, true),
];
