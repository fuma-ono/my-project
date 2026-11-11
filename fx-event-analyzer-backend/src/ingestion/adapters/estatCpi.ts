/**
 * 日本の消費者物価指数(全国、総合、前年同月比)を e-Stat の API(3.0)から読む部品 — HQ指示 2026-11-11「JP_CPI: 2025年基準の
 * 正しい統計表IDと取得項目を特定し、appId 登録後すぐ接続できる状態にする」。まだジョブにはつないでいない(appId が無い)。
 *
 * 統計表(2026-11-11 に e-Stat の画面と、本物の API(getMetaInfo・getStatsData)で確認):
 * - statsDataId 0004052037「消費者物価指数(2025年基準)」(政府統計コード 00200573、2025年基準の表はこれ1つ。
 *   https://www.e-stat.go.jp/dbview?sid=0004052037)。2020年基準の 0003427113 は 2026年9月分で更新が止まる見込み(統計局は
 *   2026年10月23日の公表から2025年基準)。
 * - 表章項目: 1 = 指数、2 = 前月比・前年比・前年度比、3 = 前年同月比【%】 → 3 を使う
 * - 地域: 00000 = 全国 / 品目: 0001 = 総合(0161 = 生鮮食品を除く総合。JP_CPI は総合。コアを足すなら別の指標)
 * - 時間軸: 'YYYY00MMMM'(例 2026年10月 = 2026001010)
 * 本物の getMetaInfo では 表章項目 = tab、品目 = cat01(名前は「0001 総合」の形)、地域 = area、時間軸 = time
 * (1970年からの遡及を含む)。getStatsData の 2026年9月分 = 総合 2.1・生鮮食品を除く総合 2.1(統計局の公表と一致)。
 * それでも分類の名前は変わりうるので決め打ちしない: まずメタ情報
 * (getMetaInfo)を読み、上の code と名前の両方が合う分類を探す。合わなければ値を取らない(推測しない)。
 *
 * 利用条件(https://www.e-stat.go.jp/api/agreement/、api-dev/faq、api-info/credit。2026-11-11 確認): 商用利用可、
 * リクエストの回数の制限は現在なし、appId を第三者に渡さない、短時間の大量アクセスは禁止。サービスに「このサービスは、
 * 政府統計総合窓口(e-Stat)のAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません。」を表示する。
 * appId は GitHub Secrets(例 ESTAT_APP_ID)で渡し、ログ・出力には出さない(redactAppId)。
 */

export const ESTAT_API_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';
export const ESTAT_CPI_2025_STATS_DATA_ID = '0004052037';
/** 出典の URL(appId を含まない、e-Stat の表の画面)。 */
export const ESTAT_CPI_DBVIEW_URL = 'https://www.e-stat.go.jp/dbview?sid=0004052037';
export const ESTAT_API_CREDIT =
  'このサービスは、政府統計総合窓口(e-Stat)のAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません。';

/** JP_CPI に使う分類の code と名前(code と名前の両方が合うものだけ使う)。 */
export const JP_CPI_CLASSES = {
  tab: { code: '3', name: '前年同月比' },
  area: { code: '00000', name: '全国' },
  item: { code: '0001', name: '総合' },
} as const;

export interface EstatDimensions {
  /** API の絞り込みの名前(例 cdTab)と code。 */
  tab: { param: string; objId: string; code: string };
  area: { param: string; objId: string; code: string };
  item: { param: string; objId: string; code: string };
  time: { param: string; objId: string };
}

export function metaInfoUrl(appId: string, statsDataId = ESTAT_CPI_2025_STATS_DATA_ID): string {
  return `${ESTAT_API_BASE}/getMetaInfo?appId=${encodeURIComponent(appId)}&statsDataId=${statsDataId}`;
}

/** ログ・エラーに出す前に、URL の appId を伏せる。 */
export function redactAppId(text: string): string {
  return text.replace(/appId=[^&\s"]*/g, 'appId=***');
}

/** 'YYYY-MM' → e-Stat の時間軸の code('YYYY00MMMM')。 */
export function estatMonthCode(period: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m ? `${m[1]}00${m[2]}${m[2]}` : null;
}

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

interface ClassObj {
  '@id'?: string;
  '@name'?: string;
  CLASS?: { '@code'?: string; '@name'?: string } | { '@code'?: string; '@name'?: string }[];
}

/** cat01 → cdCat01、area → cdArea、tab → cdTab、time → cdTime(API 3.0 の絞り込みの名前の付け方)。 */
function paramOf(objId: string): string {
  return `cd${objId.charAt(0).toUpperCase()}${objId.slice(1)}`;
}

/**
 * 分類の名前が合うか。品目は「0001 総合」のように code が前に付いて返る(2026-11-11 に本物の getMetaInfo で確認)ので、
 * 「名前そのもの」か「code + 半角空白 + 名前」のどちらかなら合うとする。
 */
function sameName(actual: string | undefined, want: { code: string; name: string }): boolean {
  const name = (actual ?? '').trim();
  return name === want.name || name === `${want.code} ${want.name}`;
}

/** getMetaInfo の応答 → JP_CPI に使う分類。code と名前の両方が合う分類がちょうど1つでなければ null。 */
export function resolveJpCpiDimensions(meta: unknown): EstatDimensions | null {
  const objs = asArray(
    (meta as { GET_META_INFO?: { METADATA_INF?: { CLASS_INF?: { CLASS_OBJ?: ClassObj | ClassObj[] } } } })
      ?.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ,
  );
  const find = (want: { code: string; name: string }) => {
    const hits = objs.filter(
      (o) =>
        typeof o['@id'] === 'string' &&
        asArray(o.CLASS).some((c) => c['@code'] === want.code && sameName(c['@name'], want)),
    );
    return hits.length === 1 ? hits[0]!['@id']! : null;
  };
  const tab = find(JP_CPI_CLASSES.tab);
  const area = find(JP_CPI_CLASSES.area);
  const item = find(JP_CPI_CLASSES.item);
  const time = objs.find((o) => o['@id'] === 'time')?.['@id'];
  if (!tab || !area || !item || !time || new Set([tab, area, item, time]).size !== 4) return null;
  return {
    tab: { param: paramOf(tab), objId: tab, code: JP_CPI_CLASSES.tab.code },
    area: { param: paramOf(area), objId: area, code: JP_CPI_CLASSES.area.code },
    item: { param: paramOf(item), objId: item, code: JP_CPI_CLASSES.item.code },
    time: { param: paramOf(time), objId: time },
  };
}

/** 対象月(1つ以上)の値だけを絞り込んで読む URL(1回の呼び出し)。月の形が正しくなければ null。 */
export function statsDataUrl(
  appId: string,
  dims: EstatDimensions,
  periods: string | readonly string[],
  statsDataId = ESTAT_CPI_2025_STATS_DATA_ID,
): string | null {
  const list = typeof periods === 'string' ? [periods] : [...periods];
  const times = list.map(estatMonthCode);
  if (times.length === 0 || times.some((t) => t === null)) return null;
  const q = new URLSearchParams({
    appId,
    statsDataId,
    [dims.tab.param]: dims.tab.code,
    [dims.area.param]: dims.area.code,
    [dims.item.param]: dims.item.code,
    [dims.time.param]: times.join(','),
  });
  return `${ESTAT_API_BASE}/getStatsData?${q.toString()}`;
}

/** getStatsData の応答の統計表の更新日('YYYY-MM-DD')。無ければ null。 */
export function tableUpdatedDate(body: unknown): string | null {
  const value = (body as { GET_STATS_DATA?: { STATISTICAL_DATA?: { TABLE_INF?: { UPDATED_DATE?: unknown } } } })
    ?.GET_STATS_DATA?.STATISTICAL_DATA?.TABLE_INF?.UPDATED_DATE;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

interface ValueObj {
  [key: string]: string | undefined;
  $?: string;
}

/**
 * getStatsData の応答 → その月の全国・総合の前年同月比(%)。該当がちょうど1件で数値のときだけ返す。
 * 数値でない値('-'・'***' など、未公表・秘匿)は null(値を作らない)。
 */
export function parseJpCpiYoY(body: unknown, dims: EstatDimensions, period: string): number | null {
  const time = estatMonthCode(period);
  if (!time) return null;
  const status = (body as { GET_STATS_DATA?: { RESULT?: { STATUS?: number | string } } })?.GET_STATS_DATA?.RESULT
    ?.STATUS;
  if (status !== undefined && Number(status) !== 0) return null;
  const values = asArray(
    (body as { GET_STATS_DATA?: { STATISTICAL_DATA?: { DATA_INF?: { VALUE?: ValueObj | ValueObj[] } } } })
      ?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE,
  ).filter(
    (v) =>
      v[`@${dims.tab.objId}`] === dims.tab.code &&
      v[`@${dims.area.objId}`] === dims.area.code &&
      v[`@${dims.item.objId}`] === dims.item.code &&
      v[`@${dims.time.objId}`] === time,
  );
  if (values.length !== 1) return null;
  const raw = values[0]!.$?.trim() ?? '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}
