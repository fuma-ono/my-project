/**
 * RSS-CB 1.2(中央銀行向けの RDF 形式の RSS。http://www.cbwiki.net/wiki/index.php/Specification_1.2/)の項目の読み取り。
 * カナダ銀行(BoC)・豪州準備銀行(RBA)の公式の発言の RSS が、この形式で出している(2026-11-18 に確認:
 * BoC は実フィードを取得、RBA は公式ページの内容を確認。RBA の実フィードは取得環境から 403 だった。docs data-sources.md §5)。
 *
 * 読むのは 1 項目あたり: 題名・公式ページの URL・説明・`dc:date`・`cb:occurrenceDate`・発言者(`cb:person` の
 * `cb:nameAsWritten`・`cb:jobTitle`)・種別(`cb:speech`(発言の項目)か、`cb:news`(お知らせ・動画の項目)か)。
 * 読めない項目は落とす(推測で補わない)。XML の依存は使わない(rss.ts と同じ方針)。
 */
import { decodeXmlText, xmlTagText } from './rss.js';

export interface CbRdfItem {
  title: string;
  /** 項目の公式ページの URL(`<link>`。無ければ `rdf:about`)。 */
  link: string;
  description: string | null;
  /** `dc:date`(ISO 8601。BoC は「公開の時刻」の意味で、予定の項目では時刻の表記が実際と異なることがある — BoC アダプタの注記)。 */
  date: string | null;
  /** `cb:occurrenceDate`(RBA は日時、BoC は日付だけ)。 */
  occurrenceDate: string | null;
  /** `cb:speech`(発言の項目)・`cb:news`(その他のお知らせ)・どちらも無ければ null。 */
  cbKind: 'speech' | 'news' | null;
  /** `cb:person` の最初の `cb:nameAsWritten`(無ければ null)。 */
  speakerName: string | null;
  speakerJobTitle: string | null;
  institution: string | null;
  location: string | null;
}

function firstNonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseCbRdfItems(xml: string): CbRdfItem[] {
  const items: CbRdfItem[] = [];
  for (const match of xml.matchAll(/<item(\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const attrs = match[1] ?? '';
    const block = match[2]!;
    const title = firstNonEmpty(xmlTagText(block, 'title'));
    const about = /rdf:about="([^"]+)"/i.exec(attrs)?.[1] ?? null;
    const link = firstNonEmpty(xmlTagText(block, 'link')) ?? (about ? decodeXmlText(about) : null);
    if (!title || !link) continue;
    const cbKind = /<cb:speech[\s>]/i.test(block) ? 'speech' : /<cb:news[\s>]/i.test(block) ? 'news' : null;
    items.push({
      title,
      link,
      description: firstNonEmpty(xmlTagText(block, 'description')),
      date: firstNonEmpty(xmlTagText(block, 'dc:date')),
      occurrenceDate: firstNonEmpty(xmlTagText(block, 'cb:occurrenceDate')),
      cbKind,
      speakerName: firstNonEmpty(xmlTagText(block, 'cb:nameAsWritten')),
      speakerJobTitle: firstNonEmpty(xmlTagText(block, 'cb:jobTitle')),
      institution: firstNonEmpty(xmlTagText(block, 'cb:institutionAbbrev')),
      location: firstNonEmpty(xmlTagText(block, 'cb:locationAsWritten')),
    });
  }
  return items;
}

/**
 * 日時の文字列を UTC の ISO に。**タイムゾーン(Z か ±hh:mm)が無いもの・存在しない日付や時刻は null**(推測で補わない)。
 * 秒は省略できる(`2026-11-09T09:30+11:00`)。日付だけ(YYYY-MM-DD)は時刻が無いので null。
 */
export function parseIsoInstant(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return null; // 2026-02-31 など
  let offsetMs = 0;
  if (m[7] !== 'Z') {
    const sign = m[7]!.startsWith('-') ? -1 : 1;
    const [oh, om] = m[7]!.slice(1).split(':').map(Number) as [number, number];
    if (oh > 23 || om > 59) return null;
    offsetMs = sign * (oh * 60 + om) * 60_000;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export class FeedFormatError extends Error {
  constructor(provider: string, reason: string) {
    super(`${provider}: invalid feed (${reason})`);
    this.name = 'FeedFormatError';
  }
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/**
 * フィードが、RSS-CB(RDF)または RSS の**正当なチャンネルの構造**であることを確かめる(HQ指示 2026-11-18 P2-2)。
 * 失敗(FeedFormatError): 空の本文・HTML(200 でエラーページなど)・ルートが RDF/RSS でない・ルートが閉じていない(途中で切れた)・
 * channel が無い/閉じていない・item や主要な要素の開きと閉じの数が合わない(壊れた XML)・item があるのに RSS-CB の要素が無い(形の変更)。
 * **正常な空のフィード(channel があり item が0件)は許容する**。XML パーサーは使わない(rss.ts と同じ方針)ので、完全な整形式の検証ではなく、
 * 上の構造の検査である。
 */
export function assertValidCbFeed(provider: string, xml: string): void {
  const body = xml.replace(/^\uFEFF/, '').trim();
  if (body === '') throw new FeedFormatError(provider, 'empty body');
  const head = body.replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (/^<!doctype\s+html|^<html[\s>]/i.test(head)) throw new FeedFormatError(provider, 'HTML page, not a feed');
  const root = /^<(rdf:RDF|rss)[\s>]/i.exec(head)?.[1]?.toLowerCase();
  if (!root) throw new FeedFormatError(provider, 'root element is not rdf:RDF or rss');
  if (!new RegExp(`</${root}>\\s*$`, 'i').test(head))
    throw new FeedFormatError(provider, 'root element is not closed (truncated?)');
  const hasChannelOpen = /<channel[\s>/]/i.test(head);
  if (!hasChannelOpen) throw new FeedFormatError(provider, 'no channel');
  const selfClosedChannel = /<channel(\s[^>]*)?\/>/i.test(head);
  if (!selfClosedChannel && !/<\/channel>/i.test(head)) throw new FeedFormatError(provider, 'channel is not closed');
  for (const tag of ['item', 'title', 'link', 'cb:speech', 'cb:news', 'cb:person']) {
    const opens = count(head, new RegExp(`<${tag}(?=[\\s>])`, 'gi'));
    const closes = count(head, new RegExp(`</${tag}>`, 'gi'));
    if (opens !== closes) throw new FeedFormatError(provider, `unbalanced <${tag}> (${opens} open / ${closes} close)`);
  }
  if (count(head, /<item[\s>]/gi) > 0 && !/<cb:/i.test(head)) {
    throw new FeedFormatError(provider, 'items found but the RSS-CB elements are missing (feed format changed?)');
  }
}
