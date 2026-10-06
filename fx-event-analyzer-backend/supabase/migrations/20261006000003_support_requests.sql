-- SCR-020 ヘルプ・お問い合わせ (db-design.md §3.17, api-design.md §24.7/§24.8):
-- お問い合わせ・フィードバックを保存し、ルールとテンプレートで自動返信する
-- (LLMは使わない。判定は src/domain/support.ts)。
--
-- classification / status / github_issue_* はBackend内部の情報で、APIでは
-- classification と github_issue_* を返さない。
--   VALID    → REPLIED   (テンプレート返信)
--   BUG      → ESCALATED (テンプレート返信 + GitHub Issue。Issue作成に
--                         失敗した・未設定のときは github_issue_* が NULL)
--   NONSENSE → IGNORED   (返信しない)
--   SPAM     → IGNORED   (返信しない)
--
-- 送信回数の上限 (1ユーザー1時間あたり5件) はこのテーブルの行数で判定する
-- ため、IGNORED の行も削除しない。

create table support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('INQUIRY', 'FEEDBACK')),
  category text not null check (category in ('ACCOUNT', 'BILLING', 'NOTIFICATION', 'CHART', 'DATA', 'BUG', 'OTHER')),
  body text not null check (char_length(body) between 1 and 2000),

  -- 不具合調査用の端末情報 (任意)。個人を特定する情報は受け取らない。
  app_version text check (char_length(app_version) <= 100),
  os_version text check (char_length(os_version) <= 100),
  device_model text check (char_length(device_model) <= 100),

  classification text not null check (classification in ('VALID', 'BUG', 'NONSENSE', 'SPAM')),
  status text not null check (status in ('REPLIED', 'IGNORED', 'ESCALATED')),
  reply_body text,
  replied_at timestamptz,
  github_issue_number int,
  github_issue_url text,
  created_at timestamptz not null default now(),

  -- IGNORED は返信なし、それ以外は返信あり。
  check ((status = 'IGNORED') = (reply_body is null)),
  check ((reply_body is null) = (replied_at is null))
);

-- GET /support/requests (newest first) and the rolling one-hour rate limit.
create index idx_support_requests_user_id_created_at on support_requests(user_id, created_at desc);

-- Same policy shape as profiles/subscriptions/entitlements/user_settings
-- (db-design.md §6): the owner may SELECT, writes are service_role (the
-- Backend) only.
alter table support_requests enable row level security;

create policy support_requests_select_own on support_requests
  for select using (user_id = auth.uid());
