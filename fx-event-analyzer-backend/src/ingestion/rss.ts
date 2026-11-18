/**
 * Minimal RSS 2.0 item reader (title / link / guid / pubDate /
 * description) for the official feeds we consume — no XML dependency.
 * Handles CDATA and the common entities; anything it cannot read is left
 * out rather than guessed.
 */
export interface RssItem {
  title: string;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
  description: string | null;
}

export function decodeXmlText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match ? decodeXmlText(match[1]!) : null;
}

/** Text of the first <name>…</name> in `block` (namespaced names such as `dc:date` allowed), entities decoded; null if absent. */
export function xmlTagText(block: string, name: string): string | null {
  // name は固定の識別子(`title`・`dc:date` など)だけを渡す。正規表現の特殊文字を含む名前は渡さない。
  return tag(block, name);
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1]!;
    const title = tag(block, 'title');
    if (title === null) continue;
    items.push({
      title,
      link: tag(block, 'link'),
      guid: tag(block, 'guid'),
      pubDate: tag(block, 'pubDate'),
      description: tag(block, 'description'),
    });
  }
  return items;
}
