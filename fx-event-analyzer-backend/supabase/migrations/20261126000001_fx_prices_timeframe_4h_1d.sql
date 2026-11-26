-- fx_prices に 4 時間足('4h')と日足('1d')を保存できるようにする(HQ 2026-11-26「価格履歴の保存設計」)。
--
-- 日足の区切りは NY 17:00(America/New_York、夏時間は自動)。4h は日足と揃う(NY 17/21/1/5/9/13 時の区切り)。
-- 計算エンジン(src/domain/technical)は '1h' と呼ぶが、DB の既存値は '60m'(この migration では変えない。対応表はコードで持つ)。
-- この migration は値の許可を広げるだけで、既存の行・取り込みの動作は変えない(4h/1d の行を書くジョブは別。価格データの
-- 利用権が確認できるまで、価格の取り込みは PRICE_FEATURES_ENABLED で止まっている)。
--
-- 手順: 既存の CHECK を外し、NOT VALID で付け直して(既存行を走査せず、ロックが短い)、VALIDATE で既存行を確認する。
-- 何度流しても同じ結果になる(外す・付ける・確認する、のいずれも既にあれば何も変わらない)。
-- 戻し方: 4h/1d の行が無いことを確認してから、制約を旧い 5 値で付け直す(下のコメント)。
--   alter table fx_prices drop constraint fx_prices_timeframe_check;
--   alter table fx_prices add constraint fx_prices_timeframe_check check (timeframe in ('1m','5m','15m','30m','60m')) not valid;
--   alter table fx_prices validate constraint fx_prices_timeframe_check;

alter table fx_prices drop constraint if exists fx_prices_timeframe_check;

alter table fx_prices
  add constraint fx_prices_timeframe_check
  check (timeframe in ('1m', '5m', '15m', '30m', '60m', '4h', '1d')) not valid;

alter table fx_prices validate constraint fx_prices_timeframe_check;
