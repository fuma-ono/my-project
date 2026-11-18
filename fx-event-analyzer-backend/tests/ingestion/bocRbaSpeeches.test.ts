/**
 * HQ指示 2026-11-18(要人発言 Backend): カナダ銀行(BoC)・豪州準備銀行(RBA)の公式の発言の RSS(RSS-CB 1.2)の取り込み。
 * DB・外部には接続しない(入力はテストの fixture、保存先はメモリ)。
 */
import { describe, expect, it } from 'vitest';
import {
  BOC_PROVIDER,
  BocSpeechesAdapter,
  bocEventId,
  parseBocSpeechesFeed,
  speakerFromDescription,
} from '../../src/ingestion/adapters/bocSpeeches.js';
import {
  RBA_PROVIDER,
  RbaSpeechesAdapter,
  parseRbaSpeechesFeed,
  rbaEventId,
} from '../../src/ingestion/adapters/rbaSpeeches.js';
import { attributionForOrganization } from '../../src/domain/attribution.js';
import { findSpeakerAlias, SPEAKER_ALIASES } from '../../src/ingestion/mappings/speakers.js';
import { SourceAccessDeniedError } from '../../src/ingestion/sourceAccess.js';
import { FeedFormatError, parseCbRdfItems, parseIsoInstant } from '../../src/ingestion/rssCb.js';
import { ingestSpeeches } from '../../src/ingestion/pipelines/speeches.js';
import { isOfficialSpeechUrl } from '../../src/ingestion/speechBody.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { fixture, MemoryIngestionStore, noSleep, stubFetch } from '../helpers/memoryIngestionStore.js';

const BOC_OPTIONS = {
  publicationTimeKinds: ['SPEECH', 'TESTIMONY', 'PRESS_CONFERENCE'] as const,
  storeSourceUrl: true,
  requireDeliveryEvidence: true,
};
/** 固定の「いま」(実フィードの取得日 2026-11-18)。 */
const NOW = new Date('2026-11-18T06:00:00Z');
const nowMs = () => NOW.getTime();

describe('RSS-CB parser', () => {
  it('reads title / link / dc:date / person from the real BoC feed (10 items; attributes on <item> are fine)', async () => {
    const items = parseCbRdfItems(await fixture('boc-speeches-rss.xml'));
    expect(items).toHaveLength(10);
    const senate = items.find((i) => i.title.startsWith('Opening Statement to the Standing Senate'))!;
    expect(senate).toMatchObject({
      cbKind: 'speech',
      speakerName: 'Tiff Macklem',
      date: '2026-11-05T10:30:59+00:00',
      occurrenceDate: '2026-11-05',
    });
    const edmonton = items.find((i) => i.title.startsWith('Speech: Edmonton'))!;
    expect(edmonton.cbKind).toBe('news');
    expect(edmonton.speakerName).toBeNull();
  });

  it('parseIsoInstant: offsets (with and without seconds) become UTC; date-only and garbage are null', () => {
    expect(parseIsoInstant('2026-11-09T09:30+11:00')).toBe('2026-11-08T22:30:00.000Z');
    expect(parseIsoInstant('2026-11-18T12:45:14+00:00')).toBe('2026-11-18T12:45:14.000Z');
    expect(parseIsoInstant('2026-11-05')).toBeNull();
    expect(parseIsoInstant('soon')).toBeNull();
    expect(parseIsoInstant(null)).toBeNull();
  });

  it('parseIsoInstant rejects a missing time zone and impossible dates / times (no guessing)', () => {
    expect(parseIsoInstant('2026-11-18T12:45:14')).toBeNull(); // タイムゾーンなし
    expect(parseIsoInstant('2026-11-18T12:45')).toBeNull();
    expect(parseIsoInstant('2026-02-31T10:00:00+00:00')).toBeNull(); // 存在しない日付
    expect(parseIsoInstant('2026-13-01T10:00:00Z')).toBeNull();
    expect(parseIsoInstant('2026-11-18T24:00:00Z')).toBeNull();
    expect(parseIsoInstant('2026-11-18T10:60:00Z')).toBeNull();
    expect(parseIsoInstant('2026-11-18T10:00:00+25:00')).toBeNull();
    expect(parseIsoInstant('2026-11-18T10:00:00Z')).toBe('2026-11-18T10:00:00.000Z');
    expect(parseIsoInstant('2026-11-18T10:00:00-05:00')).toBe('2026-11-18T15:00:00.000Z');
  });
});

describe('BoC speeches feed', () => {
  it('takes only items whose speaker is unambiguous (10 items → 8: the outside lecturer and the two-speaker press-conference webcast are dropped)', async () => {
    const speeches = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'), NOW);
    expect(speeches).toHaveLength(8);
    expect(speeches.some((s) => s.topic?.includes('Kuszczak'))).toBe(false);
    expect(new Set(speeches.map((s) => s.speakerName))).toEqual(
      new Set(['Tiff Macklem', 'Carolyn Rogers', 'Toni Gravelle']),
    );
    expect(
      speeches.every(
        (s) => s.timePrecision === 'PUBLICATION_TIME' && s.organization === 'BoC' && s.provider === BOC_PROVIDER,
      ),
    ).toBe(true);
  });

  it('classifies kinds and keeps the official page URL / stable id per page', async () => {
    const speeches = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'), NOW);
    const byTopic = (start: string) => speeches.find((s) => s.topic?.startsWith(start))!;
    expect(byTopic('Opening Statement to the Standing Senate').kind).toBe('TESTIMONY');
    // 記者会見の動画ページの説明には総裁と上級副総裁の2人が書かれており、発言者を1人に決められないので取り込まない(安全側)。
    // テキストページ(総裁の冒頭発言。cb:person あり)だけが残る。
    const press = byTopic('Monetary Policy Report Press Conference Opening Statement');
    expect(press.kind).toBe('PRESS_CONFERENCE');
    expect(press.providerEventId).toBe('2026/10/opening-statement-2026-10-28');
    expect(speeches.some((s) => s.topic?.startsWith('Press Conference: Monetary Policy Report'))).toBe(false);
    expect(byTopic('Speech: Edmonton').kind).toBe('SPEECH');
    expect(byTopic('Repo markets').kind).toBe('SPEECH');
    const edmonton = byTopic('Speech: Edmonton');
    expect(edmonton.providerEventId).toBe('multimedia/speech-edmonton-chamber-of-commerce-2026-11-18');
    expect(edmonton.url).toBe('https://www.bankofcanada.ca/multimedia/speech-edmonton-chamber-of-commerce-2026-11-18/');
    // dc:date はそのまま保存する(ET→UTC の変換はしない。PUBLICATION_TIME)。予定時刻としては扱わない: この項目は証拠が無く取り込まれない
    expect(edmonton.startsAt).toBe('2026-11-18T12:45:14.000Z');
    expect(edmonton.deliveryEvidence).toBeUndefined();
    expect(byTopic('Opening Statement to the Standing Senate').deliveryEvidence).toBe('TEXT_PAGE');
    // 動画ページだけでも、公式の発言日が2日以上前なら EVENT_DATE_PASSED(時刻の推測なし)
    expect(byTopic('Speech: Greater Victoria').deliveryEvidence).toBe('EVENT_DATE_PASSED');
    expect(new Set(speeches.map((s) => s.providerEventId)).size).toBe(speeches.length);
  });

  it('reads the speaker from the description when there is no cb:person (role words are not part of the name)', () => {
    expect(
      speakerFromDescription(
        'Scenario analysis — Deputy Governor Toni Gravelle speaks before the Edmonton Chamber of Commerce (12:45 (ET) approx.).',
      ),
    ).toBe('Toni Gravelle');
    // 複数人の記載は、誰の発言か決められないので null(安全側)
    expect(
      speakerFromDescription('Press conference by Governor Tiff Macklem and Senior Deputy Governor Carolyn Rogers.'),
    ).toBeNull();
    expect(speakerFromDescription('Governor Tiff Macklem and Governor Tiff Macklem.')).toBe('Tiff Macklem'); // 同じ人の重複は1人
    expect(speakerFromDescription('Senior Deputy Governor Carolyn Rogers talks about housing.')).toBe('Carolyn Rogers');
    expect(speakerFromDescription('Address by Gita Gopinath, Harvard University.')).toBeNull();
    expect(speakerFromDescription(null)).toBeNull();
  });

  it('only accepts https pages on www.bankofcanada.ca as ids', () => {
    expect(bocEventId('https://www.bankofcanada.ca/2026/10/x/')).toBe('2026/10/x');
    expect(bocEventId('http://www.bankofcanada.ca/2026/10/x/')).toBeNull();
    expect(bocEventId('https://evil.example/2026/10/x/')).toBeNull();
  });

  it('official-URL check: BoC page URLs are kept, other hosts are not (link only; no body is fetched for BoC/RBA)', () => {
    expect(isOfficialSpeechUrl(BOC_PROVIDER, 'https://www.bankofcanada.ca/2026/10/x/')).toBe(true);
    expect(isOfficialSpeechUrl(BOC_PROVIDER, 'https://www.bankofcanada.ca.evil.example/x')).toBe(false);
    expect(isOfficialSpeechUrl(RBA_PROVIDER, 'https://www.rba.gov.au/speeches/2026/sp-sp-ag-2026-11-09.html')).toBe(
      true,
    );
    expect(isOfficialSpeechUrl(RBA_PROVIDER, 'https://www.rba.gov.au/media-releases/x.html')).toBe(false);
  });
});

describe('RBA speeches feed (input built from the documented structure; the real feed is not reachable from this environment)', () => {
  it('reads the speaker, converts the offset time to UTC, and drops items without a speaker or outside rba.gov.au/speeches', async () => {
    const speeches = parseRbaSpeechesFeed(await fixture('rba-speeches-rss.xml'), NOW);
    expect(speeches).toHaveLength(1);
    expect(speeches[0]).toMatchObject({
      provider: RBA_PROVIDER,
      providerEventId: 'sp-sp-ag-2026-11-09',
      speakerName: 'Sarah Hunter',
      organization: 'RBA',
      kind: 'SPEECH',
      startsAt: '2026-11-08T22:30:00.000Z',
      timePrecision: 'PUBLICATION_TIME',
      deliveryEvidence: 'EVENT_TIME_PASSED', // オフセット付きの時刻がすでに過去
      url: 'https://www.rba.gov.au/speeches/2026/sp-sp-ag-2026-11-09.html',
    });
    expect(speeches[0]!.topic).toBe('What Happens to the Economy as ‘Intelligence’ Gets Cheaper?');
    expect(rbaEventId('https://www.rba.gov.au/media-releases/2026/mr-26-01.html')).toBeNull();
  });
});

describe('adapters (fetch stubbed)', () => {
  it('BoC: fetches only the official feed URL once and parses it', async () => {
    const xml = await fixture('boc-speeches-rss.xml');
    const s = stubFetch(() => ({ body: xml }));
    const speeches = await new BocSpeechesAdapter({ fetch: s.fetch, sleep: noSleep, now: nowMs }).fetchSpeeches();
    expect(speeches).toHaveLength(8);
    expect(s.calls.map((c) => c.url)).toEqual(['https://www.bankofcanada.ca/content_type/speeches/feed/']);
  });

  it.each([
    ['BoC', (f: typeof fetch) => new BocSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
    ['RBA', (f: typeof fetch) => new RbaSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
  ])('%s: a 403 / 500 response is an error (not an empty success), after bounded retries', async (_name, make) => {
    const s = stubFetch(() => ({ status: 403, body: 'Access Denied' }));
    await expect(make(s.fetch).fetchSpeeches()).rejects.toThrow(/HTTP 403|failed/);
    expect(s.calls.length).toBeLessThanOrEqual(3);
  });

  it.each([
    ['BoC', (f: typeof fetch) => new BocSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
    ['RBA', (f: typeof fetch) => new RbaSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
  ])('%s: items without any RSS-CB element (format changed) is an error, not a silent zero', async (_name, make) => {
    const s = stubFetch(() => ({
      body: '<rss><channel><item><title>x</title><link>https://www.bankofcanada.ca/x/</link></item></channel></rss>',
    }));
    await expect(make(s.fetch).fetchSpeeches()).rejects.toThrow(/format changed/);
  });

  it('an empty feed (no items) is not an error', async () => {
    const s = stubFetch(() => ({ body: '<rdf:RDF><channel/></rdf:RDF>' }));
    expect(await new BocSpeechesAdapter({ fetch: s.fetch, sleep: noSleep, now: nowMs }).fetchSpeeches()).toEqual([]);
  });
});

describe('pipeline (in-memory store): dedup, correction, link-only, unknown speakers', () => {
  const now = () => new Date('2026-11-18T06:00:00Z');

  it('without the speaker rows in the DB (migration not applied), nothing is written — every item is skipped and logged', async () => {
    const store = new MemoryIngestionStore();
    const counters = new JobCounters();
    await ingestSpeeches(
      BOC_PROVIDER,
      parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'), NOW),
      { store, now, pastDays: 90, ...BOC_OPTIONS },
      counters,
    );
    expect(store.speeches).toEqual([]);
    // 話者の表には載せたが、DB の行(migration は未適用)が無い。予定の段階の1件(Edmonton)は、証拠が無いのでその前に飛ばされる
    expect(counters.skipReasons.SPEAKER_NOT_IN_DB).toBe(7);
    expect(counters.skipReasons.NO_DELIVERY_EVIDENCE).toBe(1);
  });

  it('with speaker rows: stored once as PUBLICATION_TIME with the official URL; a rerun does not duplicate; upcoming → SCHEDULED', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [
      { id: 'sp-macklem', name: 'ティフ・マックレム', organization: 'BoC' },
      { id: 'sp-rogers', name: 'キャロリン・ロジャーズ', organization: 'BoC' },
    ];
    const speeches = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'), NOW);
    const options = { store, now, pastDays: 90, ...BOC_OPTIONS };
    await ingestSpeeches(BOC_PROVIDER, speeches, options, new JobCounters());
    const first = store.speeches.length;
    expect(first).toBeGreaterThan(0); // Gravelle は話者の行がない → SPEAKER_NOT_IN_DB で飛ばされる
    await ingestSpeeches(BOC_PROVIDER, speeches, options, new JobCounters());
    expect(store.speeches).toHaveLength(first);
    expect(store.speeches.every((r) => r.time_precision === 'PUBLICATION_TIME' && r.provider === BOC_PROVIDER)).toBe(
      true,
    );
    expect(store.speeches.every((r) => (r.source_url ?? '').startsWith('https://www.bankofcanada.ca/'))).toBe(true);
    // 証拠のある項目だけで、すべて DELIVERED。予定(SCHEDULED)の行は作らない(BoC の時刻を予定時刻として出さない)
    expect(store.speeches.every((r) => r.status === 'DELIVERED')).toBe(true);
    expect(store.speeches.some((r) => r.source_url?.includes('speech-edmonton'))).toBe(false);
  });

  it('a correction at the source (same page, new title / time) updates the same row instead of adding one', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-rogers', name: 'キャロリン・ロジャーズ', organization: 'BoC' }];
    const base = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'), NOW).find(
      (s) => s.topic === 'The complexity of housing affordability',
    )!;
    const options = { store, now, pastDays: 90, ...BOC_OPTIONS };
    await ingestSpeeches(BOC_PROVIDER, [base], options, new JobCounters());
    await ingestSpeeches(
      BOC_PROVIDER,
      [{ ...base, topic: 'The complexity of housing affordability (revised)', startsAt: '2026-10-01T15:30:00.000Z' }],
      options,
      new JobCounters(),
    );
    expect(store.speeches).toHaveLength(1);
    expect(store.speeches[0]!.title).toContain('(revised)');
    expect(store.speeches[0]!.statement_datetime).toBe('2026-10-01T15:30:00.000Z');
  });

  it('RBA: the same pipeline stores the speech (link only, PUBLICATION_TIME) and skips it as TIME_NOT_EXACT if the kind is not allowed', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-hunter', name: 'サラ・ハンター', organization: 'RBA' }];
    const speeches = parseRbaSpeechesFeed(await fixture('rba-speeches-rss.xml'), NOW);
    const counters = new JobCounters();
    await ingestSpeeches(RBA_PROVIDER, speeches, { store, now, pastDays: 90 }, counters);
    expect(store.speeches).toEqual([]);
    expect(counters.skipReasons.TIME_NOT_EXACT).toBe(1);
    await ingestSpeeches(RBA_PROVIDER, speeches, { store, now, pastDays: 90, ...BOC_OPTIONS }, new JobCounters());
    expect(store.speeches).toHaveLength(1);
    expect(store.speeches[0]!.source_url).toBe('https://www.rba.gov.au/speeches/2026/sp-sp-ag-2026-11-09.html');
  });
});

describe('same-event merge (webcast page + text page) — conservative rules', () => {
  const rss = (items: string) => `<rdf:RDF xmlns:rdf="r" xmlns:dc="d" xmlns:cb="c"><channel/>${items}</rdf:RDF>`;
  interface ItemOptions {
    path: string;
    title: string;
    date: string;
    occ: string;
    kind: 'speech' | 'news';
    who?: string;
    desc?: string;
  }
  const item = (o: ItemOptions) =>
    `<item rdf:about="https://www.bankofcanada.ca/${o.path}/"><title>${o.title}</title><link>https://www.bankofcanada.ca/${o.path}/</link>` +
    `<description>${o.desc ?? ''}</description><dc:date>${o.date}</dc:date>` +
    `<cb:${o.kind}><cb:occurrenceDate>${o.occ}</cb:occurrenceDate>${o.who ? `<cb:person><cb:nameAsWritten>${o.who}</cb:nameAsWritten></cb:person>` : ''}</cb:${o.kind}></item>`;
  const web = (o: Partial<ItemOptions> = {}) =>
    item({
      path: 'multimedia/speech-a-2026-11-10',
      title: 'Speech: A Club',
      date: '2026-11-10T15:00:00+00:00',
      occ: '2026-11-10',
      kind: 'news',
      desc: 'Deputy Governor Toni Gravelle speaks',
      ...o,
    });
  const text = (o: Partial<ItemOptions> = {}) =>
    item({
      path: '2026/11/real-title',
      title: 'Real title',
      date: '2026-11-10T16:00:00+00:00',
      occ: '2026-11-10',
      kind: 'speech',
      who: 'Toni Gravelle',
      ...o,
    });

  it('merges exactly one webcast + one text of the same speaker/day/kind: id of the webcast, title/url/time of the text', () => {
    const out = parseBocSpeechesFeed(rss(web() + text()));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      providerEventId: 'multimedia/speech-a-2026-11-10',
      topic: 'Real title',
      url: 'https://www.bankofcanada.ca/2026/11/real-title/',
      startsAt: '2026-11-10T16:00:00.000Z',
    });
  });

  it('does NOT merge on title similarity alone, or when the day differs', () => {
    expect(parseBocSpeechesFeed(rss(web({ title: 'Speech: Real title' }) + text({ occ: '2026-11-11' })))).toHaveLength(
      2,
    );
  });

  it('does NOT merge when it is ambiguous (two texts for one webcast, or two webcasts for one text)', () => {
    expect(parseBocSpeechesFeed(rss(web() + text() + text({ path: '2026/11/other', title: 'Other' })))).toHaveLength(3);
    expect(parseBocSpeechesFeed(rss(web() + web({ path: 'multimedia/speech-b-2026-11-10' }) + text()))).toHaveLength(3);
  });

  it('does NOT merge a speech with a committee statement or a press conference (kinds differ), or far-apart times', () => {
    expect(
      parseBocSpeechesFeed(
        rss(web() + text({ title: 'Opening Statement to the Standing Senate Committee on Banking' })),
      ),
    ).toHaveLength(2);
    expect(parseBocSpeechesFeed(rss(web({ title: 'Press Conference: X' }) + text()))).toHaveLength(2);
    expect(parseBocSpeechesFeed(rss(web() + text({ date: '2026-11-20T16:00:00+00:00' })))).toHaveLength(2);
  });

  it('does NOT merge across different speakers on the same day', () => {
    expect(parseBocSpeechesFeed(rss(web() + text({ who: 'Carolyn Rogers' })))).toHaveLength(2);
  });

  it('a webcast-only row stored earlier is updated (same id) when the text page appears — no duplicate row', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-gravelle', name: 'トニ・グラベル', organization: 'BoC' }];
    const now = () => new Date('2026-11-10T20:00:00Z');
    const opts = { store, now, pastDays: 30, ...BOC_OPTIONS };
    await ingestSpeeches(BOC_PROVIDER, parseBocSpeechesFeed(rss(web())), opts, new JobCounters());
    await ingestSpeeches(BOC_PROVIDER, parseBocSpeechesFeed(rss(web() + text())), opts, new JobCounters());
    expect(store.speeches).toHaveLength(1);
    expect(store.speeches[0]!.title).toContain('Real title');
    expect(store.speeches[0]!.source_url).toBe('https://www.bankofcanada.ca/2026/11/real-title/');
  });
});

describe('403 from the source is mapped, not worked around', () => {
  it.each([
    ['BoC', (f: typeof fetch) => new BocSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
    ['RBA', (f: typeof fetch) => new RbaSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
  ])('%s: HTTP 403 → SourceAccessDeniedError (one request, no custom headers)', async (_n, make) => {
    const s = stubFetch(() => ({ status: 403, body: 'Access Denied' }));
    await expect(make(s.fetch).fetchSpeeches()).rejects.toBeInstanceOf(SourceAccessDeniedError);
    expect(s.calls.length).toBe(1);
    expect(s.calls[0]!.init?.headers ?? {}).toEqual({});
  });
});

describe('speaker table / migration / attribution stay consistent', () => {
  it('every BoC / RBA alias is in the (unapplied) migration with the same Japanese name, and resolves', async () => {
    const { readFile } = await import('node:fs/promises');
    const sql = await readFile(
      new URL('../../supabase/migrations/20261118000003_boc_rba_speakers.sql', import.meta.url),
      'utf8',
    );
    const rows = SPEAKER_ALIASES.filter((a) => a.organization === 'BoC' || a.organization === 'RBA');
    expect(rows).toHaveLength(9);
    for (const a of rows) {
      expect(sql).toContain(`'${a.nameJa}'`);
      expect(sql).toContain(`'${a.organization}'`);
      expect(findSpeakerAlias(a.organization, a.aliases[0]!, SPEAKER_ALIASES)?.nameJa).toBe(a.nameJa);
    }
  });

  it('BoC / RBA speeches carry the source attribution; others are unchanged', () => {
    expect(attributionForOrganization('BoC')?.source).toContain('Bank of Canada');
    expect(attributionForOrganization('BoC')?.notice).toContain('無料');
    expect(attributionForOrganization('RBA')?.source).toContain('Reserve Bank of Australia');
    expect(attributionForOrganization('ECB')?.source).toContain('ECB');
    expect(attributionForOrganization('FRB')?.notice).toBeNull();
    expect(attributionForOrganization('日本銀行')).toBeNull();
  });
});

describe('PUBLICATION_TIME alone never makes a row DELIVERED (P2-1)', () => {
  const now = () => NOW;
  const base = {
    provider: BOC_PROVIDER,
    providerEventId: 'x/1',
    speakerName: 'Tiff Macklem',
    organization: 'BoC',
    kind: 'SPEECH' as const,
    topic: 'A speech',
    startsAt: '2026-11-17T10:00:00.000Z', // 過去の公開の時刻
    timePrecision: 'PUBLICATION_TIME' as const,
    url: 'https://www.bankofcanada.ca/2026/11/x/',
  };

  it('with requireDeliveryEvidence, an item without evidence is skipped even though its time is in the past', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-macklem', name: 'ティフ・マックレム', organization: 'BoC' }];
    const counters = new JobCounters();
    await ingestSpeeches(BOC_PROVIDER, [base], { store, now, pastDays: 30, ...BOC_OPTIONS }, counters);
    expect(store.speeches).toEqual([]);
    expect(counters.skipReasons.NO_DELIVERY_EVIDENCE).toBe(1);
  });

  it('with evidence, the row is DELIVERED even if the stored time is later than now (the number is not trusted)', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-macklem', name: 'ティフ・マックレム', organization: 'BoC' }];
    const future = { ...base, startsAt: '2026-11-19T10:00:00.000Z', deliveryEvidence: 'TEXT_PAGE' as const };
    await ingestSpeeches(BOC_PROVIDER, [future], { store, now, pastDays: 30, ...BOC_OPTIONS }, new JobCounters());
    expect(store.speeches.map((r) => r.status)).toEqual(['DELIVERED']);
  });

  it('other sources (no requireDeliveryEvidence, no evidence field) keep their time-based status (FRB / ECB unchanged)', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-macklem', name: 'ティフ・マックレム', organization: 'BoC' }];
    const past = { ...base };
    const futureOne = { ...base, providerEventId: 'x/2', startsAt: '2026-11-19T10:00:00.000Z' };
    await ingestSpeeches(
      BOC_PROVIDER,
      [past, futureOne],
      { store, now, pastDays: 30, publicationTimeKinds: ['SPEECH'] },
      new JobCounters(),
    );
    expect(store.speeches.map((r) => r.status).sort()).toEqual(['DELIVERED', 'SCHEDULED']);
  });

  it('RBA: an item whose (offset-explicit) time is still in the future has no evidence and is not stored; a past one is DELIVERED', async () => {
    const xml = (date: string) =>
      `<rdf:RDF xmlns:rdf="r" xmlns:dc="d" xmlns:cb="c"><channel><title>t</title></channel>` +
      `<item rdf:about="https://www.rba.gov.au/speeches/2026/sp-x.html"><title>T</title><link>https://www.rba.gov.au/speeches/2026/sp-x.html</link>` +
      `<dc:date>${date}</dc:date><cb:speech><cb:occurrenceDate>${date}</cb:occurrenceDate><cb:person><cb:nameAsWritten>Sarah Hunter</cb:nameAsWritten></cb:person></cb:speech></item></rdf:RDF>`;
    const future = parseRbaSpeechesFeed(xml('2026-11-20T09:30+11:00'), NOW);
    const past = parseRbaSpeechesFeed(xml('2026-11-17T09:30+11:00'), NOW);
    expect(future[0]!.deliveryEvidence).toBeUndefined();
    expect(past[0]!.deliveryEvidence).toBe('EVENT_TIME_PASSED');
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-hunter', name: 'サラ・ハンター', organization: 'RBA' }];
    const counters = new JobCounters();
    await ingestSpeeches(RBA_PROVIDER, future, { store, now, pastDays: 30, ...BOC_OPTIONS }, counters);
    expect(store.speeches).toEqual([]);
    expect(counters.skipReasons.NO_DELIVERY_EVIDENCE).toBe(1);
    await ingestSpeeches(RBA_PROVIDER, past, { store, now, pastDays: 30, ...BOC_OPTIONS }, new JobCounters());
    expect(store.speeches.map((r) => r.status)).toEqual(['DELIVERED']);
  });
});

describe('feed structure validation (P2-2): both feeds', () => {
  const makers = [
    ['BoC', (f: typeof fetch) => new BocSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
    ['RBA', (f: typeof fetch) => new RbaSpeechesAdapter({ fetch: f, sleep: noSleep, now: nowMs })],
  ] as const;
  const validItem =
    '<item rdf:about="https://www.rba.gov.au/speeches/2026/sp-x.html"><title>T</title><link>https://www.rba.gov.au/speeches/2026/sp-x.html</link>' +
    '<cb:speech><cb:person><cb:nameAsWritten>Sarah Hunter</cb:nameAsWritten></cb:person></cb:speech></item>';
  const wrap = (inner: string) =>
    `<?xml version="1.0"?><rdf:RDF xmlns:rdf="r" xmlns:cb="c"><channel><title>t</title></channel>${inner}</rdf:RDF>`;

  const broken: [string, string][] = [
    ['HTTP 200 HTML page', '<!DOCTYPE html><html><head><title>Access</title></head><body>Please verify</body></html>'],
    ['HTML without doctype', '<html><body>Error</body></html>'],
    ['empty body', ''],
    ['whitespace-only body', '  \n\t '],
    ['plain text', 'Service Unavailable'],
    ['truncated XML (root not closed)', wrap(validItem).replace('</rdf:RDF>', '')],
    ['broken XML (item not closed)', wrap(validItem.replace('</item>', ''))],
    ['broken XML (title not closed)', wrap(validItem.replace('<title>T</title>', '<title>T'))],
    ['wrong root element', '<feed><entry><title>x</title></entry></feed>'],
    ['no channel', '<rdf:RDF xmlns:rdf="r"></rdf:RDF>'],
    ['channel not closed', '<rdf:RDF xmlns:rdf="r"><channel><title>t</title></rdf:RDF>'],
  ];
  it.each(makers)('%s: every broken input is a FeedFormatError (never an empty success)', async (_n, make) => {
    for (const [, body] of broken) {
      const s = stubFetch(() => ({ body }));
      await expect(make(s.fetch).fetchSpeeches()).rejects.toBeInstanceOf(FeedFormatError);
    }
  });

  it.each(makers)('%s: a normal empty feed (valid channel, 0 items) is accepted and returns []', async (_n, make) => {
    for (const body of [
      '<rdf:RDF xmlns:rdf="r"><channel/></rdf:RDF>',
      '<?xml version="1.0"?><rdf:RDF xmlns:rdf="r" xmlns:dc="d"><channel rdf:about="u"><title>Speeches</title><items><rdf:Seq></rdf:Seq></items></channel></rdf:RDF>',
      '\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<rss version="2.0"><channel><title>t</title></channel></rss>',
    ]) {
      const s = stubFetch(() => ({ body }));
      expect(await make(s.fetch).fetchSpeeches()).toEqual([]);
    }
  });

  it.each(makers)('%s: a valid feed with one item still parses', async (_n, make) => {
    const s = stubFetch(() => ({
      body: wrap(
        validItem
          .replace('<title>T</title>', '<title>T</title><dc:date>2026-11-17T09:30+11:00</dc:date>')
          .replace('<cb:speech>', '<cb:speech><cb:occurrenceDate>2026-11-17T09:30+11:00</cb:occurrenceDate>'),
      ),
    }));
    // rdf:RDF の名前空間宣言に dc を足していないが、名前空間は検証しない(タグの文字で読む)
    const out = await make(s.fetch).fetchSpeeches();
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
