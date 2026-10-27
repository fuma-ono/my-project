-- BLS API の呼び出し回数の上限(HQ指示 2026-10-27「BLS定時実行の設計・実装準備」)。
--
-- npm run ingest:official:bls-calendar は、BLS への HTTP を1回ごと(再試行を含む)に、送る前に
-- reserve_api_credits('bls', …) で予約する(src/jobs/ingestBlsCalendar.ts、CreditGate)。
-- 予約できなければ送らない。日付の区切りは UTC 00:00(api_credit_ledger と同じ)。
--
-- BLS API v1(キーなし)の上限は 25 クエリ/日。1日の区切りが UTC か米国東部時間かは BLS の公開資料で
-- 確認できていないため(既知の制約)、1 残して合計 24 にする:
--   - daily_total_cap 24: 定期・手動・dry-run の合計
--   - automatic_cap 16: 定期実行(--scheduled)が予約できる合計。1回の実行は8回(系列ごとに1回)なので、
--     定期は1日2回まで。手動のために最低 8(1回分)残る
-- 1回の実行は runCap 10(8系列 + 再試行2回分。config.ts の API_CREDIT_CAPS.bls)。
--
-- 2回流しても同じ(on conflict do nothing)。上限を変えるときは、この行を update する(migration で)。
-- 戻し方: delete from api_credit_limits where provider = 'bls';
--   ただし、行を消すと BLS のジョブは予約できず(エラー)、BLS を1回も呼べなくなる。
--   戻すときは、先に Backend を台帳を使わない版に戻すこと。
-- **適用の順序: この migration → 台帳を使う Backend の統合(settings)**。逆だと、統合した時点から
-- 手動の official-bls も BLS を呼べなくなる(no credit limit configured for provider bls)。

insert into api_credit_limits (provider, daily_total_cap, automatic_cap)
values ('bls', 24, 16)
on conflict (provider) do nothing;
