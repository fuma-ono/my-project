-- SCR-006 指標詳細の再デザイン (HQ指示 2026-10-09): 指標ごとに英語名と
-- 「注目される理由」(2〜4個程度の短い箇条書き) を表示する。
-- api-design.md §13.1 / §13.2 の indicator オブジェクトの name_en / key_points に対応する。
--
-- どちらも NULL 可 (未登録の指標は画面側で項目を出さない)。key_points は
-- API では NULL を空配列 [] として返す (src/domain/indicators.ts)。
-- 要素の上限は6件、NULL要素と空文字の要素は不可。前後の空白だけの要素は
-- CHECK では弾かず、投入側 (seed / Ingestion) で整える。
-- 既存行は NULL のまま (= 未登録) なのでバックフィルは不要。

alter table economic_indicators
  add column name_en text,
  add column key_points text[]
    check (
      key_points is null
      or (
        cardinality(key_points) <= 6
        and array_position(key_points, null) is null
        and '' <> all (key_points)
      )
    );

comment on column economic_indicators.name_en is 'SCR-006 指標の英語名 (例: Consumer Price Index)。NULL = 未登録';
comment on column economic_indicators.key_points is 'SCR-006 「注目される理由」の箇条書き (日本語の短文、0〜6件、配列順 = 表示順、NULL要素・空文字は不可)。NULL = 未登録 (API では [] として返す)';
comment on column economic_indicators.description is 'SCR-006 「概要」として表示する指標の説明 (日本語1〜2文)。NULL = 未登録';
