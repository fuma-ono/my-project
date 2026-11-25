-- 日銀・ECB の金融政策会合の「会合の期間」と出典(HQ指示 2026-11-25「日銀・ECB の予定表」)。
--
-- economic_events の release_datetime は「決定の公表日時」(UTC)。会合は複数日(日銀・ECB とも2日間)なので、
-- 会合の初日・最終日はこの別の表に持つ(economic_events・event_schedule_changes・既存の取り込み経路は変えない)。
-- 会合の日程だけを持つ表で、政策金利の決定値・予想・結果の列は持たない(結果は FOMC の fomc_policy_decisions のような
-- 別の表で、日銀・ECB には無い)。
--
-- event_id 1つに1行(upsert で同じ行を更新する)。economic_events の行を消すとこの行も消える(cascade)。
-- 出典 source_url は公式ページの https の URL。checked_at は人が公式ページと最後に比べた日。
-- アプリ利用者が直接読み書きできないよう、economic_events と同じく RLS を有効にして権限を取り消す(Backend は service_role)。
-- 何度流しても同じ結果になる。戻し方: drop table economic_event_meetings(中身は ingest:boj-ecb-schedule で再作成できる)。

create table if not exists economic_event_meetings (
  event_id uuid primary key references economic_events(id) on delete cascade,
  meeting_start_date date not null,
  meeting_end_date date not null,
  source_url text not null check (source_url ~ '^https://'),
  checked_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (meeting_end_date >= meeting_start_date)
);

comment on table economic_event_meetings is '金融政策会合の期間(現地の日付)と出典。決定の公表日時は economic_events.release_datetime。日程だけで、決定値は持たない。';

drop trigger if exists trg_economic_event_meetings_set_updated_at on economic_event_meetings;
create trigger trg_economic_event_meetings_set_updated_at
  before update on economic_event_meetings
  for each row
  execute function set_updated_at();

alter table economic_event_meetings enable row level security;
revoke all on economic_event_meetings from anon, authenticated;
