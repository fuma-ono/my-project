-- HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要だと思う」:
-- 指標の本来の値(例: 米国CPIはYoY%)に加えて、同じ公式系列を別の変換で見た
-- 値(例: 米国CPIのMoM%)を同じイベントに併記するための列。RELEASEスナップ
-- ショットは不変(trg_prevent_release_snapshot_mutation)なので、この副指標
-- も発表時のINSERTで一緒に書き込む前提 — 後からのUPDATEでは追加できない。
-- mapping.secondary が設定されていない指標(今のところ米国CPI以外全て)は
-- 常にnullのまま。

alter table event_snapshots
  add column secondary_value_kind text check (secondary_value_kind in ('LEVEL', 'YOY_PCT', 'MOM_PCT', 'CHANGE')),
  add column secondary_forecast numeric(18, 4),
  add column secondary_actual numeric(18, 4),
  add column secondary_previous numeric(18, 4);

comment on column event_snapshots.secondary_value_kind is
  'mappings/indicators.tsのsecondary.valueKind。null = この指標には副指標が無い(米国CPI以外は現時点で全てnull)。';
comment on column event_snapshots.secondary_actual is
  '副指標の実績値。米国CPIならMoM%(前月比)。';
comment on column event_snapshots.secondary_forecast is
  '副指標の市場予想値。bls_schedule経路(米国CPI等)は予想を作らないため常にnull。';
comment on column event_snapshots.secondary_previous is
  '副指標の前回値。';
