-- SCR-005 指標一覧ほか (HQ指示 2026-10-13): 一覧画面で使う短い表示名。
-- api-design.md §13.1 / §13.2 の indicator オブジェクト、§14.6 の
-- カレンダー INDICATOR 項目、§12 の /home events の display_name に対応する。
--
-- 中身は HQ の表示名ルール (docs/projects/fx-event-analyzer/indicator-display-names.md)
-- に従って人が登録する (例: `消費者物価指数（CPI）`・`FOMC政策金利`)。
-- NULL 可 (未登録の指標は画面側で name を使う)。
-- 空文字・空白だけは不可、長さは40文字以内。
-- 既存行は NULL のまま (= 未登録) なのでバックフィルは不要。

alter table economic_indicators
  add column display_name text
    check (display_name is null or (btrim(display_name) <> '' and char_length(display_name) <= 40));

comment on column economic_indicators.display_name is '一覧画面の表示名(HQの表示名ルール、docs/projects/fx-event-analyzer/indicator-display-names.md)';
