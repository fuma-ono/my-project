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

-- 「アイコンで自分の写真を使えるようにしてほしい」への対応。絵文字
-- (avatar_emoji)と写真(avatar_photo_path、storageのavatarsバケット内の
-- パス)は排他(どちらか一方だけが入る。片方を選んだらもう片方はnullに
-- クリアする、というルールをクライアント側で徹底する)。表示側は
-- avatar_photo_pathがあればそちらを優先する。
alter table public.profiles add column if not exists avatar_photo_path text;

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

-- グループアイコンも同様に、絵文字/写真を排他で持てるようにする
-- (avatar_photo_pathと同じ考え方)。
alter table public.groups add column if not exists icon_photo_path text;

alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 「グループ内の通知は、そのグループのみを表示するようにした方がいい」
-- という指摘への対応(88回目)。profiles.notifications_seen_at(ホーム
-- 画面全体のベル用、全グループ共通の1つの既読時刻)とは別に、グループ
-- ごとの既読時刻をここに持たせる。これにより、あるグループの通知一覧を
-- 開いて既読にしても、他のグループの未読が誤って消えたことにならない
-- (単一のグローバルな既読時刻だけを使い回すと、1つのグループを見ただけで
-- 他のグループの未読バッジまで一緒に消えてしまう不具合になるため)。
-- 参加した時点より前の通知(自分がまだいなかった頃のもの)をいきなり
-- 未読扱いにしないよう、既定値はjoined_atと同じ「今」にしておく。
alter table public.group_members add column if not exists notifications_seen_at timestamptz not null default now();

-- 「グループの設定でアイコンとグループ名だけじゃ寂しい、もう少し
-- 必要なものを考えてみて」という指摘への対応(89回目)。グループ単位で
-- プッシュ通知を止められるようにする(アプリ内の通知履歴・ホーム画面の
-- ベルには引き続き残る。ミュート=「割り込みで知らせてほしくない」であって
-- 「記録を消す」ではないため)。
alter table public.group_members add column if not exists muted boolean not null default false;

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

-- 「招待した相手が参加する前でも記録できる」対応。from_user/to_userは
-- 実際に参加しているメンバー(profiles.id)しか参照できないため、まだ
-- 参加していない招待中の相手(group_invites.id)を代わりに指せる列を
-- 追加する。片方(from_user or from_invite、to_user or to_invite)が
-- 必ずどちらか一方だけ入る形にする。招待が実際の参加に変わったとき
-- (join_group RPC内)に、from_invite/to_inviteをfrom_user/to_userへ
-- 付け替える。
alter table public.entries add column if not exists from_invite uuid references public.group_invites (id) on delete cascade;
alter table public.entries add column if not exists to_invite uuid references public.group_invites (id) on delete cascade;
alter table public.entries alter column from_user drop not null;
alter table public.entries alter column to_user drop not null;

alter table public.entries drop constraint if exists entries_different_people;
alter table public.entries drop constraint if exists entries_from_one_of;
alter table public.entries drop constraint if exists entries_to_one_of;
alter table public.entries add constraint entries_from_one_of check (
  (from_user is not null and from_invite is null) or (from_user is null and from_invite is not null)
);
alter table public.entries add constraint entries_to_one_of check (
  (to_user is not null and to_invite is null) or (to_user is null and to_invite is not null)
);
-- 「貸した人・借りた人が同一人物ではないこと」の確認。from/toが
-- どちらも実メンバーの場合、どちらも招待中の相手の場合、それぞれの
-- IDが一致していないことだけ見る(実メンバー↔招待中の組み合わせは
-- 型が違う=別人として扱ってよい)。
alter table public.entries add constraint entries_different_people check (
  not (from_user is not null and from_user = to_user)
  and not (from_invite is not null and from_invite = to_invite)
);

-- 「精算済みかどうか」の単純なON/OFFではなく、「支払った→受け取った」の
-- 2段階確認を追跡できるようにする(ユーザーの本当のゴールは記録では
-- なく回収なので、双方が確認して初めて完了とみなす)。
--   unpaid    未精算(まだ誰も動いていない)
--   paid      支払う側が「支払った」を押した(受け取る側の確認待ち)
--   confirmed 受け取る側が「受け取った」を押した(双方確認済み=完了)
alter table public.entries add column if not exists settle_status text not null default 'unpaid' check (settle_status in ('unpaid', 'paid', 'confirmed'));
alter table public.entries add column if not exists paid_at timestamptz;
alter table public.entries add column if not exists confirmed_at timestamptz;

-- 精算状態を最後に変更した人・時刻(68回目)。「グループ内はメンバー
-- なら誰でも他人の記録に触れてよい」代わりに、自分以外の誰かが
-- 精算状態を変更したことに台帳画面で気づけるようにする
-- (src/components/EntryRow.tsxのハイライト表示)。作成しただけでは
-- 更新扱いしないため、初期値はnullのまま。
alter table public.entries add column if not exists updated_by uuid references public.profiles (id);
alter table public.entries add column if not exists updated_at timestamptz;

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
-- お互いを信頼する前提のため、メンバーなら誰でも記録・精算・削除できる)。
--
-- 66回目でこれを「当事者(from_user/to_user)か記録した本人(created_by)」
-- だけに絞ったが、「相手の記録に触れてもいいから、誰が変更したか分かる
-- ようにしてほしい」というオーナーの意向を受け、68回目で元の「メンバー
-- なら誰でも」に戻した。代わりに、精算状態の変更・削除は
-- notifyGroup(src/hooks/useGroupData.ts)経由でその記録の当事者・記録者に
-- 通知するようにして、権限を絞るのではなく「見えるようにする」方向で
-- 対応している。
drop policy if exists "entries are visible to members" on public.entries;
create policy "entries are visible to members"
  on public.entries for select
  using (public.is_group_member(group_id));

drop policy if exists "members can add entries" on public.entries;
create policy "members can add entries"
  on public.entries for insert
  with check (public.is_group_member(group_id) and created_by = auth.uid());

drop policy if exists "members can update entries" on public.entries;
drop policy if exists "members can update own or party entries" on public.entries;
create policy "members can update entries"
  on public.entries for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists "members can delete entries" on public.entries;
drop policy if exists "creator can delete own entries" on public.entries;
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
  _matched_invite_id uuid;
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
    )
    returning id into _matched_invite_id;

    -- 「招待した相手が参加する前でも記録できる」対応。マッチした招待宛て
    -- (from_invite/to_invite)に記録されていたentriesを、今参加した本人
    -- (from_user/to_user)へ付け替える。
    if _matched_invite_id is not null then
      update public.entries set from_user = auth.uid(), from_invite = null where from_invite = _matched_invite_id;
      update public.entries set to_user = auth.uid(), to_invite = null where to_invite = _matched_invite_id;
    end if;
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

-- 「グループ内の通知は、そのグループのみを表示するようにした方がいい」
-- という指摘への対応(88回目)。group_members.notifications_seen_at
-- (このグループを最後にいつまで見たか)を自分の行だけ更新するRPC。
-- group_membersへの直接UPDATEは開放していない(他人の行やjoined_at等
-- 他の列まで書き換えられてしまうため)ので、update_group_icon等と
-- 同じ理由でRPCに絞る。
create or replace function public.mark_group_notifications_seen(_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.group_members set notifications_seen_at = now()
  where group_id = _group_id and user_id = auth.uid();
end;
$$;

-- 「グループの設定でアイコンとグループ名だけじゃ寂しい、もう少し
-- 必要なものを考えてみて」という指摘への対応(89回目)。上と同じ理由
-- (group_membersへの直接UPDATEは開放していない)でRPCに絞る。
create or replace function public.set_group_muted(_group_id uuid, _muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.group_members set muted = _muted
  where group_id = _group_id and user_id = auth.uid();
end;
$$;

-- 「メンバーを削除する(管理者のみ)」への対応(89回目)。作成者(管理者)
-- だけが、自分以外のメンバーを外せる。leave_group(自分自身を抜ける)
-- とは別に用意し、管理者が誤って自分自身を外せないようガードする。
create or replace function public.remove_group_member(_group_id uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _created_by uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select created_by into _created_by from public.groups where id = _group_id;
  if _created_by is null or _created_by <> auth.uid() then
    raise exception 'このグループの管理者ではありません';
  end if;
  if _user_id = auth.uid() then
    raise exception '自分自身は削除できません(抜けるを使ってください)';
  end if;
  delete from public.group_members where group_id = _group_id and user_id = _user_id;
end;
$$;

-- 「グループを削除する(管理者のみ)」への対応(89回目)。作成者(管理者)
-- だけがグループごと削除できる。group_members・entries・group_invitesは
-- groupsへの外部キーにon delete cascadeを付けてあるため自動的に消える。
-- notification_logはon delete set null(履歴として残す設計、10節参照)
-- のため、削除後もgroup_name(非正規化済み)付きの記録として残る。
create or replace function public.delete_group(_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _created_by uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select created_by into _created_by from public.groups where id = _group_id;
  if _created_by is null or _created_by <> auth.uid() then
    raise exception 'このグループの管理者ではありません';
  end if;
  delete from public.groups where id = _group_id;
end;
$$;

-- グループのアイコン変更は、groups テーブルへの直接UPDATEポリシーを
-- 開放する(name等の他の列も一緒に書き換えられてしまう)代わりに、この列だけを
-- 更新するRPCに絞る。entries同様、グループ内はお互いを信頼する前提のため
-- 作成者に限らずメンバーなら誰でも変更できる。
-- 「グループのアイコンも写真を選べるように」への対応。_icon_photo_path
-- を追加(既存の2引数版は削除し、3引数版に統一。呼び出し側は絵文字を
-- 選んだ時はicon_photo_pathにnullを、写真を選んだ時はicon_emojiにnullを
-- 明示的に渡すことで、常にどちらか一方だけが入っている状態を保つ)。
drop function if exists public.update_group_icon(uuid, text);

create or replace function public.update_group_icon(_group_id uuid, _icon_emoji text, _icon_photo_path text default null)
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

  update public.groups set icon_emoji = _icon_emoji, icon_photo_path = _icon_photo_path where id = _group_id
  returning * into _group;

  return _group;
end;
$$;

-- 「グループ内の設定ボタンを押したら、グループの設定(アイコンやグループ名
-- など)を変更できるようにした方がいい」という指摘への対応(87回目)。
-- update_group_iconと同じ理由(直接UPDATEを開放するとname以外の列も
-- 書き換えられてしまう)で、この列だけを更新するRPCに絞る。
create or replace function public.update_group_name(_group_id uuid, _name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  _group public.groups;
  _trimmed text := trim(_name);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_group_member(_group_id) then
    raise exception 'このグループのメンバーではありません';
  end if;
  if _trimmed = '' then
    raise exception 'グループ名を入力してください';
  end if;

  update public.groups set name = _trimmed where id = _group_id
  returning * into _group;

  return _group;
end;
$$;

-- 66回目でentriesのUPDATEを当事者・記録者限定に絞った際に導入した
-- 「オート精算」専用のRPC。68回目でentriesのUPDATEポリシー自体を
-- 「メンバーなら誰でも」に戻したため不要になった(直接のUPDATEで
-- 元通り一括精算できる)。既にデプロイ済みの環境から取り除く。
drop function if exists public.settle_all_money(uuid, text);

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.create_group_invite(uuid, text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.mark_group_notifications_seen(uuid) to authenticated;
grant execute on function public.set_group_muted(uuid, boolean) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.update_group_icon(uuid, text, text) to authenticated;
grant execute on function public.update_group_name(uuid, text) to authenticated;
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
-- 6.5 アイコン写真用ストレージ(自分の写真・グループの写真)
-- ============================================================
--
-- 「アイコンで自分の写真を使えるようにしてほしい。グループのアイコンも
-- 同じ」への対応。保存パスは種類ごとに規約を分ける:
--   - 自分のアバター写真: "users/<user_id>/<uuid>.jpg"
--   - グループのアイコン写真: "groups/<group_id>/<uuid>.jpg"
-- レシートと同じ非公開バケットにし、署名付きURL(useSignedUrl)経由でだけ
-- 読める。閲覧できる相手はprofilesの閲覧範囲(自分自身+同じグループの
-- メンバー)と揃えている(「データの分離について」の方針と同じ)。

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists "avatar photos are visible to self and groupmates" on storage.objects;
create policy "avatar photos are visible to self and groupmates"
  on storage.objects for select
  using (
    bucket_id = 'avatars'
    and (
      (
        (storage.foldername(name))[1] = 'users'
        and (
          (storage.foldername(name))[2]::uuid = auth.uid()
          or exists (
            select 1 from public.group_members gm1
            join public.group_members gm2 on gm1.group_id = gm2.group_id
            where gm1.user_id = auth.uid() and gm2.user_id = (storage.foldername(name))[2]::uuid
          )
        )
      )
      or (
        (storage.foldername(name))[1] = 'groups'
        and public.is_group_member((storage.foldername(name))[2]::uuid)
      )
    )
  );

drop policy if exists "users manage their own avatar photo" on storage.objects;
create policy "users manage their own avatar photo"
  on storage.objects for all
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

drop policy if exists "group members manage the group icon photo" on storage.objects;
create policy "group members manage the group icon photo"
  on storage.objects for all
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_group_member((storage.foldername(name))[2]::uuid)
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_group_member((storage.foldername(name))[2]::uuid)
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

-- ============================================================
-- 8. push_tokens: プッシュ通知(Expoのプッシュトークン)
-- ============================================================
--
-- 「誰かが記録してもアプリを開くまで気づけない」への対応。端末ごとの
-- Expoプッシュトークンをここに保存し、supabase/functions/send-push
-- (Edge Function)がentry作成・支払い報告・受取確認のタイミングで
-- 該当メンバーの端末に通知を送る。
--
-- tokenを主キーにしている(1端末=1行)。同じ端末を別アカウントで
-- ログインし直した場合は、upsert_push_token側でtokenの持ち主を
-- 付け替える(古いアカウント宛には届かなくなる、というシンプルな
-- 仕組み)。langは通知文言をどちらの言語で組み立てるか
-- (send-push側)に使う。
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lang text not null default 'ja' check (lang in ('ja', 'en')),
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

-- SELECTポリシーは意図的に与えない(他人のトークンを読めても嬉しい
-- ことがなく、送信自体はservice_role権限のEdge Function側で行うため)。
-- 登録・更新はRLSを迂回できるupsert_push_token関数経由に統一し、
-- テーブルへの直接insert/updateポリシーは用意しない(下記参照)。
drop policy if exists "users can delete their own push token" on public.push_tokens;
create policy "users can delete their own push token"
  on public.push_tokens for delete
  using (user_id = auth.uid());

-- 同じtokenが既に別アカウントの持ち物として残っていても構わず、
-- 呼び出したユーザー(auth.uid())の持ち物として登録し直す。RLSの
-- insert/updateポリシーで「他人のtokenを上書きしようとしたら弾く」
-- という組み方だと、端末の使い回し(ログアウトし忘れ等)で新しい
-- アカウントが二度と登録できなくなるため、それを避けるために
-- security definerのRPCに統一している。
create or replace function public.upsert_push_token(_token text, _lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_tokens where token = _token and user_id <> auth.uid();
  insert into public.push_tokens (token, user_id, lang, updated_at)
  values (_token, auth.uid(), _lang, now())
  on conflict (token) do update set user_id = auth.uid(), lang = excluded.lang, updated_at = now();
end;
$$;

grant execute on function public.upsert_push_token(text, text) to authenticated;

-- ============================================================
-- 9. リアルタイム配信の有効化
-- ============================================================
--
-- 「相手側の記録が反映されない、いちいちリロードしないといけない」への
-- 対応。src/hooks/useGroupData.tsは`supabase.channel(...).on('postgres_changes',
-- ...)`でentries・group_members・group_invitesの変更をリアルタイムに
-- 購読しているが、テーブルを作っただけではSupabase Realtimeは配信して
-- くれない。対象テーブルをsupabase_realtimeパブリケーションに明示的に
-- 追加する必要がある(ダッシュボードのDatabase > Replicationで手動で
-- トグルするのと同じことをSQLでやっている)。これは最初のセットアップ
-- 時から漏れていた可能性が高い(単独端末での動作確認だけでは気づけない
-- 不具合のため)。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_members'
  ) then
    alter publication supabase_realtime add table public.group_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_invites'
  ) then
    alter publication supabase_realtime add table public.group_invites;
  end if;
end $$;

-- ============================================================
-- 10. notification_log: アプリ内の通知履歴
-- ============================================================
--
-- 「通知をためられるように、通知ページが必要」への対応。send-push
-- (Edge Function)が通知を組み立てるたびに、実際にOSのプッシュ通知を
-- 送れたかどうかに関わらず(相手が通知トークンを登録していない場合も
-- 含め)、対象メンバー1人につき1行ずつ記録する。アプリを開いた時に
-- 「見逃した通知」を後から見返せるようにするための、いわば受信箱。
--
-- group_nameは非正規化して保存する(グループを抜けた後や、グループ名が
-- 変わった後でも、その時点の履歴として読めるようにするため。JOINで
-- 都度引く方式だと、抜けた後はRLSで見えなくなってしまう)。
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  group_name text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.notification_log enable row level security;

-- 自分宛の通知だけ見える。挿入はservice_role権限(send-push)からのみ
-- 行うため、クライアント向けのinsertポリシーは用意しない。
drop policy if exists "users can read their own notification log" on public.notification_log;
create policy "users can read their own notification log"
  on public.notification_log for select
  using (user_id = auth.uid());

-- このテーブルも、通知ページを開いたままでも新着が反映されるよう
-- リアルタイム配信を有効化する(セクション9と同じ理由)。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_log'
  ) then
    alter publication supabase_realtime add table public.notification_log;
  end if;
end $$;

-- 「通知が来ているかどうか、アイコンを見ただけでは分からない」への
-- 対応。通知ベルの未読マーク用に、profilesへ「最後に通知ページを
-- 開いた時刻」を1列追加する。この時刻より新しいnotification_logが
-- あれば未読(ベルに赤い点を表示)とみなす。既存ユーザーには今の時刻を
-- 入れておく(移行時点より前の通知をいきなり全部未読扱いにしないため)。
alter table public.profiles add column if not exists notifications_seen_at timestamptz not null default now();
