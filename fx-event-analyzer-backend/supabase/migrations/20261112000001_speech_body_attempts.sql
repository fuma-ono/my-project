-- 要人発言の本文の取得の試行回数(HQ承認 2026-11-11「要人発言の定期実行」1日目)。
--
-- speech_events に2列を足す(既存の行は壊さない。列を足すだけ):
--   body_attempts        その発言の行で、本文のページの取得を試みた回数(発言の行ごと。ページごとではない)。
--                        実際に本文のページを読む直前に1回だけ増やす(dry-run では増やさない)。FAILED の行は、この回数が
--                        上限(3回)に達したら自動の対象から外す。人が原因を確かめた後に 0 に戻すと、また対象になる。
--   body_last_attempt_at 最後に試みた日時。
-- 回数の加算は「状態が PENDING / FAILED で、回数が読んだときのまま」の行だけに対して行う(楽観的な条件。二重の実行で
-- 二重に数えない・FETCHED の本文と URL を上書きしない — repositories/speechBodyRepository.ts)。
-- API はこの2列を返さない。既定値が定数の列の追加なので、表の書き換えは起きない。
-- 何度流しても同じ結果(add column if not exists、制約は無ければ足す)。
-- 戻す手順: alter table speech_events drop column body_last_attempt_at, drop column body_attempts;

alter table speech_events
  add column if not exists body_attempts integer not null default 0,
  add column if not exists body_last_attempt_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.speech_events'::regclass and conname = 'speech_events_body_attempts_check'
  ) then
    alter table speech_events
      add constraint speech_events_body_attempts_check check (body_attempts >= 0);
  end if;
end $$;

comment on column speech_events.body_attempts is '本文のページの取得を試みた回数(発言の行ごと)。FAILED は3回で自動の対象から外す。';
comment on column speech_events.body_last_attempt_at is '本文の取得を最後に試みた日時。';
