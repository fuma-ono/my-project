-- SCR-015 アカウント情報 (HQ確定 2026-10-05, account-screen-reference-v1.png):
-- the screen shows the user's 生年月日, which had no column yet. Optional —
-- existing and new users simply have null until they set it from
-- プロフィール編集. A calendar date only (no time / timezone).
alter table profiles
  add column birth_date date
    check (birth_date >= date '1900-01-01');
