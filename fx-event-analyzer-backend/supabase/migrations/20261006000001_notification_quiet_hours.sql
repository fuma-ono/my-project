-- SCR-016 通知設定: 通知しない時間帯 (2026-10-06)。既定はOFF。
--
-- 有効時、GET /notifications/upcoming (api-design.md §24.6) は notify_at を
-- display_timezone (IANA名。解決できない場合は Asia/Tokyo) の現地時刻に
-- 直した値が [notify_quiet_start, notify_quiet_end) に入る項目を除外する。
-- notify_quiet_end < notify_quiet_start は日付をまたぐ (既定の 23:00〜07:00)。
-- notify_quiet_start = notify_quiet_end は「抑止しない」。判定は
-- src/domain/notifications.ts。
--
-- API は "HH:MM" で受け渡しする (src/repositories/userSettingsRepository.ts
-- で "07:00:00" ⇔ "07:00" を変換)。秒は持たないため CHECK で 0 秒に限定する。
-- 既存行は列デフォルト (OFF) で埋まるのでデータ移行は不要。

alter table user_settings
  add column notify_quiet_hours_enabled boolean not null default false,
  add column notify_quiet_start time not null default '23:00'
    check (extract(second from notify_quiet_start) = 0),
  add column notify_quiet_end time not null default '07:00'
    check (extract(second from notify_quiet_end) = 0);

comment on column user_settings.notify_quiet_hours_enabled is 'SCR-016 通知しない時間帯を使うか。false なら時間帯による抑止をしない';
comment on column user_settings.notify_quiet_start is 'SCR-016 通知しない時間帯の開始(display_timezone の現地時刻、含む)';
comment on column user_settings.notify_quiet_end is 'SCR-016 通知しない時間帯の終了(display_timezone の現地時刻、含まない)。開始より前なら日付をまたぐ。開始と同じなら抑止しない';
