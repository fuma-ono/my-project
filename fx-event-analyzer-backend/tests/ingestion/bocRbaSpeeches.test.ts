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
import { parseCbRdfItems, parseIsoInstant } from '../../src/ingestion/rssCb.js';
import type { SpeakerAlias } from '../../src/ingestion/mappings/speakers.js';
import { ingestSpeeches } from '../../src/ingestion/pipelines/speeches.js';
import { isOfficialSpeechUrl } from '../../src/ingestion/speechBody.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { fixture, MemoryIngestionStore, noSleep, stubFetch } from '../helpers/memoryIngestionStore.js';

// テスト用の話者の表(実際の表 SPEAKER_ALIASES には、話者の行を作る migration が承認されるまで足さない)
const TEST_ALIASES: readonly SpeakerAlias[] = [
  { organization: 'BoC', nameJa: 'テスト・マックレム', aliases: ['Tiff Macklem'], importance: 'HIGH' },
  { organization: 'BoC', nameJa: 'テスト・ロジャーズ', aliases: ['Carolyn Rogers'], importance: 'MEDIUM' },
  { organization: 'RBA', nameJa: 'テスト・ハンター', aliases: ['Sarah Hunter'], importance: 'MEDIUM' },
];
const BOC_OPTIONS = {
  publicationTimeKinds: ['SPEECH', 'TESTIMONY', 'PRESS_CONFERENCE'] as const,
  storeSourceUrl: true,
};

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
});

describe('BoC speeches feed', () => {
  it('takes the 9 items with an identifiable BoC speaker and drops the outside lecturer (no unverifiable speaker)', async () => {
    const speeches = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'));
    expect(speeches).toHaveLength(9);
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
    const speeches = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'));
    const byTopic = (start: string) => speeches.find((s) => s.topic?.startsWith(start))!;
    expect(byTopic('Opening Statement to the Standing Senate').kind).toBe('TESTIMONY');
    expect(byTopic('Press Conference: Monetary Policy Report').kind).toBe('PRESS_CONFERENCE');
    expect(byTopic('Monetary Policy Report Press Conference Opening Statement').kind).toBe('PRESS_CONFERENCE');
    expect(byTopic('Speech: Edmonton').kind).toBe('SPEECH');
    expect(byTopic('Repo markets').kind).toBe('SPEECH');
    const edmonton = byTopic('Speech: Edmonton');
    expect(edmonton.providerEventId).toBe('multimedia/speech-edmonton-chamber-of-commerce-2026-11-18');
    expect(edmonton.url).toBe('https://www.bankofcanada.ca/multimedia/speech-edmonton-chamber-of-commerce-2026-11-18/');
    // 予定の項目の時刻は dc:date そのまま(現地の時刻の表記ずれがありうるので PUBLICATION_TIME)
    expect(edmonton.startsAt).toBe('2026-11-18T12:45:14.000Z');
    expect(new Set(speeches.map((s) => s.providerEventId)).size).toBe(speeches.length);
  });

  it('reads the speaker from the description when there is no cb:person (role words are not part of the name)', () => {
    expect(
      speakerFromDescription(
        'Scenario analysis — Deputy Governor Toni Gravelle speaks before the Edmonton Chamber of Commerce (12:45 (ET) approx.).',
      ),
    ).toBe('Toni Gravelle');
    expect(
      speakerFromDescription('Press conference by Governor Tiff Macklem and Senior Deputy Governor Carolyn Rogers.'),
    ).toBe('Tiff Macklem');
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
    const speeches = parseRbaSpeechesFeed(await fixture('rba-speeches-rss.xml'));
    expect(speeches).toHaveLength(1);
    expect(speeches[0]).toMatchObject({
      provider: RBA_PROVIDER,
      providerEventId: 'sp-sp-ag-2026-11-09',
      speakerName: 'Sarah Hunter',
      organization: 'RBA',
      kind: 'SPEECH',
      startsAt: '2026-11-08T22:30:00.000Z',
      timePrecision: 'PUBLICATION_TIME',
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
    const speeches = await new BocSpeechesAdapter({ fetch: s.fetch, sleep: noSleep }).fetchSpeeches();
    expect(speeches).toHaveLength(9);
    expect(s.calls.map((c) => c.url)).toEqual(['https://www.bankofcanada.ca/content_type/speeches/feed/']);
  });

  it.each([
    ['BoC', (f: typeof fetch) => new BocSpeechesAdapter({ fetch: f, sleep: noSleep })],
    ['RBA', (f: typeof fetch) => new RbaSpeechesAdapter({ fetch: f, sleep: noSleep })],
  ])('%s: a 403 / 500 response is an error (not an empty success), after bounded retries', async (_name, make) => {
    const s = stubFetch(() => ({ status: 403, body: 'Access Denied' }));
    await expect(make(s.fetch).fetchSpeeches()).rejects.toThrow(/HTTP 403|failed/);
    expect(s.calls.length).toBeLessThanOrEqual(3);
  });

  it.each([
    ['BoC', (f: typeof fetch) => new BocSpeechesAdapter({ fetch: f, sleep: noSleep })],
    ['RBA', (f: typeof fetch) => new RbaSpeechesAdapter({ fetch: f, sleep: noSleep })],
  ])('%s: items without any RSS-CB element (format changed) is an error, not a silent zero', async (_name, make) => {
    const s = stubFetch(() => ({
      body: '<rss><channel><item><title>x</title><link>https://www.bankofcanada.ca/x/</link></item></channel></rss>',
    }));
    await expect(make(s.fetch).fetchSpeeches()).rejects.toThrow(/format changed/);
  });

  it('an empty feed (no items) is not an error', async () => {
    const s = stubFetch(() => ({ body: '<rdf:RDF><channel/></rdf:RDF>' }));
    expect(await new BocSpeechesAdapter({ fetch: s.fetch, sleep: noSleep }).fetchSpeeches()).toEqual([]);
  });
});

describe('pipeline (in-memory store): dedup, correction, link-only, unknown speakers', () => {
  const now = () => new Date('2026-11-18T06:00:00Z');

  it('without the speaker rows / aliases (today), nothing is written — every item is skipped and logged', async () => {
    const store = new MemoryIngestionStore();
    const counters = new JobCounters();
    await ingestSpeeches(
      BOC_PROVIDER,
      parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml')),
      { store, now, pastDays: 90, ...BOC_OPTIONS },
      counters,
    );
    expect(store.speeches).toEqual([]);
    expect(counters.skipReasons.SPEAKER_UNKNOWN).toBe(9);
  });

  it('with speaker rows: stored once as PUBLICATION_TIME with the official URL; a rerun does not duplicate; upcoming → SCHEDULED', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [
      { id: 'sp-macklem', name: 'テスト・マックレム', organization: 'BoC' },
      { id: 'sp-rogers', name: 'テスト・ロジャーズ', organization: 'BoC' },
    ];
    const speeches = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml'));
    const options = { store, now, pastDays: 90, aliases: TEST_ALIASES, ...BOC_OPTIONS };
    await ingestSpeeches(BOC_PROVIDER, speeches, options, new JobCounters());
    const first = store.speeches.length;
    expect(first).toBeGreaterThan(0); // Gravelle は話者の行がない → SPEAKER_NOT_IN_DB で飛ばされる
    await ingestSpeeches(BOC_PROVIDER, speeches, options, new JobCounters());
    expect(store.speeches).toHaveLength(first);
    expect(store.speeches.every((r) => r.time_precision === 'PUBLICATION_TIME' && r.provider === BOC_PROVIDER)).toBe(
      true,
    );
    expect(store.speeches.every((r) => (r.source_url ?? '').startsWith('https://www.bankofcanada.ca/'))).toBe(true);
  });

  it('a correction at the source (same page, new title / time) updates the same row instead of adding one', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-rogers', name: 'テスト・ロジャーズ', organization: 'BoC' }];
    const base = parseBocSpeechesFeed(await fixture('boc-speeches-rss.xml')).find(
      (s) => s.topic === 'The complexity of housing affordability',
    )!;
    const options = { store, now, pastDays: 90, aliases: TEST_ALIASES, ...BOC_OPTIONS };
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
    store.speakers = [{ id: 'sp-hunter', name: 'テスト・ハンター', organization: 'RBA' }];
    const speeches = parseRbaSpeechesFeed(await fixture('rba-speeches-rss.xml'));
    const counters = new JobCounters();
    await ingestSpeeches(RBA_PROVIDER, speeches, { store, now, pastDays: 90, aliases: TEST_ALIASES }, counters);
    expect(store.speeches).toEqual([]);
    expect(counters.skipReasons.TIME_NOT_EXACT).toBe(1);
    await ingestSpeeches(
      RBA_PROVIDER,
      speeches,
      { store, now, pastDays: 90, aliases: TEST_ALIASES, ...BOC_OPTIONS },
      new JobCounters(),
    );
    expect(store.speeches).toHaveLength(1);
    expect(store.speeches[0]!.source_url).toBe('https://www.rba.gov.au/speeches/2026/sp-sp-ag-2026-11-09.html');
  });
});
