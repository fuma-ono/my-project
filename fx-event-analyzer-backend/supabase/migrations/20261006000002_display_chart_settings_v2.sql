-- SCR-018 表示・地域設定 / SCR-019 チャート設定の項目追加 (2026-10-06)。
--
-- GET/PATCH /settings (api-design.md §24.4/§24.5) の display / chart に
-- 対応する。API のフィールド名は列名から display_ / chart_ を除いたもの
-- (例: display_text_size ⇔ display.text_size)。chart_type だけは
-- chart_chart_type を避けて列名をそのまま chart.chart_type に対応させる。
-- 変換は src/repositories/userSettingsRepository.ts と
-- src/domain/userSettings.ts。
--
-- 値の妥当性は Backend (src/schemas/settings.ts) でも 422 で弾くが、DB 側も
-- CHECK で同じ列挙に限定する。既存行は列デフォルトで埋まるのでデータ移行は
-- 不要。

alter table user_settings
  -- SCR-018 表示・地域設定
  add column display_theme text not null default 'SYSTEM'
    check (display_theme in ('SYSTEM', 'DARK', 'LIGHT')),
  add column display_text_size text not null default 'STANDARD'
    check (display_text_size in ('SMALL', 'STANDARD', 'LARGE')),
  add column display_date_format text not null default 'YYYY/MM/DD'
    check (display_date_format in ('YYYY/MM/DD', 'YYYY-MM-DD', 'MM/DD/YYYY', 'YYYY年M月D日')),
  add column display_time_format text not null default '24H'
    check (display_time_format in ('24H', '12H')),
  add column display_currency text not null default 'JPY'
    check (display_currency in ('JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD')),
  add column display_week_start text not null default 'MONDAY'
    check (display_week_start in ('SUNDAY', 'MONDAY')),
  -- SCR-019 チャート設定
  add column chart_type text not null default 'CANDLE'
    check (chart_type in ('CANDLE', 'LINE', 'BAR')),
  add column chart_show_indicators boolean not null default true,
  add column chart_indicator_ma boolean not null default true,
  add column chart_indicator_bollinger boolean not null default false,
  add column chart_indicator_macd boolean not null default true,
  add column chart_indicator_rsi boolean not null default false,
  add column chart_indicator_stochastic boolean not null default false,
  add column chart_crosshair boolean not null default true,
  add column chart_price_line boolean not null default true;

comment on column user_settings.display_theme is 'SCR-018 テーマ。SYSTEM = 端末の設定に従う';
comment on column user_settings.display_text_size is 'SCR-018 文字サイズ';
comment on column user_settings.display_date_format is 'SCR-018 日付の表示形式';
comment on column user_settings.display_time_format is 'SCR-018 時刻の表示形式(24時間制 / 12時間制)';
comment on column user_settings.display_currency is 'SCR-018 表示通貨';
comment on column user_settings.display_week_start is 'SCR-018 週の始まり';
comment on column user_settings.chart_type is 'SCR-019 チャートの種類(ローソク足 / ライン / バー)';
comment on column user_settings.chart_show_indicators is 'SCR-019 テクニカル指標を表示するか。false なら各 chart_indicator_* に関わらず表示しない';
comment on column user_settings.chart_indicator_ma is 'SCR-019 移動平均線';
comment on column user_settings.chart_indicator_bollinger is 'SCR-019 ボリンジャーバンド';
comment on column user_settings.chart_indicator_macd is 'SCR-019 MACD';
comment on column user_settings.chart_indicator_rsi is 'SCR-019 RSI';
comment on column user_settings.chart_indicator_stochastic is 'SCR-019 ストキャスティクス';
comment on column user_settings.chart_crosshair is 'SCR-019 クロスヘア(十字カーソル)を表示するか';
comment on column user_settings.chart_price_line is 'SCR-019 現在値ラインを表示するか';
