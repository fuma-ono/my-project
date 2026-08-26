-- kashikari: Supabase スキーマ
--
-- オーナー向け手順:
-- 1. https://supabase.com でプロジェクトを新規作成する(無料枠でOK)
-- 2. プロジェクトの SQL Editor でこのファイルの内容を全部貼り付けて実行する
-- 3. Project Settings > API Keys から Project URL と Publishable key(sb_publishable_...)を
--    取得し、mobile/.env に EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY として
--    設定する(「Legacy anon, service_role API keys」タブの古いanonキーではなく、
--    「Publishable and secret API keys」タブのPublishable keyを使うこと)
-- 4. Authentication > Providers で「Anonymous Sign-Ins」を有効にする(このアプリはメール登録なし、
--    匿名サインイン+表示名のみで動く設計のため必須)
--
-- 設計方針: グループに参加しているメンバー以外は、そのグループの一切のデータ
-- (メンバー名・記録・残高・レシート画像)にアクセスできない。これをRLS
-- (Row Level Security)でデータベース側で強制する。アプリのUI側で表示を
-- 制限しているだけではない点が重要(以前のWebプロトタイプはUI側の制限しか
-- なく、URLさえ知っていれば誰でも全データが見えてしまう問題があったため)。
--
-- このファイルは複数回実行しても安全(create/alterはすべてif not exists等で
-- 冪等にしてある)。すでにプロジェクトを作成済みの場合も、更新のたびに
-- SQL Editorで全文を再実行すれば、追加された列やRPCが反映される。

-- ============================================================
-- 1. profiles: 認証ユーザー1人につき1行(匿名サインインでも作成される)
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  avatar_emoji text,
  created_at timestamptz not null default now()
);

-- schema.sqlを2回目以降に再実行しても安全なように、既存テーブルにも
-- 列を追加できるようにしておく(初回作成時は上のcreate tableで既に入る)。
alter table public.profiles add column if not exists avatar_emoji text;

alter table public.profiles enable row level security;

-- ============================================================
-- 2. groups / group_members
-- ============================================================

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  invite_code text not null unique,
  icon_emoji text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- schema.sqlを2回目以降に再実行しても安全なように、既存テーブルにも
-- 列を追加できるようにしておく(初回作成時は上のcreate tableで既に入る)。
alter table public.groups add column if not exists icon_emoji text;

alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

-- グループに人を招待した記録。招待コード自体はgroupsに1つしかないが、
-- 「誰を招待して、まだ参加していないか」を追跡するために、招待した
-- タイミングごとに1行作る(create_group_invite RPC経由)。参加が
-- 確認できたら status を 'joined' に進める(join_group RPC側で更新)。
create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  invited_name text not null check (char_length(invited_name) between 1 and 20),
  status text not null default 'pending' check (status in ('pending', 'joined')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  joined_user_id uuid references public.profiles (id),
  joined_at timestamptz
);

alter table public.group_invites enable row level security;

-- RLSポリシー内で group_members を再帰的に参照すると無限再帰になるため、
-- security definer 関数を介してメンバーかどうかを判定する(Supabase定番パターン)。
create or replace function public.is_group_member(_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = _group_id and user_id = auth.uid()
  );
$$;

-- ============================================================
-- 3. entries: 貸し借りの記録
-- ============================================================

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user uuid not null references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  type text not null check (type in ('money', 'favor')),
  amount numeric check (amount is null or amount > 0),
  currency text,
  description text check (description is null or char_length(description) <= 200),
  photo_path text,
  settled boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint entries_different_people check (from_user <> to_user),
  constraint entries_money_has_amount check (
    (type = 'money' and amount is not null and currency is not null) or
    (type = 'favor' and amount is null)
  )
);

alter table public.entries enable row level security;

create index if not exists entries_group_id_idx on public.entries (group_id);

-- 「精算済みかどうか」の単純なON/OFFではなく、「支払った→受け取った」の
-- 2段階確認を追跡できるようにする(ユーザーの本当のゴールは記録では
-- なく回収なので、双方が確認して初めて完了とみなす)。
--   unpaid    未精算(まだ誰も動いていない)
--   paid      支払う側が「支払った」を押した(受け取る側の確認待ち)
--   confirmed 受け取る側が「受け取った」を押した(双方確認済み=完了)
alter table public.entries add column if not exists settle_status text not null default 'unpaid' check (settle_status in ('unpaid', 'paid', 'confirmed'));
alter table public.entries add column if not exists paid_at timestamptz;
alter table public.entries add column if not exists confirmed_at timestamptz;

-- 旧settled(boolean)からの移行。初回実行時だけ意味を持ち、settled列を
-- 移行後に削除する(2回目以降は列自体が無いのでこのブロックは丸ごと
-- スキップされ、ファイル全体を安全に再実行できる)。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'entries' and column_name = 'settled'
  ) then
    update public.entries set settle_status = 'confirmed', confirmed_at = created_at where settled = true;
    alter table public.entries drop column settled;
  end if;
end $$;

-- ============================================================
-- 4. RLSポリシー
-- ============================================================

-- profiles: 自分自身、または同じグループに所属する相手の表示名だけ見える
drop policy if exists "profiles are visible to self and groupmates" on public.profiles;
create policy "profiles are visible to self and groupmates"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from public.group_members gm1
      join public.group_members gm2 on gm1.group_id = gm2.group_id
      where gm1.user_id = auth.uid() and gm2.user_id = profiles.id
    )
  );

drop policy if exists "users manage their own profile" on public.profiles;
create policy "users manage their own profile"
  on public.profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- groups: 参加しているグループだけ見える。作成・参加は下記RPC経由のみ
-- (直接のINSERTポリシーは用意しない)。
drop policy if exists "groups are visible to members" on public.groups;
create policy "groups are visible to members"
  on public.groups for select
  using (public.is_group_member(id));

-- group_members: 自分が参加しているグループのメンバー一覧だけ見える
drop policy if exists "group members are visible to members" on public.group_members;
create policy "group members are visible to members"
  on public.group_members for select
  using (public.is_group_member(group_id));

-- group_invites: 自分が参加しているグループの招待状況だけ見える。
-- 作成・更新はcreate_group_invite / join_group RPC経由のみ(直接の
-- INSERT/UPDATEポリシーは用意しない)。
drop policy if exists "group invites are visible to members" on public.group_invites;
create policy "group invites are visible to members"
  on public.group_invites for select
  using (public.is_group_member(group_id));

-- entries: 参加しているグループの記録だけ、読み書きできる(グループ内は
-- お互いを信頼する前提のため、メンバーなら誰でも記録・精算・削除できる)
drop policy if exists "entries are visible to members" on public.entries;
create policy "entries are visible to members"
  on public.entries for select
  using (public.is_group_member(group_id));

drop policy if exists "members can add entries" on public.entries;
create policy "members can add entries"
  on public.entries for insert
  with check (public.is_group_member(group_id) and created_by = auth.uid());

drop policy if exists "members can update entries" on public.entries;
create policy "members can update entries"
  on public.entries for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists "members can delete entries" on public.entries;
create policy "members can delete entries"
  on public.entries for delete
  using (public.is_group_member(group_id));

-- ============================================================
-- 5. グループ作成・参加はRPC経由(招待コードの生成・照合をサーバー側に集約)
-- ============================================================

-- 以前は create_group(_name text) の1引数だった。_icon_emoji を追加した
-- ことで引数の型構成が変わり、create or replace では置き換えられず
-- 別関数として並存してしまう(呼び出しが曖昧になる)ため、先に古い方を
-- 明示的に削除してから作り直す。
drop function if exists public.create_group(text);

create or replace function public.create_group(_name text, _icon_emoji text default null)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  _group public.groups;
  _code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- 6文字の招待コード(誤読しやすい0/O/1/Iを除いた文字セット)を衝突しなくなるまで生成
  loop
    _code := (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (random() * 32)::int + 1, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.groups where invite_code = _code);
  end loop;

  insert into public.groups (name, invite_code, icon_emoji, created_by)
  values (_name, _code, _icon_emoji, auth.uid())
  returning * into _group;

  insert into public.group_members (group_id, user_id) values (_group.id, auth.uid());

  return _group;
end;
$$;

-- 「招待中」の一覧に名前で出すための1件を作る(招待コード自体は
-- groups.invite_codeのまま変わらない。これはあくまで「誰を招待したか」の
-- 記録)。
create or replace function public.create_group_invite(_group_id uuid, _invited_name text)
returns public.group_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  _invite public.group_invites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_group_member(_group_id) then
    raise exception 'このグループのメンバーではありません';
  end if;

  insert into public.group_invites (group_id, invited_name, created_by)
  values (_group_id, _invited_name, auth.uid())
  returning * into _invite;

  return _invite;
end;
$$;

create or replace function public.join_group(_invite_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  _group public.groups;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into _group from public.groups where invite_code = upper(_invite_code);
  if _group.id is null then
    raise exception '招待コードが見つかりません';
  end if;

  insert into public.group_members (group_id, user_id)
  values (_group.id, auth.uid())
  on conflict do nothing;

  -- 新規参加(既存メンバーの再参加ではない)のときだけ、このグループで
  -- 一番古い「招待中」を「参加中」に進める。招待コードはグループ共通の
  -- 1つしかなく、誰の招待で参加したかを厳密には特定できないため、
  -- 「先に招待した人から順に参加していくはず」という前提の簡易的な
  -- マッチングにしている(FIFO)。該当する招待が無ければ何も起きない。
  if found then
    update public.group_invites
    set status = 'joined', joined_user_id = auth.uid(), joined_at = now()
    where id = (
      select id from public.group_invites
      where group_id = _group.id and status = 'pending'
      order by created_at asc
      limit 1
    );
  end if;

  return _group;
end;
$$;

create or replace function public.leave_group(_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.group_members where group_id = _group_id and user_id = auth.uid();
end;
$$;

-- グループのアイコン変更は、groups テーブルへの直接UPDATEポリシーを
-- 開放する(name等の他の列も一緒に書き換えられてしまう)代わりに、この列だけを
-- 更新するRPCに絞る。entries同様、グループ内はお互いを信頼する前提のため
-- 作成者に限らずメンバーなら誰でも変更できる。
create or replace function public.update_group_icon(_group_id uuid, _icon_emoji text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  _group public.groups;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_group_member(_group_id) then
    raise exception 'このグループのメンバーではありません';
  end if;

  update public.groups set icon_emoji = _icon_emoji where id = _group_id
  returning * into _group;

  return _group;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.create_group_invite(uuid, text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.update_group_icon(uuid, text) to authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;

-- ============================================================
-- 6. レシート画像用ストレージ(グループ単位でアクセス制限)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- 保存パスは "<group_id>/<entry_id>.jpg" という規約にする。
-- パスの先頭セグメント(group_id)からグループ所属を判定する。
drop policy if exists "group members can read receipts" on storage.objects;
create policy "group members can read receipts"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "group members can upload receipts" on storage.objects;
create policy "group members can upload receipts"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "group members can delete receipts" on storage.objects;
create policy "group members can delete receipts"
  on storage.objects for delete
  using (
    bucket_id = 'receipts'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

-- ============================================================
-- 7. 成長施策の計測(招待〜精算までのファネルを追う最小限のログ)
-- ============================================================
--
-- グループ作成数・招待送信数・参加完了数・貸し借り登録数・催促送信数・
-- 精算完了数・Premium閲覧数・Premium興味数を追うための、ごく簡単な
-- イベントログ。誰でも自分の行動として1件ずつINSERTできるだけで、
-- 行そのもの(誰が・いつ・どのグループで)へのSELECTは誰にも許可して
-- いない。アプリ内の「利用状況」画面は、下のget_usage_stats()という
-- event_typeごとの件数だけを返す関数を経由して読む(個々の行は見えない)。
-- オーナーはSupabaseダッシュボードのSQL Editor(サービスロール、RLSを
-- 迂回できる)からも直接次のように集計できる:
--
--   select event_type, count(*) from public.analytics_events
--   group by event_type order by count(*) desc;
--
-- 「精算完了率」「平均精算日数」はイベントログではなく実データから
-- 直接計算できるため、専用のイベント種別は用意していない:
--
--   -- 精算完了率(グループ作成数のうち、少なくとも1回精算完了したグループの割合)
--   select
--     count(distinct case when event_type = 'settlement_completed' then group_id end)::float
--     / nullif(count(distinct case when event_type = 'group_created' then group_id end), 0)
--     as settlement_completion_rate
--   from public.analytics_events;
--
--   -- 平均精算日数(記録作成〜受取確認までの平均日数)
--   select avg(extract(epoch from (confirmed_at - created_at)) / 86400) as avg_days_to_settle
--   from public.entries
--   where settle_status = 'confirmed' and confirmed_at is not null;

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references public.profiles (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

drop policy if exists "users can log their own analytics events" on public.analytics_events;
create policy "users can log their own analytics events"
  on public.analytics_events for insert
  with check (user_id = auth.uid() or user_id is null);

-- アプリ内の「利用状況」画面用。analytics_eventsに直接SELECTポリシーは
-- 与えず(他人の行動が個別に見えてしまうため)、event_typeごとの件数
-- だけを返すsecurity definer関数を経由させる。個々の行(誰が・いつ・
-- どのグループで)は一切外に出さない集計専用の窓口。
create or replace function public.get_usage_stats()
returns table(event_type text, event_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select event_type, count(*) as event_count
  from public.analytics_events
  group by event_type;
$$;

grant execute on function public.get_usage_stats() to authenticated;
