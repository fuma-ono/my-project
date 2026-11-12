/**
 * HQ指示(2026-11-10「要人発言本文の取得・保存機能」): 本文の取り込みのジョブ。公式ページだけを読み、取れれば FETCHED、
 * 取れなければ FAILED(理由つき)。本文を推測で補わない。発言者・日時・題名は変えない。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FRB_SPEECHES_JSON_URL,
  FRB_SPEECHES_RSS_URL,
  STORE_BODY_FOR,
  ingestSpeechBodies,
  type FrbRowForMatching,
  type SpeechBodyPatch,
  type SpeechBodyStore,
  type SpeechForBody,
} from '../../src/ingestion/pipelines/speechBodies.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import {
  frbJsonDateToUtcMs,
  frbSpeechJsonLinks,
  frbSpeechJsonTimedItems,
  matchFrbSpeechUrlsByTime,
} from '../../src/ingestion/speechBody.js';

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
  claims: { id: string; from: number }[] = [];
  /** 本物の DB と同じ: FRB のすべての行(状態・本文の有無に関係なく) */
  listFrbRowsForMatching(): Promise<FrbRowForMatching[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => r.provider === 'frb_calendar')
        .map((r) => ({
          id: r.id,
          statement_datetime: r.statement_datetime,
          source_url: r.source_url,
          speaker_name: r.speaker_name,
          speaker_organization: r.speaker_organization,
        })),
    );
  }
  /** 本物の DB と同じ条件(発言済み・期間・PENDING または FAILED で回数が上限未満) */
  listSpeechesNeedingBody(
    providers: readonly string[],
    sinceIso: string,
    maxAttempts: number,
  ): Promise<SpeechForBody[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (r) =>
            providers.includes(r.provider) &&
            r.status === 'DELIVERED' &&
            (r.body_status === 'PENDING' || r.body_status === 'FAILED') &&
            r.body_attempts < maxAttempts &&
            Date.parse(r.statement_datetime) >= Date.parse(sinceIso),
        )
        .map((r) => ({ ...r })),
    );
  }
  private guard(id: string, expectedAttempts: number) {
    const row = this.rows.find((r) => r.id === id)!;
    return ['PENDING', 'FAILED'].includes(row.body_status) && row.body_attempts === expectedAttempts ? row : null;
  }
  claimBodyAttempt(id: string, expectedAttempts: number, _at: string, maxAttempts: number): Promise<boolean> {
    const row = this.guard(id, expectedAttempts);
    if (!row || row.body_attempts >= maxAttempts) return Promise.resolve(false);
    this.claims.push({ id, from: expectedAttempts });
    row.body_attempts = expectedAttempts + 1;
    return Promise.resolve(true);
  }
  updateSpeechBody(id: string, patch: SpeechBodyPatch, expectedAttempts: number): Promise<boolean> {
    const row = this.guard(id, expectedAttempts);
    if (!row) return Promise.resolve(false);
    this.updates.push({ id, patch });
    Object.assign(row, {
      body_status: patch.body_status,
      ...(patch.source_url ? { source_url: patch.source_url } : {}),
    });
    return Promise.resolve(true);
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
  body_attempts: 0,
  speaker_name: 'クリストファー・ウォラー',
  speaker_organization: 'FRB',
  ...overrides,
});

describe('ingestSpeechBodies', () => {
  let store: FakeStore;
  let frb: FakeFetcher;
  let ecb: FakeFetcher;
  // 取り出しの処理そのものを確かめるため、ここでは ECB も保存してよいとして動かす(既定の ECB の扱いは下の別のテスト)
  const run = (maxFetches = 20, storeBodyFor: readonly string[] = ['frb_calendar', 'ecb_press_rss']) => {
    const counters = new JobCounters();
    return ingestSpeechBodies(store, { frb, ecb }, { pastDays: 30, maxFetches, storeBodyFor }, NOW, counters).then(
      () => counters,
    );
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

  it('by default (HQ 2026-11-11) the ECB body is not fetched or stored: URL kept, NOT_APPLICABLE / RIGHTS_UNCONFIRMED; FRB still stored', async () => {
    const url = 'https://www.ecb.europa.eu/press/key/date/2026/html/ecb.sp261030~08d9d540f0.en.html';
    const frbUrl = 'https://www.federalreserve.gov/newsevents/speech/bowman20261014a.htm';
    store.rows = [
      row({ id: 'e', provider: 'ecb_press_rss', source_url: url, speaker_organization: 'ECB' }),
      row({ id: 'f', source_url: frbUrl }),
    ];
    ecb.pages.set(url, ecbPage('My aim today.'));
    frb.pages.set(
      frbUrl,
      '<html><body><div id="article"><p>Thank you for the invitation to speak.</p></div></body></html>',
    );
    const counters = await run(20, STORE_BODY_FOR);
    expect(STORE_BODY_FOR).toEqual(['frb_calendar']);
    expect(patchOf('e')).toEqual({
      source_url: url,
      speech_body: null,
      body_fetched_at: null,
      body_status: 'NOT_APPLICABLE',
      body_error: 'RIGHTS_UNCONFIRMED',
    });
    expect(ecb.requested).toEqual([]); // ECB のページは読まない
    expect(counters.skipReasons.RIGHTS_UNCONFIRMED).toBe(1);
    expect(patchOf('f')?.body_status).not.toBe('NOT_APPLICABLE');
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

// HQ指示(2026-11-11「過去発言にも適用可能か確認」): RSS は直近の講演だけなので、古い発言は講演の一覧の JSON で URL を探す。
describe('ingestSpeechBodies: past speeches (--all) and the FRB speeches JSON', () => {
  const OLD = 'https://www.federalreserve.gov/newsevents/speech/waller20250117a.htm';
  const json = (...items: { l?: string; stub?: string }[]) =>
    `\uFEFF${JSON.stringify([...items.map((i) => ({ d: 'x', t: 't', s: 's', ...i })), { updateDate: 'Last update' }])}`;

  it('links an old speech the RSS no longer has from the JSON, only with pastDays = null', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    const ecb = new FakeFetcher();
    store.rows = [row({ id: 'old', statement_datetime: '2025-01-17T15:00:00Z' })];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss('https://www.federalreserve.gov/newsevents/speech/bowman20261110a.htm'));
    frb.pages.set(FRB_SPEECHES_JSON_URL, json({ l: '/newsevents/speech/waller20250117a.htm' }));
    frb.pages.set(OLD, frbPage('Inflation has eased.'));

    // 既定(直近30日)では対象に入らない
    await ingestSpeechBodies(store, { frb, ecb }, { pastDays: 30, maxFetches: 20 }, NOW, new JobCounters());
    expect(store.updates).toEqual([]);

    const counters = new JobCounters();
    await ingestSpeechBodies(store, { frb, ecb }, { pastDays: null, maxFetches: 20 }, NOW, counters);
    expect(store.updates.at(-1)).toEqual({
      id: 'old',
      patch: {
        source_url: OLD,
        speech_body: 'Inflation has eased.',
        body_fetched_at: NOW.toISOString(),
        body_status: 'FETCHED',
        body_error: null,
      },
    });
    expect(frb.requested).toEqual([FRB_SPEECHES_RSS_URL, FRB_SPEECHES_JSON_URL, OLD]);
    expect(counters.errorMessages).toEqual([]);
  });

  it('the same page listed twice (identical remarks given twice) is one item; two rows that day are not linked', async () => {
    const page = '/newsevents/speech/waller20250117a.htm';
    const one = new FakeStore();
    const frb = new FakeFetcher();
    one.rows = [row({ id: 'a', statement_datetime: '2025-01-17T15:00:00Z' })];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss());
    frb.pages.set(FRB_SPEECHES_JSON_URL, json({ l: page }, { l: '', stub: page }));
    frb.pages.set(OLD, frbPage('Inflation has eased.'));
    await ingestSpeechBodies(
      one,
      { frb, ecb: new FakeFetcher() },
      { pastDays: null, maxFetches: 20 },
      NOW,
      new JobCounters(),
    );
    expect(one.updates.at(-1)?.patch.body_status).toBe('FETCHED');

    const two = new FakeStore();
    two.rows = [
      row({ id: 'a', statement_datetime: '2025-01-17T15:00:00Z' }),
      row({ id: 'b', provider_event_id: 'p2', statement_datetime: '2025-01-17T20:00:00Z' }),
    ];
    await ingestSpeechBodies(
      two,
      { frb, ecb: new FakeFetcher() },
      { pastDays: null, maxFetches: 20 },
      NOW,
      new JobCounters(),
    );
    expect(two.updates).toEqual([]); // 推測で結ばない(PENDING のまま)
  });

  it('does not read the JSON when the RSS linked every speech', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    const url = 'https://www.federalreserve.gov/newsevents/speech/waller20261105a.htm';
    store.rows = [row({ id: 'w' })];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss(url));
    frb.pages.set(url, frbPage('Thank you.'));
    await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { pastDays: 30, maxFetches: 20 },
      NOW,
      new JobCounters(),
    );
    expect(frb.requested).not.toContain(FRB_SPEECHES_JSON_URL);
  });
});

describe('frbSpeechJsonLinks', () => {
  it('reads l / stub as official URLs, drops duplicates and non-speech paths, and is empty for bad JSON', () => {
    expect(
      frbSpeechJsonLinks(
        '\uFEFF[{"l":"/newsevents/speech/powell20170107a.htm"},{"l":"","stub":"/newsevents/speech/powell20170107a.htm"},{"l":"/newsevents/testimony/x.htm"},{"updateDate":"u"}]',
      ),
    ).toEqual(['https://www.federalreserve.gov/newsevents/speech/powell20170107a.htm']);
    expect(frbSpeechJsonLinks('<html>')).toEqual([]);
    expect(frbSpeechJsonLinks('{"a":1}')).toEqual([]);
  });
});

// HQ指示(2026-11-11「実行前に対象件数を確認できるように」): dry-run は書かない・本文のページを読まない。各発言で何をするかを返す。
describe('ingestSpeechBodies: dry-run', () => {
  it('returns the plan in date order, reads only the RSS and the JSON, and writes nothing', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    const ecb = new FakeFetcher();
    const rssUrl = 'https://www.federalreserve.gov/newsevents/speech/waller20261105a.htm';
    const ecbUrl = 'https://www.ecb.europa.eu/press/key/date/2026/html/ecb.sp261030~08d9d540f0.en.html';
    store.rows = [
      row({ id: 'new', statement_datetime: '2026-11-05T12:30:00Z' }),
      row({ id: 'old', statement_datetime: '2025-01-17T15:00:00Z' }),
      row({ id: 'nourl', speaker_name: 'ミシェル・ボウマン', statement_datetime: '2025-02-01T15:00:00Z' }),
      row({
        id: 'ecb',
        provider: 'ecb_press_rss',
        source_url: ecbUrl,
        speaker_organization: 'ECB',
        statement_datetime: '2026-10-30T09:00:00Z',
      }),
    ].sort((a, b) => a.statement_datetime.localeCompare(b.statement_datetime));
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss(rssUrl));
    frb.pages.set(FRB_SPEECHES_JSON_URL, `[{"l":"/newsevents/speech/waller20250117a.htm"}]`);
    const counters = new JobCounters();
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb },
      { pastDays: null, maxFetches: 1, dryRun: true },
      NOW,
      counters,
    );
    expect(plan.map((p) => [p.speech_id, p.action, p.url_from])).toEqual([
      ['old', 'FETCH', 'json'],
      ['nourl', 'NO_SOURCE_URL', null],
      ['ecb', 'RIGHTS_UNCONFIRMED', 'stored'],
      ['new', 'RUN_CAP', 'rss'], // 1回の上限(maxFetches = 1)を超えた分は次の実行
    ]);
    expect(store.updates).toEqual([]);
    expect(frb.requested).toEqual([FRB_SPEECHES_RSS_URL, FRB_SPEECHES_JSON_URL]);
    expect(ecb.requested).toEqual([]);
  });
});

// HQ承認(2026-11-11「FRB公式JSONの時刻照合」): 姓と日付で一意に決まらない行だけ、一覧の時刻(東部時間 → UTC)と完全一致で結ぶ。
describe('frbJsonDateToUtcMs (US Eastern → UTC, DST-aware, exact)', () => {
  const iso = (v: string) => {
    const ms = frbJsonDateToUtcMs(v);
    return ms === null ? null : new Date(ms).toISOString();
  };

  it('converts EDT and EST times', () => {
    expect(iso('10/14/2026 10:55:00 PM')).toBe('2026-10-15T02:55:00.000Z'); // EDT
    expect(iso('11/10/2026 3:30:00 PM')).toBe('2026-11-10T20:30:00.000Z'); // EST
    expect(iso('11/10/2026 6:30:00 PM')).toBe('2026-11-10T23:30:00.000Z');
    expect(iso('1/7/2017 11:15:00 AM')).toBe('2017-01-07T16:15:00.000Z');
  });

  it('midnight and noon', () => {
    expect(iso('6/1/2026 12:00:00 AM')).toBe('2026-06-01T04:00:00.000Z');
    expect(iso('6/1/2026 12:00:00 PM')).toBe('2026-06-01T16:00:00.000Z');
  });

  it('DST boundaries: a skipped or a repeated wall time is not converted (never one of two)', () => {
    expect(iso('3/8/2026 2:30:00 AM')).toBeNull(); // 夏時間の始まり: 存在しない時刻
    expect(iso('3/8/2026 3:00:00 AM')).toBe('2026-03-08T07:00:00.000Z');
    expect(iso('3/7/2026 11:00:00 PM')).toBe('2026-03-08T04:00:00.000Z');
    expect(iso('11/1/2026 1:30:00 AM')).toBeNull(); // 夏時間の終わり: 2回ある時刻
    expect(iso('11/1/2026 2:30:00 AM')).toBe('2026-11-01T07:30:00.000Z');
    expect(iso('11/1/2026 12:30:00 AM')).toBe('2026-11-01T04:30:00.000Z');
  });

  it('bad shapes are null', () => {
    for (const v of ['', '11/10/2026', '11/10/2026 15:30:00', '11/10/2026 3:30:00 PM x', '11/10/2026 0:30:00 AM']) {
      expect(frbJsonDateToUtcMs(v), v).toBeNull();
    }
  });
});

describe('matchFrbSpeechUrlsByTime', () => {
  const at = (v: string) => Date.parse(v);
  const B = 'https://www.federalreserve.gov/newsevents/speech/bowman20261110a.htm';
  const B2 = 'https://www.federalreserve.gov/newsevents/speech/bowman20261110b.htm';
  const timedRow = (id: string, statementIso: string) => ({ id, speakerNameEn: 'Michelle W. Bowman', statementIso });

  it('same page given twice the same day: each row linked only by its own exact time', () => {
    const items = [
      { url: B, surname: 'bowman', instantMs: at('2026-11-10T20:30:00Z') },
      { url: B, surname: 'bowman', instantMs: at('2026-11-10T23:30:00Z') },
    ];
    const m = matchFrbSpeechUrlsByTime(
      [timedRow('a', '2026-11-10T20:30:00Z'), timedRow('b', '2026-11-10T23:30:00+00:00')],
      items,
    );
    expect([...m]).toEqual([
      ['a', B],
      ['b', B],
    ]);
  });

  it('no tolerance: one minute off is not linked', () => {
    const items = [{ url: B, surname: 'bowman', instantMs: at('2026-11-10T20:30:00Z') }];
    expect(matchFrbSpeechUrlsByTime([timedRow('a', '2026-11-10T20:31:00Z')], items).size).toBe(0);
  });

  it('two different pages at the same time (time collision, several candidates): not linked', () => {
    const items = [
      { url: B, surname: 'bowman', instantMs: at('2026-11-10T20:30:00Z') },
      { url: B2, surname: 'bowman', instantMs: at('2026-11-10T20:30:00Z') },
    ];
    expect(matchFrbSpeechUrlsByTime([timedRow('a', '2026-11-10T20:30:00Z')], items).size).toBe(0);
  });

  it('another speaker at the same time is not a candidate', () => {
    const items = [{ url: B, surname: 'waller', instantMs: at('2026-11-10T20:30:00Z') }];
    expect(matchFrbSpeechUrlsByTime([timedRow('a', '2026-11-10T20:30:00Z')], items).size).toBe(0);
  });
});

describe('frbSpeechJsonTimedItems', () => {
  it('keeps the time of each entry, drops exact duplicates, keeps same-time different pages', () => {
    const text = JSON.stringify([
      { d: '11/10/2026 6:30:00 PM', l: '', stub: '/newsevents/speech/bowman20261110a.htm' },
      { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110a.htm' },
      { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110a.htm' },
      { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110b.htm' },
      { d: 'bad', l: '/newsevents/speech/waller20261110a.htm' },
      { updateDate: 'Last update' },
    ]);
    expect(
      frbSpeechJsonTimedItems(text).map((i) => [i.url.split('/').at(-1), new Date(i.instantMs).toISOString()]),
    ).toEqual([
      ['bowman20261110a.htm', '2026-11-10T23:30:00.000Z'],
      ['bowman20261110a.htm', '2026-11-10T20:30:00.000Z'],
      ['bowman20261110b.htm', '2026-11-10T20:30:00.000Z'],
    ]);
  });
});

describe('ingestSpeechBodies: the four DEV cases (2026-11-11) with the official JSON times', () => {
  it('10/15 02:55Z and both 11/10 rows are linked by exact time; the 10/14 discussion is not; existing links unchanged', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    const bowman = 'ミシェル・ボウマン';
    store.rows = [
      row({ id: 'disc1014', speaker_name: bowman, statement_datetime: '2026-10-14T09:40:00+00:00' }),
      row({ id: 'sp1015', speaker_name: bowman, statement_datetime: '2026-10-15T02:55:00+00:00' }),
      row({ id: 'waller1110', statement_datetime: '2026-11-10T09:00:00+00:00' }),
      row({ id: 'b1110a', speaker_name: bowman, statement_datetime: '2026-11-10T20:30:00+00:00' }),
      row({ id: 'b1110b', speaker_name: bowman, statement_datetime: '2026-11-10T23:30:00+00:00' }),
      row({
        id: 'stored',
        speaker_name: bowman,
        statement_datetime: '2026-11-10T21:00:00+00:00',
        source_url: 'https://www.federalreserve.gov/newsevents/speech/bowman20261110b.htm',
      }),
    ];
    frb.pages.set(
      FRB_SPEECHES_RSS_URL,
      rss(
        'https://www.federalreserve.gov/newsevents/speech/waller20261110a.htm',
        'https://www.federalreserve.gov/newsevents/speech/bowman20261110a.htm',
      ),
    );
    frb.pages.set(
      FRB_SPEECHES_JSON_URL,
      JSON.stringify([
        { d: '11/10/2026 6:30:00 PM', l: '', stub: '/newsevents/speech/bowman20261110a.htm' },
        { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110a.htm' },
        { d: '11/10/2026 4:00:00 AM', l: '/newsevents/speech/waller20261110a.htm' },
        { d: '10/14/2026 10:55:00 PM', l: '/newsevents/speech/bowman20261014a.htm' },
      ]),
    );
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { pastDays: null, maxFetches: 20, dryRun: true },
      NOW,
      new JobCounters(),
    );
    const byId = new Map(
      plan.map((p) => [p.speech_id, [p.action, p.url_from, p.source_url?.split('/').at(-1) ?? null]]),
    );
    expect(byId.get('disc1014')).toEqual(['NO_SOURCE_URL', null, null]);
    expect(byId.get('sp1015')).toEqual(['FETCH', 'json_time', 'bowman20261014a.htm']);
    expect(byId.get('waller1110')).toEqual(['FETCH', 'rss', 'waller20261110a.htm']);
    expect(byId.get('b1110a')).toEqual(['FETCH', 'json_time', 'bowman20261110a.htm']);
    expect(byId.get('b1110b')).toEqual(['FETCH', 'json_time', 'bowman20261110a.htm']);
    expect(byId.get('stored')).toEqual(['FETCH', 'stored', 'bowman20261110b.htm']); // 既にある URL は変えない
    expect(store.updates).toEqual([]);
  });
});

// HQ承認(2026-11-11「要人発言の定期実行」1日目): 試行回数・直近14日・二重の実行の防止。
describe('ingestSpeechBodies: attempts, the 14-day window and concurrent runs', () => {
  const NOW_S = new Date('2026-11-20T06:00:00Z');
  const URL_A = 'https://www.federalreserve.gov/newsevents/speech/waller20261115a.htm';
  const settings14 = { pastDays: 14, maxFetches: 20 };
  const withRss = (frb: FakeFetcher, ...urls: string[]) => frb.pages.set(FRB_SPEECHES_RSS_URL, rss(...urls));

  it('counts one attempt per speech row, just before reading its page (not per page, not for rows without a URL)', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [
      row({ id: 'a', statement_datetime: '2026-11-15T15:00:00Z', source_url: URL_A }),
      row({ id: 'b', statement_datetime: '2026-11-16T15:00:00Z', source_url: URL_A }), // 同じページ、別の行
      row({ id: 'nourl', speaker_name: 'ミシェル・ボウマン', statement_datetime: '2026-11-17T15:00:00Z' }),
    ];
    withRss(frb);
    frb.pages.set(FRB_SPEECHES_JSON_URL, '[]');
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    await ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, new JobCounters());
    expect(store.claims).toEqual([
      { id: 'a', from: 0 },
      { id: 'b', from: 0 },
    ]);
    expect(store.rows.find((r) => r.id === 'a')!.body_attempts).toBe(1);
    expect(store.rows.find((r) => r.id === 'nourl')!.body_attempts).toBe(0);
  });

  it('only DELIVERED rows whose statement time is within the last 14 days; SCHEDULED never', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [
      row({ id: 'in13', statement_datetime: '2026-11-07T06:00:00Z', source_url: URL_A }),
      row({ id: 'out15', statement_datetime: '2026-11-05T06:00:00Z', source_url: URL_A }),
      row({ id: 'sched', status: 'SCHEDULED', statement_datetime: '2026-11-19T06:00:00Z', source_url: URL_A }),
    ];
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      settings14,
      NOW_S,
      new JobCounters(),
    );
    expect(plan.map((p) => p.speech_id)).toEqual(['in13']);

    // ストアが条件を落として返しても、発言前・期間外・上限に達した FAILED は対象にしない
    const loose: SpeechBodyStore = {
      listFrbRowsForMatching: () => Promise.resolve([]),
      listSpeechesNeedingBody: () =>
        Promise.resolve([
          row({ id: 'sched', status: 'SCHEDULED', statement_datetime: '2026-11-19T06:00:00Z', source_url: URL_A }),
          row({ id: 'old', statement_datetime: '2026-10-01T06:00:00Z', source_url: URL_A }),
          row({
            id: 'cap',
            body_status: 'FAILED',
            body_attempts: 3,
            statement_datetime: '2026-11-19T06:00:00Z',
            source_url: URL_A,
          }),
        ]),
      claimBodyAttempt: () => Promise.reject(new Error('must not be called')),
      updateSpeechBody: () => Promise.reject(new Error('must not be called')),
    };
    const r = await ingestSpeechBodies(loose, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, new JobCounters());
    expect(r.plan).toEqual([]);
  });

  it('FAILED is retried up to 3 attempts per row, then left alone', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher(); // ページが無い → 404 → FAILED
    store.rows = [
      row({
        id: 'f2',
        body_status: 'FAILED',
        body_attempts: 2,
        statement_datetime: '2026-11-15T15:00:00Z',
        source_url: URL_A,
      }),
      row({
        id: 'f3',
        body_status: 'FAILED',
        body_attempts: 3,
        statement_datetime: '2026-11-15T16:00:00Z',
        source_url: URL_A,
      }),
    ];
    const counters = new JobCounters();
    await ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, counters);
    expect(store.claims).toEqual([{ id: 'f2', from: 2 }]);
    expect(store.rows.find((r) => r.id === 'f2')).toMatchObject({ body_status: 'FAILED', body_attempts: 3 });
    expect(store.updates.at(-1)).toMatchObject({ id: 'f2', patch: { body_status: 'FAILED', body_error: 'HTTP_404' } });
    // 次の実行では、上限に達したので対象にならない
    store.claims = [];
    await ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, new JobCounters());
    expect(store.claims).toEqual([]);
    expect(frb.requested.filter((u) => u === URL_A)).toHaveLength(1);
  });

  it('dry-run: no attempt is counted and nothing is written', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [row({ id: 'a', statement_datetime: '2026-11-15T15:00:00Z', source_url: URL_A })];
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...settings14, dryRun: true },
      NOW_S,
      new JobCounters(),
    );
    expect(plan.map((p) => p.action)).toEqual(['FETCH']);
    expect(store.claims).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(store.rows[0]!.body_attempts).toBe(0);
    expect(frb.requested).toEqual([]);
  });

  it('a row another run already FETCHED is not read again or overwritten (state condition)', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [row({ id: 'a', statement_datetime: '2026-11-15T15:00:00Z', source_url: URL_A })];
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    const original = store.listSpeechesNeedingBody.bind(store);
    store.listSpeechesNeedingBody = async (...args) => {
      const listed = await original(...args);
      Object.assign(store.rows[0]!, { body_status: 'FETCHED' }); // 読んだ直後に、ほかの実行が FETCHED にした
      return listed;
    };
    const counters = new JobCounters();
    await ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, counters);
    expect(frb.requested).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(counters.skipReasons).toMatchObject({ CONCURRENT_UPDATE: 1 });
    expect(counters.success).toBe(0);
  });

  it('if another run bumped the attempt count meanwhile, the result is not written (optimistic condition)', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [row({ id: 'a', statement_datetime: '2026-11-15T15:00:00Z', source_url: URL_A })];
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    const getText = frb.getText.bind(frb);
    frb.getText = async (url: string) => {
      const page = await getText(url);
      store.rows[0]!.body_attempts += 1; // 本文を読んでいる間に、ほかの実行が同じ行を数えた
      return page;
    };
    const counters = new JobCounters();
    await ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, counters);
    expect(store.updates).toEqual([]);
    expect(counters.success).toBe(0);
    expect(counters.skipReasons).toMatchObject({ CONCURRENT_UPDATE: 1 });
  });
});

// HQレビュー(2026-11-12): PENDING も回数で止める。
describe('ingestSpeechBodies: the attempt cap applies to PENDING too', () => {
  const NOW_S = new Date('2026-11-20T06:00:00Z');
  const URL_A = 'https://www.federalreserve.gov/newsevents/speech/waller20261115a.htm';
  const settings14 = { pastDays: 14, maxFetches: 20 };
  const matrix = (['PENDING', 'FAILED'] as const).flatMap((status) =>
    [0, 1, 2, 3].map((attempts, i) =>
      row({
        id: `${status}-${attempts}`,
        provider_event_id: `${status}-${attempts}`,
        body_status: status,
        body_attempts: attempts,
        statement_datetime: `2026-11-1${i}T15:00:00Z`,
        source_url: URL_A,
      }),
    ),
  );

  it('PENDING and FAILED × attempts 0–3: 0, 1, 2 are tried (one count each), 3 is not', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = matrix.map((r) => ({ ...r }));
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      settings14,
      NOW_S,
      new JobCounters(),
    );
    const tried = new Set(plan.map((p) => p.speech_id));
    for (const r of matrix) expect(tried.has(r.id), r.id).toBe(r.body_attempts < 3);
    expect(store.claims.map((c) => c.id).sort()).toEqual(
      ['FAILED-0', 'FAILED-1', 'FAILED-2', 'PENDING-0', 'PENDING-1', 'PENDING-2'].sort(),
    );
  });

  it('the same when the store returns every row (the pipeline itself filters attempts >= 3)', async () => {
    const loose: SpeechBodyStore = {
      listFrbRowsForMatching: () => Promise.resolve([]),
      listSpeechesNeedingBody: () => Promise.resolve(matrix.map((r) => ({ ...r }))),
      claimBodyAttempt: () => Promise.resolve(true),
      updateSpeechBody: () => Promise.resolve(true),
    };
    const frb = new FakeFetcher();
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    const { plan } = await ingestSpeechBodies(
      loose,
      { frb, ecb: new FakeFetcher() },
      settings14,
      NOW_S,
      new JobCounters(),
    );
    expect(plan.map((p) => p.speech_id).sort()).toEqual(
      ['FAILED-0', 'FAILED-1', 'FAILED-2', 'PENDING-0', 'PENDING-1', 'PENDING-2'].sort(),
    );
  });

  it('abnormal end after counting (the result is never written, the row stays PENDING): stops after 3 runs', async () => {
    class CrashingStore extends FakeStore {
      override updateSpeechBody(): Promise<boolean> {
        return Promise.reject(new Error('connection lost')); // 回数を数えた後、結果を書く前に落ちる
      }
    }
    const store = new CrashingStore();
    const frb = new FakeFetcher();
    store.rows = [row({ id: 'p', statement_datetime: '2026-11-15T15:00:00Z', source_url: URL_A })];
    frb.pages.set(URL_A, frbPage('Inflation has eased.'));
    for (let run = 1; run <= 3; run += 1) {
      await expect(
        ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, settings14, NOW_S, new JobCounters()),
      ).rejects.toThrow('connection lost');
      expect(store.rows[0]).toMatchObject({ body_status: 'PENDING', body_attempts: run });
    }
    // 4回目の実行: もう対象にならず、ページも読まない
    const pagesBefore = frb.requested.filter((u) => u === URL_A).length;
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      settings14,
      NOW_S,
      new JobCounters(),
    );
    expect(plan).toEqual([]);
    expect(frb.requested.filter((u) => u === URL_A)).toHaveLength(pagesBefore);
    expect(store.claims).toHaveLength(3);
    expect(store.rows[0]).toMatchObject({ body_status: 'PENDING', body_attempts: 3 });
  });
});

// HQ承認(2026-11-12「誤紐付けの修正」): 日付の照らし合わせは FRB のすべての行で数え、別の行が使っている URL は再利用しない。
describe('ingestSpeechBodies: no wrong link when another row of the same day already has the page', () => {
  const NOW_M = new Date('2026-11-12T03:00:00Z');
  const bowman = 'ミシェル・ボウマン';
  const P1014 = 'https://www.federalreserve.gov/newsevents/speech/bowman20261014a.htm';
  const P1110 = 'https://www.federalreserve.gov/newsevents/speech/bowman20261110a.htm';
  const all = { pastDays: null, maxFetches: 20 };
  const json1014 = JSON.stringify([{ d: '10/14/2026 10:55:00 PM', l: '/newsevents/speech/bowman20261014a.htm' }]);
  const discussion = () => row({ id: 'disc', speaker_name: bowman, statement_datetime: '2026-10-14T09:40:00+00:00' });
  const speech = () => row({ id: 'speech', speaker_name: bowman, statement_datetime: '2026-10-15T02:55:00+00:00' });
  const actions = (plan: { speech_id: string; action: string; url_from: string | null; source_url: string | null }[]) =>
    Object.fromEntries(plan.map((p) => [p.speech_id, [p.action, p.url_from, p.source_url]]));

  it('10/14: with both the discussion and the speech pending, only the speech is linked (by its exact time)', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [discussion(), speech()];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss(P1014));
    frb.pages.set(FRB_SPEECHES_JSON_URL, json1014);
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...all, dryRun: true },
      NOW_M,
      new JobCounters(),
    );
    expect(actions(plan)).toEqual({
      disc: ['NO_SOURCE_URL', null, null],
      speech: ['FETCH', 'json_time', P1014],
    });
  });

  it('10/14 after the speech body was FETCHED: the discussion does not get the same URL (dry-run and a real run)', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [discussion(), { ...speech(), body_status: 'FETCHED', source_url: P1014 }];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss(P1014));
    frb.pages.set(FRB_SPEECHES_JSON_URL, json1014);
    frb.pages.set(P1014, frbPage('Supervisory modernization.'));
    const dry = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...all, dryRun: true },
      NOW_M,
      new JobCounters(),
    );
    expect(actions(dry.plan)).toEqual({ disc: ['NO_SOURCE_URL', null, null] });
    // 本番の実行でも、討論の行は数えず・書かず、講演の行(本文・URL)には触れない
    await ingestSpeechBodies(store, { frb, ecb: new FakeFetcher() }, all, NOW_M, new JobCounters());
    expect(store.claims).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(frb.requested).not.toContain(P1014);
    expect(store.rows.find((r) => r.id === 'speech')).toMatchObject({ body_status: 'FETCHED', source_url: P1014 });
    expect(store.rows.find((r) => r.id === 'disc')).toMatchObject({
      body_status: 'PENDING',
      source_url: null,
      body_attempts: 0,
    });
  });

  it('two rows of the same speaker on the same day: never linked by the date alone', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [
      row({ id: 'am', speaker_name: bowman, statement_datetime: '2026-11-05T14:00:00Z' }),
      row({ id: 'pm', speaker_name: bowman, statement_datetime: '2026-11-05T20:00:00Z' }),
    ];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss('https://www.federalreserve.gov/newsevents/speech/bowman20261105a.htm'));
    frb.pages.set(FRB_SPEECHES_JSON_URL, '[]'); // 時刻の手がかりなし
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...all, dryRun: true },
      NOW_M,
      new JobCounters(),
    );
    expect(actions(plan)).toEqual({ am: ['NO_SOURCE_URL', null, null], pm: ['NO_SOURCE_URL', null, null] });
  });

  it('a URL another row already uses is not reused by the date match', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    const U = 'https://www.federalreserve.gov/newsevents/speech/waller20261105a.htm';
    store.rows = [
      row({ id: 'cand', statement_datetime: '2026-11-05T15:00:00Z' }), // ウォラー、日付では一意
      row({ id: 'holder', statement_datetime: '2026-11-07T15:00:00Z', body_status: 'FETCHED', source_url: U }),
    ];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss(U));
    frb.pages.set(FRB_SPEECHES_JSON_URL, '[]');
    const counters = new JobCounters();
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...all, dryRun: true },
      NOW_M,
      counters,
    );
    expect(actions(plan)).toEqual({ cand: ['NO_SOURCE_URL', null, null] });
    expect(counters.skipReasons).toMatchObject({ URL_IN_USE: 1 });
  });

  it('11/10: the exact-time match still links both rows to the same page (also when one of them is already FETCHED)', async () => {
    const jsonTimes = JSON.stringify([
      { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110a.htm' },
      { d: '11/10/2026 6:30:00 PM', l: '', stub: '/newsevents/speech/bowman20261110a.htm' },
    ]);
    const a = () => row({ id: 'b1530', speaker_name: bowman, statement_datetime: '2026-11-10T20:30:00+00:00' });
    const b = () => row({ id: 'b1830', speaker_name: bowman, statement_datetime: '2026-11-10T23:30:00+00:00' });
    for (const rows of [
      [a(), b()],
      [{ ...a(), body_status: 'FETCHED', source_url: P1110 }, b()],
    ]) {
      const store = new FakeStore();
      const frb = new FakeFetcher();
      store.rows = rows;
      frb.pages.set(FRB_SPEECHES_RSS_URL, rss(P1110));
      frb.pages.set(FRB_SPEECHES_JSON_URL, jsonTimes);
      const { plan } = await ingestSpeechBodies(
        store,
        { frb, ecb: new FakeFetcher() },
        { ...all, dryRun: true },
        NOW_M,
        new JobCounters(),
      );
      for (const p of plan)
        expect([p.action, p.url_from, p.source_url], p.speech_id).toEqual(['FETCH', 'json_time', P1110]);
      expect(plan.map((p) => p.speech_id)).toEqual(rows.filter((r) => r.body_status === 'PENDING').map((r) => r.id));
    }
  });

  it('exact time but the page is used by a row that does not match it exactly (URL conflict): not linked', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [
      row({ id: 'cand', speaker_name: bowman, statement_datetime: '2026-11-10T20:30:00+00:00' }),
      row({
        id: 'odd',
        speaker_name: bowman,
        statement_datetime: '2026-11-09T12:00:00+00:00',
        body_status: 'FETCHED',
        source_url: P1110,
      }),
      row({ id: 'odd2', speaker_name: bowman, statement_datetime: '2026-11-10T12:00:00+00:00' }), // 同じ日の別の行(日付は一意にならない)
    ];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss());
    frb.pages.set(
      FRB_SPEECHES_JSON_URL,
      JSON.stringify([{ d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110a.htm' }]),
    );
    const counters = new JobCounters();
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...all, dryRun: true },
      NOW_M,
      counters,
    );
    expect(actions(plan)).toEqual({ cand: ['NO_SOURCE_URL', null, null], odd2: ['NO_SOURCE_URL', null, null] });
    expect(counters.skipReasons).toMatchObject({ URL_CONFLICT: 1 });
  });

  it('several exact-time candidates or a time mismatch: never FETCH', async () => {
    const store = new FakeStore();
    const frb = new FakeFetcher();
    store.rows = [
      row({ id: 'two', speaker_name: bowman, statement_datetime: '2026-11-10T20:30:00+00:00' }),
      row({ id: 'off', speaker_name: bowman, statement_datetime: '2026-11-10T20:31:00+00:00' }),
    ];
    frb.pages.set(FRB_SPEECHES_RSS_URL, rss());
    frb.pages.set(
      FRB_SPEECHES_JSON_URL,
      JSON.stringify([
        { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110a.htm' },
        { d: '11/10/2026 3:30:00 PM', l: '/newsevents/speech/bowman20261110b.htm' },
      ]),
    );
    const { plan } = await ingestSpeechBodies(
      store,
      { frb, ecb: new FakeFetcher() },
      { ...all, dryRun: true },
      NOW_M,
      new JobCounters(),
    );
    expect(actions(plan)).toEqual({ two: ['NO_SOURCE_URL', null, null], off: ['NO_SOURCE_URL', null, null] });
  });
});
