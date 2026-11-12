/**
 * ECB press feed — ④ (delivered speeches / interviews).
 * https://www.ecb.europa.eu/rss/press.html — "Press releases, speeches,
 * interviews, press conference transcripts". Speech items link to
 * /press/key/…, interviews to /press/inter/…; the title is
 * "Speaker Name: Topic".
 *
 * pubDate is when the TEXT was published, not when the speech started
 * (recorded example: an Elderson speech published "02:00:00 +0200"), so
 * items are PUBLICATION_TIME and the speech pipeline skips them by default.
 * Exact upcoming times are only on the HTML "Weekly schedule of public
 * speaking engagements" page — next step (data-sources.md §5).
 *
 * Terms: free use with accurate reproduction and the ECB cited as source;
 * when incorporated in something sold, buyers must be told the
 * information is available free of charge on the ECB site; modifications
 * must be stated (data-sources.md §2).
 */
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import type { SpeechScheduleProvider } from '../providers.js';
import { parseRssItems } from '../rss.js';
import type { NormalizedSpeech } from '../types.js';

export const ECB_PRESS_RSS_URL = 'https://www.ecb.europa.eu/rss/press.html';
export const ECB_PROVIDER = 'ecb_press_rss';

export function parseEcbPressRss(xml: string): NormalizedSpeech[] {
  const speeches: NormalizedSpeech[] = [];
  for (const item of parseRssItems(xml)) {
    const link = item.link ?? item.guid;
    if (!link) continue;
    const isSpeech = link.includes('/press/key/');
    const isInterview = link.includes('/press/inter/');
    if (!isSpeech && !isInterview) continue;
    const split = /^([^:]+):\s*(.+)$/.exec(item.title.trim());
    if (!split) continue;
    const publishedMs = item.pubDate ? Date.parse(item.pubDate) : Number.NaN;
    if (!Number.isFinite(publishedMs)) continue;
    const id = /\/([^/]+)\.en\.html$/.exec(link)?.[1] ?? link;
    speeches.push({
      provider: ECB_PROVIDER,
      providerEventId: id,
      speakerName: split[1]!.trim(),
      organization: 'ECB',
      kind: isSpeech ? 'SPEECH' : 'INTERVIEW',
      topic: split[2]!.trim(),
      startsAt: new Date(publishedMs).toISOString(),
      timePrecision: 'PUBLICATION_TIME',
      url: link.replace('europa.eu//', 'europa.eu/'),
    });
  }
  return speeches;
}

export class EcbPressAdapter implements SpeechScheduleProvider {
  readonly name = ECB_PROVIDER;
  private readonly http: HttpClient;

  constructor(deps: HttpClientDeps = {}) {
    this.http = new HttpClient('ecb', PROVIDER_HTTP_SETTINGS.ecb, deps);
  }

  async fetchSpeeches(): Promise<NormalizedSpeech[]> {
    return parseEcbPressRss(await this.http.getText(ECB_PRESS_RSS_URL));
  }
}
