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

/** 日時の文字列(オフセット付き ISO 8601)を UTC の ISO に。読めなければ null。日付だけ(YYYY-MM-DD)は読まない(時刻が無い)。 */
export function parseIsoInstant(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  // `2026-11-09T09:30+11:00`(秒なし)は Date.parse が環境によって読めないので、秒を補う。
  const normalized = /T\d{2}:\d{2}(?=[+-]\d{2}:\d{2}|Z|$)/.test(value)
    ? value.replace(/T(\d{2}:\d{2})/, 'T$1:00')
    : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
