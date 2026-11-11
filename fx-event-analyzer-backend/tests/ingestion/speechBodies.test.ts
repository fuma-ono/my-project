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
            (r.body_status === 'PENDING' || (r.body_status === 'FAILED' && r.body_attempts < maxAttempts)) &&
            Date.parse(r.statement_datetime) >= Date.parse(sinceIso),
        )
        .map((r) => ({ ...r })),
    );
  }
  private guard(id: string, expectedAttempts: number) {
    const row = this.rows.find((r) => r.id === id)!;
    return ['PENDING', 'FAILED'].includes(row.body_status) && row.body_attempts === expectedAttempts ? row : null;
  }
  claimBodyAttempt(id: string, expectedAttempts: number): Promise<boolean> {
    const row = this.guard(id, expectedAttempts);
    if (!row) return Promise.resolve(false);
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
