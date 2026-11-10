/**
 * HQ指示(2026-11-10「要人発言本文の取得・保存機能」): 本文の取り込みのジョブ。公式ページだけを読み、取れれば FETCHED、
 * 取れなければ FAILED(理由つき)。本文を推測で補わない。発言者・日時・題名は変えない。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FRB_SPEECHES_RSS_URL,
  ingestSpeechBodies,
  type SpeechBodyPatch,
  type SpeechBodyStore,
  type SpeechForBody,
} from '../../src/ingestion/pipelines/speechBodies.js';
import { JobCounters } from '../../src/ingestion/runner.js';

const NOW = new Date('2026-11-10T06:00:00Z');

const frbPage = (text: string) =>
  `<div id="article"><div class="heading col-xs-12 col-sm-8 col-md-8"><p>h</p></div><div class="col-xs-12 col-sm-8 col-md-8"><p>${text}</p><hr/><p>1. footnote</p></div></div><div id="lastUpdate"></div>`;
const ecbPage = (text: string) =>
  `<main><div class="section"><p>${text}</p><div class="footnotes"><p>fn</p></div></div></main>`;
const rss = (...links: string[]) =>
  `<rss><channel>${links.map((l) => `<item><title>t</title><link><![CDATA[${l}]]></link></item>`).join('')}</channel></rss>`;

class FakeStore implements SpeechBodyStore {
  rows: SpeechForBody[] = [];
  updates: { id: string; patch: SpeechBodyPatch }[] = [];
  listSpeechesNeedingBody(providers: readonly string[], sinceIso: string): Promise<SpeechForBody[]> {
    return Promise.resolve(
      this.rows.filter(
        (r) =>
          providers.includes(r.provider) &&
          r.status === 'DELIVERED' &&
          ['PENDING', 'FAILED'].includes(r.body_status) &&
          r.statement_datetime >= sinceIso,
      ),
    );
  }
  updateSpeechBody(id: string, patch: SpeechBodyPatch): Promise<void> {
    this.updates.push({ id, patch });
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, {
      body_status: patch.body_status,
      ...(patch.source_url ? { source_url: patch.source_url } : {}),
    });
    return Promise.resolve();
  }
}

class FakeFetcher {
  pages = new Map<string, string>();
  requested: string[] = [];
  getText(url: string): Promise<string> {
    this.requested.push(url);
    const page = this.pages.get(url);
    return page === undefined ? Promise.reject(new Error(`HTTP 404 for ${url}`)) : Promise.resolve(page);
  }
}

const row = (overrides: Partial<SpeechForBody>): SpeechForBody => ({
  id: 'id',
  provider: 'frb_calendar',
  provider_event_id: 'p',
  title: 't',
  statement_datetime: '2026-11-05T12:30:00Z', // 直近30日の内側(NOW は 11/10)
  status: 'DELIVERED',
  source_url: null,
  body_status: 'PENDING',
  speaker_name: 'クリストファー・ウォラー',
  speaker_organization: 'FRB',
  ...overrides,
});

describe('ingestSpeechBodies', () => {
  let store: FakeStore;
  let frb: FakeFetcher;
  let ecb: FakeFetcher;
  const run = (maxFetches = 20) => {
    const counters = new JobCounters();
    return ingestSpeechBodies(store, { frb, ecb }, { pastDays: 30, maxFetches }, NOW, counters).then(() => counters);
  };
  const patchOf = (id: string) => store.updates.filter((u) => u.id === id).at(-1)?.patch;

  beforeEach(() => {
    store = new FakeStore();
    frb = new FakeFetcher();
    ecb = new FakeFetcher();
  });

  it('FRB: links the speech page from the speeches RSS (surname + New York date) and stores the body', async () => {
    const url = 'https://www.federalreserve.gov/newsevents/speech/waller20261105a.htm';
    store.rows = [row({ id: 'w' })];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss(url));
    frb.pages.set(url, frbPage('Thank you.'));
    const counters = await run();
    expect(patchOf('w')).toEqual({
      source_url: url,
      speech_body: 'Thank you.',
      body_fetched_at: NOW.toISOString(),
      body_status: 'FETCHED',
      body_error: null,
    });
    expect(counters.success).toBe(1);
  });

  it('ECB: uses the stored source_url and stores the body (the speeches RSS of the FRB is not read)', async () => {
    const url = 'https://www.ecb.europa.eu/press/key/date/2026/html/ecb.sp261030~08d9d540f0.en.html';
    store.rows = [row({ id: 'e', provider: 'ecb_press_rss', source_url: url, speaker_organization: 'ECB' })];
    ecb.pages.set(url, ecbPage('My aim today.'));
    await run();
    expect(patchOf('e')).toMatchObject({ body_status: 'FETCHED', speech_body: 'My aim today.' });
    expect(frb.requested).toEqual([]);
  });

  it('no matching speech page → stays PENDING (nothing guessed, nothing written)', async () => {
    store.rows = [row({ id: 'w' })];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss('https://www.federalreserve.gov/newsevents/speech/bowman20261014a.htm'));
    const counters = await run();
    expect(store.updates).toEqual([]);
    expect(counters.skipReasons.NO_SOURCE_URL).toBe(1);
  });

  it('HTTP failure → FAILED with the status code; a page without the body → FAILED NO_BODY_FOUND (no made-up body)', async () => {
    const a = 'https://www.ecb.europa.eu/press/key/a.en.html';
    const b = 'https://www.ecb.europa.eu/press/key/b.en.html';
    store.rows = [
      row({ id: 'a', provider: 'ecb_press_rss', source_url: a }),
      row({ id: 'b', provider: 'ecb_press_rss', source_url: b }),
    ];
    ecb.pages.set(b, '<html><body><p>Page moved</p></body></html>');
    await run();
    expect(patchOf('a')).toEqual({ source_url: a, body_status: 'FAILED', body_error: 'HTTP_404' });
    expect(patchOf('b')).toEqual({ source_url: b, body_status: 'FAILED', body_error: 'NO_BODY_FOUND' });
    expect(store.updates.some((u) => u.patch.speech_body)).toBe(false);
  });

  it('a stored non-official URL is never fetched (FAILED NOT_OFFICIAL_URL)', async () => {
    store.rows = [row({ id: 'x', provider: 'ecb_press_rss', source_url: 'https://example.com/press/key/x.html' })];
    await run();
    expect(ecb.requested).toEqual([]);
    expect(patchOf('x')).toEqual({ body_status: 'FAILED', body_error: 'NOT_OFFICIAL_URL' });
  });

  it('reads at most maxFetches pages per run; the rest keep their URL and stay PENDING for the next run', async () => {
    const urls = [1, 2, 3].map((n) => `https://www.ecb.europa.eu/press/key/${n}.en.html`);
    store.rows = urls.map((url, i) => row({ id: `e${i}`, provider: 'ecb_press_rss', source_url: url }));
    for (const url of urls) ecb.pages.set(url, ecbPage(`body ${url}`));
    const counters = await run(2);
    expect(ecb.requested).toEqual(urls.slice(0, 2));
    expect(counters.skipReasons.RUN_CAP).toBe(1);
    expect(patchOf('e2')).toBeUndefined(); // URL は元からあるので書かない
  });

  it('each body goes to its own speech (no mix-up between rows)', async () => {
    const urls = ['https://www.ecb.europa.eu/press/key/a.en.html', 'https://www.ecb.europa.eu/press/key/b.en.html'];
    store.rows = urls.map((url, i) => row({ id: `r${i}`, provider: 'ecb_press_rss', source_url: url }));
    ecb.pages.set(urls[0]!, ecbPage('Speech A'));
    ecb.pages.set(urls[1]!, ecbPage('Speech B'));
    await run();
    expect(patchOf('r0')?.speech_body).toBe('Speech A');
    expect(patchOf('r1')?.speech_body).toBe('Speech B');
  });

  it('only DELIVERED speeches whose body is missing are candidates (FETCHED / SCHEDULED are not re-read)', async () => {
    store.rows = [
      row({
        id: 'done',
        provider: 'ecb_press_rss',
        source_url: 'https://www.ecb.europa.eu/press/key/d.en.html',
        body_status: 'FETCHED',
      }),
      row({ id: 'later', status: 'SCHEDULED' }),
    ];
    const counters = await run();
    expect(counters.fetched).toBe(0);
    expect(frb.requested).toEqual([]);
    expect(ecb.requested).toEqual([]);
  });
});
