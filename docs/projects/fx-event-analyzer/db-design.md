# FX Event Analyzer: DB詳細設計 v4.0

**出典**: HQより2026-09-16「DB設計確定事項」指示。v3.0で報告したHQ確認事項17件すべてに対し、HQが最終判断を確定した内容を反映した。

**位置づけ**: 本書はDB設計ドキュメントであり、コード変更・Migration実行・Table作成・API実装・Swift実装・Supabase変更などの**実装ではない**(HQ指示「実装は一切行わない」)。本書をもってDB詳細設計の正式版とする。

## 変更履歴

- **v1.0**: 初版。Claude Code独自のたたき台
- **v2.0**: HQ提示の第1回Entity定義に基づき全面改訂。不整合6件・確認事項19件を報告
- **v3.0**: HQ確定(第2回)を反映。EconomicEvent/EventSnapshot分離、EventExplanation復活等。残存確認事項17件を整理
- **v4.0**(今回): HQ確定(第3回、2026-09-16)により17件すべてに最終判断
  - EventSnapshotの不変性をDBレベル(トリガー)で担保する方針を明記
  - EventExplanationは履歴保持に変更(`UQ(event_id)`→`UQ(event_id, version)`)。AI拡張カラムはMVPで追加せず、将来Migrationで追加する方針に変更
  - `Entitlement.feature_code`を機能単位のコード体系(VIEW_BASIC_EVENT等)に具体化。FREE/PRO名称は埋め込まない
  - `IngestionLog.data_type`をECONOMIC_EVENT/FX_PRICE/EVENT_REACTION/OTHERに確定
  - Surpriseが0の場合はsurprise_direction=NEUTRAL、NULLとは明確に区別
  - Numeric精度をカラム用途ごとに個別設定(一律numeric(18,6)を廃止)
  - `EconomicEvent`の重複防止をprovider_event_id優先に変更。indicator_id+release_datetimeは補助的なIndexに格下げ(UNIQUE制約は付けない)
  - `EventPriceReaction.max_upward`/`max_downward`の定義を「pre_release_price基準・期間内の最大上昇幅/下降幅」に確定
  - RLS論理方針・Delete/Cascade方針(RESTRICT中心)・FxPriceのデータ保持範囲(イベント時間窓中心)を最終確定
  - 概要設計書・要件定義書に残る「EconomicEvent = EventSnapshot」等の旧仕様表現は、既にv1.4で修正済みであることを再確認(11章参照)

---

## 1. Entity一覧

| Entity | 概要 |
|---|---|
| `Profile` | アプリ固有のユーザー情報(認証情報自体は認証基盤=Supabase Authが保持) |
| `Subscription` | ユーザーのプラン契約状態 |
| `Entitlement` | 機能単位のアクセス権フラグ |
| `EconomicIndicator` | 経済指標マスタ |
| `EconomicEvent` | 特定日時に発表される1回のイベント(メタデータ) |
| `EventSnapshot` | 発表時点でユーザーに提供されていた値。immutable(DBレベルで担保) |
| `EventRevision` | 後日判明した改定情報(参考情報、分析には使わない) |
| `EventExplanation` | 乖離理由(MVP: 出典付き事実要約。履歴保持) |
| `IndicatorFxPair` | Indicator↔FXPairの多対多関連 |
| `FxPair` | 通貨ペアマスタ |
| `FxPrice` | FX価格ローソク足(イベント時間窓中心の保持) |
| `EventPriceReaction` | イベント×通貨ペア×時間軸ごとの価格反応 |
| `IngestionLog` | 外部データ取得・取り込みの運用ログ(FEAT-150) |

将来拡張(P2、今回はテーブル設計対象外): `favorite_indicators` / `favorite_pairs` / `alert_settings` / `Person` / `SpeechEvent` / `SpeechPriceReaction` / Community関連。

---

## 2. ER関係

```
Profile
   │
   ├── Subscription[]
   └── Entitlement[]

EconomicIndicator
   │
   ├── IndicatorFxPair ── FxPair ── FxPrice
   │
   └── EconomicEvent(メタデータ + provider/provider_event_id)
          │
          ├── EventSnapshot[]       … 発表時点の値。immutable(DBトリガーで保護)。MVPはsnapshot_type=RELEASEのみ
          ├── EventRevision[]       … 改定履歴(追記のみ)
          ├── EventExplanation[]    … 乖離理由(履歴保持、複数version)
          └── EventPriceReaction
                 │
                 └── (参照)FxPair・FxPrice

IngestionLog(他Entityへの直接参照なし。provider/data_typeで対象を記録)
```

---

## 3. Table定義

`PK`=主キー、`FK`=外部キー、`UQ`=UNIQUE制約、`IDX`=インデックス、`NN`=NOT NULL、`DEF`=DEFAULT、`CHK`=CHECK制約。Timestamp系カラムはすべて`timestamptz`(UTC保存、9章参照)。Enum値はUPPER_SNAKE_CASEで統一する。

### 3.1 Profile

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | 認証基盤(Supabase `auth.users.id`)と同値 |
| display_name | text | nullable | |
| deleted_at | timestamptz | nullable | ソフトデリート。Apple 5.1.1(v)対応 |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

**RLS**: `id = auth.uid()`の本人のみSELECT/UPDATE可。INSERT/DELETEはservice_roleのみ(6章)。

### 3.2 Subscription(確定)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→Profile.id, NN | |
| plan | text | NN, DEF `FREE`, CHK: `plan IN ('FREE','PRO')` | |
| status | text | NN, CHK: `status IN ('ACTIVE','CANCELED','EXPIRED','TRIAL')` | **HQ確定**。4状態に固定 |
| provider | text | NN, DEF `APP_STORE` | |
| provider_customer_id | text | nullable | |
| provider_subscription_id | text | nullable | |
| started_at | timestamptz | NN | |
| expires_at | timestamptz | nullable | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

IDX(user_id)
UQ: `status = 'ACTIVE'`の行はuser_idにつき1件まで(部分UNIQUE index)。履歴として過去の契約行は複数残る。

**RLS**: `user_id = auth.uid()`の本人のみSELECT可。書き込みはservice_role(決済処理)のみ。

### 3.3 Entitlement(確定: feature_codeを機能単位のコード体系に具体化)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→Profile.id, NN | |
| feature_code | text | NN | 値セットは下記参照。FREE/PRO名称は埋め込まない(HQ確定) |
| enabled | boolean | NN, DEF false | |
| expires_at | timestamptz | nullable | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(user_id, feature_code)
IDX(user_id)

**`feature_code`の値セット(MVP)**:

| コード | 意味 |
|---|---|
| `VIEW_BASIC_EVENT` | 基本的なイベント情報の閲覧 |
| `VIEW_HISTORICAL` | 過去イベント比較の閲覧 |
| `VIEW_MARKET_REACTION` | 市場反応(EventPriceReaction)の閲覧 |
| `VIEW_ADVANCED_STATS` | 高度な統計の閲覧 |

**将来追加予定(値のみ確保、CHECK制約はかけずtext型で拡張性を確保)**: `AI_ANALYSIS` / `SPEECH_ANALYSIS` / `ALERT`

実際のFree/Proへの機能割り当ては`Subscription`/`Entitlement`の運用ロジック側で管理し、`feature_code`自体にFREE/PROという名称は含めない(HQ確定)。CHECK制約は付けず、値の追加を将来のMigrationのみで行えるようにする。

**RLS**: `user_id = auth.uid()`の本人のみSELECT可。書き込みはservice_roleのみ。

### 3.4 EconomicIndicator(確定: importance値セット)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| code | text | UQ, NN | 内部コード(Provider非依存) |
| name | text | NN | |
| country_code | text | NN | ISO 3166-1 alpha-2を想定 |
| currency_code | text | NN | ISO 4217を想定(参照テーブルなし) |
| importance | text | NN, CHK: `importance IN ('LOW','MEDIUM','HIGH')` | **HQ確定**。3段階 |
| description | text | nullable | |
| frequency | text | NN, CHK: `frequency IN ('MONTHLY','QUARTERLY','IRREGULAR')` | |
| unit | text | nullable | |
| source | text | nullable | |
| source_url | text | nullable | |
| favorable_direction | text | NN, CHK: `favorable_direction IN ('HIGHER_IS_POSITIVE','LOWER_IS_POSITIVE','NEUTRAL')` | Surpriseの符号・方向性判定(9章) |
| is_active | boolean | NN, DEF true | 論理削除相当 |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

### 3.5 EconomicEvent(確定: 重複防止をprovider_event_id優先に変更)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→EconomicIndicator.id, NN | |
| provider | text | nullable | データ取得元のProvider識別子(Provider選定前はnull) |
| provider_event_id | text | nullable | Providerが提供する一意イベントID(存在しない場合はnull) |
| release_datetime | timestamptz | NN | |
| release_datetime_precision | text | NN, CHK: `release_datetime_precision IN ('EXACT','DATE_ONLY','APPROXIMATE','UNKNOWN')` | |
| importance | text | NN, CHK: `importance IN ('LOW','MEDIUM','HIGH')` | イベント単位でも保持(既存設計踏襲) |
| status | text | NN, DEF `SCHEDULED`, CHK: `status IN ('SCHEDULED','RELEASED','CANCELLED')` | |
| data_status | text | NN, DEF `PENDING`, CHK: `data_status IN ('PENDING','AVAILABLE','PARTIAL','UNAVAILABLE')` | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

**重複防止(HQ確定)**: `provider`が付与できるイベントは`UQ(provider, provider_event_id) WHERE provider_event_id IS NOT NULL`(部分UNIQUE index)を一意性の主たる担保とする。`provider_event_id`が存在しないケースを考慮し、`indicator_id + release_datetime`はUNIQUE制約とはせず、**補助的な重複検知用の通常Index**として保持する(IDXのみ、絶対的な一意性ルールにはしない)。同一指標を将来複数Providerから取得する構造を妨げない。

IDX(indicator_id)
IDX(indicator_id, release_datetime) — 補助的な重複検知・過去N件クエリ用
IDX(release_datetime)
IDX(status)

### 3.6 EventSnapshot(確定: DBレベルで不変性を担保)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| snapshot_type | text | NN, DEF `RELEASE` | MVPは`RELEASE`のみ使用 |
| forecast | numeric(18,4) | nullable | 存在しない場合null(0にしない) |
| actual | numeric(18,4) | nullable | 発表前はnull |
| previous | numeric(18,4) | nullable | |
| unit | text | nullable | |
| source | text | nullable | |
| source_url | text | nullable | |
| captured_at | timestamptz | NN | Snapshotを取得・確定した時刻 |
| surprise | numeric(18,4) | nullable | `actual - forecast`。いずれかがnullならnull。0ちょうどはnullにしない(5章) |
| surprise_direction | text | nullable, CHK: `surprise_direction IN ('POSITIVE','NEGATIVE','NEUTRAL')` | 5章の判定ロジック参照。surpriseがnullならnull、0なら`NEUTRAL` |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, snapshot_type)
IDX(event_id)

**不変性のDBレベル担保(HQ確定)**: `RELEASE`のSnapshotは、作成後のUPDATE/DELETEをDBレベルで防止する。実装方式の第一候補は、`BEFORE UPDATE OR DELETE`トリガーで`OLD.snapshot_type = 'RELEASE'`の場合に例外を発生させる方式(代案: アプリケーションroleへのUPDATE/DELETE権限を`REVOKE`し、訂正が必要な場合は`EventRevision`経由のみで表現する権限設計)。具体的なSQL(トリガー関数・権限設定)は実装フェーズで確定するが、**「DB側で不変性を担保する」ことは設計方針として確定**する。

### 3.7 EventRevision

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| field_name | text | NN, CHK: `field_name IN ('ACTUAL','PREVIOUS')` | |
| old_value | numeric(18,4) | NN | |
| new_value | numeric(18,4) | NN | |
| effective_at | timestamptz | NN | 改定が判明した日時 |
| source | text | nullable | |
| created_at | timestamptz | NN, DEF now() | レコード登録時刻(effective_atとは別) |

IDX(event_id)

**追記専用(append-only)**: UPDATE/DELETEは想定しない。UI表示時は「改定後」ラベルで`EventSnapshot`の値と区別する。

### 3.8 EventExplanation(確定: 履歴保持に変更)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| version | integer | NN, DEF 1 | 同一eventに対する新旧を判別するための連番。新しい生成ほど大きい値 |
| explanation_type | text | NN, DEF `FACT_SUMMARY`, CHK: `explanation_type IN ('FACT_SUMMARY','AI_ANALYSIS','AI_SPECULATION')` | MVPは`FACT_SUMMARY`固定 |
| summary | text | nullable | 出典が無い場合はnull(「情報なし」表示) |
| source | text | nullable | |
| source_url | text | nullable | |
| published_at | timestamptz | nullable | 出典元の公開日時 |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, version) — **上書きせず履歴保持(HQ確定)**。同一eventについて複数のExplanationが存在可能
IDX(event_id)

**最新版の判定**: `event_id`ごとに`version`の最大値(または`created_at`の最大値、両者は単調増加で一致する設計とする)を「現在表示すべき版」として扱う。Read APIは原則として最新版のみを返し、履歴一覧が必要な画面では全版を返す(API詳細設計で確定)。

**将来のAI拡張(HQ確定: MVPでは追加しない)**: `generated_by`/`model`/`prompt_version`/`confidence`等のAI向けカラムは、**MVPでは追加しない**。AI分析機能を実装するタイミングで、Migrationにより追加できる構造とする(`explanation_type`に`AI_ANALYSIS`/`AI_SPECULATION`という値をあらかじめ用意しているため、型追加なしでもtype区分自体は将来使える)。

### 3.9 IndicatorFxPair

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→EconomicIndicator.id, NN | |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| priority | smallint | NN, DEF 100 | 数値が小さいほど優先(主要ペア) |
| is_active | boolean | NN, DEF true | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(indicator_id, fx_pair_id)
IDX(indicator_id)
IDX(fx_pair_id)

### 3.10 FxPair

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| symbol | text | UQ, NN | 例: `USDJPY` |
| base_currency | text | NN | ISO 4217コード |
| quote_currency | text | NN | |
| pip_size | numeric(10,6) | NN | 固有の定数(例: 0.01、0.0001) |
| price_precision | smallint | NN | 通貨ペアごとの小数桁数(JPYペア: 3、それ以外: 5が一般的) |
| is_active | boolean | NN, DEF true | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

### 3.11 FxPrice(確定: id型・Numeric精度・保持範囲)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | bigint (bigserial / `GENERATED BY DEFAULT AS IDENTITY`) | PK | **HQ確定**。時系列データのため整数系を採用。実装時はPostgreSQLのIDENTITY構文を優先してよい |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| timestamp | timestamptz | NN | open time基準 |
| timeframe | text | NN, CHK: `timeframe IN ('1m','5m','15m','30m','60m')` | |
| open | numeric(12,6) | NN | |
| high | numeric(12,6) | NN | |
| low | numeric(12,6) | NN | |
| close | numeric(12,6) | NN | |
| volume | numeric | nullable | 提供元により意味が異なるため必須にしない |
| source | text | nullable | |
| created_at | timestamptz | NN, DEF now() | |

UQ(fx_pair_id, timeframe, timestamp)
IDX(fx_pair_id, timestamp)
IDX(fx_pair_id, timeframe, timestamp)

**データ保持範囲(HQ確定)**: MVPでは連続した全期間の価格データを永続保存する方式にはしない。経済イベント分析に必要な**イベント周辺の時間窓**(発表前〜+60分の1m/5m/15m/30m/60m算出に必要な範囲)を中心に保持する。将来Web分析ダッシュボードや通常のFXチャート機能を追加する場合、連続価格データ保存へ拡張可能な設計とする(テーブル構造自体はどちらの運用にも対応できるため、保持範囲は運用(Ingestion Workerの取得・保持ポリシー)側の設定で制御する)。

### 3.12 EventPriceReaction(確定: max_upward/max_downwardの定義、timeframeからBEFOREを除外、Numeric精度)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| timeframe | text | NN, CHK: `timeframe IN ('1m','5m','15m','30m','60m')` | **HQ確定**。`BEFORE`は含めない。発表前価格は`pre_release_price`で保持し役割を分離 |
| pre_release_price | numeric(12,6) | nullable | 発表直前価格。全timeframe行で共通値 |
| post_release_price | numeric(12,6) | nullable | 該当timeframe時点の価格 |
| movement | numeric(12,6) | nullable | 絶対変化(post_release_price - pre_release_price) |
| pips | numeric(10,2) | nullable | Backendが正 |
| change_percent | numeric(10,4) | nullable | |
| max_upward | numeric(12,6) | nullable | **HQ確定の定義**: `pre_release_price`を基準とした、発表後その時間軸までの期間内の最大上昇幅(= 期間内の最高値 − pre_release_price)。累積変動量ではない |
| max_downward | numeric(12,6) | nullable | 同様に、期間内の最大下降幅(= 期間内の最安値 − pre_release_price、負の値) |
| data_status | text | NN, DEF `PENDING`, CHK: `data_status IN ('PENDING','AVAILABLE','UNAVAILABLE')` | 価格データ不足時に0を保存せず「分析対象外/Data Pending」を表現 |
| calculated_at | timestamptz | nullable | data_status=AVAILABLEになった時点の計算時刻 |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, fx_pair_id, timeframe)
IDX(event_id)
IDX(fx_pair_id)
IDX(event_id, fx_pair_id, timeframe)

**max_upward/max_downwardの計算例(HQ提示)**: `pre_release_price = 150.00`で、期間中に150.20まで上昇・149.70まで下落した場合、`max_upward = +0.20`・`max_downward = -0.30`。pips換算値(`max_upward_pips`等)は本テーブルには保持せず、pips化が必要な画面ではAPI応答時に`FxPair.pip_size`を用いて算出する(カラム追加の要否はAPI詳細設計で確認)。

**段階的生成**: イベント発表後、該当timeframeの`FxPrice`が確定した時点で、その都度該当timeframeの行を生成・upsertする。行が存在しない、または`data_status = PENDING`は「まだ計算されていない」ことを表す。価格データが取得できなかった場合は`data_status = UNAVAILABLE`とし、数値列は`0`ではなく`null`のまま保持する。

### 3.13 IngestionLog(確定: data_type値セット)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| provider | text | NN | 例: `trading_economics`、`eodhd`等(Provider選定後に値確定) |
| data_type | text | NN, CHK: `data_type IN ('ECONOMIC_EVENT','FX_PRICE','EVENT_REACTION','OTHER')` | **HQ確定**。`OTHER`を将来拡張の受け皿として用意 |
| started_at | timestamptz | NN | |
| completed_at | timestamptz | nullable | |
| status | text | NN, CHK: `status IN ('SUCCESS','FAILURE','PARTIAL')` | |
| fetched_count | integer | nullable | 取得試行件数 |
| success_count | integer | nullable | |
| error_count | integer | nullable | |
| error_message | text | nullable | |
| created_at | timestamptz | NN, DEF now() | |

IDX(data_type, started_at DESC)
IDX(status)

---

## 4. Snapshot不変性・Revision管理(確定)

- `EventSnapshot`(`snapshot_type = RELEASE`)は発表確定時に1回生成し、以後**DBレベルのトリガー/権限制御で**書き換え・削除を防止する(3.6節)。
- `EventRevision`は改定が判明するたびに追記のみ行う(UPDATE/DELETEなし、アプリケーション層の規律で運用)。
- 分析(Surprise計算・pips計算・統計)は常に`EventSnapshot`(RELEASE)の値を用い、`EventRevision`の値では再計算しない。
- `EventExplanation`との責務分離: `EventExplanation`は`EventRevision`とは独立したEntityであり、改定(数値の訂正)ではなく「乖離理由の説明」を保持する。`EventRevision`が発生しても`EventExplanation`を自動更新することはしない(必要な場合は新しい`version`の`EventExplanation`を別途生成する運用とする)。

## 5. Surprise計算方式(確定)

`EventSnapshot`の`surprise`(raw、`actual - forecast`)・`surprise_direction`(`favorable_direction`に基づく方向性)の2列で管理する(保存方式)。

**判定ロジック(HQ確定)**:

- `forecast`または`actual`がnullの場合 → `surprise` = null、`surprise_direction` = null(**「計算できない」を意味する**)
- `surprise = 0`(ForecastとActualが完全一致) → `surprise_direction = NEUTRAL`。**NULLとは明確に区別する**(0は「計算できたが差がなかった」ことを意味する)
- `surprise ≠ 0`の場合:
  - `favorable_direction = HIGHER_IS_POSITIVE`かつ`surprise > 0` → `POSITIVE`、`surprise < 0` → `NEGATIVE`
  - `favorable_direction = LOWER_IS_POSITIVE`かつ`surprise < 0` → `POSITIVE`、`surprise > 0` → `NEGATIVE`
  - `favorable_direction = NEUTRAL` → 常に`NEUTRAL`(符号のみでは判定しない)
- 保存タイミング: `EventSnapshot`のactualが確定した時点(Ingestion Workerの処理内)で算出・保存する。

## 6. RLS方針(確定)

Supabase RLSを実装前提の設計条件として採用する。論理方針は本書で確定し、具体的なポリシー文(SQL)は実装フェーズで確定する。

| 区分 | 対象テーブル | 方針 |
|---|---|---|
| ユーザー固有 | `Profile` / `Subscription` / `Entitlement` | `auth.uid()`等を利用した本人のみSELECT可。INSERT/UPDATE/DELETEはservice_roleのみ |
| 共有データ | `EconomicIndicator` / `EconomicEvent` / `EventSnapshot` / `EventRevision` / `EventExplanation` / `IndicatorFxPair` / `FxPair` / `FxPrice` / `EventPriceReaction` | ユーザー単位のRLSを前提とせず、原則として全認証ユーザーからSELECT可能。INSERT/UPDATE/DELETEはservice_role(Ingestion Worker・管理者機能)のみ |
| 運用ログ | `IngestionLog` | 一般ユーザーからは非公開。管理者機能・service_roleのみアクセス可 |

## 7. Delete / Cascade方針(確定)

基本方針は**RESTRICT中心**。特に分析履歴の正確性を損なう可能性がある`EconomicEvent`/`EventSnapshot`/`EventPriceReaction`等について、安易なCASCADE DELETEは採用しない(親Entity削除時に履歴データが意図せず消えることを防ぐ)。

- 歴史的record(`EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventExplanation`/`EventPriceReaction`/`FxPrice`): 子から親への外部キーは`ON DELETE RESTRICT`。
- マスタ系(`EconomicIndicator`/`FxPair`): `is_active`による論理無効化を優先し、物理削除は想定しない(`ON DELETE RESTRICT`)。
- ユーザー系: `Profile`はソフトデリート(`deleted_at`)。`Subscription`/`Entitlement`は`Profile`への`ON DELETE CASCADE`(ユーザー削除時に契約情報も削除)。
- 関連テーブル(`IndicatorFxPair`): 親(`EconomicIndicator`/`FxPair`)は物理削除を想定しないため、実質的にCASCADEが発火する場面はない。

不要になったデータは削除ではなく`is_active`/`status`等による論理的な無効化を優先する。

## 8. Numeric精度(確定: 用途ごとに個別設定)

一律`numeric(18,6)`は適用せず、カラムの用途ごとに精度を設定する。

| 用途 | 型 | 対象カラム |
|---|---|---|
| 経済指標値(指標により単位・桁数が大きく異なる) | `numeric(18,4)` | `EventSnapshot.forecast`/`actual`/`previous`/`surprise`、`EventRevision.old_value`/`new_value` |
| FX価格(レート) | `numeric(12,6)` | `FxPrice.open`/`high`/`low`/`close`、`EventPriceReaction.pre_release_price`/`post_release_price`/`movement`/`max_upward`/`max_downward` |
| pips | `numeric(10,2)` | `EventPriceReaction.pips` |
| 変化率(%) | `numeric(10,4)` | `EventPriceReaction.change_percent` |
| pip_size(通貨ペア固有の定数) | `numeric(10,6)` | `FxPair.pip_size` |

FX価格の実際の小数桁数は`FxPair.price_precision`(通貨ペアごと)で規定し、上記`numeric`型はそれを余裕を持って収められるよう設定した。

## 9. UTC/Timezone方針

全テーブルの時刻系カラムは`timestamptz`(内部はUTC)で統一する。ユーザー表示時にクライアント側でローカルタイムゾーンへ変換する(概要設計書v1.5 8.1節・要件定義書v1.4 9.1節で確定済みの方針を踏襲)。

## 10. データ品質ルール

`EconomicEvent.data_status`(PENDING/AVAILABLE/PARTIAL/UNAVAILABLE)と`EventPriceReaction.data_status`(PENDING/AVAILABLE/UNAVAILABLE)により、以下を担保する:

- 取得できていないデータを0として扱わない
- Forecastがない場合、Surpriseを0にしない(0とnullを明確に区別する、5章)
- Release時点の情報と、後から改定された情報を区別する(4章)
- 統計対象外イベントを分析件数に無条件で含めない(母数を明示、概要設計書v1.5 10.2節)
- 外部APIのデータをそのままUIへ流さず、Backendで正規化してから利用する
- データ取得失敗・欠損・遅延を状態(data_status)として管理する

## 11. 他ドキュメントとの整合性(再確認)

概要設計書・要件定義書は、前ラウンド(db-design.md v3.0作成時)で「EconomicEvent = EventSnapshot」という旧来の同一視表現を、Entity分離方針に合わせて既に修正済みである(概要設計書5章・要件定義書5.1節/27章)。

本ラウンドの確定事項のうち、`EventExplanation`の履歴保持化は概要設計書5.6節にも反映済み(v1.4→**v1.5**、「上書きせず履歴保持とする」を明記)。

以下は、概要設計書v1.5・要件定義書v1.4に**明記がなく、今回DB詳細設計のみで確定した実装レベルの設計判断**であるため、ドキュメント本文の修正は不要と判断したが、12章「他ドキュメントの更新対象」で確認のため報告する:

- `Entitlement.feature_code`の具体化(概要設計書25章・要件定義書38〜55章はEntitlementの「存在」を要件化しているのみで、feature_codeの命名規則までは踏み込んでいない。矛盾はないため本文修正は不要と判断)
- `EconomicEvent`への`provider`/`provider_event_id`追加(概要設計書のEconomicEvent管理情報の記述と矛盾しない、追加情報のため本文修正は不要と判断)

---

## 12. Search機能に必要なIndex(現時点の到達点)

Search機能(FEAT-110〜115)の最終Index構成はAPI詳細設計で確定する。本書では検索対象Entityと主要検索カラムの候補のみ記録する:

- `EconomicIndicator`: `name`(部分一致検索の可能性、全文検索Indexの要否は検索要件次第)
- `EconomicEvent`: `release_datetime`(範囲検索、3.5節のIndexで対応済み)
- `FxPair`: `symbol`
- `EconomicIndicator.country_code` / `currency_code`(絞り込み検索)

具体的なIndex構成(pg_trgm等の全文検索Indexの要否含む)は、API詳細設計で検索対象・検索条件が確定してから決定する。

---

## 13. 次のフェーズ

本書をもってDB詳細設計を完成版とする。HQレビューの後、API詳細設計(Endpoint・Request/Response・Error Code)へ進む。今回もDB設計の実装(migration実行・Table作成・API実装・Swift実装・Supabase変更)は行わない。
