# FX Event Analyzer (iOS / iPadOS)

SwiftUI native client for FX Event Analyzer. Design is owned by HQ; this
directory is the implementation only. Full design docs (requirements, DB,
API, UI screens) live at
[`docs/projects/fx-event-analyzer/`](../docs/projects/fx-event-analyzer/) —
treat that directory as the source of truth for behavior, not this README.

## Status

Phase 1 (app foundation): Xcode project scaffold, navigation, theme,
network layer, Supabase Auth integration, SCR-000 Splash, SCR-010 Login,
SCR-001 Home shell.

Phase 2: `URLSessionAPIClient` now attaches the signed-in user's Supabase
Auth access token to every Backend request (`Authorization: Bearer
<token>`, api-design.md §2.2) — Phase 1 built this client but never wired
a real token into it. `Networking/AccountService.swift`,
`SubscriptionService.swift`, and `EntitlementsService.swift` connect to
the Backend's `GET /api/v1/account`, `/subscription`, and `/entitlements`
respectively.

Phase 3: the core UX flow — 経済指標 → イベント → 予想/結果 → Surprise →
乖離理由 — is now real Backend-backed across 4 new screens plus Home's
completed API connection:

- **SCR-001 Home**: full event card (Forecast/Actual/Previous/Surprise/
  countdown/related FX pairs), split into 今日の注目イベント(`SCHEDULED`)
  and 最近のイベント(`RELEASED`), plus 主要通貨ペアの動向(`major_fx`).
- **SCR-002 Indicators** (`Features/Indicators/`): `GET /indicators` list
  with search (`q`) and an importance filter — no ad-hoc frequency filter,
  per HQ's Phase 3 instruction.
- **SCR-003 Indicator Detail** (`Features/IndicatorDetail/`):
  `GET /indicators/{id}` + `GET /indicators/{id}/events` (the latter newly
  added Backend-side this phase — see the Backend README). Distinct from
  Event Detail: no single event's Surprise is this screen's headline.
- **SCR-004 Event Detail** (`Features/EventDetail/`, the central screen):
  `GET /events/{event_id}`, in ui-screens.md's fixed H-1 order — Forecast/
  Actual/Previous → Surprise → 乖離理由(fact summary + source URL, no
  AI-generated text) → 市場への影響 (related FX pairs' 5m reaction).
  Handles DATA_PENDING/DATA_UNAVAILABLE/NOT_ANALYZABLE and the entitlement-
  gated 403 case explicitly.
- **SCR-007 Historical Event Detail** (`Features/HistoricalEventDetail/`):
  `GET /events/{event_id}/history`, with the mandatory "指標詳細を見る" →
  SCR-003 navigation.
- **Navigation**: 4-tab main navigation (Home/Indicators/Search/Settings,
  ui-screens.md §4 — Search/Settings are tab-slot placeholders only, their
  content is a later phase), each tab owning its own `NavigationPath` and
  routing through a shared `AppRoute` enum (`Navigation/`).

Phase 4: "市場への影響" — SCR-005 Movement Detail and SCR-006 Historical
Comparison, both real Backend-backed:

- **SCR-005 Movement Detail** (`Features/MovementDetail/`): reached by
  tapping a related FX pair on SCR-004. Fetches every timeframe's Reaction
  summary once (`GET /events/{id}/reaction?timeframe=all`, api-design.md
  §18.1) so the 1m/5m/15m/30m/60m Segmented Control switches instantly, and
  re-fetches only the Chart (`GET /events/{id}/reaction/chart`, §19) per
  timeframe. Uses Swift Charts (`import Charts`, no third-party
  dependency) for a close-price line with a release-time `RuleMark` and
  pre/post `RectangleMark` shading. pips/movement/change%/max upward-
  downward are the Backend's values, never recomputed client-side.
- **SCR-006 Historical Comparison** (`Features/HistoricalComparison/`):
  `GET /indicators/{id}/comparison`, reached from SCR-003's "過去の発表を
  見る". Advanced Statistics follows the existing partial-gating contract
  (§21.3) — a FREE user sees the whole screen with a "Proで解放" note, never
  a 403 blocking the page.
- Both screens share the same Segmented Control timeframe pattern as SCR-005
  for visual consistency, and cap content width on iPad via
  `adaptiveContentWidth()`; Movement Detail additionally splits chart/
  figures side-by-side on wide layouts via `ViewThatFits`.

Phase 4.5 was a UX audit only (no code changes) — full report delivered to
HQ separately. It found that individual screens were complete but not
connected into one continuous analysis experience. Phase 5 closes those
gaps and finishes two App-Store-readiness items, without adding new
screens or touching the Backend:

- **Navigation is now a connected chain**, not isolated screens: Movement
  Detail → Historical Comparison (`historicalComparisonLink` in
  `MovementDetailView`, reusing the current event's `indicatorId`/
  `fxPairId` — no re-search); Historical Comparison's event list is now
  tappable → Historical Event Detail; Event Detail → Historical
  Comparison directly (via its highest-priority related FX pair); and
  Historical Event Detail's FX pair rows → Movement Detail, so the chart
  experience works for past events too, not only the live/current flow.
  `AppRoute.movementDetail` carries `indicatorId` now for this reason.
- **Login's two previously-inert buttons** ("パスワードをお忘れですか？" /
  "新規登録") now surface an explicit "準備中" alert instead of doing
  nothing — building the underlying flows is out of Phase 5's scope
  (HQ: don't expand Auth scope), but a dead tap target is not acceptable.
- **A real ログアウト exists** (`Features/Settings/`): Settings' tab is no
  longer a pure placeholder — it calls `AuthServicing.signOut()`, guards
  against a double-tap firing two concurrent sign-outs, shows an error
  inline on failure, and routes back to Login via `AppState.handleSignOut()`
  (deliberately distinct from the session-expiry path, so a user who signs
  out on purpose never sees "セッションの有効期限が切れています").
- **Surprise now shows a plain-language comparison**
  (`ValueFormat.surpriseComparisonLabel`) — "予想を上回る結果" / "予想を
  下回る結果" / "予想通りの結果" — derived only from the sign of the
  Backend's own `surprise` value, alongside the existing `favorable_
  direction`-adjusted POSITIVE/NEGATIVE/NEUTRAL label. No AI, no trading
  implication.
- **Splash's tagline** changed from "Turn Economic Events into Trading
  Opportunities" to "Understand Economic Events & FX Reactions" — the
  original wording implied trading signals/advice, which this app
  explicitly does not provide.

No real Supabase project is provisioned yet, and the Node.js Backend
(`fx-event-analyzer-backend/`) has no deployment target — both `SUPABASE_URL`/
`SUPABASE_ANON_KEY` and the `API_BASE_URL` build setting are still blank by
default, so every screen still — correctly — shows its "Backendは準備中
です" empty state (this is real, not stale copy: nothing is actually
reachable yet). The app is built to run safely with all three unconfigured.

## Requirements

- Xcode (latest stable), iOS 17.0+ deployment target
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)

This repo does not commit a `.xcodeproj` — it's generated from
[`project.yml`](./project.yml) so the project file never drifts from a
human-reviewable spec and never needs Xcode itself to produce.

## Build locally

```sh
cd fx-event-analyzer
xcodegen generate
open FXEventAnalyzer.xcodeproj
```

Without `SUPABASE_URL` / `SUPABASE_ANON_KEY` build settings, the app still
launches; Auth-dependent actions report a "not configured" state instead of
crashing. See `.env.example` for what those variables are and
`FXEventAnalyzer/Auth/SupabaseConfig.swift` for how they're read.

## CI

`.github/workflows/fx-event-analyzer-ios-build.yml` runs on a macOS GitHub
Actions runner: installs XcodeGen, generates the project, builds, and runs
the unit test suite against an iOS Simulator. Code signing is disabled
(`CODE_SIGNING_ALLOWED=NO`) — no Apple Developer Team, certificate, or
provisioning profile exists yet, so TestFlight submission is out of scope
for Phase 1.

## What this is not

- Not a fork or copy of any other project in this repo (`app/`,
  `expense-app/`, `personal-side-projects/kashikari/`). No code, Bundle ID,
  or Supabase project is shared with them.
- Not React Native, Expo, Flutter, or Kotlin Multiplatform — SwiftUI native
  only, per HQ decision.
