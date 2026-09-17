# FX Event Analyzer — Backend

Data foundation for FX Event Analyzer: DB schema, RLS, and (once unblocked
— see below) the Backend API server. Design is owned by HQ; full specs
live at
[`docs/projects/fx-event-analyzer/`](../docs/projects/fx-event-analyzer/)
(`db-design.md`, `api-design.md` are the ones this directory implements
against).

## Status (Phase 2)

**Done**: DB migrations (all 13 entities from db-design.md v4.2), RLS
policies, `pg_trgm` search indexes, development/test seed data.

**Blocked**: the Backend API server itself. No design document names a
language or framework for it — `design.md` §31 lists "Backend framework"
explicitly as an unresolved item, and Phase 2's HQ instruction describes
the API's behavior (REST, `/api/v1`, JWT → Authorization → Entitlement →
DB → DTO) without naming one either. Writing server code now would mean
picking a language unilaterally, which is the same category of decision
HQ made explicitly for the iOS client (SwiftUI over React Native) rather
than leaving to implementation. See the Phase 2 report for the specific
question raised to HQ.

**Not yet provisioned**: no real Supabase project exists for FX Event
Analyzer (confirmed in the Phase 0 audit, still true). Migrations here are
ready to apply the moment one exists.

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

| File | Contents |
|---|---|
| `20260917000001_extensions_and_helpers.sql` | `pgcrypto`, `pg_trgm`, shared `set_updated_at()` trigger function |
| `20260917000002_profiles_subscriptions_entitlements.sql` | User-specific tables |
| `20260917000003_economic_indicators_and_fx_pairs.sql` | Indicator/FxPair masters + `IndicatorFxPair` |
| `20260917000004_economic_events.sql` | `EconomicEvent` metadata |
| `20260917000005_event_snapshots.sql` | `EventSnapshot` + the RELEASE-immutability trigger |
| `20260917000006_event_revisions_and_explanations.sql` | `EventRevision`, `EventExplanation` |
| `20260917000007_fx_prices_and_event_price_reactions.sql` | `FxPrice`, `EventPriceReaction` |
| `20260917000008_ingestion_logs.sql` | `IngestionLog` |
| `20260917000009_rls.sql` | RLS enable + policies for all 13 tables |
| `20260917000010_search_indexes.sql` | `pg_trgm` GIN indexes for partial-match Search |

### Seed data

`supabase/seed.sql` — development/test fixtures only (5 indicators, 3 FX
pairs, 3 events covering released/no-forecast/scheduled states). Never to
be presented as real Provider data. `Profile`/`Subscription`/`Entitlement`
rows are intentionally not seeded here — `profiles.id` is a foreign key
into Supabase's own `auth.users`, and that schema is best populated by
actually signing up through Supabase Auth against a running local stack,
not by hand-inserting into a GoTrue-owned table.

## What this is not

Independent of `app/`, `expense-app/`, and
`personal-side-projects/kashikari/` — no shared code, Supabase project, or
secrets. Independent of `fx-event-analyzer/` (the iOS client) as a
deployable, though both implement the same product design.
