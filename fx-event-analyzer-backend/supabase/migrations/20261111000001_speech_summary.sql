-- 要人発言の要約を作る工程(HQ指示 2026-11-11「要人発言: 本文取得と要約生成を別々の工程として扱う」)。
--
-- 本文の取得(migration 20261110000001、ingest:speech-bodies)とは別の工程(ingest:speech-summaries)が、本文の取れた
-- 発言(body_status = FETCHED)から要約を作り、speech_events.summary(既存の列)に入れる。この migration は、どう作ったか・
-- いつ作ったか・作れなかった理由を残す列を足す(既存の行は壊さない。列を足すだけ)。
--   summary_method       EXTRACTIVE_EN = 原文(英語)から要点の文をそのまま抜き出したもの(言語モデル・有料 API は使わない。
--                        訳さない・言い換えない)。ほかの方法(日本語の要約など)を入れるときは値を足す。
--   summary_generated_at 要約を作った日時。
--   summary_error        作れなかった理由(例: BODY_TOO_SHORT・NO_SENTENCES)。この列がある行の summary_status は FAILED。
-- 要約は本文の権利を確認できた発言元(今は FRB だけ。pipelines/speechBodies.ts)の発言にしか作られない(本文が無い発言には作れない)。
-- 何度流しても同じ結果(add column if not exists、制約は無ければ足す)。
-- 戻す手順: alter table speech_events drop column summary_error, drop column summary_generated_at, drop column summary_method;

alter table speech_events
  add column if not exists summary_method text,
  add column if not exists summary_generated_at timestamptz,
  add column if not exists summary_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.speech_events'::regclass and conname = 'speech_events_summary_method_check'
  ) then
    alter table speech_events
      add constraint speech_events_summary_method_check
        check (summary_method is null or summary_method in ('EXTRACTIVE_EN'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.speech_events'::regclass and conname = 'speech_events_summary_generated_check'
  ) then
    -- 工程が作った要約には、作り方と日時がある(作れなかった行には要約が無い)
    alter table speech_events
      add constraint speech_events_summary_generated_check
        check (
          (summary_method is null or (summary is not null and summary_generated_at is not null))
          and (summary_error is null or summary is null)
        );
  end if;
end $$;
