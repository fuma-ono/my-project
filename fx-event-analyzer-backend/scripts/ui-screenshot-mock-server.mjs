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
  name_en: 'Consumer Price Index',
  country_code: 'US',
  currency_code: 'USD',
  importance: 'HIGH',
  description:
    '消費者物価指数（CPI）は、消費者が購入するモノやサービスの価格の変動を測定する指標です。インフレの動向を示す重要な指標であり、金融政策の判断材料として注目されます。',
  key_points: ['インフレの動向を把握できる', '金融政策への影響が大きい', '為替や株式市場に大きな影響を与える'],
  frequency: 'MONTHLY',
  unit: '%',
  source: 'U.S. Bureau of Labor Statistics',
  source_url: 'https://www.bls.gov/cpi/',
  favorable_direction: 'HIGHER_IS_POSITIVE',
  market_view_above:
    '米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
  market_view_below: '米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。',
};

const INDICATORS_LIST = [
  INDICATOR_US_CPI,
  {
    id: INDICATOR_ID_NFP,
    code: 'US_NFP',
    name: '米国雇用統計(非農業部門雇用者数)',
    name_en: 'Nonfarm Payrolls',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description:
      '非農業部門雇用者数（NFP）は、農業部門を除く米国の雇用者数が前月から何人増減したかを示す指標です。米国の景気や雇用の強さを測る代表的な指標として注目されます。',
    key_points: ['米国の景気の強さを把握できる', 'FRBの金融政策判断に影響する', '発表直後に為替が大きく動きやすい'],
    frequency: 'MONTHLY',
    unit: '千人',
    source: 'U.S. Bureau of Labor Statistics',
    source_url: 'https://www.bls.gov/ces/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '米国の非農業部門雇用者数が予想を上回ると、雇用の底堅さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    market_view_below:
      '米国の非農業部門雇用者数が予想を下回ると、雇用の減速から利下げが意識され、ドルが売られやすいとされる。',
  },
  {
    id: INDICATOR_ID_FOMC,
    code: 'US_FOMC',
    name: 'FOMC政策金利',
    name_en: 'FOMC Interest Rate Decision',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description:
      'FOMC（連邦公開市場委員会）が決定する、米国の政策金利（フェデラル・ファンド金利の誘導目標）です。米国の金融政策の方向性を示し、世界の金融市場に大きな影響を与えます。',
    key_points: [
      '米国の金融政策の方向性がわかる',
      '米ドルの金利水準を直接左右する',
      '声明や会見で今後の見通しが示される',
      '世界の株式・債券市場にも影響する',
    ],
    frequency: 'IRREGULAR',
    unit: '%',
    source: 'Federal Reserve',
    source_url: 'https://www.federalreserve.gov/',
    favorable_direction: 'NEUTRAL',
    market_view_above:
      'FOMCの政策金利が予想より高い水準に決まると、米国の金利が高止まりするとの見方が強まり、ドルが買われやすいとされる。',
    market_view_below:
      'FOMCの政策金利が予想より低い水準に決まると、米国の金融緩和が進むとの見方が強まり、ドルが売られやすいとされる。',
  },
  {
    id: INDICATOR_ID_JP_CPI,
    code: 'JP_CPI',
    name: '日本CPI(消費者物価指数)',
    name_en: 'Japan Consumer Price Index',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'MEDIUM',
    description:
      '日本の消費者物価指数（CPI）は、国内の消費者が購入するモノやサービスの価格の変動を前年同月比で示す指標です。日本のインフレの動向を示し、日銀の金融政策の判断材料として注目されます。',
    key_points: ['日本のインフレの動向を把握できる', '日銀の金融政策の判断材料になる', '円相場の方向性に影響する'],
    frequency: 'MONTHLY',
    unit: '%',
    source: '総務省統計局',
    source_url: 'https://www.stat.go.jp/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above: '日本CPIが予想を上回ると、物価の上昇から日銀の利上げ観測が強まり、円が買われやすいとされる。',
    market_view_below:
      '日本CPIが予想を下回ると、物価の伸び悩みから日銀の利上げが遠のくとの見方が強まり、円が売られやすいとされる。',
  },
];

const RELATED_FX_PAIRS = [{ fx_pair_id: FX_PAIR_ID, symbol: 'USDJPY', priority: 1 }];

// SCR-006 指標詳細 (HQ指示 2026-10-09): GET /calendar の指標行は indicator_id を
// 持ち、タップで GET /indicators/{id} を開く。上の4指標に当たらないカレンダー
// 用の指標はここに置く (GET /indicators の一覧には出さず、詳細だけ返す)。
// 米国新規失業保険申請件数は週次だが、frequency は DB の値 (MONTHLY /
// QUARTERLY / IRREGULAR) に合わせて IRREGULAR にしている。
const CALENDAR_INDICATORS = {
  JP_PPI: {
    id: '11111111-1111-1111-1111-111111111201',
    code: 'JP_PPI',
    name: '国内企業物価指数',
    name_en: 'Corporate Goods Price Index',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'HIGH',
    description:
      '国内企業物価指数は、企業間で取引されるモノの価格の変動を測定する指標です。消費者物価の先行指標として、インフレの動向を占う材料になります。',
    key_points: ['消費者物価の先行きを占える', '原材料やエネルギー価格の影響がわかる', '日銀の物価判断の材料になる'],
    frequency: 'MONTHLY',
    unit: '%',
    source: '日本銀行',
    source_url: 'https://www.boj.or.jp/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '国内企業物価指数が予想を上回ると、消費者物価への波及から日銀の利上げ観測が意識され、円が買われやすいとされる。',
    market_view_below:
      '国内企業物価指数が予想を下回ると、物価上昇の鈍化から日銀の利上げが遠のくとの見方が出て、円が売られやすいとされる。',
  },
  JP_TANKAN: {
    id: '11111111-1111-1111-1111-111111111202',
    code: 'JP_TANKAN',
    name: '日銀短観(大企業製造業業況判断)',
    name_en: 'Tankan Large Manufacturers Index',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'HIGH',
    description:
      '日銀短観は、日本銀行が全国の企業に景況感などを尋ねる調査で、大企業製造業の業況判断DIが特に注目されます。日本の景気の現状と先行きを示す代表的な指標です。',
    key_points: ['企業の景況感を把握できる', '日本の景気の方向性がわかる', '日銀の金融政策の判断材料になる'],
    frequency: 'QUARTERLY',
    unit: null,
    source: '日本銀行',
    source_url: 'https://www.boj.or.jp/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '日銀短観の業況判断が予想を上回ると、景況感の改善から日銀の利上げ観測が意識され、円が買われやすいとされる。',
    market_view_below:
      '日銀短観の業況判断が予想を下回ると、景況感の悪化から日銀の利上げが遠のくとの見方が出て、円が売られやすいとされる。',
  },
  US_ISM_MFG: {
    id: '11111111-1111-1111-1111-111111111203',
    code: 'US_ISM_MFG',
    name: '米国ISM製造業景況指数',
    name_en: 'ISM Manufacturing PMI',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description:
      'ISM製造業景況指数は、米国の製造業の購買担当者へのアンケートをもとに景況感を示す指標です。50を上回ると景気拡大、下回ると景気縮小を示すとされます。',
    key_points: [
      '米国の製造業の景況感がわかる',
      '50を境に景気の拡大・縮小を判断できる',
      '雇用統計の前に発表され先行指標として注目される',
    ],
    frequency: 'MONTHLY',
    unit: null,
    source: 'Institute for Supply Management',
    source_url: 'https://www.ismworld.org/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '米国ISM製造業景況指数が予想を上回ると、景気の底堅さから利下げが遠のくとの見方が出て、ドルが買われやすいとされる。',
    market_view_below:
      '米国ISM製造業景況指数が予想を下回ると、景気の減速懸念から利下げが意識され、ドルが売られやすいとされる。',
  },
  EU_HICP_FLASH: {
    id: '11111111-1111-1111-1111-111111111204',
    code: 'EU_HICP_FLASH',
    name: 'ユーロ圏消費者物価指数(速報値)',
    name_en: 'Eurozone CPI Flash Estimate',
    country_code: 'EU',
    currency_code: 'EUR',
    importance: 'HIGH',
    description:
      'ユーロ圏消費者物価指数（HICP）の速報値は、ユーロ圏の消費者が購入するモノやサービスの価格の変動を示す指標です。ECBの金融政策の判断材料として注目されます。',
    key_points: ['ユーロ圏のインフレの動向を把握できる', 'ECBの金融政策に影響する', 'ユーロ相場が動きやすい'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'Eurostat',
    source_url: 'https://ec.europa.eu/eurostat',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      'ユーロ圏消費者物価指数が予想を上回ると、インフレの高止まりからECBの利下げが遠のくとの見方が強まり、ユーロが買われやすいとされる。',
    market_view_below:
      'ユーロ圏消費者物価指数が予想を下回ると、インフレの落ち着きからECBの利下げが意識され、ユーロが売られやすいとされる。',
  },
  US_JOBLESS_CLAIMS: {
    id: '11111111-1111-1111-1111-111111111205',
    code: 'US_JOBLESS_CLAIMS',
    name: '米国新規失業保険申請件数',
    name_en: 'Initial Jobless Claims',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'MEDIUM',
    description:
      '新規失業保険申請件数は、米国で新たに失業保険の給付を申請した人の数を示す指標です。毎週発表されるため、雇用情勢の変化をいち早くつかむ材料として注目されます。',
    key_points: [
      '雇用情勢の変化をいち早くつかめる',
      '件数の増加は景気減速のサインとされる',
      '雇用統計の予想の手がかりになる',
    ],
    frequency: 'IRREGULAR',
    unit: '千件',
    source: 'U.S. Department of Labor',
    source_url: 'https://www.dol.gov/',
    favorable_direction: 'LOWER_IS_POSITIVE',
    market_view_above:
      '米国新規失業保険申請件数が予想を上回ると、雇用の悪化懸念から利下げが意識され、ドルが売られやすいとされる。',
    market_view_below:
      '米国新規失業保険申請件数が予想を下回ると、雇用の底堅さから利下げが遠のくとの見方が出て、ドルが買われやすいとされる。',
  },
  AU_RBA_RATE: {
    id: '11111111-1111-1111-1111-111111111206',
    code: 'AU_RBA_RATE',
    name: '豪州RBA政策金利',
    name_en: 'RBA Interest Rate Decision',
    country_code: 'AU',
    currency_code: 'AUD',
    importance: 'HIGH',
    description:
      '豪州準備銀行（RBA）が金融政策会合で決定する政策金利です。豪州の金融政策の方向性を示し、豪ドル相場に大きな影響を与えます。',
    key_points: ['豪州の金融政策の方向性がわかる', '豪ドルの金利水準を直接左右する', '声明文の内容で相場が動きやすい'],
    frequency: 'IRREGULAR',
    unit: '%',
    source: 'Reserve Bank of Australia',
    source_url: 'https://www.rba.gov.au/',
    favorable_direction: 'NEUTRAL',
    market_view_above:
      'RBAの政策金利が予想より高い水準に決まると、金融引き締めが進むとの見方が強まり、豪ドルが買われやすいとされる。',
    market_view_below:
      'RBAの政策金利が予想より低い水準に決まると、金融緩和が進むとの見方が強まり、豪ドルが売られやすいとされる。',
  },
  GB_SERVICES_PMI: {
    id: '11111111-1111-1111-1111-111111111207',
    code: 'GB_SERVICES_PMI',
    name: '英国サービス業PMI',
    name_en: 'UK Services PMI',
    country_code: 'GB',
    currency_code: 'GBP',
    importance: 'LOW',
    description:
      '英国サービス業PMIは、サービス業の購買担当者へのアンケートをもとに景況感を示す指標です。英国経済の大部分を占めるサービス業の動向を把握できます。',
    key_points: [
      '英国のサービス業の景況感がわかる',
      '50を境に景気の拡大・縮小を判断できる',
      '英国経済の先行指標として使われる',
    ],
    frequency: 'MONTHLY',
    unit: null,
    source: 'S&P Global',
    source_url: 'https://www.pmi.spglobal.com/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '英国サービス業PMIが予想を上回ると、景気の底堅さからBOEの利下げが遠のくとの見方が出て、ポンドが買われやすいとされる。',
    market_view_below:
      '英国サービス業PMIが予想を下回ると、景気の減速懸念からBOEの利下げが意識され、ポンドが売られやすいとされる。',
  },
  JP_GDP: {
    id: '11111111-1111-1111-1111-111111111208',
    code: 'JP_GDP',
    name: '国内総生産(GDP)改定値',
    name_en: 'Japan GDP (Revised)',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'MEDIUM',
    description:
      '国内総生産（GDP）は、一定期間に国内で生み出されたモノやサービスの付加価値の合計で、改定値は速報値に新しい統計を反映して見直したものです。日本経済の成長の度合いを示す最も基本的な指標です。',
    key_points: ['日本経済の成長の度合いがわかる', '速報値からの修正幅が注目される', '日銀の景気判断の材料になる'],
    frequency: 'QUARTERLY',
    unit: '%',
    source: '内閣府',
    source_url: 'https://www.esri.cao.go.jp/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '日本のGDP改定値が予想を上回ると、景気の底堅さから日銀の利上げ観測が意識され、円が買われやすいとされる。',
    market_view_below:
      '日本のGDP改定値が予想を下回ると、景気の弱さから日銀の利上げが遠のくとの見方が出て、円が売られやすいとされる。',
  },
  GB_GDP_MONTHLY: {
    id: '11111111-1111-1111-1111-111111111209',
    code: 'GB_GDP_MONTHLY',
    name: '英国GDP(月次)',
    name_en: 'UK GDP (Monthly)',
    country_code: 'GB',
    currency_code: 'GBP',
    importance: 'MEDIUM',
    description:
      '英国GDP（月次）は、英国国家統計局が毎月発表する国内総生産の前月比の伸び率です。四半期GDPより早く英国経済の動きをつかめる指標として注目されます。',
    key_points: ['英国経済の動きを毎月つかめる', 'BOEの金融政策の判断材料になる', 'ポンド相場に影響する'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'Office for National Statistics',
    source_url: 'https://www.ons.gov.uk/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '英国の月次GDPが予想を上回ると、景気の底堅さからBOEの利下げが遠のくとの見方が出て、ポンドが買われやすいとされる。',
    market_view_below:
      '英国の月次GDPが予想を下回ると、景気の減速懸念からBOEの利下げが意識され、ポンドが売られやすいとされる。',
  },
  EU_GDP: {
    id: '11111111-1111-1111-1111-111111111210',
    code: 'EU_GDP',
    name: 'ユーロ圏GDP(改定値)',
    name_en: 'Eurozone GDP (Revised)',
    country_code: 'EU',
    currency_code: 'EUR',
    importance: 'LOW',
    description:
      'ユーロ圏GDPは、ユーロ圏で一定期間に生み出されたモノやサービスの付加価値の合計を示す指標で、改定値は速報値を見直したものです。ユーロ圏経済の成長の度合いを把握できます。',
    key_points: ['ユーロ圏経済の成長の度合いがわかる', '速報値からの修正幅が注目される', 'ECBの景気判断の材料になる'],
    frequency: 'QUARTERLY',
    unit: '%',
    source: 'Eurostat',
    source_url: 'https://ec.europa.eu/eurostat',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      'ユーロ圏GDP改定値が予想を上回ると、景気の底堅さからECBの利下げが遠のくとの見方が出て、ユーロが買われやすいとされる。',
    market_view_below:
      'ユーロ圏GDP改定値が予想を下回ると、景気の減速懸念からECBの利下げが意識され、ユーロが売られやすいとされる。',
  },
  US_RETAIL_SALES: {
    id: '11111111-1111-1111-1111-111111111211',
    code: 'US_RETAIL_SALES',
    name: '米国小売売上高',
    name_en: 'Retail Sales',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description:
      '小売売上高は、米国の小売業の売上高の前月からの変化を示す指標です。米国経済の約7割を占める個人消費の動向を把握する材料として注目されます。',
    key_points: ['個人消費の動向を把握できる', '米国の景気の強さがわかる', '予想との差で為替が動きやすい'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'U.S. Census Bureau',
    source_url: 'https://www.census.gov/retail/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '米国小売売上高が予想を上回ると、個人消費の強さから利下げが遠のくとの見方が出て、ドルが買われやすいとされる。',
    market_view_below:
      '米国小売売上高が予想を下回ると、個人消費の弱さから利下げが意識され、ドルが売られやすいとされる。',
  },
  AU_EMPLOYMENT: {
    id: '11111111-1111-1111-1111-111111111212',
    code: 'AU_EMPLOYMENT',
    name: '豪州雇用統計(失業率)',
    name_en: 'Australia Unemployment Rate',
    country_code: 'AU',
    currency_code: 'AUD',
    importance: 'HIGH',
    description:
      '豪州雇用統計は、豪州統計局が毎月発表する雇用の状況で、失業率や雇用者数の増減が注目されます。豪州の景気やRBAの金融政策の行方を占う材料になります。',
    key_points: ['豪州の雇用情勢を把握できる', 'RBAの金融政策の判断材料になる', '豪ドル相場が動きやすい'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'Australian Bureau of Statistics',
    source_url: 'https://www.abs.gov.au/',
    favorable_direction: 'LOWER_IS_POSITIVE',
    market_view_above:
      '豪州の失業率が予想を上回ると、雇用の悪化からRBAの利下げが意識され、豪ドルが売られやすいとされる。',
    market_view_below:
      '豪州の失業率が予想を下回ると、雇用の底堅さからRBAの利下げが遠のくとの見方が出て、豪ドルが買われやすいとされる。',
  },
  US_HOUSING_STARTS: {
    id: '11111111-1111-1111-1111-111111111213',
    code: 'US_HOUSING_STARTS',
    name: '米国住宅着工件数',
    name_en: 'Housing Starts',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'LOW',
    description:
      '住宅着工件数は、米国で新たに建設が始まった住宅の戸数を示す指標です。金利の影響を受けやすい住宅市場の動向から、景気の先行きを占う材料になります。',
    key_points: ['住宅市場の動向を把握できる', '金利の変化の影響が表れやすい', '景気の先行指標として使われる'],
    frequency: 'MONTHLY',
    unit: '千件',
    source: 'U.S. Census Bureau',
    source_url: 'https://www.census.gov/construction/nrc/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above: null,
    market_view_below: null,
  },
  GB_RETAIL_SALES: {
    id: '11111111-1111-1111-1111-111111111214',
    code: 'GB_RETAIL_SALES',
    name: '英国小売売上高',
    name_en: 'UK Retail Sales',
    country_code: 'GB',
    currency_code: 'GBP',
    importance: 'MEDIUM',
    description:
      '英国小売売上高は、英国の小売業の売上高の前月からの変化を示す指標です。英国の個人消費の動向を把握する材料として注目されます。',
    key_points: ['英国の個人消費の動向を把握できる', 'BOEの金融政策の判断材料になる', 'ポンド相場に影響する'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'Office for National Statistics',
    source_url: 'https://www.ons.gov.uk/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '英国小売売上高が予想を上回ると、個人消費の強さからBOEの利下げが遠のくとの見方が出て、ポンドが買われやすいとされる。',
    market_view_below:
      '英国小売売上高が予想を下回ると、個人消費の弱さからBOEの利下げが意識され、ポンドが売られやすいとされる。',
  },
  US_MFG_PMI_FLASH: {
    id: '11111111-1111-1111-1111-111111111215',
    code: 'US_MFG_PMI_FLASH',
    name: '米国製造業PMI(速報値)',
    name_en: 'S&P Global US Manufacturing PMI (Flash)',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'MEDIUM',
    description:
      '米国製造業PMIの速報値は、製造業の購買担当者へのアンケートをもとに景況感を示す指標です。月の途中までの回答で集計されるため、景気の変化をいち早くつかめます。',
    key_points: [
      '米国の製造業の景況感がわかる',
      '50を境に景気の拡大・縮小を判断できる',
      '月内の早い時期に景気の変化をつかめる',
    ],
    frequency: 'MONTHLY',
    unit: null,
    source: 'S&P Global',
    source_url: 'https://www.pmi.spglobal.com/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '米国製造業PMI速報値が予想を上回ると、景気の底堅さから利下げが遠のくとの見方が出て、ドルが買われやすいとされる。',
    market_view_below:
      '米国製造業PMI速報値が予想を下回ると、景気の減速懸念から利下げが意識され、ドルが売られやすいとされる。',
  },
  BOJ_RATE: {
    id: '11111111-1111-1111-1111-111111111216',
    code: 'BOJ_RATE',
    name: '日銀金融政策決定会合(政策金利)',
    name_en: 'BOJ Interest Rate Decision',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'HIGH',
    description:
      '日本銀行が金融政策決定会合で決定する政策金利です。日本の金融政策の方向性を示し、円の金利水準や為替相場に大きな影響を与えます。',
    key_points: ['日本の金融政策の方向性がわかる', '円の金利水準を直接左右する', '総裁会見の発言で相場が動きやすい'],
    frequency: 'IRREGULAR',
    unit: '%',
    source: '日本銀行',
    source_url: 'https://www.boj.or.jp/',
    favorable_direction: 'NEUTRAL',
    market_view_above:
      '日銀の政策金利が予想より高い水準に決まると、金融引き締めが進むとの見方が強まり、円が買われやすいとされる。',
    market_view_below:
      '日銀の政策金利が予想より低い水準に決まると、金融緩和的な姿勢が続くとの見方が強まり、円が売られやすいとされる。',
  },
  ECB_RATE: {
    id: '11111111-1111-1111-1111-111111111217',
    code: 'ECB_RATE',
    name: 'ECB政策金利',
    name_en: 'ECB Interest Rate Decision',
    country_code: 'EU',
    currency_code: 'EUR',
    importance: 'HIGH',
    description:
      '欧州中央銀行（ECB）が理事会で決定する政策金利です。ユーロ圏の金融政策の方向性を示し、ユーロ相場に大きな影響を与えます。',
    key_points: [
      'ユーロ圏の金融政策の方向性がわかる',
      'ユーロの金利水準を直接左右する',
      '総裁会見の発言で相場が動きやすい',
    ],
    frequency: 'IRREGULAR',
    unit: '%',
    source: 'European Central Bank',
    source_url: 'https://www.ecb.europa.eu/',
    favorable_direction: 'NEUTRAL',
    market_view_above:
      'ECBの政策金利が予想より高い水準に決まると、金融引き締めが進むとの見方が強まり、ユーロが買われやすいとされる。',
    market_view_below:
      'ECBの政策金利が予想より低い水準に決まると、金融緩和が進むとの見方が強まり、ユーロが売られやすいとされる。',
  },
  US_PCE: {
    id: '11111111-1111-1111-1111-111111111218',
    code: 'US_PCE',
    name: '米国PCEデフレーター',
    name_en: 'PCE Price Index',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description:
      'PCEデフレーターは、米国の個人消費支出（PCE）にかかわる価格の変動を示す物価指標です。FRBが物価目標の基準としているため、金融政策の判断材料として特に注目されます。',
    key_points: ['FRBが重視する物価指標である', 'インフレの動向を把握できる', '金融政策の見通しに影響する'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'U.S. Bureau of Economic Analysis',
    source_url: 'https://www.bea.gov/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '米国PCEデフレーターが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    market_view_below:
      '米国PCEデフレーターが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。',
  },
  JP_TOKYO_CPI: {
    id: '11111111-1111-1111-1111-111111111219',
    code: 'JP_TOKYO_CPI',
    name: '東京都区部CPI',
    name_en: 'Tokyo Consumer Price Index',
    country_code: 'JP',
    currency_code: 'JPY',
    importance: 'LOW',
    description:
      '東京都区部CPIは、東京23区の消費者物価指数で、全国CPIより約1か月早く発表されます。全国の物価の動向を先取りする指標として注目されます。',
    key_points: ['全国CPIの先行指標になる', '日本のインフレの動向をいち早くつかめる', '日銀の金融政策の判断材料になる'],
    frequency: 'MONTHLY',
    unit: '%',
    source: '総務省統計局',
    source_url: 'https://www.stat.go.jp/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '東京都区部CPIが予想を上回ると、全国の物価上昇を先取りする形で日銀の利上げ観測が意識され、円が買われやすいとされる。',
    market_view_below:
      '東京都区部CPIが予想を下回ると、物価の伸び悩みから日銀の利上げが遠のくとの見方が出て、円が売られやすいとされる。',
  },
  AU_RETAIL_SALES: {
    id: '11111111-1111-1111-1111-111111111220',
    code: 'AU_RETAIL_SALES',
    name: '豪州小売売上高',
    name_en: 'Australia Retail Sales',
    country_code: 'AU',
    currency_code: 'AUD',
    importance: 'MEDIUM',
    description:
      '豪州小売売上高は、豪州の小売業の売上高の前月からの変化を示す指標です。豪州の個人消費の動向を把握する材料として注目されます。',
    key_points: ['豪州の個人消費の動向を把握できる', 'RBAの金融政策の判断材料になる', '豪ドル相場に影響する'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'Australian Bureau of Statistics',
    source_url: 'https://www.abs.gov.au/',
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '豪州小売売上高が予想を上回ると、個人消費の強さからRBAの利下げが遠のくとの見方が出て、豪ドルが買われやすいとされる。',
    market_view_below:
      '豪州小売売上高が予想を下回ると、個人消費の弱さからRBAの利下げが意識され、豪ドルが売られやすいとされる。',
  },
};

/** GET /indicators/{id} が返せる全指標 (一覧の4指標 + カレンダー用)。 */
const ALL_MOCK_INDICATORS = [...INDICATORS_LIST, ...Object.values(CALENDAR_INDICATORS)];

// SCR-007 イベント詳細の参考画像 (HQ指示 2026-10-09): 結果 3.1 / 予想 3.2 / 前回 3.3。
// ホーム・指標詳細・過去比較・過去イベント詳細もこの値を参照する。
const RELEASE_SNAPSHOT = {
  forecast: 3.2,
  actual: 3.1,
  previous: 3.3,
  unit: '%',
  source: 'U.S. Bureau of Labor Statistics',
  source_url: 'https://www.bls.gov/cpi/',
  captured_at: EVENT_RELEASE_DATETIME,
  surprise: -0.1,
  surprise_direction: 'NEGATIVE',
};

const EXPLANATION = {
  version: 1,
  explanation_type: 'FACT_SUMMARY',
  summary: 'エネルギー価格の下落と中古車価格の低下が市場予想を下回る要因となった。住居費の伸びも前月から鈍化している。',
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
  const indicator = ALL_MOCK_INDICATORS.find((row) => row.id === indicatorId);
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
          : { timeframe: '5m', ...pairReactionValues('USDJPY', '5m'), analysis_status: 'READY' },
      },
    ],
    major_fx_reactions: majorFxReactions(isUpcoming),
    available_timeframes: ['1m', '5m', '15m', '30m', '60m'],
  };
}

// SCR-007「主要通貨ペアの値動き(pips)」/ SCR-008 相場反応詳細 (HQ指示 2026-10-09)。
// 1m/5m/15m は米国CPIの参考画像の値。30m/60m は SCR-008 用のもっともらしい値。
// change_percent は pips × pip_size ÷ 発表直前価格 × 100 (src/domain/reaction.ts と同じ式)。
const MAJOR_FX_REACTION_FIXTURES = {
  USDJPY: {
    preReleasePrice: 155.1,
    pipSize: 0.01,
    pips: { '1m': -8.2, '5m': -24.5, '15m': -41.3, '30m': -45.6, '60m': -38.9 },
  },
  EURUSD: {
    preReleasePrice: 1.079,
    pipSize: 0.0001,
    pips: { '1m': 6.4, '5m': 18.7, '15m': 32.1, '30m': 35.0, '60m': 29.8 },
  },
  GBPUSD: {
    preReleasePrice: 1.269,
    pipSize: 0.0001,
    pips: { '1m': 4.7, '5m': 12.3, '15m': 20.8, '30m': 23.1, '60m': 19.5 },
  },
  AUDUSD: {
    preReleasePrice: 0.661,
    pipSize: 0.0001,
    pips: { '1m': 3.2, '5m': 9.6, '15m': 16.2, '30m': 17.9, '60m': 15.0 },
  },
};
const MAJOR_FX_REACTION_SYMBOLS = ['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD'];
const MAJOR_FX_REACTION_TIMEFRAMES = ['1m', '5m', '15m'];

function pairReactionValues(symbol, timeframe) {
  const fixture = MAJOR_FX_REACTION_FIXTURES[symbol];
  const pips = fixture.pips[timeframe];
  const changePercent = ((pips * fixture.pipSize) / fixture.preReleasePrice) * 100;
  return { pips, change_percent: Number(changePercent.toFixed(2)) };
}

/** GET /events/{id} major_fx_reactions (src/domain/majorFxReactions.ts): USD のイベントなので
 * 関連ペア USDJPY → 主要順の EURUSD → GBPUSD → AUDUSD。発表前は pips null / DATA_PENDING。 */
function majorFxReactions(isUpcoming) {
  return MAJOR_FX_REACTION_SYMBOLS.map((symbol) => ({
    fx_pair_id: FX_PAIRS.find((pair) => pair.symbol === symbol).fx_pair_id,
    symbol,
    reactions: MAJOR_FX_REACTION_TIMEFRAMES.map((timeframe) =>
      isUpcoming
        ? { timeframe, pips: null, change_percent: null, analysis_status: 'DATA_PENDING' }
        : { timeframe, ...pairReactionValues(symbol, timeframe), analysis_status: 'READY' },
    ),
  }));
}

/** SCR-008: fx_pair_id の通貨ペアの反応。MAJOR_FX_REACTION_FIXTURES に無いペアは従来の
 * TIMEFRAME_REACTIONS (USDJPY 相当の値) で答える。 */
function pairReactionFixture(fxPairId) {
  const symbol = FX_PAIRS.find((pair) => pair.fx_pair_id === fxPairId)?.symbol;
  const fixture = symbol ? MAJOR_FX_REACTION_FIXTURES[symbol] : undefined;
  if (!fixture) return LEGACY_REACTION_FIXTURE;
  const rows = {};
  for (const [timeframe, pips] of Object.entries(fixture.pips)) {
    // 発表方向の最大値は pips より少し先まで行き、逆方向は少しだけ戻した値。
    const sign = pips < 0 ? -1 : 1;
    const favorable = Number((pips * 1.12).toFixed(1));
    const adverse = Number((-sign * (1.0 + Math.abs(pips) * 0.08)).toFixed(1));
    rows[timeframe] = {
      ...pairReactionValues(symbol, timeframe),
      max_upward_pips: sign > 0 ? favorable : adverse,
      max_downward_pips: sign > 0 ? adverse : favorable,
    };
  }
  return { preReleasePrice: fixture.preReleasePrice, pipSize: fixture.pipSize, rows, chartTargetPips: null };
}

const TIMEFRAME_REACTIONS = {
  '1m': { pips: 4.1, change_percent: 0.03, max_upward_pips: 5.2, max_downward_pips: -1.0 },
  '5m': { pips: 12.3, change_percent: 0.08, max_upward_pips: 14.0, max_downward_pips: -2.1 },
  '15m': { pips: 18.7, change_percent: 0.12, max_upward_pips: 20.5, max_downward_pips: -3.4 },
  '30m': { pips: 22.4, change_percent: 0.14, max_upward_pips: 24.8, max_downward_pips: -4.0 },
  '60m': { pips: 19.9, change_percent: 0.13, max_upward_pips: 25.1, max_downward_pips: -6.2 },
};

/** 過去イベント詳細・過去比較・未知の fx_pair_id 用: 従来の TIMEFRAME_REACTIONS の値のまま。 */
const LEGACY_REACTION_FIXTURE = {
  preReleasePrice: 155.1,
  pipSize: 0.01,
  rows: TIMEFRAME_REACTIONS,
  chartTargetPips: 12.3,
};

function reactionRow(timeframe, fixture = LEGACY_REACTION_FIXTURE) {
  const base = fixture.rows[timeframe];
  const { preReleasePrice, pipSize } = fixture;
  const digits = pipSize < 0.01 ? 5 : 3;
  const postReleasePrice = Number((preReleasePrice + base.pips * pipSize).toFixed(digits));
  return {
    timeframe,
    post_release_price: postReleasePrice,
    movement: Number((base.pips * pipSize).toFixed(digits)),
    pips: base.pips,
    change_percent: base.change_percent,
    max_upward: Number((base.max_upward_pips * pipSize).toFixed(digits)),
    max_downward: Number((base.max_downward_pips * pipSize).toFixed(digits)),
    max_upward_pips: base.max_upward_pips,
    max_downward_pips: base.max_downward_pips,
    analysis_status: 'READY',
  };
}

function reactionAllHandler(eventId, fxPairId) {
  const fixture = pairReactionFixture(fxPairId);
  return {
    event_id: eventId,
    fx_pair_id: fxPairId,
    pre_release_price: fixture.preReleasePrice,
    reactions: Object.keys(fixture.rows).map((tf) => reactionRow(tf, fixture)),
  };
}

function reactionSingleHandler(eventId, timeframe, fxPairId) {
  const fixture = pairReactionFixture(fxPairId);
  const row = reactionRow(timeframe, fixture);
  return { event_id: eventId, fx_pair_id: fxPairId, pre_release_price: fixture.preReleasePrice, ...row };
}

// HQ指示(2026-10-09)「チャートがおかしいのできれいなデータを」: 本物らしいローソク足に
// する。1分足を作ってから5分足・15分足にまとめる。発表前は小さく上下し、発表後は
// 1m/5m/15m/30m/60m の反応(pairReactionFixture の rows)を通るように大きく動いてから
// 落ち着く。乱数は通貨ペアIDから決まる種で作るので、毎回同じ形になる。
function seededRandom(seedText) {
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function oneMinuteCandles(fixture, fxPairId) {
  const { preReleasePrice, pipSize, rows } = fixture;
  const random = seededRandom(String(fxPairId));
  const releaseMs = new Date(EVENT_RELEASE_DATETIME).getTime();
  // 発表後の目標(分 → pips)。0分は発表直前の価格。
  const anchors = [
    [0, 0],
    [1, rows['1m']?.pips ?? 0],
    [5, rows['5m']?.pips ?? 0],
    [15, rows['15m']?.pips ?? 0],
    [30, rows['30m']?.pips ?? rows['15m']?.pips ?? 0],
    [60, rows['60m']?.pips ?? rows['30m']?.pips ?? 0],
  ];
  const targetAt = (minute) => {
    for (let i = 1; i < anchors.length; i += 1) {
      const [m0, p0] = anchors[i - 1];
      const [m1, p1] = anchors[i];
      if (minute <= m1) return p0 + ((p1 - p0) * (minute - m0)) / (m1 - m0);
    }
    return anchors[anchors.length - 1][1];
  };
  const candles = [];
  let previousClose = preReleasePrice;
  for (let minute = -180; minute < 180; minute += 1) {
    const after = minute >= 0;
    // 発表直後ほど振れ幅が大きく、時間とともに落ち着く。
    const noisePips = after ? 1.2 + 6 * Math.exp(-minute / 6) : 0.9;
    // 発表前はゆるやかに上下する(3時間前でも平らになりすぎないよう、ゆっくりした波を足す)。
    const base = after ? targetAt(minute + 1) : Math.sin(minute / 25) * 4 + (random() - 0.5) * 2.5;
    const closePips = base + (random() - 0.5) * noisePips;
    const close = preReleasePrice + closePips * pipSize;
    const open = previousClose;
    const wick = (0.3 + random() * (after ? noisePips * 0.6 : 0.8)) * pipSize;
    candles.push({
      t: releaseMs + minute * 60_000,
      open,
      high: Math.max(open, close) + wick * random(),
      low: Math.min(open, close) - wick * random(),
      close,
    });
    previousClose = close;
  }
  return candles;
}

function reactionChartHandler(eventId, timeframe, fxPairId) {
  const fixture = pairReactionFixture(fxPairId);
  const digits = fixture.pipSize < 0.01 ? 5 : 3;
  const round = (value) => Number(value.toFixed(digits));
  const stepMinutes = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60 }[timeframe] ?? 5;
  // 本番と同じく、発表時刻を基準に時間足ごとの範囲(1m 前後15分・5m 前後60分・15m 前後3時間)。
  const releaseMs = new Date(EVENT_RELEASE_DATETIME).getTime();
  const windowMinutes = { '1m': [15, 15], '5m': [60, 60], '15m': [180, 180] }[timeframe] ?? [30, 60];
  const fromMs = releaseMs - windowMinutes[0] * 60_000;
  const toMs = releaseMs + windowMinutes[1] * 60_000;
  const minutes = oneMinuteCandles(fixture, fxPairId).filter((c) => c.t >= fromMs && c.t < toMs);
  const prices = [];
  for (let i = 0; i < minutes.length; i += stepMinutes) {
    const group = minutes.slice(i, i + stepMinutes);
    prices.push({
      timestamp: new Date(group[0].t).toISOString(),
      open: round(group[0].open),
      high: round(Math.max(...group.map((c) => c.high))),
      low: round(Math.min(...group.map((c) => c.low))),
      close: round(group[group.length - 1].close),
      volume: null,
    });
  }
  return {
    event_id: eventId,
    fx_pair_id: fxPairId,
    timeframe,
    release_datetime: EVENT_RELEASE_DATETIME,
    window_from: new Date(fromMs).toISOString(),
    window_to: new Date(toMs).toISOString(),
    prices,
  };
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
  // api-design.md §21 / §28.1: only the plan's history_events_max most recent releases.
  const maxForPlan = MOCK_PLAN_LIMITS[mockSubscriptionPlan].history_events_max;
  const events = comparisonEventsList().slice(0, maxForPlan);
  const meta = { page: 1, limit: 20, total: events.length, has_next: false };
  const historyLimit = {
    applied: events.length,
    max_for_plan: maxForPlan,
    pro_max: MOCK_PLAN_LIMITS.PRO.history_events_max,
  };
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
      history_limit: historyLimit,
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
    history_limit: historyLimit,
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

// 指標: ['I', 'HH:MM'(日本時間), 指標名, country, currency, importance, event_id(nullは自動採番), indicator_id]
// indicator_id は GET /indicators/{id} が200を返す指標 (INDICATORS_LIST か CALENDAR_INDICATORS)。
// 発言: ['S', 'HH:MM'(日本時間), 題名, CALENDAR_SPEAKERSのキー, importance]
const CALENDAR_TODAY_ITEMS = [
  ['I', '08:50', '国内企業物価指数', 'JP', 'JPY', 'HIGH', null, CALENDAR_INDICATORS.JP_PPI.id],
  ['S', '15:00', 'FOMCメンバー発言', 'waller', 'HIGH'],
  ['S', '20:35', 'ECB要人発言', 'schnabel', 'MEDIUM'],
  ['I', '21:30', '雇用統計(非農業部門雇用者数)', 'US', 'USD', 'HIGH', EVENT_ID_UPCOMING, INDICATOR_ID_NFP],
];

/** 日(1〜31) → その日の項目。本日と重なる日・その月に無い日(31日等)は使わない。 */
const CALENDAR_OTHER_DAYS = {
  1: [
    ['I', '08:50', '日銀短観(大企業製造業業況判断)', 'JP', 'JPY', 'HIGH', null, CALENDAR_INDICATORS.JP_TANKAN.id],
    ['I', '23:00', '米国ISM製造業景況指数', 'US', 'USD', 'HIGH', null, CALENDAR_INDICATORS.US_ISM_MFG.id],
  ],
  2: [
    ['I', '18:00', 'ユーロ圏消費者物価指数(速報値)', 'EU', 'EUR', 'HIGH', null, CALENDAR_INDICATORS.EU_HICP_FLASH.id],
  ],
  3: [
    ['I', '21:30', '米国新規失業保険申請件数', 'US', 'USD', 'MEDIUM', null, CALENDAR_INDICATORS.US_JOBLESS_CLAIMS.id],
    ['S', '23:00', 'FRB議長発言', 'powell', 'HIGH'],
  ],
  6: [
    ['I', '12:30', '豪州RBA政策金利', 'AU', 'AUD', 'HIGH', null, CALENDAR_INDICATORS.AU_RBA_RATE.id],
    ['I', '17:30', '英国サービス業PMI', 'GB', 'GBP', 'LOW', null, CALENDAR_INDICATORS.GB_SERVICES_PMI.id],
  ],
  9: [
    ['I', '08:50', '国内総生産(GDP)改定値', 'JP', 'JPY', 'MEDIUM', null, CALENDAR_INDICATORS.JP_GDP.id],
    ['S', '16:00', 'BOE総裁発言', 'bailey', 'MEDIUM'],
    ['I', '21:30', INDICATOR_US_CPI.name, 'US', 'USD', 'HIGH', EVENT_ID, INDICATOR_ID],
  ],
  12: [['I', '15:00', '英国GDP(月次)', 'GB', 'GBP', 'MEDIUM', null, CALENDAR_INDICATORS.GB_GDP_MONTHLY.id]],
  14: [
    ['I', '18:00', 'ユーロ圏GDP(改定値)', 'EU', 'EUR', 'LOW', null, CALENDAR_INDICATORS.EU_GDP.id],
    ['I', '21:30', '米国小売売上高', 'US', 'USD', 'HIGH', null, CALENDAR_INDICATORS.US_RETAIL_SALES.id],
    ['S', '22:00', 'ECB総裁発言', 'lagarde', 'HIGH'],
  ],
  16: [['I', '09:30', '豪州雇用統計(失業率)', 'AU', 'AUD', 'HIGH', null, CALENDAR_INDICATORS.AU_EMPLOYMENT.id]],
  17: [['I', '08:30', INDICATORS_LIST[3].name, 'JP', 'JPY', 'MEDIUM', EVENT_ID_UPCOMING_JP_CPI, INDICATOR_ID_JP_CPI]],
  20: [
    ['S', '10:00', '日銀総裁発言', 'ueda', 'MEDIUM'],
    ['I', '21:30', '米国住宅着工件数', 'US', 'USD', 'LOW', null, CALENDAR_INDICATORS.US_HOUSING_STARTS.id],
  ],
  22: [
    ['I', '17:30', '英国小売売上高', 'GB', 'GBP', 'MEDIUM', null, CALENDAR_INDICATORS.GB_RETAIL_SALES.id],
    ['I', '22:45', '米国製造業PMI(速報値)', 'US', 'USD', 'MEDIUM', null, CALENDAR_INDICATORS.US_MFG_PMI_FLASH.id],
  ],
  24: [
    ['I', '12:00', '日銀金融政策決定会合(政策金利)', 'JP', 'JPY', 'HIGH', null, CALENDAR_INDICATORS.BOJ_RATE.id],
    ['S', '15:30', '日銀総裁会見', 'ueda', 'HIGH'],
    ['I', '21:15', 'ECB政策金利', 'EU', 'EUR', 'HIGH', null, CALENDAR_INDICATORS.ECB_RATE.id],
    ['S', '21:45', 'ECB総裁会見', 'lagarde', 'HIGH'],
  ],
  27: [
    ['I', '03:00', INDICATORS_LIST[2].name, 'US', 'USD', 'HIGH', EVENT_ID_UPCOMING_FOMC, INDICATOR_ID_FOMC],
    ['S', '03:30', 'FRB議長会見', 'powell', 'HIGH'],
  ],
  29: [['I', '21:30', '米国PCEデフレーター', 'US', 'USD', 'HIGH', null, CALENDAR_INDICATORS.US_PCE.id]],
  30: [
    ['I', '08:30', '東京都区部CPI', 'JP', 'JPY', 'LOW', null, CALENDAR_INDICATORS.JP_TOKYO_CPI.id],
    ['I', '10:30', '豪州小売売上高', 'AU', 'AUD', 'MEDIUM', null, CALENDAR_INDICATORS.AU_RETAIL_SALES.id],
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
        const [, , title, country, currency, importance, eventId, indicatorId] = spec;
        items.push({
          kind: 'INDICATOR',
          id: eventId ?? `cccccccc-cccc-cccc-cccc-${serial}`,
          indicator_id: indicatorId,
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
          indicator_id: null,
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

// FREE / PRO usage limits (api-design.md §28.1, HQ決定 2026-10-08) — same
// numbers as src/domain/planLimits.ts, following the /__mock/subscription-plan switch.
const MOCK_PLAN_LIMITS = {
  FREE: {
    calendar_past: { unit: 'MONTHS', count: 1 },
    favorites_max: 3,
    notification_importances: ['HIGH'],
    notification_fx_pairs_max: 1,
    history_events_max: 5,
  },
  PRO: {
    calendar_past: { unit: 'YEARS', count: 5 },
    favorites_max: null,
    notification_importances: ['HIGH', 'MEDIUM', 'LOW'],
    notification_fx_pairs_max: null,
    history_events_max: 20,
  },
};
const MOCK_CALENDAR_FUTURE_YEARS = 2;

/** UTC offset (ms) at `instant`: of `timeZone` when the request names one,
 * otherwise of this server's local timezone (like calendarFixture). */
function mockOffsetMs(instant, timeZone) {
  if (!timeZone) return -new Date(instant).getTimezoneOffset() * 60_000;
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant))
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

function mockValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** 00:00 local on year/month(1-based, may overflow)/day, as a Date. */
function mockLocalMidnight(year, month, day, timeZone) {
  const wall = Date.UTC(year, month - 1, day);
  return new Date(wall - mockOffsetMs(wall - mockOffsetMs(wall, timeZone), timeZone));
}

function mockCalendarBounds(plan, timeZone) {
  const local = new Date(now().getTime() + mockOffsetMs(now().getTime(), timeZone));
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const earliest = (past) =>
    past.unit === 'MONTHS'
      ? mockLocalMidnight(year, month - past.count, 1, timeZone)
      : mockLocalMidnight(year - past.count, 1, 1, timeZone);
  return {
    earliestFrom: earliest(MOCK_PLAN_LIMITS[plan].calendar_past),
    proEarliestFrom: earliest(MOCK_PLAN_LIMITS.PRO.calendar_past),
    latestTo: mockLocalMidnight(year + MOCK_CALENDAR_FUTURE_YEARS, 1, 1, timeZone),
  };
}

/** GET /entitlements (api-design.md §27): features + plan + limits. */
function entitlementsHandler(searchParams) {
  const timeZone = searchParams.get('timezone') || undefined;
  const plan = mockSubscriptionPlan;
  const limits = MOCK_PLAN_LIMITS[plan];
  const bounds = mockCalendarBounds(plan, timeZone);
  const features = ['VIEW_BASIC_EVENT', 'VIEW_HISTORICAL', 'VIEW_MARKET_REACTION'];
  if (plan === 'PRO') features.push('VIEW_ADVANCED_STATS');
  return {
    features,
    plan,
    limits: {
      calendar_earliest_from: isoSeconds(bounds.earliestFrom),
      calendar_latest_to: isoSeconds(bounds.latestTo),
      favorites_max: limits.favorites_max,
      notification_importances: limits.notification_importances,
      notification_fx_pairs_max: limits.notification_fx_pairs_max,
      history_events_max: limits.history_events_max,
    },
  };
}

/** GET /calendar's plan range rule (api-design.md §14.6): null when allowed,
 * otherwise [status, error body]. */
function calendarPlanError(searchParams) {
  const timeZone = searchParams.get('timezone') || undefined;
  if (timeZone && !mockValidTimeZone(timeZone)) {
    return [422, { error: { code: 'VALIDATION_ERROR', message: 'timezone: must be a valid IANA time zone' } }];
  }
  const fromMs = Date.parse(searchParams.get('from') ?? '');
  const toMs = Date.parse(searchParams.get('to') ?? '');
  const bounds = mockCalendarBounds(mockSubscriptionPlan, timeZone);
  if (!Number.isNaN(toMs) && toMs > bounds.latestTo.getTime()) {
    return [
      422,
      { error: { code: 'VALIDATION_ERROR', message: `to: must be ${isoSeconds(bounds.latestTo)} or earlier.` } },
    ];
  }
  if (!Number.isNaN(fromMs) && fromMs < bounds.earliestFrom.getTime()) {
    if (fromMs >= bounds.proEarliestFrom.getTime()) {
      return [
        403,
        {
          error: {
            code: 'PLAN_LIMIT_EXCEEDED',
            message: `from: the ${mockSubscriptionPlan} plan can go back to ${isoSeconds(bounds.earliestFrom)}.`,
            required_plan: 'PRO',
          },
        },
      ];
    }
    return [
      422,
      { error: { code: 'VALIDATION_ERROR', message: `from: must be ${isoSeconds(bounds.earliestFrom)} or later.` } },
    ];
  }
  return null;
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
  if (pathname === '/api/v1/calendar') {
    const planError = calendarPlanError(searchParams);
    if (planError) return json(res, ...planError);
    return json(res, 200, calendarHandler(searchParams));
  }
  // api-design.md §27 / §28.1: follows the /__mock/subscription-plan switch.
  if (pathname === '/api/v1/entitlements') return json(res, 200, entitlementsHandler(searchParams));
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
    const fxPairId = searchParams.get('fx_pair_id') ?? FX_PAIR_ID;
    if (timeframe === 'all') return json(res, 200, reactionAllHandler(segments[1], fxPairId));
    return json(res, 200, reactionSingleHandler(segments[1], timeframe, fxPairId));
  }
  if (segments[0] === 'events' && segments[2] === 'reaction' && segments[3] === 'chart') {
    const timeframe = searchParams.get('timeframe') ?? '5m';
    const fxPairId = searchParams.get('fx_pair_id') ?? FX_PAIR_ID;
    return json(res, 200, reactionChartHandler(segments[1], timeframe, fxPairId));
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
