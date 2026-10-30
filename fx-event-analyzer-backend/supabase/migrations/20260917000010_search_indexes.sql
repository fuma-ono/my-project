-- db-design.md v4.2 §12: Partial Match Search (ILIKE '%...%') needs
-- pg_trgm + GIN, not a plain B-tree index. Event search has no independent
-- index — it always goes through economic_indicators.name/code (Search
-- API §23.1 A-6: EconomicEvent has no event_name column to search).
-- Currency search uses a static application-level Code->Name map, not a
-- DB query, so currency_code needs no trgm index either.

create index idx_economic_indicators_name_trgm on economic_indicators using gin (name gin_trgm_ops);
create index idx_economic_indicators_code_trgm on economic_indicators using gin (code gin_trgm_ops);
create index idx_fx_pairs_symbol_trgm on fx_pairs using gin (symbol gin_trgm_ops);
