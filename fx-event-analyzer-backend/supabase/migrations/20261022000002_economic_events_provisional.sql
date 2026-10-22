-- 暫定の予定(HQ承認 2026-10-22 Task 3「FOMCの公式日程」、db-design.md v4.17 §3.5、
-- api-design.md v1.31 §14.6)。
--
-- is_provisional = true は「予定の日時がまだ公式に確定していない」ことを表す。
-- FOMCの日程表(src/ingestion/mappings/fomcSchedule.ts)では、FRBの
-- 「各会合の日程は直前の会合で確認されるまで暫定」というルールと、
-- FRBのカレンダー(calendar.json)にまだ発表時刻が載っていないことから付ける。
-- アプリのカレンダーは true の行に「予定（暫定）」と表示する。
-- 既存の行・他の取り込み経路はすべて false(既定値)のままで変わらない。
--
-- 影響の確認:
-- - event_schedule_changes のトリガー(20261015000002)は
--   `after update of release_datetime, status` なので、is_provisional だけを
--   変える UPDATE では起動しない(日時の変更・中止としては記録されない)。
-- - RLS(20260917000009)は行単位の SELECT ポリシーだけで、列を足しても変わらない。
-- - set_updated_at トリガーは今まで通り updated_at を更新する。
alter table economic_events add column if not exists is_provisional boolean not null default false;

comment on column economic_events.is_provisional is
  '予定の日時が公式にまだ確定していない(暫定)なら true。FOMC日程表(fomc_schedule)が設定する。既定 false。';
