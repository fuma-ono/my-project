-- 要人発言の時刻の性質(HQ判断 2026-10-28「ECB週間予定・告知APIの追加対応」: ポッドキャストは要人発言として
-- 扱うが、通常の演説とは区別する)。
--   EXACT            = 発言そのものの予定の時刻(今までの行はすべてこれ)
--   PUBLICATION_TIME = 公開の時刻しか分からない(例: 収録済みのポッドキャストの公開時刻)。一覧・詳細には出すが、
--                      発言の時刻が確かめられないので相場反応の計算・過去比較・発言前の通知には使わない
-- 既存の行は既定値の EXACT になる(行の中身は変えない)。
alter table speech_events
  add column time_precision text not null default 'EXACT'
    check (time_precision in ('EXACT', 'PUBLICATION_TIME'));

comment on column speech_events.time_precision is
  'EXACT = scheduled time of the appearance; PUBLICATION_TIME = only the publication time is known (no reactions, no pre-statement notifications)';
