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
const EVENT_ID_UPCOMING = '44444444-4444-4444-4444-444444444444'; // 本日発表前
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
    ],
    major_fx: [
      { fx_pair_id: FX_PAIR_ID, symbol: 'USDJPY', price: 155.42, change: 0.38, change_percent: 0.25, timestamp: isoMinusHours(1) },
      { fx_pair_id: '22222222-2222-2222-2222-222222222223', symbol: 'EURUSD', price: 1.0821, change: -0.0015, change_percent: -0.14, timestamp: isoMinusHours(1) },
      { fx_pair_id: '22222222-2222-2222-2222-222222222224', symbol: 'EURJPY', price: 168.24, change: 0.12, change_percent: 0.07, timestamp: isoMinusHours(1) },
    ],
  };
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
    latest_event: indicatorId === INDICATOR_ID ? { id: EVENT_ID, release_datetime: EVENT_RELEASE_DATETIME, status: 'RELEASED' } : null,
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
    const open = Number((price).toFixed(3));
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

async function handleApi(req, res, pathname, searchParams) {
  const segments = pathname.replace(/^\/api\/v1\//, '').split('/').filter(Boolean);

  if (pathname === '/api/v1/home') return json(res, 200, homeHandler());
  if (pathname === '/api/v1/indicators') return json(res, 200, indicatorsListHandler());

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
  await readBody(req); // drain request body (unused — this fixture never validates input)
  console.log(`[mock] ${req.method} ${url.pathname}${url.search}`);

  if (url.pathname.startsWith('/auth/v1/')) {
    return handleAuth(req, res, url.pathname);
  }
  if (url.pathname.startsWith('/api/v1/')) {
    return handleApi(req, res, url.pathname, url.searchParams);
  }
  json(res, 404, { error: { code: 'NOT_FOUND', message: 'No fixture route.' } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] UI-screenshot fixture server listening on http://127.0.0.1:${PORT}`);
});
