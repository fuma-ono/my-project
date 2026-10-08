#!/usr/bin/env node
// HQ instruction "FX Event Analyzer UIスクリーンショット取得" (2026-09-18):
// a standalone, dependency-free HTTP server that stands in for both
// Supabase Auth (GoTrue) and the Backend Read API, so the real iOS app
// (unmodified) can log in and load real screens for screenshotting in CI
// without Docker (GitHub-hosted macOS runners cannot run `supabase start`
// — no Docker support — see the design.md v1.10 Provider-decision session
// for the underlying investigation).
//
// This is a UI-screenshot fixture only: it is never used by production
// code, the real Backend (`src/`), or any existing test. It reuses the
// exact response shapes the real routes return (src/routes/*.ts) so the
// app renders the same way it would against the real Backend, and reuses
// example values in the spirit of supabase/seed.sql (same indicator/event/
// FX pair flavor), but does not read seed.sql or touch any real Supabase
// project.
//
// One documented exception: `/api/v1/home`'s `speeches` field (HQ
// instruction 2026-10-06, "直近の要人発言に何か表示されるようにして").
// `SpeechEvent` is explicitly P2/out of scope for the real Backend
// (db-design.md, features.md), so `src/routes/home.ts` does not and will
// not return this field — it exists only here, so HQ can review the
// Home screen's 直近の要人発言 card layout via CI screenshots. The iOS
// app's `HomeResponse.speeches` is optional for exactly this reason: a
// real Backend response (this field absent) still decodes fine and the
// card still renders its empty state, unchanged.
//
// Usage: node scripts/ui-screenshot-mock-server.mjs [port]
// Serves BOTH:
//   - /auth/v1/*  (minimal GoTrue-compatible surface for supabase-swift's
//     Auth client — see Sources/Auth/Types.swift's Session/User Codable
//     shape, snake_case via .convertFromSnakeCase)
//   - /api/v1/*   (the Backend Read API surface the iOS app's
//     URLSessionAPIClient calls)
// on the same port, so a single SUPABASE_URL / API_BASE_URL pair
// (both http://127.0.0.1:<port>, API_BASE_URL with an /api/v1 suffix)
// points the app at this one process.

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8090);

// ---------------------------------------------------------------------------
// Fixed IDs (stable across a run so navigation between screens round-trips
// to the same records — the app passes IDs it received from one response
// as path/query params to the next).

const INDICATOR_ID = '11111111-1111-1111-1111-111111111111'; // 米国CPI
const INDICATOR_ID_NFP = '11111111-1111-1111-1111-111111111112'; // 米国NFP
const INDICATOR_ID_FOMC = '11111111-1111-1111-1111-111111111113'; // FOMC
const INDICATOR_ID_JP_CPI = '11111111-1111-1111-1111-111111111114'; // 日本CPI
const FX_PAIR_ID = '22222222-2222-2222-2222-222222222222'; // USDJPY
const EVENT_ID = '33333333-3333-3333-3333-333333333333'; // 本日発表済み
const EVENT_ID_UPCOMING = '44444444-4444-4444-4444-444444444444'; // 本日発表前(NFP)
// HQ指示(2026-10-02、4回目)「今日の重要指標は3つ表示してください」:
// Homeの「今日の重要イベント」はSCHEDULED(本日発表前)のイベントのみを
// 表示する(HomeViewModel.upcomingEvents)。このUIスクリーンショット用
// フィクスチャにはSCHEDULEDイベントが1件(NFP)しか無かったため、同じ
// 性質のテストデータとしてFOMC/日本CPIのSCHEDULEDイベントを2件追加し、
// 参考画像(3件表示)と同じ件数をCIキャプチャで確認できるようにした。
const EVENT_ID_UPCOMING_FOMC = '44444444-4444-4444-4444-444444444445'; // 本日発表前(FOMC)
const EVENT_ID_UPCOMING_JP_CPI = '44444444-4444-4444-4444-444444444446'; // 本日発表前(日本CPI)
const TEST_USER_ID = '99999999-9999-9999-9999-999999999999';
const TEST_USER_EMAIL = 'ui-screenshot@example.com';

const HISTORICAL_EVENT_IDS = [
  '55555555-5555-5555-5555-555555555551',
  '55555555-5555-5555-5555-555555555552',
  '55555555-5555-5555-5555-555555555553',
  '55555555-5555-5555-5555-555555555554',
  '55555555-5555-5555-5555-555555555555',
  '55555555-5555-5555-5555-555555555556',
];

// HQ指示(2026-10-06)「直近の要人発言に何か表示されるようにして」参考画像
// 固定ID — 本番Backendには対応するSpeechEventテーブル・APIが無い
// (ui-screenshot-mock-server.mjsの冒頭コメント参照)。
const SPEECH_IDS = [
  '66666666-6666-6666-6666-666666666661',
  '66666666-6666-6666-6666-666666666662',
  '66666666-6666-6666-6666-666666666663',
];

const now = () => new Date();
const isoMinusHours = (hours) => new Date(now().getTime() - hours * 3_600_000).toISOString();
const isoPlusHours = (hours) => new Date(now().getTime() + hours * 3_600_000).toISOString();
const isoMinusDays = (days) => new Date(now().getTime() - days * 86_400_000).toISOString();

const EVENT_RELEASE_DATETIME = isoMinusHours(3);
const EVENT_UPCOMING_RELEASE_DATETIME = isoPlusHours(5);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

// ---------------------------------------------------------------------------
// /auth/v1/* — minimal GoTrue-compatible surface. supabase-swift's Auth
// client decodes with JSONDecoder().keyDecodingStrategy = .convertFromSnakeCase
// (Sources/Auth/Defaults.swift) against the Session/User structs in
// Sources/Auth/Types.swift — field names below match those exactly.

function authSession() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: 'ui-screenshot-mock-access-token',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: nowSeconds + 86400,
    refresh_token: 'ui-screenshot-mock-refresh-token',
    user: {
      id: TEST_USER_ID,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      email: TEST_USER_EMAIL,
      created_at: isoMinusDays(30),
      updated_at: isoMinusDays(1),
      is_anonymous: false,
    },
  };
}

function handleAuth(req, res, pathname) {
  // Every /auth/v1/* call (password grant, refresh, user lookup, ...)
  // gets a fresh, valid session/user — this fixture only needs "always
  // succeeds", never real credential checking.
  if (pathname === '/auth/v1/user') {
    json(res, 200, authSession().user);
    return;
  }
  json(res, 200, authSession());
}

// ---------------------------------------------------------------------------
// /api/v1/* — Backend Read API fixture data, shaped exactly like the real
// routes (src/routes/home.ts, events.ts, indicators.ts, historical.ts).

const INDICATOR_US_CPI = {
  id: INDICATOR_ID,
  code: 'US_CPI',
  name: '米国CPI(消費者物価指数)',
  country_code: 'US',
  currency_code: 'USD',
  importance: 'HIGH',
  description: '米国労働省が毎月発表する消費者物価指数。インフレ動向を示す代表的指標。',
  frequency: 'MONTHLY',
  unit: '%',
  source: 'U.S. Bureau of Labor Statistics',
  source_url: 'https://www.bls.gov/cpi/',
  favorable_direction: 'HIGHER_IS_POSITIVE',
};

const INDICATORS_LIST = [
  INDICATOR_US_CPI,
  {
    id: INDICATOR_ID_NFP,
    code: 'US_NFP',
    name: '米国雇用統計(非農業部門雇用者数)',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description: '米国労働省が毎月発表する非農業部門の雇用者数増減。',
    frequency: 'MONTHLY',
    unit: '千人',
    source: 'U.S. Bureau of Labor Statistics',
    source_url: 'https://www.bls.gov/ces/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
  },
  {
    id: INDICATOR_ID_FOMC,
    code: 'US_FOMC',
    name: 'FOMC政策金利',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description: '米国連邦公開市場委員会が決定する政策金利。',
    frequency: 'IRREGULAR',
    unit: '%',
    source: 'Federal Reserve',
    source_url: 'https://www.federalreserve.gov/',
    favorable_direction: 'NEUTRAL',
  },
  {
    id: INDICATOR_ID_JP_CPI,
    code: 'JP_CPI',
    name: '日本CPI(消費者物価指数)',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'MEDIUM',
    description: '総務省統計局が毎月発表する日本の消費者物価指数。',
    frequency: 'MONTHLY',
    unit: '%',
    source: '総務省統計局',
    source_url: 'https://www.stat.go.jp/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
  },
];

const RELATED_FX_PAIRS = [{ fx_pair_id: FX_PAIR_ID, symbol: 'USDJPY', priority: 1 }];

const RELEASE_SNAPSHOT = {
  forecast: 3.1,
  actual: 3.3,
  previous: 3.0,
  unit: '%',
  source: 'U.S. Bureau of Labor Statistics',
  source_url: 'https://www.bls.gov/cpi/',
  captured_at: EVENT_RELEASE_DATETIME,
  surprise: 0.2,
  surprise_direction: 'POSITIVE',
};

const EXPLANATION = {
  version: 1,
  explanation_type: 'FACT_SUMMARY',
  summary:
    'エネルギー価格の上昇と住居費の高止まりが市場予想を上回る要因となった。前月からのコア指数の伸びも継続している。',
  source: 'U.S. Bureau of Labor Statistics',
  source_url: 'https://www.bls.gov/cpi/',
  published_at: EVENT_RELEASE_DATETIME,
};

function homeHandler() {
  return {
    date: now().toISOString().slice(0, 10),
    timezone: 'UTC',
    events: [
      {
        event_id: EVENT_ID,
        indicator_id: INDICATOR_ID,
        indicator_name: INDICATOR_US_CPI.name,
        unit: INDICATOR_US_CPI.unit,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        release_datetime: EVENT_RELEASE_DATETIME,
        release_datetime_precision: 'EXACT',
        status: 'RELEASED',
        data_status: 'READY',
        forecast: RELEASE_SNAPSHOT.forecast,
        actual: RELEASE_SNAPSHOT.actual,
        previous: RELEASE_SNAPSHOT.previous,
        surprise: RELEASE_SNAPSHOT.surprise,
        surprise_direction: RELEASE_SNAPSHOT.surprise_direction,
        related_fx_pairs: RELATED_FX_PAIRS,
      },
      {
        event_id: EVENT_ID_UPCOMING,
        indicator_id: INDICATOR_ID_NFP,
        indicator_name: INDICATORS_LIST[1].name,
        unit: INDICATORS_LIST[1].unit,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        release_datetime: EVENT_UPCOMING_RELEASE_DATETIME,
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'DATA_PENDING',
        forecast: 180,
        actual: null,
        previous: 175,
        surprise: null,
        surprise_direction: null,
        related_fx_pairs: RELATED_FX_PAIRS,
      },
      {
        event_id: EVENT_ID_UPCOMING_FOMC,
        indicator_id: INDICATOR_ID_FOMC,
        indicator_name: INDICATORS_LIST[2].name,
        unit: INDICATORS_LIST[2].unit,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        release_datetime: isoPlusHours(2),
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'DATA_PENDING',
        // HQ指示(2026-10-08): FOMCだけ予想・前回が無く行の配置がそろわないため値を入れる。
        forecast: 4.5,
        actual: null,
        previous: 4.75,
        surprise: null,
        surprise_direction: null,
        related_fx_pairs: RELATED_FX_PAIRS,
      },
      {
        event_id: EVENT_ID_UPCOMING_JP_CPI,
        indicator_id: INDICATOR_ID_JP_CPI,
        indicator_name: INDICATORS_LIST[3].name,
        unit: INDICATORS_LIST[3].unit,
        country_code: 'JP',
        currency_code: 'JPY',
        importance: 'MEDIUM',
        release_datetime: isoPlusHours(8),
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'DATA_PENDING',
        forecast: 2.9,
        actual: null,
        previous: 2.8,
        surprise: null,
        surprise_direction: null,
        related_fx_pairs: [],
      },
    ],
    major_fx: majorFxRows(),
    // HQ指示(2026-10-06)「直近の要人発言に何か表示されるようにして」の
    // 参考画像内容を再現したUIスクリーンショット専用フィクスチャ — ファイル
    // 冒頭コメントの「documented exception」参照。本番`/home`ルートは
    // このフィールドを返さない。
    //
    // HQ再指摘(2026-10-06、2回目、参考画像をピクセル単位で再確認)
    // 「発言前と現在それぞれの数字を付けて」に伴い、organization/
    // reaction_price_before/reaction_price_after/reaction_pipsを追加
    // (参考画像の表示値をそのまま採用 — 155.42-155.14=+28pips等、全て
    // 整合する値)。
    //
    // HQ指示(2026-10-08)「データを合わせて」: 「現在」は通貨ペアカードと同じ
    // `MOCK_FX_QUOTES`の価格にし、「発言前」はpipsが合うよう逆算した値にした。
    speeches: [
      {
        speech_id: SPEECH_IDS[0],
        country_code: 'US',
        speaker_name: 'パウエルFRB議長',
        statement_datetime: isoMinusHours(3),
        headline: 'インフレ率は依然として高い',
        organization: 'FRB',
        reaction_fx_symbol: 'USD/JPY',
        reaction_price_before: 155.14,
        reaction_price_after: 155.42,
        reaction_pips: 28,
      },
      {
        speech_id: SPEECH_IDS[1],
        country_code: 'EU',
        speaker_name: 'ラガルドECB総裁',
        statement_datetime: isoMinusHours(9),
        headline: '金利は十分な制約的な水準にある',
        organization: 'ECB',
        reaction_fx_symbol: 'EUR/USD',
        reaction_price_before: 1.0839,
        reaction_price_after: 1.0821,
        reaction_pips: -18,
      },
      {
        speech_id: SPEECH_IDS[2],
        country_code: 'GB',
        speaker_name: 'ベイリーBOE総裁',
        statement_datetime: isoMinusHours(14),
        headline: '金融政策は引き締め的なスタンスを維持',
        organization: 'BOE',
        reaction_fx_symbol: 'GBP/USD',
        reaction_price_before: 1.274,
        reaction_price_after: 1.2718,
        reaction_pips: -22,
      },
    ],
  };
}

// SCR-026 ホーム通貨ペア編集: fake quotes for every pair in FX_PAIRS.
const MOCK_FX_QUOTES = {
  USDJPY: { price: 155.42, change: 0.38, change_percent: 0.25 },
  EURUSD: { price: 1.0821, change: -0.0015, change_percent: -0.14 },
  EURJPY: { price: 168.24, change: 0.12, change_percent: 0.07 },
  GBPJPY: { price: 197.65, change: -0.42, change_percent: -0.21 },
  AUDUSD: { price: 0.6634, change: 0.0021, change_percent: 0.32 },
  GBPUSD: { price: 1.2718, change: -0.0034, change_percent: -0.27 },
  USDCHF: { price: 0.8842, change: 0.0012, change_percent: 0.14 },
  AUDJPY: { price: 103.11, change: 0.27, change_percent: 0.26 },
  CADJPY: { price: 113.58, change: -0.09, change_percent: -0.08 },
};
const DEFAULT_HOME_FX_PAIR_SYMBOLS = ['USDJPY', 'EURUSD', 'EURJPY'];

/** GET /home major_fx: the saved settings.home.fx_pairs in that order, else
 * the default 3 (src/domain/homeFxPairs.ts). Unknown symbols are skipped. */
function majorFxRows() {
  const symbols = settingsFixture.home.fx_pairs ?? DEFAULT_HOME_FX_PAIR_SYMBOLS;
  return symbols.flatMap((symbol) => {
    const pair = FX_PAIRS.find((row) => row.symbol === symbol);
    if (!pair) return [];
    const quote = MOCK_FX_QUOTES[symbol] ?? { price: 100, change: 0, change_percent: 0 };
    return [{ fx_pair_id: pair.fx_pair_id, symbol, ...quote, timestamp: isoMinusHours(1) }];
  });
}

function indicatorsListHandler() {
  return {
    data: INDICATORS_LIST,
    meta: { page: 1, limit: 20, total: INDICATORS_LIST.length, has_next: false },
  };
}

function indicatorDetailHandler(indicatorId) {
  const indicator = INDICATORS_LIST.find((row) => row.id === indicatorId);
  if (!indicator) return null;
  return {
    indicator,
    favorable_direction: indicator.favorable_direction,
    related_fx_pairs: indicatorId === INDICATOR_ID ? RELATED_FX_PAIRS : [],
    latest_event:
      indicatorId === INDICATOR_ID
        ? { id: EVENT_ID, release_datetime: EVENT_RELEASE_DATETIME, status: 'RELEASED' }
        : null,
  };
}

function indicatorEventsHandler(indicatorId) {
  if (indicatorId !== INDICATOR_ID) {
    return { data: [], meta: { page: 1, limit: 10, total: 0, has_next: false } };
  }
  const rows = [
    {
      event_id: EVENT_ID,
      indicator_id: INDICATOR_ID,
      release_datetime: EVENT_RELEASE_DATETIME,
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: 'RELEASED',
      data_status: 'READY',
      forecast: RELEASE_SNAPSHOT.forecast,
      actual: RELEASE_SNAPSHOT.actual,
      previous: RELEASE_SNAPSHOT.previous,
      surprise: RELEASE_SNAPSHOT.surprise,
      surprise_direction: RELEASE_SNAPSHOT.surprise_direction,
    },
    ...HISTORICAL_EVENT_IDS.map((id, index) => historicalIndicatorEventRow(id, index)),
  ];
  return { data: rows, meta: { page: 1, limit: 10, total: rows.length, has_next: false } };
}

function historicalIndicatorEventRow(id, index) {
  const surprise = [0.2, -0.1, 0.0, 0.3, -0.2, 0.1][index % 6];
  return {
    event_id: id,
    indicator_id: INDICATOR_ID,
    release_datetime: isoMinusDays(30 * (index + 1) + 3),
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status: 'RELEASED',
    data_status: 'READY',
    forecast: 3.0 + index * 0.05,
    actual: 3.0 + index * 0.05 + surprise,
    previous: 2.9 + index * 0.05,
    surprise,
    surprise_direction: surprise > 0 ? 'POSITIVE' : surprise < 0 ? 'NEGATIVE' : 'NEUTRAL',
  };
}

function eventDetailHandler(eventId) {
  const isUpcoming = eventId === EVENT_ID_UPCOMING;
  return {
    event: {
      id: eventId,
      indicator_id: INDICATOR_ID,
      indicator_name: INDICATOR_US_CPI.name,
      country_code: 'US',
      currency_code: 'USD',
      release_datetime: isUpcoming ? EVENT_UPCOMING_RELEASE_DATETIME : EVENT_RELEASE_DATETIME,
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: isUpcoming ? 'SCHEDULED' : 'RELEASED',
      data_status: isUpcoming ? 'DATA_PENDING' : 'READY',
      revision_status: 'NONE',
    },
    snapshot: isUpcoming ? null : RELEASE_SNAPSHOT,
    analysis: {
      surprise: isUpcoming ? null : RELEASE_SNAPSHOT.surprise,
      surprise_direction: isUpcoming ? null : RELEASE_SNAPSHOT.surprise_direction,
    },
    explanation: isUpcoming ? null : EXPLANATION,
    related_fx_pairs: [
      {
        fx_pair_id: FX_PAIR_ID,
        symbol: 'USDJPY',
        priority: 1,
        reaction: isUpcoming
          ? { timeframe: '5m', pips: null, change_percent: null, analysis_status: 'DATA_PENDING' }
          : { timeframe: '5m', pips: 12.3, change_percent: 0.08, analysis_status: 'READY' },
      },
    ],
    available_timeframes: ['1m', '5m', '15m', '30m', '60m'],
  };
}

const TIMEFRAME_REACTIONS = {
  '1m': { pips: 4.1, change_percent: 0.03, max_upward_pips: 5.2, max_downward_pips: -1.0 },
  '5m': { pips: 12.3, change_percent: 0.08, max_upward_pips: 14.0, max_downward_pips: -2.1 },
  '15m': { pips: 18.7, change_percent: 0.12, max_upward_pips: 20.5, max_downward_pips: -3.4 },
  '30m': { pips: 22.4, change_percent: 0.14, max_upward_pips: 24.8, max_downward_pips: -4.0 },
  '60m': { pips: 19.9, change_percent: 0.13, max_upward_pips: 25.1, max_downward_pips: -6.2 },
};

function reactionRow(timeframe) {
  const base = TIMEFRAME_REACTIONS[timeframe];
  const preReleasePrice = 155.1;
  const pipSize = 0.01;
  const postReleasePrice = Number((preReleasePrice + base.pips * pipSize).toFixed(3));
  return {
    timeframe,
    post_release_price: postReleasePrice,
    movement: Number((base.pips * pipSize).toFixed(3)),
    pips: base.pips,
    change_percent: base.change_percent,
    max_upward: Number((base.max_upward_pips * pipSize).toFixed(3)),
    max_downward: Number((base.max_downward_pips * pipSize).toFixed(3)),
    max_upward_pips: base.max_upward_pips,
    max_downward_pips: base.max_downward_pips,
    analysis_status: 'READY',
  };
}

function reactionAllHandler(eventId) {
  return {
    event_id: eventId,
    fx_pair_id: FX_PAIR_ID,
    pre_release_price: 155.1,
    reactions: Object.keys(TIMEFRAME_REACTIONS).map(reactionRow),
  };
}

function reactionSingleHandler(eventId, timeframe) {
  const row = reactionRow(timeframe);
  return { event_id: eventId, fx_pair_id: FX_PAIR_ID, pre_release_price: 155.1, ...row };
}

function reactionChartHandler(eventId, timeframe) {
  const releaseMs = new Date(EVENT_RELEASE_DATETIME).getTime();
  const stepMinutes = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60 }[timeframe] ?? 5;
  const fromMs = releaseMs - 30 * 60_000;
  const toMs = releaseMs + 60 * 60_000;
  const prices = [];
  let price = 155.1;
  for (let t = fromMs; t <= toMs; t += stepMinutes * 60_000) {
    // deterministic gentle walk: flat before release, step up around it.
    const minutesFromRelease = (t - releaseMs) / 60_000;
    const drift = minutesFromRelease < 0 ? 0 : Math.min(0.123, 0.123 * (minutesFromRelease / 30));
    const wobble = Math.sin(t / 900_000) * 0.02;
    const open = Number(price.toFixed(3));
    price = Number((155.1 + drift + wobble).toFixed(3));
    const close = price;
    const high = Number(Math.max(open, close) + 0.01).toFixed(3);
    const low = Number(Math.min(open, close) - 0.01).toFixed(3);
    prices.push({
      timestamp: new Date(t).toISOString(),
      open,
      high: Number(high),
      low: Number(low),
      close,
      volume: null,
    });
  }
  return { event_id: eventId, fx_pair_id: FX_PAIR_ID, timeframe, release_datetime: EVENT_RELEASE_DATETIME, prices };
}

function eventHistoryHandler(eventId) {
  return {
    indicator_id: INDICATOR_ID,
    event: {
      id: eventId,
      indicator_name: INDICATOR_US_CPI.name,
      release_datetime: EVENT_RELEASE_DATETIME,
      importance: 'HIGH',
    },
    snapshot: RELEASE_SNAPSHOT,
    explanation: EXPLANATION,
    related_fx_pairs: [
      {
        fx_pair_id: FX_PAIR_ID,
        symbol: 'USDJPY',
        reactions: Object.keys(TIMEFRAME_REACTIONS).map((tf) => {
          const { analysis_status: analysisStatus, ...rest } = reactionRow(tf);
          return { ...rest, analysis_status: analysisStatus };
        }),
      },
    ],
  };
}

function comparisonEventsList() {
  // ComparisonEventSummary.CodingKeys maps `id` to JSON key `event_id`
  // (HistoricalComparisonModels.swift) — matches historicalRepository.ts's
  // HistoricalEventRow shape, NOT the plain `id` used elsewhere (e.g.
  // EventDetailEvent/HistoricalEventSummary use plain `id`).
  return [
    {
      event_id: EVENT_ID,
      release_datetime: EVENT_RELEASE_DATETIME,
      forecast: RELEASE_SNAPSHOT.forecast,
      actual: RELEASE_SNAPSHOT.actual,
      previous: RELEASE_SNAPSHOT.previous,
      surprise: RELEASE_SNAPSHOT.surprise,
      surprise_direction: RELEASE_SNAPSHOT.surprise_direction,
    },
    ...HISTORICAL_EVENT_IDS.map((id, index) => {
      const surprise = [0.2, -0.1, 0.0, 0.3, -0.2, 0.1][index % 6];
      return {
        event_id: id,
        release_datetime: isoMinusDays(30 * (index + 1) + 3),
        forecast: 3.0 + index * 0.05,
        actual: 3.0 + index * 0.05 + surprise,
        previous: 2.9 + index * 0.05,
        surprise,
        surprise_direction: surprise > 0 ? 'POSITIVE' : surprise < 0 ? 'NEGATIVE' : 'NEUTRAL',
      };
    }),
  ];
}

function comparisonHandler(indicatorId, timeframe) {
  const indicator = INDICATORS_LIST.find((row) => row.id === indicatorId) ?? INDICATOR_US_CPI;
  const events = comparisonEventsList();
  const meta = { page: 1, limit: 20, total: events.length, has_next: false };
  const advanced = { average_absolute_movement: 0.184, average_absolute_pips: 18.4 };

  if (timeframe === 'all') {
    const statsByTimeframe = Object.keys(TIMEFRAME_REACTIONS).map((tf) => ({
      timeframe: tf,
      stats: {
        average_movement: Number((TIMEFRAME_REACTIONS[tf].pips * 0.01).toFixed(3)),
        average_pips: TIMEFRAME_REACTIONS[tf].pips,
        max_movement: Number((TIMEFRAME_REACTIONS[tf].max_upward_pips * 0.01).toFixed(3)),
        min_movement: Number((TIMEFRAME_REACTIONS[tf].max_downward_pips * 0.01).toFixed(3)),
        upward_count: 5,
        downward_count: 1,
        no_change_count: 0,
      },
      advanced_statistics: { available: true, required_entitlement: null, data: advanced },
    }));
    return {
      indicator: { id: indicator.id, code: indicator.code, name: indicator.name },
      fx_pair_id: FX_PAIR_ID,
      total_events: events.length,
      analyzable_events: events.length,
      stats_by_timeframe: statsByTimeframe,
      events,
      meta,
    };
  }

  const base = TIMEFRAME_REACTIONS[timeframe] ?? TIMEFRAME_REACTIONS['5m'];
  return {
    indicator: { id: indicator.id, code: indicator.code, name: indicator.name },
    fx_pair_id: FX_PAIR_ID,
    timeframe,
    total_events: events.length,
    analyzable_events: events.length,
    stats: {
      average_movement: Number((base.pips * 0.01).toFixed(3)),
      average_pips: base.pips,
      max_movement: Number((base.max_upward_pips * 0.01).toFixed(3)),
      min_movement: Number((base.max_downward_pips * 0.01).toFixed(3)),
      upward_count: 5,
      downward_count: 1,
      no_change_count: 0,
    },
    advanced_statistics: { available: true, required_entitlement: null, data: advanced },
    events,
    meta,
  };
}

// SCR-016 通知設定 v2 (HQ指示 2026-10-05) — same shape as the real
// GET /settings (src/domain/userSettings.ts).
const settingsFixture = {
  notifications: {
    push: true,
    indicators: true,
    speeches: true,
    fx_pairs: null,
    importances: ['HIGH', 'MEDIUM'],
    lead_minutes: 5,
    // 通知しない時間帯 (2026-10-06). The mock never applies it to
    // /notifications/upcoming — screenshot runs happen at arbitrary times
    // and the list must stay populated.
    quiet_hours_enabled: false,
    quiet_start: '23:00',
    quiet_end: '07:00',
  },
  // SCR-018 表示・地域設定 / SCR-019 チャート設定 (2026-10-06): the new
  // fields carry the DB column defaults
  // (supabase/migrations/20261006000002_display_chart_settings_v2.sql).
  display: {
    language: 'ja',
    region: 'JP',
    timezone: 'Asia/Tokyo',
    theme: 'SYSTEM',
    text_size: 'STANDARD',
    date_format: 'YYYY/MM/DD',
    time_format: '24H',
    currency: 'JPY',
    week_start: 'MONDAY',
  },
  chart: {
    default_fx_pair_symbol: 'USDJPY',
    default_timeframe: '5m',
    chart_type: 'CANDLE',
    show_indicators: true,
    indicator_ma: true,
    indicator_bollinger: false,
    indicator_macd: true,
    indicator_rsi: false,
    indicator_stochastic: false,
    crosshair: true,
    price_line: true,
  },
  // SCR-026 ホーム通貨ペア編集 (2026-10-07). null = default (USDJPY, EURUSD, EURJPY).
  home: {
    fx_pairs: null,
  },
  updated_at: '2026-10-02T00:00:00Z',
};

const IMPORTANCE_ORDER = ['HIGH', 'MEDIUM', 'LOW'];

/** PATCH /settings: merge each group present in the body into the fixture
 * (no validation — the real Backend does that) and return the result, so
 * toggles made during a screenshot run stick when the screen reloads. */
function patchSettings(rawBody) {
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return null;
  }
  for (const group of ['notifications', 'display', 'chart', 'home']) {
    if (body && typeof body[group] === 'object' && body[group] !== null) {
      Object.assign(settingsFixture[group], body[group]);
    }
  }
  settingsFixture.notifications.importances = IMPORTANCE_ORDER.filter((level) =>
    settingsFixture.notifications.importances.includes(level),
  );
  settingsFixture.updated_at = isoSeconds(now());
  return settingsFixture;
}

// ---------------------------------------------------------------------------
// FX pairs / 要人発言 / upcoming notifications (HQ指示 2026-10-05). Dates
// are relative to now and formatted WITHOUT fractional seconds — the iOS
// app decodes with JSONDecoder's .iso8601 strategy, which rejects them.

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const isoSecondsPlusMinutes = (minutes) => isoSeconds(new Date(now().getTime() + minutes * 60_000));

const FX_PAIRS = [
  { fx_pair_id: '22222222-2222-2222-2222-222222222226', symbol: 'AUDJPY', base_currency: 'AUD', quote_currency: 'JPY' },
  { fx_pair_id: '22222222-2222-2222-2222-222222222227', symbol: 'AUDUSD', base_currency: 'AUD', quote_currency: 'USD' },
  { fx_pair_id: '22222222-2222-2222-2222-222222222228', symbol: 'CADJPY', base_currency: 'CAD', quote_currency: 'JPY' },
  { fx_pair_id: '22222222-2222-2222-2222-222222222224', symbol: 'EURJPY', base_currency: 'EUR', quote_currency: 'JPY' },
  { fx_pair_id: '22222222-2222-2222-2222-222222222223', symbol: 'EURUSD', base_currency: 'EUR', quote_currency: 'USD' },
  { fx_pair_id: '22222222-2222-2222-2222-222222222225', symbol: 'GBPJPY', base_currency: 'GBP', quote_currency: 'JPY' },
  { fx_pair_id: '22222222-2222-2222-2222-222222222229', symbol: 'GBPUSD', base_currency: 'GBP', quote_currency: 'USD' },
  { fx_pair_id: '22222222-2222-2222-2222-22222222222a', symbol: 'USDCHF', base_currency: 'USD', quote_currency: 'CHF' },
  { fx_pair_id: FX_PAIR_ID, symbol: 'USDJPY', base_currency: 'USD', quote_currency: 'JPY' },
];

const SPEAKERS = {
  powell: {
    speaker_id: '66666666-6666-6666-6666-666666666661',
    name: 'ジェローム・パウエル',
    title: 'FRB議長',
    organization: 'FRB',
    country_code: 'US',
    currency_code: 'USD',
  },
  ueda: {
    speaker_id: '66666666-6666-6666-6666-666666666662',
    name: '植田和男',
    title: '日本銀行総裁',
    organization: '日本銀行',
    country_code: 'JP',
    currency_code: 'JPY',
  },
  lagarde: {
    speaker_id: '66666666-6666-6666-6666-666666666663',
    name: 'クリスティーヌ・ラガルド',
    title: 'ECB総裁',
    organization: 'ECB',
    country_code: 'EU',
    currency_code: 'EUR',
  },
};

const SPEECH_ID_POWELL_UPCOMING = '77777777-7777-7777-7777-777777777771';
const SPEECH_ID_UEDA_UPCOMING = '77777777-7777-7777-7777-777777777772';
const SPEECH_ID_UEDA_SOON = '77777777-7777-7777-7777-777777777776';

function speechesFixture() {
  return [
    {
      speech_id: SPEECH_ID_POWELL_UPCOMING,
      speaker: SPEAKERS.powell,
      title: '経済見通しに関する講演',
      summary: null,
      statement_datetime: isoSecondsPlusMinutes(26 * 60),
      importance: 'HIGH',
      status: 'SCHEDULED',
    },
    {
      speech_id: SPEECH_ID_UEDA_UPCOMING,
      speaker: SPEAKERS.ueda,
      title: '国会答弁',
      summary: null,
      statement_datetime: isoSecondsPlusMinutes(8 * 60),
      importance: 'MEDIUM',
      status: 'SCHEDULED',
    },
    {
      speech_id: SPEECH_ID_UEDA_SOON,
      speaker: SPEAKERS.ueda,
      title: '金融経済懇談会での講演',
      summary: null,
      statement_datetime: isoSecondsPlusMinutes(2),
      importance: 'MEDIUM',
      status: 'SCHEDULED',
    },
    {
      speech_id: '77777777-7777-7777-7777-777777777773',
      speaker: SPEAKERS.lagarde,
      title: '欧州議会での証言',
      summary: 'ユーロ圏のインフレ動向について説明した。',
      statement_datetime: isoSecondsPlusMinutes(-2 * 24 * 60),
      importance: 'MEDIUM',
      status: 'DELIVERED',
    },
    {
      speech_id: '77777777-7777-7777-7777-777777777774',
      speaker: SPEAKERS.ueda,
      title: '金融政策決定会合後の記者会見',
      summary: '現行の金融緩和の枠組みを維持する方針を説明した。',
      statement_datetime: isoSecondsPlusMinutes(-5 * 24 * 60),
      importance: 'HIGH',
      status: 'DELIVERED',
    },
    {
      speech_id: '77777777-7777-7777-7777-777777777775',
      speaker: SPEAKERS.powell,
      title: 'FOMC後の記者会見',
      summary: '政策金利の据え置きを説明し、今後の判断はデータ次第との認識を示した。',
      statement_datetime: isoSecondsPlusMinutes(-9 * 24 * 60),
      importance: 'HIGH',
      status: 'DELIVERED',
    },
  ].sort((a, b) => b.statement_datetime.localeCompare(a.statement_datetime));
}

function speechesListHandler() {
  const data = speechesFixture();
  return { data, meta: { page: 1, limit: 20, total: data.length, has_next: false } };
}

/**
 * GET /notifications/upcoming. Deliberately ignores the real API's
 * notify_at >= from rule: the first two items' notify_at is a few minutes
 * in the PAST so the iOS in-app notification list has content in
 * screenshots; the last two are in the future. Quiet hours
 * (quiet_hours_enabled / quiet_start / quiet_end) are never applied either.
 */
function upcomingNotificationsHandler() {
  const lead = settingsFixture.notifications.lead_minutes;
  const item = (kind, id, title, speakerName, importance, scheduledInMinutes, country, currency, pairs) => ({
    kind,
    id,
    title,
    speaker_name: speakerName,
    importance,
    scheduled_at: isoSecondsPlusMinutes(scheduledInMinutes),
    notify_at: isoSecondsPlusMinutes(scheduledInMinutes - lead),
    country_code: country,
    currency_code: currency,
    related_fx_pairs: pairs,
  });
  const jpyPairs = ['AUDJPY', 'CADJPY', 'EURJPY', 'GBPJPY', 'USDJPY'];
  return {
    lead_minutes: lead,
    items: [
      // notify_at = now - 10 min / now - 1 min (past)
      item('INDICATOR', EVENT_ID_UPCOMING_JP_CPI, '日本CPI(消費者物価指数)', null, 'HIGH', lead - 10, 'JP', 'JPY', [
        'USDJPY',
        'EURJPY',
      ]),
      item(
        'SPEECH',
        SPEECH_ID_UEDA_SOON,
        '金融経済懇談会での講演',
        '植田和男',
        'MEDIUM',
        lead - 1,
        'JP',
        'JPY',
        jpyPairs,
      ),
      // future
      item('INDICATOR', EVENT_ID_UPCOMING, '米国雇用統計(非農業部門雇用者数)', null, 'HIGH', 5 * 60, 'US', 'USD', [
        'USDJPY',
        'EURUSD',
      ]),
      item(
        'SPEECH',
        SPEECH_ID_POWELL_UPCOMING,
        '経済見通しに関する講演',
        'ジェローム・パウエル',
        'HIGH',
        26 * 60,
        'US',
        'USD',
        ['AUDUSD', 'EURUSD', 'GBPUSD', 'USDCHF', 'USDJPY'],
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// SCR-010 経済カレンダー — GET /calendar (api-design.md §14.6、v1.14).
// HQ指示(2026-10-08): 月のマス目に重要度の点が並び、選んだ日の一覧に指標と
// 要人発言が時刻順で混ざって出るよう、撮影した月の約15日に
// 1〜4件ずつ並べる。本日は参考画像と同じ4件(08:50 国内企業物価指数 /
// 15:00 FOMCメンバー発言 / 20:35 ECB要人発言 / 21:30 雇用統計)にする。
// 時刻はこのサーバーのタイムゾーン(CIはシミュレーターと同じUTC、手元は日本時間)
// の時刻として書き、UTCに直して返す。日本時間で固定すると、UTCのシミュレーター
// では時刻がずれて別の日に分かれてしまうため。発表済み・発言済みかは撮影時刻で決める。
// 既存のフィクスチャと同じ指標(米国CPI・NFP・FOMC・日本CPI)は同じevent_idを
// 使い、タップ先の詳細画面が出るようにした。要人発言はGET /speeches/{id}が
// このカレンダー用の発言も返す(handleApi参照)。

const CALENDAR_SPEAKERS = {
  powell: SPEAKERS.powell,
  ueda: SPEAKERS.ueda,
  lagarde: SPEAKERS.lagarde,
  waller: {
    speaker_id: '66666666-6666-6666-6666-666666666664',
    name: 'クリストファー・ウォラー',
    title: 'FRB理事',
    organization: 'FRB',
    country_code: 'US',
    currency_code: 'USD',
  },
  schnabel: {
    speaker_id: '66666666-6666-6666-6666-666666666665',
    name: 'イザベル・シュナーベル',
    title: 'ECB専務理事',
    organization: 'ECB',
    country_code: 'EU',
    currency_code: 'EUR',
  },
  bailey: {
    speaker_id: '66666666-6666-6666-6666-666666666666',
    name: 'アンドリュー・ベイリー',
    title: 'BOE総裁',
    organization: 'BOE',
    country_code: 'GB',
    currency_code: 'GBP',
  },
};

// 指標: ['I', 'HH:MM'(日本時間), 指標名, country, currency, importance, event_id(任意)]
// 発言: ['S', 'HH:MM'(日本時間), 題名, CALENDAR_SPEAKERSのキー, importance]
const CALENDAR_TODAY_ITEMS = [
  ['I', '08:50', '国内企業物価指数', 'JP', 'JPY', 'HIGH'],
  ['S', '15:00', 'FOMCメンバー発言', 'waller', 'HIGH'],
  ['S', '20:35', 'ECB要人発言', 'schnabel', 'MEDIUM'],
  ['I', '21:30', '雇用統計(非農業部門雇用者数)', 'US', 'USD', 'HIGH', EVENT_ID_UPCOMING],
];

/** 日(1〜31) → その日の項目。本日と重なる日・その月に無い日(31日等)は使わない。 */
const CALENDAR_OTHER_DAYS = {
  1: [
    ['I', '08:50', '日銀短観(大企業製造業業況判断)', 'JP', 'JPY', 'HIGH'],
    ['I', '23:00', '米国ISM製造業景況指数', 'US', 'USD', 'HIGH'],
  ],
  2: [['I', '18:00', 'ユーロ圏消費者物価指数(速報値)', 'EU', 'EUR', 'HIGH']],
  3: [
    ['I', '21:30', '米国新規失業保険申請件数', 'US', 'USD', 'MEDIUM'],
    ['S', '23:00', 'FRB議長発言', 'powell', 'HIGH'],
  ],
  6: [
    ['I', '12:30', '豪州RBA政策金利', 'AU', 'AUD', 'HIGH'],
    ['I', '17:30', '英国サービス業PMI', 'GB', 'GBP', 'LOW'],
  ],
  9: [
    ['I', '08:50', '国内総生産(GDP)改定値', 'JP', 'JPY', 'MEDIUM'],
    ['S', '16:00', 'BOE総裁発言', 'bailey', 'MEDIUM'],
    ['I', '21:30', INDICATOR_US_CPI.name, 'US', 'USD', 'HIGH', EVENT_ID],
  ],
  12: [['I', '15:00', '英国GDP(月次)', 'GB', 'GBP', 'MEDIUM']],
  14: [
    ['I', '18:00', 'ユーロ圏GDP(改定値)', 'EU', 'EUR', 'LOW'],
    ['I', '21:30', '米国小売売上高', 'US', 'USD', 'HIGH'],
    ['S', '22:00', 'ECB総裁発言', 'lagarde', 'HIGH'],
  ],
  16: [['I', '09:30', '豪州雇用統計(失業率)', 'AU', 'AUD', 'HIGH']],
  17: [['I', '08:30', INDICATORS_LIST[3].name, 'JP', 'JPY', 'MEDIUM', EVENT_ID_UPCOMING_JP_CPI]],
  20: [
    ['S', '10:00', '日銀総裁発言', 'ueda', 'MEDIUM'],
    ['I', '21:30', '米国住宅着工件数', 'US', 'USD', 'LOW'],
  ],
  22: [
    ['I', '17:30', '英国小売売上高', 'GB', 'GBP', 'MEDIUM'],
    ['I', '22:45', '米国製造業PMI(速報値)', 'US', 'USD', 'MEDIUM'],
  ],
  24: [
    ['I', '12:00', '日銀金融政策決定会合(政策金利)', 'JP', 'JPY', 'HIGH'],
    ['S', '15:30', '日銀総裁会見', 'ueda', 'HIGH'],
    ['I', '21:15', 'ECB政策金利', 'EU', 'EUR', 'HIGH'],
    ['S', '21:45', 'ECB総裁会見', 'lagarde', 'HIGH'],
  ],
  27: [
    ['I', '03:00', INDICATORS_LIST[2].name, 'US', 'USD', 'HIGH', EVENT_ID_UPCOMING_FOMC],
    ['S', '03:30', 'FRB議長会見', 'powell', 'HIGH'],
  ],
  29: [['I', '21:30', '米国PCEデフレーター', 'US', 'USD', 'HIGH']],
  30: [
    ['I', '08:30', '東京都区部CPI', 'JP', 'JPY', 'LOW'],
    ['I', '10:30', '豪州小売売上高', 'AU', 'AUD', 'MEDIUM'],
  ],
};

/** 撮影した月(このサーバーのタイムゾーン)の全項目。kind・idはGET /calendarと同じ形。 */
function calendarFixture() {
  const offsetMs = -now().getTimezoneOffset() * 60_000;
  const localNow = new Date(now().getTime() + offsetMs);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const today = localNow.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const days = [[today, CALENDAR_TODAY_ITEMS]];
  for (const [day, specs] of Object.entries(CALENDAR_OTHER_DAYS)) {
    if (Number(day) !== today && Number(day) <= daysInMonth) days.push([Number(day), specs]);
  }

  const items = [];
  for (const [day, specs] of days) {
    specs.forEach((spec, index) => {
      const [hours, minutes] = spec[1].split(':').map(Number);
      const at = new Date(Date.UTC(year, month, day, hours, minutes) - offsetMs);
      const past = at.getTime() <= now().getTime();
      const serial = String(day * 10 + index).padStart(12, '0');
      if (spec[0] === 'I') {
        const [, , title, country, currency, importance, eventId] = spec;
        items.push({
          kind: 'INDICATOR',
          id: eventId ?? `cccccccc-cccc-cccc-cccc-${serial}`,
          title,
          speaker_name: null,
          country_code: country,
          currency_code: currency,
          importance,
          datetime: isoSeconds(at),
          datetime_precision: 'EXACT',
          status: past ? 'RELEASED' : 'SCHEDULED',
        });
      } else {
        const [, , title, speakerKey, importance] = spec;
        const speaker = CALENDAR_SPEAKERS[speakerKey];
        items.push({
          kind: 'SPEECH',
          id: `dddddddd-dddd-dddd-dddd-${serial}`,
          title,
          speaker_name: speaker.name,
          country_code: speaker.country_code,
          currency_code: speaker.currency_code,
          importance,
          datetime: isoSeconds(at),
          datetime_precision: 'EXACT',
          status: past ? 'DELIVERED' : 'SCHEDULED',
          speaker, // GET /speeches/{id}用。GET /calendarのResponseからは外す
        });
      }
    });
  }
  return items;
}

/** GET /speeches/{id}: カレンダー用の発言をSpeechSummaryの形で返す。 */
function calendarSpeechSummary(speechId) {
  const item = calendarFixture().find((row) => row.kind === 'SPEECH' && row.id === speechId);
  if (!item) return null;
  return {
    speech_id: item.id,
    speaker: item.speaker,
    title: item.title,
    summary: null,
    statement_datetime: item.datetime,
    importance: item.importance,
    status: item.status,
  };
}

/** GET /calendar: from(含む)〜to(含まない)、importance・currencyで絞り、
 * 日時 → INDICATORが先 → idの順。 */
function calendarHandler(searchParams) {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const importance = searchParams.get('importance');
  const currency = searchParams.get('currency');
  const fromMs = from ? Date.parse(from) : -Infinity;
  const toMs = to ? Date.parse(to) : Infinity;
  const kindOrder = { INDICATOR: 0, SPEECH: 1 };
  const items = calendarFixture()
    .filter((item) => {
      const at = Date.parse(item.datetime);
      if (at < fromMs || at >= toMs) return false;
      if (importance && item.importance !== importance) return false;
      if (currency && item.currency_code !== currency) return false;
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a.datetime) - Date.parse(b.datetime) ||
        kindOrder[a.kind] - kindOrder[b.kind] ||
        a.id.localeCompare(b.id),
    )
    .map(({ speaker: _speaker, ...item }) => item);
  return { from, to, items };
}

const accountFixture = () => ({
  user_id: TEST_USER_ID,
  display_name: '山田 太郎',
  birth_date: '1990-01-01',
  created_at: isoMinusDays(30),
  updated_at: isoMinusDays(1),
});

// ---------------------------------------------------------------------------
// SCR-020 ヘルプ・お問い合わせ (api-design.md §24.7/§24.8). In-memory, with a
// much simpler version of src/domain/support.ts: very short bodies get no
// reply (IGNORED), BUG category or a bug keyword gets the bug reply
// (ESCALATED — no GitHub Issue here), everything else the category's
// template reply (shortened versions of the real templates).

const SUPPORT_KINDS = ['INQUIRY', 'FEEDBACK'];
const SUPPORT_CATEGORIES = ['ACCOUNT', 'BILLING', 'NOTIFICATION', 'CHART', 'DATA', 'BUG', 'OTHER'];
const SUPPORT_BUG_PATTERN =
  /落ち(?:る|た|ます)|クラッシュ|不具合|バグ|エラー|フリーズ|強制終了|固ま(?:る|り)|動かない|(?:表示|反映)され(?:ない|ません)|(?:起動|ログイン)(?:し|でき)(?:ない|ません)|読み込めない/;
const SUPPORT_BUG_REPLY =
  '不具合のご報告ありがとうございます。開発チームで確認し、修正対象として登録しました。修正まで今しばらくお待ちいただけますと幸いです。';
const SUPPORT_FEEDBACK_REPLY =
  'ご意見ありがとうございます。いただいた内容は開発チームで確認し、今後の改善の参考にさせていただきます。';
const SUPPORT_INQUIRY_REPLIES = {
  ACCOUNT: 'お問い合わせありがとうございます。アカウント情報の確認・変更は、設定画面の「アカウント情報」から行えます。',
  BILLING:
    'お問い合わせありがとうございます。プランのお支払いはApp Storeのサブスクリプションで管理されています。解約や変更は、iPhoneの「設定」アプリ > Apple ID > サブスクリプションから行えます。',
  NOTIFICATION: 'お問い合わせありがとうございます。通知の対象や時間は、設定画面の「通知設定」から変更できます。',
  CHART:
    'お問い合わせありがとうございます。チャートの種類や表示するテクニカル指標は、設定画面の「チャート設定」から変更できます。',
  DATA: 'お問い合わせありがとうございます。各指標の値は発表元の公表値をもとに表示しています。発表直後は反映までお時間をいただく場合があります。',
  OTHER: 'お問い合わせありがとうございます。内容を確認いたしました。よくある質問もあわせてご覧いただけますと幸いです。',
};

/** Newest first. Seeded with one answered inquiry so the history list has content. */
const supportRequests = [
  {
    id: '88888888-8888-8888-8888-888888888881',
    kind: 'INQUIRY',
    category: 'NOTIFICATION',
    body: '通知が届く時間を変更できますか?',
    status: 'REPLIED',
    reply_body:
      'お問い合わせありがとうございます。通知の対象や時間は、設定画面の「通知設定」から変更できます。通知が届かない場合は、iPhoneの「設定」アプリ > 通知で、本アプリの通知が許可されているかもご確認ください。',
    replied_at: isoSeconds(new Date(now().getTime() - 2 * 86_400_000)),
    created_at: isoSeconds(new Date(now().getTime() - 2 * 86_400_000)),
  },
];
let supportRequestCounter = 1;

function createSupportRequest(rawBody) {
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { error: 'Invalid JSON body.' };
  }
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!SUPPORT_KINDS.includes(body?.kind)) return { error: 'kind: invalid value' };
  if (!SUPPORT_CATEGORIES.includes(body?.category)) return { error: 'category: invalid value' };
  if (text.length < 1 || text.length > 2000) return { error: 'body: must be 1-2000 characters' };

  let status = 'REPLIED';
  let reply = body.kind === 'FEEDBACK' ? SUPPORT_FEEDBACK_REPLY : SUPPORT_INQUIRY_REPLIES[body.category];
  if (Array.from(text).length < 2) {
    status = 'IGNORED';
    reply = null;
  } else if (body.category === 'BUG' || SUPPORT_BUG_PATTERN.test(text)) {
    status = 'ESCALATED';
    reply = SUPPORT_BUG_REPLY;
  }

  supportRequestCounter += 1;
  const createdAt = isoSeconds(now());
  const row = {
    id: `88888888-8888-8888-8888-${String(supportRequestCounter).padStart(12, '0')}`,
    kind: body.kind,
    category: body.category,
    body: text,
    status,
    reply_body: reply,
    replied_at: reply === null ? null : createdAt,
    created_at: createdAt,
  };
  supportRequests.unshift(row);
  return { row };
}

/** SCR-017の撮影用。`/__mock/subscription-plan`で切り替える(PRO / FREE)。 */
let mockSubscriptionPlan = 'PRO';

/** GET /subscription and POST /subscription/verify (api-design.md §25/§25.1). */
function subscriptionFixture() {
  if (mockSubscriptionPlan === 'FREE') {
    return { plan: 'FREE', status: null, started_at: null, expires_at: null, product_id: null };
  }
  return {
    plan: 'PRO',
    status: 'ACTIVE',
    started_at: '2026-09-06T03:00:00Z',
    expires_at: '2026-11-06T03:00:00Z',
    product_id: 'com.fumaono.fxeventanalyzer.pro.monthly',
  };
}

async function handleApi(req, res, pathname, searchParams, rawBody) {
  const segments = pathname
    .replace(/^\/api\/v1\//, '')
    .split('/')
    .filter(Boolean);

  if (pathname === '/api/v1/home') return json(res, 200, homeHandler());
  if (pathname === '/api/v1/indicators') return json(res, 200, indicatorsListHandler());
  // SCR-016/018/020/021 (api-design.md §24.4/§24.5). PATCH merges the body
  // into the fixture and answers with the result.
  if (pathname === '/api/v1/settings') {
    if (req.method === 'PATCH') {
      const updated = patchSettings(rawBody);
      if (!updated) return json(res, 422, { error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body.' } });
      return json(res, 200, updated);
    }
    return json(res, 200, settingsFixture);
  }
  if (pathname === '/api/v1/fx-pairs') return json(res, 200, { data: FX_PAIRS });
  if (pathname === '/api/v1/speeches') return json(res, 200, speechesListHandler());
  if (segments[0] === 'speeches' && segments.length === 2) {
    const speech = speechesFixture().find((row) => row.speech_id === segments[1]) ?? calendarSpeechSummary(segments[1]);
    if (!speech) return json(res, 404, { error: { code: 'SPEECH_NOT_FOUND', message: 'Speech not found.' } });
    return json(res, 200, speech);
  }
  if (pathname === '/api/v1/notifications/upcoming') return json(res, 200, upcomingNotificationsHandler());
  // SCR-010 経済カレンダー (api-design.md §14.6).
  if (pathname === '/api/v1/calendar') return json(res, 200, calendarHandler(searchParams));
  // SCR-015 アカウント情報 (api-design.md §24.1-§24.3). PATCH answers with
  // the same fixture; DELETE is never exercised by the screenshot run.
  if (pathname === '/api/v1/account') {
    if (req.method === 'DELETE') {
      res.writeHead(204);
      return res.end();
    }
    return json(res, 200, accountFixture());
  }
  // SCR-017 プラン・購読管理: 参考画像(HQ指示 2026-10-06)と同じく有料プラン加入中の状態で撮る。
  // 無料プランの画面は、UIテストが`POST /__mock/subscription-plan?plan=FREE`で切り替えてから撮る。
  if (pathname === '/api/v1/subscription') {
    return json(res, 200, subscriptionFixture());
  }
  // api-design.md §25.1: same shape as GET /subscription. No signature check
  // here — the screenshot run never sends a real StoreKit transaction.
  if (pathname === '/api/v1/subscription/verify' && req.method === 'POST') {
    return json(res, 200, subscriptionFixture());
  }

  // SCR-020 ヘルプ・お問い合わせ (api-design.md §24.7/§24.8).
  if (pathname === '/api/v1/support/requests') {
    if (req.method === 'POST') {
      const result = createSupportRequest(rawBody);
      if (result.error) return json(res, 422, { error: { code: 'VALIDATION_ERROR', message: result.error } });
      return json(res, 201, result.row);
    }
    return json(res, 200, { data: supportRequests.slice(0, 50) });
  }

  if (segments[0] === 'indicators' && segments.length === 2) {
    const detail = indicatorDetailHandler(segments[1]);
    if (!detail) return json(res, 404, { error: { code: 'INDICATOR_NOT_FOUND', message: 'Indicator not found.' } });
    return json(res, 200, detail);
  }
  if (segments[0] === 'indicators' && segments[2] === 'events') {
    return json(res, 200, indicatorEventsHandler(segments[1]));
  }
  if (segments[0] === 'indicators' && segments[2] === 'comparison') {
    const timeframe = searchParams.get('timeframe') ?? '5m';
    return json(res, 200, comparisonHandler(segments[1], timeframe));
  }
  if (segments[0] === 'events' && segments.length === 2) {
    return json(res, 200, eventDetailHandler(segments[1]));
  }
  if (segments[0] === 'events' && segments[2] === 'history') {
    return json(res, 200, eventHistoryHandler(segments[1]));
  }
  if (segments[0] === 'events' && segments[2] === 'reaction' && segments.length === 3) {
    const timeframe = searchParams.get('timeframe') ?? 'all';
    if (timeframe === 'all') return json(res, 200, reactionAllHandler(segments[1]));
    return json(res, 200, reactionSingleHandler(segments[1], timeframe));
  }
  if (segments[0] === 'events' && segments[2] === 'reaction' && segments[3] === 'chart') {
    const timeframe = searchParams.get('timeframe') ?? '5m';
    return json(res, 200, reactionChartHandler(segments[1], timeframe));
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: `No UI-screenshot fixture for ${pathname}` } });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rawBody = await readBody(req); // only PATCH /settings and POST /support/requests read it
  console.log(`[mock] ${req.method} ${url.pathname}${url.search}`);

  if (url.pathname.startsWith('/auth/v1/')) {
    return handleAuth(req, res, url.pathname);
  }
  if (url.pathname.startsWith('/api/v1/')) {
    return handleApi(req, res, url.pathname, url.searchParams, rawBody);
  }
  if (url.pathname === '/__mock/subscription-plan' && req.method === 'POST') {
    mockSubscriptionPlan = url.searchParams.get('plan') === 'FREE' ? 'FREE' : 'PRO';
    return json(res, 200, { plan: mockSubscriptionPlan });
  }
  json(res, 404, { error: { code: 'NOT_FOUND', message: 'No fixture route.' } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] UI-screenshot fixture server listening on http://127.0.0.1:${PORT}`);
});
