-- db-design.md v4.2 §3.7: append-only by application-layer discipline
-- (not a DB trigger — unlike event_snapshots, HQ did not require DB-level
-- enforcement here). EconomicEvent never gets a revision_status column;
-- API computes NONE/REVISED dynamically from row existence (Phase 2
-- instruction §4 "Revision").

create table event_revisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references economic_events(id) on delete restrict,
  field_name text not null check (field_name in ('ACTUAL', 'PREVIOUS')),
  old_value numeric(18, 4) not null,
  new_value numeric(18, 4) not null,
  effective_at timestamptz not null,
  source text,
  created_at timestamptz not null default now()
);

create index idx_event_revisions_event_id on event_revisions(event_id);

-- db-design.md v4.2 §3.8: history-preserving (never overwritten). MVP only
-- ever writes explanation_type = FACT_SUMMARY (Phase 2 instruction §4
-- "EventExplanation" — no free-form AI analysis in Phase 2). AI_ANALYSIS /
-- AI_SPECULATION values exist in the CHECK constraint for future use, but
-- no AI-generation-specific columns are added yet (db-design.md §3.8: "MVP
-- では追加しない").
create table event_explanations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references economic_events(id) on delete restrict,
  version integer not null default 1,
  explanation_type text not null default 'FACT_SUMMARY' check (explanation_type in ('FACT_SUMMARY', 'AI_ANALYSIS', 'AI_SPECULATION')),
  summary text,
  source text,
  source_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, version)
);

create index idx_event_explanations_event_id on event_explanations(event_id);
