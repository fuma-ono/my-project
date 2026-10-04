-- db-design.md v4.2 §3.13. No FK to any other entity — records what a
-- provider/data_type ingestion run did, not what it touched.

create table ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  data_type text not null check (data_type in ('ECONOMIC_EVENT', 'FX_PRICE', 'EVENT_REACTION', 'OTHER')),
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null check (status in ('SUCCESS', 'FAILURE', 'PARTIAL')),
  fetched_count integer,
  success_count integer,
  error_count integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_ingestion_logs_data_type_started on ingestion_logs(data_type, started_at desc);
create index idx_ingestion_logs_status on ingestion_logs(status);
