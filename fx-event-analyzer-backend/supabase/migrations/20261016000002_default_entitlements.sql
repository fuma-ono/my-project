-- 全ユーザーが最初から持つ機能(db-design.md v4.16 §3.3.1、api-design.md §28、HQ指示 2026-10-16)。
--
-- これまで FREE の機能(VIEW_BASIC_EVENT / VIEW_HISTORICAL / VIEW_MARKET_REACTION)は
-- entitlements の行が無いと使えなかったが、新しいユーザーにその行を入れる処理はどこにも無かった
-- (profiles は初回アクセス時に作るだけ、POST /subscription/verify は VIEW_ADVANCED_STATS だけを切り替える)。
-- そのため登録したばかりのユーザーが /speeches・/calendar・/events などで 403 FEATURE_NOT_ENTITLED になっていた。
--
-- ここに入っている feature_code は、認証済みのユーザーなら誰でも使える。
-- ただし同じユーザー・同じ feature_code の entitlements の行があれば、そちらが常に優先する
-- (enabled = true で期限内なら使える。enabled = false や期限切れなら、既定の機能でも使えない)。
-- これで運用側がユーザーごとに既定の機能を止められる。
-- FREE / PRO の名前はここにも入れない(db-design.md §3.3)。どの機能を既定にするかはこの表のデータで決める。

create table default_entitlements (
  feature_code text primary key,
  created_at timestamptz not null default now()
);

comment on table default_entitlements is
  '認証済みの全ユーザーが持つ機能。同じ user_id・feature_code の entitlements の行(有効・無効・期限切れのどれでも)があれば、そちらが優先する。';

insert into default_entitlements (feature_code) values
  ('VIEW_BASIC_EVENT'),
  ('VIEW_HISTORICAL'),
  ('VIEW_MARKET_REACTION')
on conflict (feature_code) do nothing;

-- Backend は service_role で読む(RLS を通らない)。クライアントから直接読む必要はないのでポリシーは作らない。
alter table default_entitlements enable row level security;
