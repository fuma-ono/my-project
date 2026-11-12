-- 取り込みの運用データの表の権限 (HQ判断 2026-10-22, db-design.md §6, dev-environment.md §13.8)
--
-- ingestion_logs・ingestion_staged_values・official_observations は、取り込みの
-- 途中の値や公式統計の値(無料プランでロックされた過去の発表の結果も含む)を
-- 持つ。RLS は有効でポリシーも無いので、これまでも anon / authenticated から
-- は0件・書き込み不可だったが、権限は Supabase の既定(ALL)のままだった。
-- 防御を重ねるため、anon / authenticated の表の権限をすべて取り消す
-- (SELECT・INSERT・UPDATE・DELETE・TRUNCATE・REFERENCES・TRIGGER)。
-- RLS は有効のまま、ポリシーは変えない。
--
-- これらの権限に頼るものが無いことの確認:
--   - 読み書きするのは取り込みジョブ(src/repositories/ingestionRepository.ts)と
--     品質レポート(src/ingestion/quality/reader.ts、npm run report:data-quality /
--     GET /quality-report)で、どれも service_role(src/db/supabaseClient.ts)
--   - iOS は Supabase を認証にしか使わない
--   - 3表を読む view・関数は無い。トリガーは ingestion_staged_values の
--     set_updated_at だけ(NEW を書き換えるだけで、更新した service_role の権限で動く)
--   - official_observations.id の連番(identity)は service_role だけが使う
--     (INSERT の権限が無いので anon / authenticated は連番を使えない)
--
-- 20261022000001 / 20261022000003 とは別のファイルで、単独で適用・取り消しできる。
-- 順番の決まりは無い。戻す手順は dev-environment.md §13.8。
-- 何度流しても同じ結果になる(revoke)。

alter table ingestion_logs enable row level security;
alter table ingestion_staged_values enable row level security;
alter table official_observations enable row level security;

revoke all on ingestion_logs from anon, authenticated;
revoke all on ingestion_staged_values from anon, authenticated;
revoke all on official_observations from anon, authenticated;
