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
respectively (matching `fx-event-analyzer-backend/src/routes/` exactly);
no screen consumes them yet, since none existed before Phase 2 and
building new ones wasn't asked for — they're ready for a future
Account/Subscription screen the same way `HomeViewModel(apiClient:)`
already consumes `APIClient`.

No real Supabase project is provisioned yet, and the Node.js Backend
(`fx-event-analyzer-backend/`) has no deployment target — both `SUPABASE_URL`/
`SUPABASE_ANON_KEY` and the new `API_BASE_URL` build setting are still
blank by default, so `HomeView` still — correctly — shows "Backendは準備中
です" (this is real, not stale copy: nothing is actually reachable yet).
The app is built to run safely with all three unconfigured.

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
