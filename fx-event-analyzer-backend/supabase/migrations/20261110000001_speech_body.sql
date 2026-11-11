-- 要人発言の公式ページの URL と本文(HQ指示 2026-11-10「要人発言本文の取得・保存機能」)。
--
-- speech_events に次の列を足す(既存の行は壊さない。列を足すだけ):
--   source_url      公式の発言ページの URL(FRB: federalreserve.gov/newsevents/speech/…、ECB: ecb.europa.eu/press/key/…)。
--                   分からないあいだは null(推測で作らない)。
--   speech_body     発言ページから取り出した本文(ナビゲーション・脚注・図の注記を除いた段落)。取れていなければ null。
--   body_fetched_at 本文を取得した日時。
--   body_status     PENDING = まだ取っていない(既存の行もこれ) / FETCHED = 取れた / FAILED = 取れなかった(body_error に理由) /
--                   NOT_APPLICABLE = 本文の無い行(発言前・中止など)。本文を推測で補うことはしない。
--   body_error      FAILED の理由(例: NO_SOURCE_URL、HTTP_404、NO_BODY_FOUND)。
--
-- 本文はまだ API で返さない(ECB の「著者名の付いた文書」の例外に当たるかなど、再掲の権利が未確認 — 報告済み)。
-- 何度流しても同じ結果になる(add column if not exists、制約は無ければ足す)。
-- 戻す手順: alter table speech_events drop column body_error, drop column body_status, drop column body_fetched_at,
--          drop column speech_body, drop column source_url;

alter table speech_events
  add column if not exists source_url text,
  add column if not exists speech_body text,
  add column if not exists body_fetched_at timestamptz,
  add column if not exists body_status text not null default 'PENDING',
  add column if not exists body_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.speech_events'::regclass and conname = 'speech_events_body_status_check'
  ) then
    alter table speech_events
      add constraint speech_events_body_status_check
        check (body_status in ('PENDING', 'FETCHED', 'FAILED', 'NOT_APPLICABLE'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.speech_events'::regclass and conname = 'speech_events_source_url_official_check'
  ) then
    -- 公式サイトの https の URL だけ(ほかのサイトの URL を出典として保存しない)。
    alter table speech_events
      add constraint speech_events_source_url_official_check
        check (
          source_url is null
          or source_url like 'https://www.federalreserve.gov/%'
          or source_url like 'https://www.ecb.europa.eu/%'
        );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.speech_events'::regclass and conname = 'speech_events_body_fetched_check'
  ) then
    -- FETCHED なら本文と取得日時がある。
    alter table speech_events
      add constraint speech_events_body_fetched_check
        check (body_status <> 'FETCHED' or (speech_body is not null and body_fetched_at is not null and source_url is not null));
  end if;
end $$;

comment on column speech_events.source_url is '公式の発言ページの URL(FRB・ECB の https だけ)。分からなければ null。';
comment on column speech_events.speech_body is '発言ページから取り出した本文(段落を空行で区切ったテキスト)。取れていなければ null。API ではまだ返さない。';
comment on column speech_events.body_fetched_at is '本文を取得した日時。';
comment on column speech_events.body_status is 'PENDING / FETCHED / FAILED / NOT_APPLICABLE。本文を推測で補わない。';
comment on column speech_events.body_error is 'FAILED の理由。';
