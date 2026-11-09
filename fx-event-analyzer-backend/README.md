# FX Event Analyzer — Backend

Data foundation and API server for FX Event Analyzer: DB schema, RLS, and
the Node.js + TypeScript + Fastify Backend API. Design is owned by HQ;
full specs live at
[`docs/projects/fx-event-analyzer/`](../docs/projects/fx-event-analyzer/)
(`db-design.md`, `api-design.md` are the ones this directory implements
against).

## Status (Phase 3)

**Done (Phase 2)**: DB migrations (all 13 entities from db-design.md v4.2),
RLS policies, `pg_trgm` search indexes, development/test seed data, and the
Backend API server itself — bootstrap (Fastify/TypeScript/config/error
handler/health check/graceful shutdown), JWT auth middleware, Authorization
and Entitlement checks, and all 12 HQ-specified endpoints (Account,
Subscription, Entitlements, Indicators, Events, Reaction, Historical,
Search, Home).

**Done (Phase 3)**: two gaps found while wiring the iOS client's SCR-001〜
SCR-004/007 screens against this Backend, both already specified in
api-design.md but not yet implemented/correct in Phase 2 code — fixed as
minor implementation-level corrections (api-design.md's contract itself was
unchanged):
- `GET /indicators/{id}/events` (§13.3) — was entirely missing.
- `GET /home`'s events were missing `related_fx_pairs` (§12); `GET
  /events/{id}/history`'s reactions leaked the raw DB `data_status` value
  instead of the API-contract `analysis_status` (§7.1/§20).

**Backend Technology (HQ confirmed, 2026-09-17)**: Node.js + TypeScript +
Fastify v5, `@supabase/supabase-js` (service_role) for DB access, `zod` for
validation, `jose` for JWT verification, `vitest` for tests. No ORM —
db-design.md's schema is small and stable enough that raw supabase-js
queries plus hand-written repository return types (see
`src/repositories/`) are enough; see `eslint.config.js` for why that
layer's untyped Supabase results don't leak `no-unsafe-*` complaints into
the rest of the codebase.

JWT verification (`src/auth/jwt.ts`) fetches the project's own JWKS
(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) rather than checking a
shared secret — confirmed necessary against a real local stack in Phase 2
integration testing: Supabase CLI 2.71.1+ issues ES256-signed access
tokens by default, not the legacy HS256 this Backend originally verified
(every authenticated request 401'd until this was fixed). JWKS-based
verification handles either signing mode transparently and needs no
`SUPABASE_JWT_SECRET` at all.

**Not yet provisioned**: no real Supabase project exists for FX Event
Analyzer (confirmed in the Phase 0 audit, still true). Migrations and the
API server here are ready to run the moment one exists; `.env.example`
lists what `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`
need to be set to (no JWT secret — see JWKS note below).

**Out of scope for Phase 2** (per the Phase 2 instruction, deliberately not
implemented yet): external Economic Indicator/FX Price Provider
integration, the Ingestion Worker, AI analysis, speech analysis,
notifications, community features, StoreKit, Web client, and
auto-trading/signal/prediction features.

## Ingestion Worker (phase 1, 2026-10-15)

`src/ingestion/` — provider adapters, the code-reviewed mapping tables
(`src/ingestion/mappings/`), validation, cross-verification against
official statistics, and idempotent writes with an `ingestion_logs` row per
run. Values that fail validation or do not match the official statistics
are held in `ingestion_staged_values` (never read by the Read API, so the
event stays `DATA_PENDING`). Sources, terms of use, accuracy rules and
the keys to obtain: [`data-sources.md`](../docs/projects/fx-event-analyzer/data-sources.md).

- `npm run ingest:official` — FRED / BLS observations + re-verification of values waiting for an official number
- `npm run ingest:speeches` — FRB calendar (and ECB RSS, logged only) → `speech_events`
- `npm run eval:providers` — compares the paid candidates whose keys are set; writes `eval-reports/` (no DB writes; exits 0 without keys)

Nothing is scheduled automatically (suggested intervals: data-sources.md §8).
Behind a proxy: `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=...`.

## Running locally

```sh
cd fx-event-analyzer-backend
npm install
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
npm run dev             # tsx watch src/server.ts
```

## Jobs

```sh
npm run jobs:cleanup-notifications   # tsx src/jobs/cleanupNotifications.ts
node dist/jobs/cleanupNotifications.js   # same, after `npm run build`
```

Deletes every user's expired `notification_inbox` rows (`expires_at <= now()`,
via the `delete_expired_notification_inbox()` SQL function). Run it once a day
from cron, e.g. `15 3 * * * cd /path/to/fx-event-analyzer-backend && npm run jobs:cleanup-notifications`.
It reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the environment (or
`.env`) like the server, prints one JSON line (`{"job":"cleanup-notifications","deleted":N,...}`)
and exits non-zero on failure. `GET /notifications` already deletes the
caller's own expired rows, so the job only matters for users who stop opening
the app (api-design.md §24.9). It also deletes `event_schedule_changes` older
than 7 days (the CALENDAR_UPDATE retention).

```sh
npm run jobs:evaluate-rate-alerts    # tsx src/jobs/evaluateRateAlerts.ts
node dist/jobs/evaluateRateAlerts.js # same, after `npm run build`
```

Checks every user's active `rate_alerts` against the latest stored price
(`fx_prices`, the same price `GET /home` `major_fx` shows) and, for crossed
ones, inserts the `RATE_ALERT` inbox row and deactivates the alert. Users with
push off are skipped (like `GET /notifications`), and each user's alerts are
cut to their plan's limit. Run it after each price ingestion, e.g. every 5
minutes: `*/5 * * * * cd /path/to/fx-event-analyzer-backend && npm run jobs:evaluate-rate-alerts`.
Prints `{"job":"evaluate-rate-alerts","users":N,"evaluated":N,"fired":N,...}`
and exits non-zero on failure (api-design.md §24.12).

## Quality gates

```sh
npm run lint        # eslint (flat config, typed rules)
npm run format       # prettier --check
npm run typecheck    # tsc --noEmit against both src/ and tests/
npm test             # vitest — pure-logic + fake-boundary tests always run;
                      # tests/integration/** self-skips unless SUPABASE_URL /
                      # SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY point
                      # at a real local Supabase stack (see
                      # tests/integration/setup.ts). CI provides
                      # that stack via the Supabase CLI — see
                      # .github/workflows/fx-event-analyzer-backend-ci.yml.
```

## DB layer

```sh
cd fx-event-analyzer-backend
supabase start      # local Postgres + full Supabase stack (needs Docker)
supabase db reset    # applies every migration in supabase/migrations/, then supabase/seed.sql
```

`supabase/config.toml` is a local-dev/CI config only — it is not linked to
any live project and contains no secrets.

### Migrations

One file per logical group, applied in filename order:

| File                                                     | Contents                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `20260917000001_extensions_and_helpers.sql`              | `pgcrypto`, `pg_trgm`, shared `set_updated_at()` trigger function |
| `20260917000002_profiles_subscriptions_entitlements.sql` | User-specific tables                                              |
| `20260917000003_economic_indicators_and_fx_pairs.sql`    | Indicator/FxPair masters + `IndicatorFxPair`                      |
| `20260917000004_economic_events.sql`                     | `EconomicEvent` metadata                                          |
| `20260917000005_event_snapshots.sql`                     | `EventSnapshot` + the RELEASE-immutability trigger                |
| `20260917000006_event_revisions_and_explanations.sql`    | `EventRevision`, `EventExplanation`                               |
| `20260917000007_fx_prices_and_event_price_reactions.sql` | `FxPrice`, `EventPriceReaction`                                   |
| `20260917000008_ingestion_logs.sql`                      | `IngestionLog`                                                    |
| `20260917000009_rls.sql`                                 | RLS enable + policies for all 13 tables                           |
| `20260917000010_search_indexes.sql`                      | `pg_trgm` GIN indexes for partial-match Search                    |

### Seed data

`supabase/seed.sql` — development/test fixtures only (5 indicators, 3 FX
pairs, 3 events covering released/no-forecast/scheduled states). Never to
be presented as real Provider data. `Profile`/`Subscription`/`Entitlement`
rows are intentionally not seeded here — `profiles.id` is a foreign key
into Supabase's own `auth.users`, and that schema is best populated by
actually signing up through Supabase Auth against a running local stack,
not by hand-inserting into a GoTrue-owned table.

### Tests

| Directory                                                       | What                                                                                                                                                                                                                                                     | Requires a live Supabase stack?                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `tests/domain/`, `tests/utils/`, `tests/errors/`, `tests/auth/` | Pure-logic unit tests (Surprise, Reaction, Data Quality, Advanced Statistics gating, Historical Statistics, Pagination/sort-allowlist, ApiError, JWT verification)                                                                                       | No                                                           |
| `tests/authorization/`                                          | Authorization/Entitlement decision logic, against `tests/helpers/fakeSupabaseClient.ts` (a boundary fake — see its own doc comment)                                                                                                                      | No                                                           |
| `tests/integration/`                                            | The real Fastify app (`src/app.ts`) against a real local Supabase stack: genuine GoTrue-issued JWTs, real RLS-bound queries (user isolation, shared-market-data access, `ingestion_logs` lockout), and the real RELEASE-snapshot-immutability DB trigger | Yes — self-skips otherwise, see `tests/integration/setup.ts` |

## What this is not

Independent of `app/`, `expense-app/`, and
`personal-side-projects/kashikari/` — no shared code, Supabase project, or
secrets. Independent of `fx-event-analyzer/` (the iOS client) as a
deployable, though both implement the same product design.
