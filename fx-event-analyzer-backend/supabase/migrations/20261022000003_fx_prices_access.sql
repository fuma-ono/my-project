-- fx_prices の直接参照の禁止 (HQ指示 2026-10-22, db-design.md §6, dev-environment.md §13)
--
-- これまで fx_prices は「全認証ユーザーが SELECT 可」(20260917000009_rls.sql の
-- fx_prices_select_authenticated)だったため、アプリの anon key でログインした
-- 利用者が Supabase に直接つなぐと、無料プランでロックされた過去の発表
-- (api-design.md 28.2節)の前後の足を読み、値動き(pips)を計算し直せた。
-- 足そのものも外部の価格データ(社内確認専用の Twelve Data 無料キーで取得)で、
-- 生のまま配るべきものではない。
--
-- anon / authenticated の policy を消し、表の権限もすべて取り消す
-- (SELECT・INSERT・UPDATE・DELETE・TRUNCATE・REFERENCES・TRIGGER)。RLS は有効のまま。
-- 20261022000001_past_release_access.sql とは別のファイルにして、単独で
-- 適用・取り消しできるようにしている。順番の決まりは無い(Backend は
-- service_role で読むので、Backend のデプロイの前でも後でもよい)。
--
-- これらの権限に頼るものが無いことの確認:
--   - Backend・取り込みジョブ・レートアラートの判定は service_role で接続する
--     (src/db/supabaseClient.ts)。service_role の権限は変えない
--   - iOS は Supabase を認証にしか使わない(fx_prices を直接読まない)
--   - fx_prices を読む view・関数・トリガーは無い。Realtime の publication にも入れていない
--   - 外部キーの確認は表の所有者の権限で行われるので REFERENCES は不要
--
-- 戻す手順(rollback)は dev-environment.md §13.6。
-- 何度流しても同じ結果になる(if exists / revoke)。

alter table fx_prices enable row level security;

drop policy if exists fx_prices_select_authenticated on fx_prices;

revoke all on fx_prices from anon, authenticated;
