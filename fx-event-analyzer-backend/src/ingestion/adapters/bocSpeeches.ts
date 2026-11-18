/**
 * カナダ銀行(BoC)の発言の RSS — ④(発言・議会の冒頭陳述・記者会見)。
 * 公式の RSS: https://www.bankofcanada.ca/content_type/speeches/feed/(「Speeches and appearances」。RSS-CB 1.2 の RDF 形式)。
 * ページ: https://www.bankofcanada.ca/rss-feeds/
 *
 * 利用条件(確認済み。https://www.bankofcanada.ca/terms/ — 2026-11-18): サイトの内容は自由に使用・複製・配布・送信できる。
 * 条件: ① カナダ銀行を出典として示し、変更したことを示す ② 再現する内容の正確さに注意する ③ 有料のサービスで提供する場合は、
 * 買い手に、内容が同サイトで無料で入手できることを事前に伝える ④ ロゴ・紙幣の画像・第三者の内容は別(再利用しない)
 * ⑤ Valet API 等のリクエストの制限・頻度の制限を回避しない・サイトに過大な負荷をかけない。
 * RSS・発言について個別の定めはなく、上の一般の許可の範囲(項目ごとに、第三者の内容の記載がないか確認が要る)。
 *
 * 時刻: `dc:date` は「公開の時刻」。**予定の項目では、説明に書かれた現地の時刻(例 "12:45 (ET) approx.")が、`dc:date` では
 * UTC の表記のままの数字(12:45+00:00)になっていることがある**(2026-11-18 の実フィードの1件で確認)。発言の開始時刻としては
 * 使えないので、すべて PUBLICATION_TIME(発言の開始時刻とは扱わず、反応の計算の起点にしない。ECB の RSS と同じ扱い)。
 *
 * 発言者: `cb:person` の名前(発言の項目)、無ければ説明の「<役職> <名前>」の形から読む。読めない項目(外部の講演者など
 * 当行の役職者でない人の項目)は取り込まない(出典・発言者を確認できない発言は登録しない)。
 */
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import type { SpeechScheduleProvider } from '../providers.js';
import { parseCbRdfItems, parseIsoInstant, type CbRdfItem } from '../rssCb.js';
import type { NormalizedSpeech, SpeechKind } from '../types.js';

export const BOC_SPEECHES_RSS_URL = 'https://www.bankofcanada.ca/content_type/speeches/feed/';
export const BOC_PROVIDER = 'boc_speeches_rss';
/** speakers.organization の表記は、話者の行を作る migration(HQ の承認待ち)で確定する。確定までは DB に行が無いので取り込みは行われない。 */
export const BOC_ORGANIZATION = 'BoC';

const ROLE_NAME =
  /\b(?:Senior Deputy Governor|Deputy Governor|Governor)\s+((?:[A-Z][\p{L}'’.-]*)(?:\s+[A-Z][\p{L}'’.-]*){1,3})/u;

/** 説明の「Deputy Governor Toni Gravelle speaks …」から発言者の名前だけを読む(役職は付けない)。 */
export function speakerFromDescription(description: string | null): string | null {
  if (!description) return null;
  return ROLE_NAME.exec(description)?.[1]?.trim() ?? null;
}

function kindOf(item: CbRdfItem): SpeechKind {
  if (/press conference/i.test(item.title)) return 'PRESS_CONFERENCE';
  if (/(opening statement|appearance before|testimony)/i.test(item.title) && /committee/i.test(item.title))
    return 'TESTIMONY';
  if (item.cbKind === 'speech' || /^speech\b/i.test(item.title)) return 'SPEECH';
  return 'OTHER';
}

/** `https://www.bankofcanada.ca/<path>/` の path を、重複しない固定の ID にする(同じ公式ページは同じ ID)。 */
export function bocEventId(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'www.bankofcanada.ca') return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    return path ? path : null;
  } catch {
    return null;
  }
}

export function parseBocSpeechesFeed(xml: string): NormalizedSpeech[] {
  const speeches: NormalizedSpeech[] = [];
  for (const item of parseCbRdfItems(xml)) {
    const id = bocEventId(item.link);
    const startsAt = parseIsoInstant(item.date);
    const speakerName = item.speakerName ?? speakerFromDescription(item.description);
    if (!id || !startsAt || !speakerName) continue;
    speeches.push({
      provider: BOC_PROVIDER,
      providerEventId: id,
      speakerName,
      organization: BOC_ORGANIZATION,
      kind: kindOf(item),
      topic: item.title,
      startsAt,
      timePrecision: 'PUBLICATION_TIME',
      url: item.link,
    });
  }
  return speeches;
}

export class BocSpeechesAdapter implements SpeechScheduleProvider {
  readonly name = BOC_PROVIDER;
  private readonly http: HttpClient;

  constructor(deps: HttpClientDeps = {}) {
    this.http = new HttpClient('boc', PROVIDER_HTTP_SETTINGS.boc, deps);
  }

  async fetchSpeeches(): Promise<NormalizedSpeech[]> {
    const xml = await this.http.getText(BOC_SPEECHES_RSS_URL);
    // 形が変わって何も読めなくなったときに、静かに0件にしない(項目の `<item` はあるのに1件も読めない)。
    const speeches = parseBocSpeechesFeed(xml);
    if (speeches.length === 0 && /<item[\s>]/i.test(xml) && !/<cb:/i.test(xml)) {
      throw new Error('BoC speeches feed: items found but the RSS-CB elements are missing (feed format changed?)');
    }
    return speeches;
  }
}
