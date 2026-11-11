/**
 * 要人発言の公式ページの URL と本文(HQ指示 2026-11-10「要人発言本文の取得・保存機能」)。純粋な関数だけ(HTTP・DB は呼ばない)。
 *
 * - FRB: 公式の講演の RSS(https://www.federalreserve.gov/feeds/speeches.xml)の項目の link が講演ページ
 *   (/newsevents/speech/<姓><YYYYMMDD><a|b…>.htm)。取り込み済みの行(frb_calendar)とは、**発言者の姓と、URL の日付
 *   (ニューヨークの日付)の両方が一致し、その組み合わせが1件だけのとき**に結ぶ(同じ日に同じ人が2回話したなど、1件に
 *   決まらないときは結ばない — 推測で結ばない)。
 *   本文は `<div id="article">` の中の、見出し(heading)ではない `col-xs-12 col-sm-8 col-md-8` の列の段落。`<hr>` より後ろは
 *   脚注なので入れない。
 * - ECB: 取り込みの press の RSS の link(/press/key/…)をそのまま URL にする。本文は `<main>` の `div.section` の中の、class の
 *   無い `<p>`(図の注記は `<p class="">`、日付は `<p class="ecb-publicationDate">` なので入らない)。脚注(`div.footnotes`)と
 *   連絡先(`address-box`)より後ろは入れない。
 * 取り出せなければ null(本文を作らない・推測で補わない)。
 */

export type SpeechBodyProvider = 'frb_calendar' | 'ecb_press_rss';

const OFFICIAL_PREFIX: Record<SpeechBodyProvider, string> = {
  frb_calendar: 'https://www.federalreserve.gov/newsevents/speech/',
  ecb_press_rss: 'https://www.ecb.europa.eu/press/key/',
};

/** その取得元の公式の講演ページの URL か(https・決まった場所だけ)。 */
export function isOfficialSpeechUrl(provider: string, url: string | null | undefined): boolean {
  if (!url) return false;
  const prefix = OFFICIAL_PREFIX[provider as SpeechBodyProvider];
  if (!prefix) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && url.startsWith(prefix) && !url.includes('..');
  } catch {
    return false;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  euro: '€',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  eacute: 'é',
  egrave: 'è',
  ccedil: 'ç',
  szlig: 'ß',
};

function decodeHtml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** 段落の HTML → テキスト(脚注の番号 <sup>…</sup> は除く。タグは外す。空白は1つにまとめる)。 */
function paragraphText(html: string): string {
  return decodeHtml(
    html
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 段落の頭の小見出し(FRB は `<p><em>Labor Market Conditions</em><br />本文…</p>`)を、別の段落に分ける
 * (本文の文にくっつかないように)。小見出しの文字は消さない。
 */
function splitLeadingHeading(html: string): string[] {
  const m = /^\s*<(em|strong|b|i)>([^<]{1,120})<\/\1>\s*<br\s*\/?>([\s\S]*)$/i.exec(html);
  return m ? [m[2]!, m[3]!] : [html];
}

function joinParagraphs(paragraphs: string[]): string | null {
  const texts = paragraphs
    .flatMap(splitLeadingHeading)
    .map(paragraphText)
    .filter((text) => text !== '');
  return texts.length > 0 ? texts.join('\n\n') : null;
}

/** FRB の講演ページ → 本文(段落を空行で区切る)。取り出せなければ null。 */
export function extractFrbSpeechBody(html: string): string | null {
  const start = html.indexOf('id="article"');
  if (start < 0) return null;
  const endMark = html.indexOf('id="lastUpdate"', start);
  const article = html.slice(start, endMark > start ? endMark : undefined);
  // 見出し(heading)ではない本文の列。
  const columns = [...article.matchAll(/<div class="col-xs-12 col-sm-8 col-md-8">/g)];
  const column = columns[0];
  if (!column || column.index === undefined) return null;
  let body = article.slice(column.index);
  const nextColumn = body.indexOf('<div class="col-xs-12 col-sm-4', 1);
  if (nextColumn > 0) body = body.slice(0, nextColumn);
  const hr = body.search(/<hr\b/i);
  if (hr > 0) body = body.slice(0, hr); // 脚注より前だけ
  return joinParagraphs([...body.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)].map((m) => m[1]!));
}

/** ECB の講演ページ → 本文(段落を空行で区切る)。取り出せなければ null。 */
export function extractEcbSpeechBody(html: string): string | null {
  const mainStart = html.indexOf('<main');
  if (mainStart < 0) return null;
  const mainEnd = html.indexOf('</main>', mainStart);
  const main = html.slice(mainStart, mainEnd > mainStart ? mainEnd : undefined);
  const sectionStart = main.indexOf('<div class="section"');
  if (sectionStart < 0) return null;
  let section = main.slice(sectionStart);
  const ends = [section.indexOf('<div class="footnotes'), section.indexOf('class="address-box')].filter((i) => i > 0);
  if (ends.length > 0) section = section.slice(0, Math.min(...ends));
  // class の無い <p> だけ(図の注記 <p class=""> や日付 <p class="ecb-publicationDate"> は入らない)。
  return joinParagraphs([...section.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]!));
}

export function extractSpeechBody(provider: string, html: string): string | null {
  if (provider === 'frb_calendar') return extractFrbSpeechBody(html);
  if (provider === 'ecb_press_rss') return extractEcbSpeechBody(html);
  return null;
}

export interface FrbSpeechRssItem {
  url: string;
  /** URL の姓(小文字、例 "waller")。 */
  surname: string;
  /** URL の日付(ニューヨークの日付、YYYY-MM-DD)。 */
  date: string;
}

/** FRB の講演の RSS の項目(link)から、講演ページの URL・姓・日付を読む。形が違うものは入れない。 */
export function frbSpeechRssItems(links: readonly (string | null)[]): FrbSpeechRssItem[] {
  const items: FrbSpeechRssItem[] = [];
  for (const raw of links) {
    const url = raw?.trim();
    if (!url || !isOfficialSpeechUrl('frb_calendar', url)) continue;
    const match = /\/newsevents\/speech\/([a-z]+)(\d{4})(\d{2})(\d{2})[a-z]\.htm$/.exec(url);
    if (!match) continue;
    items.push({ url, surname: match[1]!, date: `${match[2]}-${match[3]}-${match[4]}` });
  }
  return items;
}

/** 発言者の英語名(例 "Christopher J. Waller"、"Michelle W. Bowman")→ URL に使われる姓(小文字・英字だけ)。 */
export function frbSurnameKey(englishName: string): string | null {
  const parts = englishName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .split(/\s+/)
    .filter((part) => !/^(jr\.?|sr\.?|ii|iii)$/i.test(part));
  const last = parts.at(-1);
  if (!last) return null;
  const key = last.toLowerCase().replace(/[^a-z]/g, '');
  return key === '' ? null : key;
}

export interface FrbSpeechRowForMatch {
  id: string;
  /** 発言者の英語名(speakers.name_en など)。 */
  speakerNameEn: string | null;
  /** その発言のニューヨークの日付(YYYY-MM-DD)。 */
  date: string;
}

/**
 * FRB の行 → 講演ページの URL。姓と日付が一致する RSS の項目が**ちょうど1件**で、その項目に一致する行も**ちょうど1件**の
 * ときだけ結ぶ。それ以外(0件・2件以上)は結ばない(Map に入れない)。
 */
export function matchFrbSpeechUrls(
  rows: readonly FrbSpeechRowForMatch[],
  items: readonly FrbSpeechRssItem[],
): Map<string, string> {
  const key = (surname: string, date: string) => `${surname}|${date}`;
  const itemsByKey = new Map<string, FrbSpeechRssItem[]>();
  for (const item of items) {
    const k = key(item.surname, item.date);
    itemsByKey.set(k, [...(itemsByKey.get(k) ?? []), item]);
  }
  const rowsByKey = new Map<string, FrbSpeechRowForMatch[]>();
  for (const row of rows) {
    const surname = row.speakerNameEn ? frbSurnameKey(row.speakerNameEn) : null;
    if (!surname) continue;
    const k = key(surname, row.date);
    rowsByKey.set(k, [...(rowsByKey.get(k) ?? []), row]);
  }
  const matched = new Map<string, string>();
  for (const [k, sameKeyRows] of rowsByKey) {
    const sameKeyItems = itemsByKey.get(k) ?? [];
    if (sameKeyRows.length === 1 && sameKeyItems.length === 1) matched.set(sameKeyRows[0]!.id, sameKeyItems[0]!.url);
  }
  return matched;
}
