-- SCR-008 相場反応詳細 (HQ指示 2026-10-09): 値動き分析カードに、結果が予想を
-- 上回った / 下回ったときに「一般的にどう見られているか」を表示する。
-- api-design.md §13.1 / §13.2 の indicator オブジェクトの
-- market_view_above / market_view_below に対応する。
--
-- 中身は人が書いた定型の1文 (AI生成ではない)。教科書的な一般論であり、
-- 個別イベントの実際の値動きの原因と断定する表示には使わない。
-- どちらも NULL 可 (未登録の指標は画面側で項目を出さない)。
-- 空文字・空白だけの文は不可、長さは200文字以内。
-- 既存行は NULL のまま (= 未登録) なのでバックフィルは不要。

alter table economic_indicators
  add column market_view_above text
    check (market_view_above is null or (btrim(market_view_above) <> '' and char_length(market_view_above) <= 200)),
  add column market_view_below text
    check (market_view_below is null or (btrim(market_view_below) <> '' and char_length(market_view_below) <= 200));

comment on column economic_indicators.market_view_above is 'SCR-008 結果が予想を上回ったときの一般的な見方 (人が書いた日本語1文、200文字以内)。実際の値動きの原因とは断定しない。NULL = 未登録';
comment on column economic_indicators.market_view_below is 'SCR-008 結果が予想を下回ったときの一般的な見方 (人が書いた日本語1文、200文字以内)。実際の値動きの原因とは断定しない。NULL = 未登録';
