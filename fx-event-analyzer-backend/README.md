# FX Event Analyzer — Backend

Data foundation and API server for FX Event Analyzer: DB schema, RLS, and
the Node.js + TypeScript + Fastify Backend API. Design is owned by HQ;
full specs live at
[`docs/projects/fx-event-analyzer/`](../docs/projects/fx-event-analyzer/)
(`db-design.md`, `api-design.md` are the ones this directory implements
against).

## Status (Phase 2)

**Done**: DB migrations (all 13 entities from db-design.md v4.2), RLS
policies, `pg_trgm` search indexes, development/test seed data, and the
Backend API server itself — bootstrap (Fastify/TypeScript/config/error
handler/health check/graceful shutdown), JWT auth middleware, Authorization
and Entitlement checks, and all 12 HQ-specified endpoints (Account,
Subscription, Entitlements, Indicators, Events, Reaction, Historical,
Search, Home).

**Backend Technology (HQ confirmed, 2026-09-17)**: Node.js + TypeScript +
Fastify v5, `@supabase/supabase-js` (service_role) for DB access, `zod` for
validation, `jsonwebtoken` for JWT verification, `vitest` for tests. No
ORM — db-design.md's schema is small and stable enough that raw
supabase-js queries plus hand-written repository return types (see
`src/repositories/`) are enough; see `eslint.config.js` for why that
layer's untyped Supabase results don't leak `no-unsafe-*` complaints into
the rest of the codebase.

**Not yet provisioned**: no real Supabase project exists for FX Event
Analyzer (confirmed in the Phase 0 audit, still true). Migrations and the
API server here are ready to run the moment one exists; `.env.example`
lists what `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET`
need to be set to.

**Out of scope for Phase 2** (per the Phase 2 instruction, deliberately not
implemented yet): external Economic Indicator/FX Price Provider
integration, the Ingestion Worker, AI analysis, speech analysis,
notifications, community features, StoreKit, Web client, and
auto-trading/signal/prediction features.

## Running locally

```sh
cd fx-event-analyzer-backend
npm install
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET
npm run dev             # tsx watch src/server.ts
```

## Quality gates

```sh
npm run lint        # eslint (flat config, typed rules)
npm run format       # prettier --check
npm run typecheck    # tsc --noEmit against both src/ and tests/
npm test             # vitest — pure-logic + fake-boundary tests always run;
                      # tests/integration/** self-skips unless SUPABASE_URL /
                      # SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY /
                      # SUPABASE_JWT_SECRET point at a real local Supabase
                      # stack (see tests/integration/setup.ts). CI provides
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
