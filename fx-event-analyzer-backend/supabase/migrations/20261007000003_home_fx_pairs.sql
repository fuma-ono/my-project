-- SCR-026 ホーム通貨ペア編集 (2026-10-07): ホームの主要通貨ペア欄に表示する
-- 通貨ペア(最大3件・表示順つき)を保存する。api-design.md §24.4 の
-- settings.home.fx_pairs に対応する。
--
-- NULL = 既定 (USDJPY, EURUSD, EURJPY の順。src/domain/homeFxPairs.ts)。
-- 配列にFKは張れないため、要素が有効な fx_pairs.symbol かどうかと重複の
-- 有無は PATCH /settings で検証する (notify_fx_pair_symbols と同じ)。
-- 既存ユーザーは NULL のまま (= 既定) なのでバックフィルは不要。

alter table user_settings
  add column home_fx_pairs text[]
    check (home_fx_pairs is null or cardinality(home_fx_pairs) between 1 and 3);

comment on column user_settings.home_fx_pairs is 'SCR-026 ホームに表示する通貨ペア(fx_pairs.symbol の配列、1〜3件、配列順 = 表示順)。NULL = 既定 (USDJPY, EURUSD, EURJPY)';
