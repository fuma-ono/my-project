-- 無料プランの「過去の発表」制限 (HQ判断 2026-10-21/22, api-design.md §28.1, db-design.md §6)
--
-- HQ判断: FREE は指標ごとに、発表済み(status = 'RELEASED')の直近3回
-- (release_datetime の新しい順、同時刻は id の昇順)だけ結果の値を見られる。
-- それより古い発表の値・改定・解説・値動きは PRO で解放する。判定は
-- Backend API (src/domain/pastReleaseAccess.ts) が行う。
--
-- この制限をアプリ利用者が Supabase に直接つないで回避できないよう、
-- 市場の「値」を持つ次の5テーブルは、anon / authenticated から直接
-- 読み書きできなくする(これまでの「全認証ユーザーが SELECT 可」の
-- policy を削除し、テーブルの権限もすべて取り消す。RLS は有効のまま)。
--   economic_events, event_snapshots, event_revisions,
--   event_explanations, event_price_reactions
--
-- Backend は service_role で接続する(RLS も GRANT も迂回する)ので影響なし。
-- 書き込みも従来どおり service_role だけ。
--
-- 変えないもの: economic_indicators, fx_pairs, fx_prices, speakers,
-- speech_events, event_schedule_changes, indicator_fx_pairs の policy
-- (fx_prices は別ファイル 20261022000003_fx_prices_access.sql で同じ対策をする)。
--
-- 取り消す権限: SELECT だけでなく INSERT / UPDATE / DELETE / TRUNCATE /
-- REFERENCES / TRIGGER も(revoke all)。Supabase は public スキーマの表に
-- 既定で anon / authenticated / service_role へ ALL を与える(default
-- privileges)。INSERT / UPDATE / DELETE はこれまでも policy が無く RLS で
-- 拒否されていたが、TRUNCATE は RLS の対象外なので権限ごと外す。
-- 戻す手順(rollback)は dev-environment.md §13。
--
-- これらの権限に頼るものが無いことの確認:
--   - トリガー関数 record_economic_event_schedule_change (economic_events の
--     UPDATE 時、OLD/NEW だけを使い event_schedule_changes に INSERT) と
--     prevent_release_snapshot_mutation (event_snapshots の UPDATE/DELETE
--     時、OLD/NEW だけを使う) はどちらもこの5テーブルを SELECT しない。
--     トリガーは更新した役割(service_role)の権限で動く。
--   - set_updated_at() は NEW を書き換えるだけ。
--   - この5テーブルを読む view・SECURITY INVOKER の関数は無い(SECURITY
--     DEFINER の関数は下の visible_released_event_ids だけ)。
--   - 外部キーの確認は表の所有者の権限で行われるので REFERENCES は不要。
--   - iOS は Supabase を認証にしか使わない(テーブルを直接読まない)。
--
-- 何度流しても同じ結果になる(if exists / create or replace / revoke・grant)。

-- ---------------------------------------------------------------------
-- 1) 直接の読み書きの禁止
-- ---------------------------------------------------------------------

alter table economic_events enable row level security;
alter table event_snapshots enable row level security;
alter table event_revisions enable row level security;
alter table event_explanations enable row level security;
alter table event_price_reactions enable row level security;

drop policy if exists economic_events_select_authenticated on economic_events;
drop policy if exists event_snapshots_select_authenticated on event_snapshots;
drop policy if exists event_revisions_select_authenticated on event_revisions;
drop policy if exists event_explanations_select_authenticated on event_explanations;
drop policy if exists event_price_reactions_select_authenticated on event_price_reactions;

revoke all on economic_events from anon, authenticated;
revoke all on event_snapshots from anon, authenticated;
revoke all on event_revisions from anon, authenticated;
revoke all on event_explanations from anon, authenticated;
revoke all on event_price_reactions from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) 値を見られる発表の計算
-- ---------------------------------------------------------------------
-- 指標ごとに、RELEASED の直近 p_limit 回の event id を返す
-- (release_datetime desc, id asc)。Backend が FREE のときだけ呼ぶ
-- (PRO は呼ばない)。service_role 専用。

create or replace function visible_released_event_ids(p_indicator_ids uuid[], p_limit int)
returns table (event_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select ranked.id
  from (
    select
      e.id,
      row_number() over (partition by e.indicator_id order by e.release_datetime desc, e.id asc) as rn
    from economic_events e
    where e.indicator_id = any (p_indicator_ids)
      and e.status = 'RELEASED'
  ) ranked
  where ranked.rn <= p_limit;
$$;

revoke all on function visible_released_event_ids(uuid[], int) from public, anon, authenticated;
grant execute on function visible_released_event_ids(uuid[], int) to service_role;
