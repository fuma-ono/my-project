-- fx_prices の重複した索引を1本消す(HQ 2026-11-26「価格履歴の保存設計」。DEV の実測: 約 45MB)。
--
-- idx_fx_prices_pair_timeframe_timestamp(fx_pair_id, timeframe, "timestamp")は、
-- 一意制約 fx_prices_fx_pair_id_timeframe_timestamp_key が作る索引と、列も順序も同じ(btree)。
-- 一意制約の索引が同じ検索をすべて支えるので、機能は変わらない(DEV の実測: 一意制約の索引は約 113 万回、この索引は約 8.7 万回使われていた=
-- どちらも使われるが、同じ列なので片方で足りる。planner が重複側を選んでいた分は一意制約の索引に移る)。
-- 一意制約の索引は消さない(制約そのもの)。idx_fx_prices_pair_timestamp(fx_pair_id, "timestamp")は別の列なので消さない。
-- 何度流しても同じ結果になる。戻し方(通常は不要):
--   create index if not exists idx_fx_prices_pair_timeframe_timestamp on fx_prices(fx_pair_id, timeframe, "timestamp");

drop index if exists idx_fx_prices_pair_timeframe_timestamp;
