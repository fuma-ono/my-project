/**
 * 豪州準備銀行(RBA)の発言の RSS — ④(講演)。
 * 公式の RSS: https://www.rba.gov.au/rss/rss-cb-speeches.xml(「Reserve Bank of Australia | Speeches」。RSS-CB 1.2 の RDF 形式)。
 * ページ: https://www.rba.gov.au/rss/
 *
 * 利用条件(確認済み。https://www.rba.gov.au/copyright/ — 2026-11-18): 多くの内容は Creative Commons Attribution 4.0 International
 * で、RBA を出典として示せば、複製・公開・送信・翻案ができる。出典の書式は「Source: Reserve Bank of Australia [年]」または
 * 「Source: RBA [年]」。RBA が推奨していると示唆してはならない。氏名のある講演は、RBA を完全な参照に含めれば、発言者を示してよい。
 * 商用利用: Cash Rate・金融データは、RBA の推奨を示唆しなければ可。「不適切な商用の利用(欺く・出所を偽る・RBA が無料で公開して
 * いることを客に伝えずに課金する)」は禁止。ロゴ・紙幣の画像・動画や音声等のマルチメディア・サイトのスクリプト等は対象外
 * (再利用しない)。第三者の内容(ABS のデータなど)は、その権利者の同意が要る。
 *
 * **RBA の公式の案内(https://www.rba.gov.au/qa/rss.html)**: RSS は WAF で保護され、自動の取得は拒否されうる。問題は rbainfo@rba.gov.au へ。
 * 代わりの公式の配信経路は、メール・SMS の通知(/updates/email-and-sms-service.html)と SNS で、機械が読める API ではない。
 * **未確認(ブロッカー)**: この環境から実フィードへの GET が 403(Access Denied。配信元のボット対策)で、実際の XML は取得できて
 * いない。形式は公式ページの内容の確認に基づく(`cb:speech`・`cb:person`・`cb:occurrenceDate`・`cb:institutionAbbrev`)。GitHub Actions の
 * 実行環境から取得できるかは未確認。**ブラウザを装う等の回避はしない**(アクセスの可否・条件は RBA に問い合わせる案を HQ に提示)。
 *
 * 時刻(HQ指示 2026-11-18 P2-1。RBA にも BoC と同じ問題がないか確認した結果): `cb:occurrenceDate`(例 2026-11-09T09:30+11:00)・`dc:date` は、
 * **オフセットが明示されている**ので BoC のようなタイムゾーンの推測は要らない。ただし、講演の開始時刻か公開の時刻かは公式の記載で
 * 確認できていない。そのため PUBLICATION_TIME とし(反応の計算の起点にしない)、**その時刻がすでに過去のときだけ「行われた」**
 * (`deliveryEvidence: EVENT_TIME_PASSED`)とする。未来の時刻の項目は取り込まない(予定時刻として画面に出さない)。
 */
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import type { SpeechScheduleProvider } from '../providers.js';
import { withAccessDeniedMapping } from '../sourceAccess.js';
import { assertValidCbFeed, parseCbRdfItems, parseIsoInstant } from '../rssCb.js';
import type { NormalizedSpeech } from '../types.js';

export const RBA_SPEECHES_RSS_URL = 'https://www.rba.gov.au/rss/rss-cb-speeches.xml';
export const RBA_PROVIDER = 'rba_speeches_rss';
/** speakers.organization の表記は、話者の行を作る migration(HQ の承認待ち)で確定する。確定までは DB に行が無いので取り込みは行われない。 */
export const RBA_ORGANIZATION = 'RBA';

/** `https://www.rba.gov.au/speeches/2026/sp-sp-ag-2026-11-09.html` → `sp-sp-ag-2026-11-09`。 */
export function rbaEventId(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'www.rba.gov.au' || !url.pathname.startsWith('/speeches/'))
      return null;
    const base = url.pathname
      .split('/')
      .pop()
      ?.replace(/\.html?$/i, '');
    return base ? base : null;
  } catch {
    return null;
  }
}

export function parseRbaSpeechesFeed(xml: string, now: Date = new Date()): NormalizedSpeech[] {
  const speeches: NormalizedSpeech[] = [];
  for (const item of parseCbRdfItems(xml)) {
    const id = rbaEventId(item.link);
    const startsAt = parseIsoInstant(item.occurrenceDate) ?? parseIsoInstant(item.date);
    if (!id || !startsAt || !item.speakerName) continue;
    speeches.push({
      provider: RBA_PROVIDER,
      providerEventId: id,
      speakerName: item.speakerName,
      organization: RBA_ORGANIZATION,
      kind: 'SPEECH',
      topic: item.title,
      startsAt,
      timePrecision: 'PUBLICATION_TIME',
      url: item.link,
      ...(Date.parse(startsAt) <= now.getTime() ? { deliveryEvidence: 'EVENT_TIME_PASSED' as const } : {}),
    });
  }
  return speeches;
}

export class RbaSpeechesAdapter implements SpeechScheduleProvider {
  readonly name = RBA_PROVIDER;
  private readonly http: HttpClient;
  private readonly clock: () => number;

  constructor(deps: HttpClientDeps = {}) {
    this.http = new HttpClient('rba', PROVIDER_HTTP_SETTINGS.rba, deps);
    this.clock = deps.now ?? Date.now;
  }

  async fetchSpeeches(): Promise<NormalizedSpeech[]> {
    const xml = await withAccessDeniedMapping(RBA_PROVIDER, () => this.http.getText(RBA_SPEECHES_RSS_URL));
    assertValidCbFeed(RBA_PROVIDER, xml);
    return parseRbaSpeechesFeed(xml, new Date(this.clock()));
  }
}
