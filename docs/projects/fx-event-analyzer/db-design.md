# FX Event Analyzer: DB詳細設計 v3.0

**出典**: HQより2026-09-16「FX Event Analyzer DB詳細設計 v1.0」確定指示。v2.0で報告した既存設計との不整合・確認事項に対し、HQが正式な判断を確定した内容を反映した。

**位置づけ**: 本書はDB設計ドキュメントであり、migration実行・Table作成・API実装・Swift実装・Supabase変更などの**実装ではない**(HQ指示「実装禁止」)。

**本書の作成方針**: HQ確定事項をそのまま反映した。それでもなお技術的な選択肢が残る箇所(型・精度・enum値の細部等)は、断定せず7章「HQ確認事項」に整理した。

## 変更履歴

- **v1.0**: 初版。Claude Code独自のたたき台
- **v2.0**: HQが提示した正式なEntity定義・Relationship・Column一覧(2026-09-16 第1回)に基づき全面改訂。既存設計との不整合6件・確認事項19件を報告
- **v3.0**(今回): HQ確定(2026-09-16 第2回)を反映
  - `EconomicEvent`/`EventSnapshot`を別Entityとして正式採用(1.1節の不整合が解決)
  - `EventSnapshot.snapshot_type`は将来の複数種類を想定した設計とし、MVPは`RELEASE`固定(1.1節が解決)
  - `EventExplanation`をMVP必須Entityとして追加(1.2節の欠落が解決)
  - `EconomicIndicator.favorable_direction`を追加(欠落が解決)
  - `EconomicEvent.release_datetime_precision`を追加(欠落が解決)
  - `IngestionLog`をEntityとして追加(1.6節の欠落が解決)
  - Supabase + PostgreSQLを正式採用、RLSは実装前提の設計条件として確定(1.7節が解決)
  - Surpriseは保存方式を採用、raw surpriseとfavorable_directionに基づく方向性を区別
  - EventPriceReactionは段階的生成を採用。データ不足時は0を保存せず「分析対象外/Data Pending」として扱う
  - 概要設計書v1.4・要件定義書v1.4への追従(該当箇所を更新済み)

---

## 1. Entity一覧

| Entity | 概要 |
|---|---|
| `Profile` | アプリ固有のユーザー情報(認証情報自体は認証基盤=Supabase Authが保持) |
| `Subscription` | ユーザーのプラン契約状態 |
| `Entitlement` | 機能単位のアクセス権フラグ |
| `EconomicIndicator` | 経済指標マスタ |
| `EconomicEvent` | 特定日時に発表される1回のイベント(メタデータ) |
| `EventSnapshot` | 発表時点でユーザーに提供されていた値。immutable |
| `EventRevision` | 後日判明した改定情報(参考情報、分析には使わない) |
| `EventExplanation` | 乖離理由(MVP: 出典付き事実要約) |
| `IndicatorFxPair` | Indicator↔FXPairの多対多関連 |
| `FxPair` | 通貨ペアマスタ |
| `FxPrice` | FX価格ローソク足 |
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
   └── EconomicEvent(メタデータ: release_datetime/status/data_status)
          │
          ├── EventSnapshot[]     … 発表時点の値。immutable。MVPはsnapshot_type=RELEASEのみ
          ├── EventRevision[]     … 改定履歴(追記のみ)
          ├── EventExplanation    … 乖離理由
          └── EventPriceReaction
                 │
                 └── (参照)FxPair・FxPrice

IngestionLog(他Entityへの直接参照なし。provider/data_typeで対象を記録)
```

---

## 3. Table定義

`PK`=主キー、`FK`=外部キー、`UQ`=UNIQUE制約、`IDX`=インデックス、`NN`=NOT NULL、`DEF`=DEFAULT、`CHK`=CHECK制約。Timestamp系カラムはすべて`timestamptz`(UTC保存、9章参照)。Enum値はUPPER_SNAKE_CASEで統一する(HQ提示の命名に準拠)。

### 3.1 Profile

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | 認証基盤(Supabase `auth.users.id`)と同値 |
| display_name | text | nullable | |
| deleted_at | timestamptz | nullable | ソフトデリート。Apple 5.1.1(v)対応(kashikariプロジェクトの実装経験を踏襲) |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

**RLS**: `id = auth.uid()`の本人のみSELECT/UPDATE可。INSERT/DELETEはservice_roleのみ(6章参照)。

### 3.2 Subscription

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→Profile.id, NN | |
| plan | text | NN, DEF `FREE`, CHK: `plan IN ('FREE','PRO')` | |
| status | text | NN, CHK: `status IN ('ACTIVE','CANCELED','EXPIRED','TRIAL')` | 値セットは7章確認事項2 |
| provider | text | NN, DEF `APP_STORE` | 将来他プロバイダを追加する可能性を考慮しCHECK制約は緩め(値の枚挙のみtext) |
| provider_customer_id | text | nullable | |
| provider_subscription_id | text | nullable | |
| started_at | timestamptz | NN | |
| expires_at | timestamptz | nullable | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

IDX(user_id)
UQ: `status = 'ACTIVE'`の行はuser_idにつき1件まで(部分UNIQUE index)。履歴として過去の契約行は複数残る。

**RLS**: `user_id = auth.uid()`の本人のみSELECT可。書き込みはservice_role(決済処理)のみ。

### 3.3 Entitlement

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→Profile.id, NN | |
| feature_code | text | NN | 値セットはFree/Pro機能境界確定後(7章確認事項3) |
| enabled | boolean | NN, DEF false | |
| expires_at | timestamptz | nullable | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(user_id, feature_code)
IDX(user_id)

**RLS**: `user_id = auth.uid()`の本人のみSELECT可。書き込みはservice_roleのみ。

### 3.4 EconomicIndicator

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| code | text | UQ, NN | 内部コード(Provider非依存) |
| name | text | NN | |
| country_code | text | NN | ISO 3166-1 alpha-2を想定 |
| currency_code | text | NN | ISO 4217を想定(参照テーブルなし、コード文字列のみ) |
| importance | text | NN, CHK: `importance IN ('HIGH','MEDIUM','LOW')` | 値セットは7章確認事項4 |
| description | text | nullable | |
| frequency | text | NN, CHK: `frequency IN ('MONTHLY','QUARTERLY','IRREGULAR')` | 要件定義書4.2節の履歴年数要件に対応 |
| unit | text | nullable | |
| source | text | nullable | |
| source_url | text | nullable | |
| favorable_direction | text | NN, CHK: `favorable_direction IN ('HIGHER_IS_POSITIVE','LOWER_IS_POSITIVE','NEUTRAL')` | Surpriseの符号・方向性判定(9章) |
| is_active | boolean | NN, DEF true | 論理削除相当(廃止指標の扱い) |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

### 3.5 EconomicEvent

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→EconomicIndicator.id, NN | |
| release_datetime | timestamptz | NN | |
| release_datetime_precision | text | NN, CHK: `release_datetime_precision IN ('EXACT','DATE_ONLY','APPROXIMATE','UNKNOWN')` | 正確な発表時刻が保証されないイベントを高精度分析対象として誤って扱わないため |
| importance | text | NN, CHK同上 | 指標マスタと異なる場合があり得るため、イベント単位でも保持(既存設計踏襲) |
| status | text | NN, DEF `SCHEDULED`, CHK: `status IN ('SCHEDULED','RELEASED','CANCELLED')` | |
| data_status | text | NN, DEF `PENDING`, CHK: `data_status IN ('PENDING','AVAILABLE','PARTIAL','UNAVAILABLE')` | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(indicator_id, release_datetime) — 同一指標・同一発表時刻の重複防止(7章確認事項5)
IDX(indicator_id)
IDX(release_datetime)
IDX(status)

### 3.6 EventSnapshot

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| snapshot_type | text | NN, DEF `RELEASE` | MVPは`RELEASE`のみ使用。将来的な複数種類の追加を妨げない設計(textにしCHECK制約で緩やかに制限) |
| forecast | numeric(18,6) | nullable | 存在しない場合null(0にしない) |
| actual | numeric(18,6) | nullable | 発表前はnull |
| previous | numeric(18,6) | nullable | |
| unit | text | nullable | |
| source | text | nullable | |
| source_url | text | nullable | |
| captured_at | timestamptz | NN | Snapshotを取得・確定した時刻 |
| surprise | numeric(18,6) | nullable | `actual - forecast`。いずれかがnullならnull(9章参照、0にしない) |
| surprise_direction | text | nullable, CHK: `surprise_direction IN ('POSITIVE','NEGATIVE','NEUTRAL')` | `favorable_direction`に基づく方向性。surpriseがnullならnull |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, snapshot_type) — MVPでは`snapshot_type`が実質`RELEASE`固定のため`UQ(event_id)`と同義
IDX(event_id)

**不変性**: `forecast`/`actual`/`previous`は一度確定したら書き換えない。RELEASE Snapshotが分析の正であり、後から改定されても書き換えない(改定は`EventRevision`で管理)。DBレベルでの強制方法(トリガー/権限制御)は7章確認事項1で引き続き確認する。

### 3.7 EventRevision

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| field_name | text | NN, CHK: `field_name IN ('ACTUAL','PREVIOUS')` | |
| old_value | numeric(18,6) | NN | |
| new_value | numeric(18,6) | NN | |
| effective_at | timestamptz | NN | 改定が判明した日時 |
| source | text | nullable | |
| created_at | timestamptz | NN, DEF now() | レコード登録時刻(effective_atとは別) |

IDX(event_id)

**追記専用(append-only)**: UPDATE/DELETEは想定しない。UI表示時は「改定後」ラベルで`EventSnapshot`の値と区別する(概要設計書v1.4 5.5節)。

### 3.8 EventExplanation

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| explanation_type | text | NN, DEF `FACT_SUMMARY`, CHK: `explanation_type IN ('FACT_SUMMARY','AI_ANALYSIS','AI_SPECULATION')` | MVPは`FACT_SUMMARY`固定。将来のAI拡張時に値を追加(7章確認事項6) |
| summary | text | nullable | 出典が無い場合はnull(「情報なし」表示) |
| source | text | nullable | |
| source_url | text | nullable | |
| published_at | timestamptz | nullable | 出典元の公開日時 |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id) — MVPでは1イベント1件(上書き運用)を想定(7章確認事項7)

**将来のAI拡張**: 概要設計書v1.4 11.2節で設計済みの拡張方針(`generated_by`/`source_references`/`confidence_note`等)は、`explanation_type`の値追加と将来カラム追加で対応する想定。具体的なカラムは今回のHQ確定リストに含まれていないため、追加が必要になった時点で改めて設計する(7章確認事項6)。

### 3.9 IndicatorFxPair

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→EconomicIndicator.id, NN | |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| priority | smallint | NN, DEF 100 | 数値が小さいほど優先(主要ペア)。主要/準主要の区別を表現(HQ確定) |
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
| base_currency | text | NN | ISO 4217コード(参照テーブルなし) |
| quote_currency | text | NN | |
| pip_size | numeric(10,6) | NN | |
| price_precision | smallint | NN | |
| is_active | boolean | NN, DEF true | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

### 3.11 FxPrice

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | bigserial | PK | 時系列データのため連番整数を推奨(7章確認事項8) |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| timestamp | timestamptz | NN | open time基準 |
| timeframe | text | NN, CHK: `timeframe IN ('1m','5m','15m','30m','60m')` | |
| open | numeric(18,6) | NN | |
| high | numeric(18,6) | NN | |
| low | numeric(18,6) | NN | |
| close | numeric(18,6) | NN | |
| volume | numeric | nullable | 提供元により意味が異なるため必須にしない |
| source | text | nullable | |
| created_at | timestamptz | NN, DEF now() | |

UQ(fx_pair_id, timeframe, timestamp) — 重複防止(HQ指示通り)
IDX(fx_pair_id, timestamp)
IDX(fx_pair_id, timeframe, timestamp)

### 3.12 EventPriceReaction

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| timeframe | text | NN, CHK: `timeframe IN ('1m','5m','15m','30m','60m')` | |
| pre_release_price | numeric(18,6) | nullable | 発表直前価格。全timeframe行で共通値(7章確認事項9) |
| post_release_price | numeric(18,6) | nullable | 該当timeframe時点の価格 |
| movement | numeric(18,6) | nullable | 絶対変化(post - pre) |
| pips | numeric(10,4) | nullable | Backendが正 |
| change_percent | numeric(10,4) | nullable | |
| max_upward | numeric(18,6) | nullable | 発表からその時点までの累積最大上昇(7章確認事項10) |
| max_downward | numeric(18,6) | nullable | 発表からその時点までの累積最大下落 |
| data_status | text | NN, DEF `PENDING`, CHK: `data_status IN ('PENDING','AVAILABLE','UNAVAILABLE')` | 価格データ不足時に0を保存せず「分析対象外/Data Pending」を表現するために追加(HQ方針11章) |
| calculated_at | timestamptz | nullable | data_status=AVAILABLEになった時点の計算時刻 |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, fx_pair_id, timeframe)
IDX(event_id)
IDX(fx_pair_id)
IDX(event_id, fx_pair_id, timeframe)

**段階的生成**: イベント発表後、該当timeframeの`FxPrice`が確定した時点で、その都度該当timeframeの行を生成・upsertする(全timeframeが揃うのを待たない)。行が存在しない、または`data_status = PENDING`の状態は「まだ計算されていない」ことを表す。価格データが取得できなかった場合は`data_status = UNAVAILABLE`とし、`pips`等の数値列は`0`ではなく`null`のまま保持する(HQ方針、絶対に0扱いしない)。

**名称確定**: 本テーブルは「MarketReaction」ではなく`EventPriceReaction`として設計する(HQ確定済み)。

### 3.13 IngestionLog

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| provider | text | NN | 例: `trading_economics`、`eodhd`等(Provider選定後に値確定) |
| data_type | text | NN, CHK: `data_type IN ('ECONOMIC_CALENDAR','FX_PRICE','REVISION_CHECK')` | 値セットは7章確認事項11 |
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

## 4. Snapshot不変性・Revision管理

- `EventSnapshot`は発表確定時に1回生成し(`snapshot_type = RELEASE`)、以後書き換えない。
- `EventRevision`は改定が判明するたびに追記のみ行う(UPDATE/DELETEなし)。
- 分析(Surprise計算・pips計算・統計)は常に`EventSnapshot`(RELEASE)の値を用い、`EventRevision`の値では再計算しない。
- DBレベルでの不変性の強制方法(トリガー/権限制御)は7章確認事項1で引き続き確認する。

## 5. Surprise計算方式

**保存方式を採用する**(HQ確定)。`EventSnapshot`の`surprise`(raw、`actual - forecast`)・`surprise_direction`(`favorable_direction`に基づく方向性)の2列で管理する。

- `forecast`または`actual`がnullの場合、`surprise`・`surprise_direction`ともnull。「欠損 = 0」とは絶対に扱わない。
- `surprise_direction`の算出: `favorable_direction = HIGHER_IS_POSITIVE`なら`surprise > 0`を`POSITIVE`、`LOWER_IS_POSITIVE`なら`surprise < 0`を`POSITIVE`、`NEUTRAL`なら常に`NEUTRAL`(符号のみでは判定しない)。具体的な境界値(0ちょうどの扱い等)は7章確認事項12で確認する。
- 保存タイミング: `EventSnapshot`のactualが確定した時点(Ingestion Workerの処理内)で算出・保存する。

## 6. RLS方針

Supabase RLSを実装前提の設計条件として採用する(HQ確定)。

| 区分 | 対象テーブル | 方針 |
|---|---|---|
| ユーザー固有 | `Profile` / `Subscription` / `Entitlement` | `user_id = auth.uid()`(または`id = auth.uid()`)による本人のみSELECT可。INSERT/UPDATE/DELETEはservice_roleのみ |
| 共有データ | `EconomicIndicator` / `EconomicEvent` / `EventSnapshot` / `EventRevision` / `EventExplanation` / `IndicatorFxPair` / `FxPair` / `FxPrice` / `EventPriceReaction` | ユーザー単位のRLSを前提としない。認証済みユーザー全員にSELECTのみ許可。INSERT/UPDATE/DELETEはservice_role(Ingestion Worker・管理者機能)のみ |
| 運用ログ | `IngestionLog` | 一般ユーザーからは非公開。管理者機能・service_roleのみアクセス可 |

具体的なポリシー文(SQL)は本書のスコープ外(migration実装時に作成、7章確認事項13)。

## 7. HQ確認事項

以下は、HQ確定を受けてもなお本書内で断定できなかった技術的な細部。独自に確定していない。

1. **Snapshot不変性の担保方法**: `EventSnapshot`の`forecast`/`actual`/`previous`のUPDATE禁止を、DB制約(トリガー・権限)で強制するか、アプリケーション層の規律のみに頼るか。
2. **`Subscription.status`の値セット**: `ACTIVE`/`CANCELED`/`EXPIRED`/`TRIAL`を暫定案としたが妥当か。
3. **`Entitlement.feature_code`の値一覧**: Free/Proの機能境界(`implementation-notes-for-hq.md`既出の未確定事項)が確定してから定義する。
4. **`EconomicIndicator.importance`の値セット**: `HIGH`/`MEDIUM`/`LOW`の3段階を暫定案としたが妥当か。
5. **`EconomicEvent`の`UNIQUE(indicator_id, release_datetime)`制約**: 同一指標・同一時刻の重複防止として妥当か。
6. **`EventExplanation`の将来AI拡張カラム**: 概要設計書v1.4 11.2節の`generated_by`/`source_references`/`confidence_note`等を、今のうちに(値は使わず型だけ)追加しておくか、必要になった時点で追加するか。
7. **`EventExplanation`の再生成時の扱い**: `UQ(event_id)`により上書き運用としたが、改定時等に過去バージョンを履歴として残す必要があるか。
8. **`FxPrice.id`の型**: 時系列データの量を考慮し`bigserial`を提案したが、他テーブルとの一貫性のため`uuid`で統一すべきという方針があれば従う。
9. **`EventPriceReaction`に`before`(発表直前)をtimeframeとして含めるか**: 現在は`pre_release_price`列に発表直前価格を保持し、`timeframe`は`1m`〜`60m`のみとしたが、この役割分担で問題ないか。
10. **`max_upward`/`max_downward`の意味**: 「発表からその時点までの累積最大値」という解釈で設計したが(ui-screens.md SCR-005の表示に対応)、この解釈で正しいか。
11. **`IngestionLog.data_type`の値セット**: `ECONOMIC_CALENDAR`/`FX_PRICE`/`REVISION_CHECK`を暫定案としたが妥当か。
12. **Surprise方向性判定の境界値**: `surprise = 0`ちょうどの場合の`surprise_direction`の扱い(`NEUTRAL`とするか、`favorable_direction`の方向に倣うか)。
13. **RLSの具体的なポリシー文**: SQLレベルの実装は本書のスコープ外としたが、migration実装時にどのタイミングで確定するか。
14. **Decimal/Numeric精度**: `numeric(18,6)`(指標値・FX価格)・`numeric(10,4)`(pips/change_percent)で全指標・全通貨ペアのケースをカバーできるか。
15. **Cascade/Delete方針**: 歴史的record(`EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventExplanation`/`EventPriceReaction`/`FxPrice`)は`ON DELETE RESTRICT`、マスタ系(`EconomicIndicator`/`FxPair`)は論理削除(`is_active`)のみで物理削除不可、`Subscription`/`Entitlement`は`Profile`への`ON DELETE CASCADE`を提案。この方針でよいか。
16. **`FxPrice`のデータ保持範囲**: イベント時間窓(発表直前〜+60分)限定の保存で要件を満たせるか、連続した市場全体の1分足を無期限保持する必要があるか。
17. **Search機能に必要なIndex**: FEAT-110〜115の検索要件がAPI詳細設計で確定してから追加する、という進め方でよいか。

---

## 8. 横断的な設計方針(まとめ)

### 8.1 Cascade方針・Delete方針

- 歴史的record: `ON DELETE RESTRICT`を基本とし、意図しない履歴消失を防ぐ(7章確認事項15)。
- マスタ系: `is_active`による論理無効化、物理削除は想定しない。
- ユーザー系: `Profile`はソフトデリート。`Subscription`/`Entitlement`は`Profile`への`ON DELETE CASCADE`を提案。

### 8.2 Soft Deleteの要否(まとめ)

| テーブル | 方式 |
|---|---|
| `Profile` | `deleted_at`によるソフトデリート(Apple 5.1.1(v)対応) |
| `EconomicIndicator` / `FxPair` | `is_active`による論理無効化 |
| `EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventExplanation`/`EventPriceReaction`/`FxPrice` | 削除非対応(不変の歴史的record) |
| `Subscription`/`Entitlement` | `status`/`enabled`により状態管理 |
| `IngestionLog` | 運用ログのため、7章確認事項とは別に保持期間を検討(9章参照) |

### 8.3 データ保持方針

| データ | 方針 |
|---|---|
| `EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventExplanation`/`EventPriceReaction` | 無期限保持(「過去イベント比較」が中核価値のため) |
| `FxPrice` | 未確定(7章確認事項16) |
| `IngestionLog` | ローリング保持(例: 90日)を提案 |
| `Profile`(削除済みアカウント) | ソフトデリート後、匿名化した状態で保持 |

### 8.4 外部APIデータとのMapping

具体的なフィールド対応表は、Economic Data Provider / FX Price Providerの正式選定後でなければ確定できない(`implementation-notes-for-hq.md`既出)。`EconomicDataProvider` / `FXPriceDataProvider`というAdapterインターフェースが正規化すべきカラムセット:

- `EventSnapshot`: `forecast` / `actual` / `previous` / `unit`
- `EconomicEvent`: `release_datetime` + `release_datetime_precision`
- `FxPrice`: `timestamp`(open time基準へ正規化) / `open` / `high` / `low` / `close`
- タイムゾーンはAdapter層でUTCへ正規化してから保存する(9章)

### 8.5 データ品質ルール

`EconomicEvent.data_status`(PENDING/AVAILABLE/PARTIAL/UNAVAILABLE)と`EventPriceReaction.data_status`(PENDING/AVAILABLE/UNAVAILABLE)により、以下を担保する:

- 取得できていないデータを0として扱わない(3.6節・3.12節)
- Forecastがない場合、Surpriseを0にしない(5章)
- Release時点の情報と、後から改定された情報を区別する(4章、Snapshot/Revision分離)
- 統計対象外イベントを分析件数に無条件で含めない(母数を明示、概要設計書v1.4 10.2節)
- 外部APIのデータをそのままUIへ流さず、Backendで正規化してから利用する(8.4節)
- データ取得失敗・欠損・遅延を状態(data_status)として管理する

## 9. UTC/Timezone方針

全テーブルの時刻系カラムは`timestamptz`(内部はUTC)で統一する。ユーザー表示時にクライアント側でローカルタイムゾーンへ変換する(概要設計書v1.4 8.1節・要件定義書v1.4 9.1節で確定済みの方針を踏襲)。

---

## 10. 次のフェーズ

HQレビューの後、DB設計が確定次第、API詳細設計(Endpoint・Request/Response・Error Code)へ進む。今回もDB設計の実装(migration実行・Table作成・API実装・Swift実装・Supabase変更)は行わない。
