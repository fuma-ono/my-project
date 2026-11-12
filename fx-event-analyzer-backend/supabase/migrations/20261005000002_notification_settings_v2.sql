-- SCR-016 通知設定 v2 (HQ指示 2026-10-05): 通知を「保存のみ」から端末内の
-- ローカル通知へ切り替える。HQ確定 2026-10-02 の「MVPはPush通知を送信しない」
-- は本指示で置き換え。iOSは GET /notifications/upcoming (api-design.md §24.6)
-- の結果からローカル通知を予約するため、Backend側の送信基盤・デバイス
-- トークンは引き続き不要。
--
-- 旧カラム (pre_release / result / favorites / min_importance) は新画面に
-- 対応する項目が無いため削除する。既存ユーザーの値は以下で移行する:
--   notify_indicators  = notify_pre_release OR notify_result
--   notify_importances = ★ >= notify_min_importance を満たす重要度
--                        (暫定マッピング LOW→★1 / MEDIUM→★3 / HIGH→★5、
--                        src/domain/importance.ts / db-design.md §3.14)

alter table user_settings
  add column notify_push boolean not null default true,
  add column notify_indicators boolean not null default true,
  add column notify_speeches boolean not null default true,
  -- NULL = すべての通貨ペア。配列にFKは張れないため、要素が fx_pairs.symbol
  -- に存在するかは PATCH /settings で検証する。
  add column notify_fx_pair_symbols text[]
    check (notify_fx_pair_symbols is null or cardinality(notify_fx_pair_symbols) >= 1),
  add column notify_importances text[] not null default '{HIGH,MEDIUM}'
    check (cardinality(notify_importances) >= 1 and notify_importances <@ array['LOW', 'MEDIUM', 'HIGH']),
  -- 0 = 発表時ちょうど
  add column notify_lead_minutes smallint not null default 5
    check (notify_lead_minutes in (0, 5, 10, 15, 30, 60));

-- Backfill without bumping updated_at — this is a schema migration, not a
-- change the user made.
alter table user_settings disable trigger trg_user_settings_set_updated_at;

update user_settings
set
  notify_indicators = notify_pre_release or notify_result,
  notify_importances = array_remove(
    array[
      case when 5 >= notify_min_importance then 'HIGH' end,
      case when 3 >= notify_min_importance then 'MEDIUM' end,
      case when 1 >= notify_min_importance then 'LOW' end
    ],
    null
  );

alter table user_settings enable trigger trg_user_settings_set_updated_at;

alter table user_settings
  drop column notify_pre_release,
  drop column notify_result,
  drop column notify_favorites,
  drop column notify_min_importance;

comment on column user_settings.notify_push is 'SCR-016 プッシュ通知(全体のON/OFF)。false なら他の通知設定に関わらず通知しない';
comment on column user_settings.notify_indicators is 'SCR-016 重要な経済指標の通知';
comment on column user_settings.notify_speeches is 'SCR-016 要人発言の通知';
comment on column user_settings.notify_fx_pair_symbols is 'SCR-016 対象通貨ペア(fx_pairs.symbol の配列)。NULL = すべての通貨ペア';
comment on column user_settings.notify_importances is 'SCR-016 通知する重要度(LOW/MEDIUM/HIGH の部分集合、1件以上)';
comment on column user_settings.notify_lead_minutes is 'SCR-016 通知タイミング(発表の何分前か)。0 = 発表時';
