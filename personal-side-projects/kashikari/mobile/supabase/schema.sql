-- kashikari: Supabase スキーマ
--
-- オーナー向け手順:
-- 1. https://supabase.com でプロジェクトを新規作成する(無料枠でOK)
-- 2. プロジェクトの SQL Editor でこのファイルの内容を全部貼り付けて実行する
-- 3. Project Settings > API から Project URL と anon public key を取得し、
--    mobile/.env に EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY として設定する
-- 4. Authentication > Providers で「Anonymous Sign-Ins」を有効にする(このアプリはメール登録なし、
--    匿名サインイン+表示名のみで動く設計のため必須)
--
-- 設計方針: グループに参加しているメンバー以外は、そのグループの一切のデータ
-- (メンバー名・記録・残高・レシート画像)にアクセスできない。これをRLS
-- (Row Level Security)でデータベース側で強制する。アプリのUI側で表示を
-- 制限しているだけではない点が重要(以前のWebプロトタイプはUI側の制限しか
-- なく、URLさえ知っていれば誰でも全データが見えてしまう問題があったため)。

-- ============================================================
-- 1. profiles: 認証ユーザー1人につき1行(匿名サインインでも作成される)
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ============================================================
-- 2. groups / group_members
-- ============================================================

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  invite_code text not null unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

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

create or replace function public.create_group(_name text)
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

  insert into public.groups (name, invite_code, created_by)
  values (_name, _code, auth.uid())
  returning * into _group;

  insert into public.group_members (group_id, user_id) values (_group.id, auth.uid());

  return _group;
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

  return _group;
end;
$$;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
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
