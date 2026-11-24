-- 要人発言の表 speech_events の直接参照の禁止 (HQ判断 2026-11-24, db-design.md §3.16 / §6, dev-environment.md)
--
-- 20261005000003 の policy speech_events_select_authenticated
-- (auth.role() = 'authenticated') は speech_events の「全列」を SELECT 可にしていて、
-- 後から追加した列(speech_body・body_status・body_error・body_fetched_at・source_url・
-- summary_* など。20261028000001 / 20261110000001 / 20261111000001 / 20261112000001)にも
-- 及ぶ。ログイン済みの利用者が Supabase へ直接つなぐと、API が返さない本文・要約も読めた。
-- 20261022000001 は economic_events などの「値」の表だけを閉じ、speech_events は
-- 「変えないもの」に入れていた(当時は本文の列が無く、公開の予定・題名だけだったため)。
--
-- この migration は、20261022000001 と同じ方式で speech_events を閉じる:
--   - policy speech_events_select_authenticated を削除する(RLS は有効のまま)
--   - anon / authenticated の表の権限をすべて取り消す(revoke all。SELECT だけでなく
--     INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER も。TRUNCATE は RLS の対象外)
-- 列単位ではなく表ごと閉じる(今後 speech_events に足す列が自動で露出しないようにするため)。
--
-- 変えないもの: speakers の policy と権限(発言者の名前・肩書きだけで、本文を持たない)。
--
-- これらの権限に頼るものが無いことの確認(2026-11-24 に調べた):
--   - iOS は Supabase を認証(/auth/v1)にしか使わない。fx-event-analyzer 配下に
--     PostgREST(/rest/v1)・supabase.from(...) の呼び出しは無い。speech_events は
--     NotificationModels.swift のコメントに出るだけ。発言は Backend API(/speeches、
--     /calendar、/notifications/upcoming 等)だけで読む。
--   - Backend は src/db/supabaseClient.ts の service_role だけで speech_events を読み書きする
--     (speechesRepository・speechBodyRepository・speechSummaryRepository・
--     ingestionRepository・quality/reader)。anon key は Backend のコードに無い。
--   - speech_events を読む view・SECURITY INVOKER の関数は無い。トリガー
--     (set_updated_at、20261015000002 の trg_speech_events_schedule_change)は NEW / OLD だけを使い、
--     更新した役割(service_role)の権限で動く。
--   - 外部キーの確認は表の所有者の権限で行われるので REFERENCES は不要。
--
-- 他の migration とは独立で、単独で適用・取り消しできる。順番の決まりは無い。
-- 何度流しても同じ結果になる(drop policy if exists / revoke)。
--
-- 戻す手順(rollback。元の「全認証ユーザーが全列 SELECT 可」に戻る。本文が再び露出するので
-- 戻した状態で公開しない):
--   create policy speech_events_select_authenticated on speech_events
--     for select using (auth.role() = 'authenticated');
--   grant all on speech_events to anon, authenticated;   -- Supabase の既定(ALL)
--   notify pgrst, 'reload schema';

alter table speech_events enable row level security;

drop policy if exists speech_events_select_authenticated on speech_events;

revoke all on speech_events from anon, authenticated;
