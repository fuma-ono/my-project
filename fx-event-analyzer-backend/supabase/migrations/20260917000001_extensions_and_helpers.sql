-- Extensions and shared helper functions used across later migrations.
-- db-design.md v4.2 §12 confirms pg_trgm for partial-match Search indexes.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- Shared BEFORE UPDATE trigger to keep updated_at current. Applied per
-- table in later migrations only where db-design.md defines an
-- updated_at column.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
