/**
 * 日銀の金融政策決定会合と ECB の金融政策会合(Governing Council)の日程 — HQ指示 2026-11-25
 * 「日銀・ECB の予定表」。CODE-REVIEWED CONFIG(mappings/retailSalesSchedule.ts・mappings/gbAuCaSchedule.ts と同じ):
 * 人が公式ページを読んで書く表で、規則から推測して日付を作らない。ライブの HTML の取得・解析はしない。
 * 日程だけ(値=政策金利の決定値は入れない)。BOE は対象外(サイトの利用条件が未確認)。
 *
 * 公式の取得元(2026-11-25 に取得して確認):
 * - 日銀: https://www.boj.or.jp/mopo/mpmsche_minu/index.htm 「金融政策決定会合」の年別の表(2026年・2027年)。
 *   会合は2日間。決定は2日目に公表される。key と releaseDate は**2日目の日付**(会合の初日はコメントに書く)。
 *   ページに「暫定」の表記は無い。決定の公表時刻はページに無い(未確認)→ DATE_ONLY とし、time の 12:00 JST は
 *   確認した時刻ではなく代わりの基準時刻(日本に夏時間は無い)。
 * - ECB: https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html 「monetary policy meeting in Frankfurt」の行
 *   (Day 1 / Day 2。Day 2 に記者会見)。key と releaseDate は Day 2 の日付。ページに時刻は無い(未確認)→ DATE_ONLY。
 *   time の 14:15 は ECB が決定を公表する通例の時刻(CET/CEST)に基づく代わりの基準時刻で、**公式ページでは未確認**。
 *   時刻の基準は Europe/Berlin(ECB の所在地 Frankfurt。CET/CEST を zonedWallTimeToUtc が夏時間込みで UTC にする)。
 *   ページには非金融政策会合(2026-11-25 など)も載っているが、金融政策会合だけを載せた。
 *
 * 表に載せる条件: 公式ページに実際に日付があり、作成時点(2026-11-25)より後に決定が公表される回だけ。
 * 日銀の2026年1〜10月の回は過去のため載せていない。
 *
 * 安定した key(provider_event_id の一部)は「公式ページに載っていた会合の月」'YYYY-MM'(日付ではない)。日程が移っても key は
 * 変えず、decision / start / end の日付だけを書き換える(同じ行が更新される。新しい行は作らない)。中止は `cancelled: true`、
 * 公式に未確定の日程は `provisional: true` を、その行に足す(mappings/gbAuCaSchedule.ts の OfficialScheduleEntry)。
 *
 * 分けて持つもの: 会合の期間(meeting.startDate〜endDate = economic_event_meetings)と、決定の公表日時(release_datetime = UTC)。
 * 表示は日本時間(JST)に統一する(dry-run の plan に release_datetime_jst を出す。保存は UTC)。この表は日程だけで、
 * 政策金利の決定値・予想・結果は一切持たない(FOMC の fomc_policy_decisions のような結果の表・列は使わない)。
 *
 * | 日銀(決定日 = 2日目) | ECB(決定日 = Day 2) |
 * |---|---|
 * | 2026-12-18(12/17-18) | 2026-12-17(12/16-17) |
 * | 2027-01-22(1/21-22) | 2027-02-04(2/3-4) |
 * | 2027-03-18(3/17-18) | 2027-03-18(3/17-18) |
 * | 2027-04-28(4/27-28) | 2027-04-29(4/28-29) |
 * | 2027-06-11(6/10-11) | 2027-06-10(6/9-10) |
 * | 2027-07-22(7/21-22) | 2027-07-22(7/21-22) |
 * | 2027-09-22(9/21-22) | 2027-09-09(9/8-9) |
 * | 2027-10-29(10/28-29) | 2027-10-28(10/27-28) |
 * | 2027-12-17(12/16-17) | 2027-12-16(12/15-16) |
 *
 * 公式ページの日程が変わったら、この表を直して再実行する(同じ行の release_datetime が更新される)。
 * 出典の利用条件: 日銀は https://www.boj.or.jp/about/copyright.htm(商用利用は事前相談が公式方針。日程は事実情報として扱うが
 * 法務の確認待ち)、ECB は出典を明記すれば利用可(加工は明示)。
 */
import type { OfficialScheduleEntry, OfficialScheduleTable } from './gbAuCaSchedule.js';

export const BOJ_MEETING_SCHEDULE_URL = 'https://www.boj.or.jp/mopo/mpmsche_minu/index.htm';
export const ECB_MEETING_CALENDAR_URL = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html';

export const BOJ_MEETING_PROVIDER = 'boj_meeting_schedule';
export const ECB_MEETING_PROVIDER = 'ecb_meeting_schedule';
export const BOJ_RATE_INDICATOR_CODE = 'BOJ_RATE';
export const ECB_RATE_INDICATOR_CODE = 'EU_ECB_RATE';

/** 代わりの基準時刻(上の説明。どちらも公式ページでは未確認)。 */
export const BOJ_ANCHOR_TIME = '12:00';
export const BOJ_TIME_ZONE = 'Asia/Tokyo';
export const ECB_ANCHOR_TIME = '14:15';
export const ECB_TIME_ZONE = 'Europe/Berlin';

const CHECKED_AT = '2026-11-25';

/** [key(会合の月), 初日, 最終日(= 決定の公表日)] */
type Meeting = readonly [key: string, start: string, end: string];

function rows(
  indicatorCode: string,
  time: string,
  timeZone: string,
  source: string,
  meetings: readonly Meeting[],
): OfficialScheduleEntry[] {
  return meetings.map(([key, startDate, endDate]) => ({
    indicatorCode,
    key,
    releaseDate: endDate,
    time,
    timeZone,
    precision: 'DATE_ONLY' as const,
    meeting: { startDate, endDate },
    provisional: false,
    sources: [source],
    checkedAt: CHECKED_AT,
  }));
}

/** 日銀 金融政策決定会合(2日間。決定は2日目)。 */
export const BOJ_MEETINGS: readonly Meeting[] = [
  ['2026-12', '2026-12-17', '2026-12-18'],
  ['2027-01', '2027-01-21', '2027-01-22'],
  ['2027-03', '2027-03-17', '2027-03-18'],
  ['2027-04', '2027-04-27', '2027-04-28'],
  ['2027-06', '2027-06-10', '2027-06-11'],
  ['2027-07', '2027-07-21', '2027-07-22'],
  ['2027-09', '2027-09-21', '2027-09-22'],
  ['2027-10', '2027-10-28', '2027-10-29'],
  ['2027-12', '2027-12-16', '2027-12-17'],
];

/** ECB 金融政策会合(Day 1 - Day 2。決定と記者会見は Day 2)。 */
export const ECB_MEETINGS: readonly Meeting[] = [
  ['2026-12', '2026-12-16', '2026-12-17'],
  ['2027-02', '2027-02-03', '2027-02-04'],
  ['2027-03', '2027-03-17', '2027-03-18'],
  ['2027-04', '2027-04-28', '2027-04-29'],
  ['2027-06', '2027-06-09', '2027-06-10'],
  ['2027-07', '2027-07-21', '2027-07-22'],
  ['2027-09', '2027-09-08', '2027-09-09'],
  ['2027-10', '2027-10-27', '2027-10-28'],
  ['2027-12', '2027-12-15', '2027-12-16'],
];

export const BOJ_DECISION_DATES: readonly string[] = BOJ_MEETINGS.map((m) => m[2]);
export const ECB_DECISION_DATES: readonly string[] = ECB_MEETINGS.map((m) => m[2]);

export const BOJ_ECB_SCHEDULES: readonly OfficialScheduleTable[] = [
  {
    provider: BOJ_MEETING_PROVIDER,
    entries: rows(BOJ_RATE_INDICATOR_CODE, BOJ_ANCHOR_TIME, BOJ_TIME_ZONE, BOJ_MEETING_SCHEDULE_URL, BOJ_MEETINGS),
  },
  {
    provider: ECB_MEETING_PROVIDER,
    entries: rows(ECB_RATE_INDICATOR_CODE, ECB_ANCHOR_TIME, ECB_TIME_ZONE, ECB_MEETING_CALENDAR_URL, ECB_MEETINGS),
  },
];
