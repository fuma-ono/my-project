# FX Event Analyzer: DB詳細設計 v2.0

**出典**: HQより2026-09-16指示「FX Event Analyzer DB詳細設計 v1.0」。HQが提示したEntity定義・Relationship・Column一覧を正として、既存の要件定義書v1.3・概要設計書v1.3・機能一覧v1.3との整合性を確認した上で、正式なDB詳細設計書として整理したもの。

**位置づけ**: 本書はDB設計ドキュメントであり、migration実行・Table作成・API実装・Swift実装・Supabase変更などの**実装ではない**(HQ指示、2026-09「実装禁止」)。

**本書の作成方針**: HQが提示したEntity・Column構成を設計のベースとして採用した。ただし、既存資料と矛盾する箇所、既存資料には無い新しい概念、および型・制約・運用ルールがHQ指示の範囲外で未確定な箇所は、**独自に決定せず**、1章「既存設計との整合性確認」および8章「HQ確認事項」として報告する。

## 変更履歴

- **v1.0**: 初版。Claude Code独自のたたき台として作成(HQからの詳細な方針提示前)
- **v2.0**(今回): HQが提示した正式なEntity定義・Relationship・Column一覧(2026-09-16)に基づき全面改訂。既存設計書との整合性確認結果(1章)、14項目の確認事項への選択肢・推奨案(8章)を追加

---

## 1. 既存設計との整合性確認(★最重要、まず報告)

### 1.1 EconomicEvent / EventSnapshotの関係(構造変更)

- **既存資料の記述**: 概要設計書v1.3 5.1節・5.3節は「`EconomicEvent`(= `EventSnapshot`、発表時点の値。不変)」として**同一エンティティ**と明記している。要件定義書v1.3 27章の推奨データモデルも「EconomicEvent(Snapshot)」という書き方をしている。
- **今回のHQ方針**: `EconomicEvent`(release_datetime/status/data_status等のメタデータ)と`EventSnapshot`(forecast/actual/previous等の値、snapshot_type/captured_at)を**別テーブル**として明確に分離している。
- **本書の扱い**: 今回のHQ方針を正として3章のテーブル定義を作成した。ただし概要設計書・要件定義書の該当箇所が「同一エンティティ」という記述のままになっているため、**両ドキュメントの更新が必要か確認をお願いしたい**。
- **`snapshot_type`の用途が未確認**: 既存資料にはこのフィールドに相当する概念がない。1イベントにつき複数のSnapshot(例: 発表前の暫定値スナップショットと発表後の確定値スナップショット)を想定しているのか、それとも実質的に常に1種類(MVPでは`release`固定)で、将来の拡張余地として用意されたものかを確認したい(8章確認事項1と関連)。

### 1.2 EventExplanation(乖離理由)がEntity一覧から欠落

- 概要設計書v1.3 11章・要件定義書v1.3 12章で、「乖離理由の出典付き事実要約」は**MVP必須機能**として明記されており(概要設計書28章のMVP必須リストにも記載)、`EventExplanation`というEntityとして概要設計書27章の推奨データモデルにも定義済みである。
- 今回HQが提示したEntity一覧には`EventExplanation`が含まれていない。
- **意図的に今回のDB設計スコープから外したのか(後続ラウンドで設計するのか)、追加が必要か確認したい。** 本書では、既存資料との矛盾を増やさないため、`EventExplanation`のテーブル定義は今回のHQ方針に含まれていないという理由で追加せず、5章で「未反映」として扱った。

### 1.3 IndicatorFxPair.priorityにより、持ち越されていた決定が解決

- 概要設計書v1.3 5.2節で「指標ごとに主要ペア/準主要ペアの区別を持たせるか等はDB詳細設計で確定する」と持ち越されていた決定について、今回`priority`(および`is_active`)フィールドが提示された。この持ち越し事項は**今回のHQ方針により解決した**と理解し、本書に反映した。

### 1.4 Currency参照テーブルを廃止(v1.0からの変更)

- 本書v1.0(たたき台)では`currencies`マスタテーブルを提案していたが、今回のHQ方針では`EconomicIndicator.currency_code`・`FxPair.base_currency`/`quote_currency`とも文字列コード(FKなし)として保持する設計になっている。この方針にあわせ、本書からは`currencies`テーブルを削除した。

### 1.5 release_datetime_precision(発表時刻の精度フラグ)がEconomicEventの項目から欠落

- 概要設計書v1.3 8.2節は「`release_datetime`の精度(分単位で確定/概算)を`release_datetime_precision`として保持する」ことを明記しており、v1.0(たたき台)にもこのカラムを含めていた。
- 今回HQが提示した`EconomicEvent`の想定項目(id/indicator_id/release_datetime/importance/status/data_status/created_at/updated_at)には、このカラムが含まれていない。
- 8.2節の要件を満たすため本書では`EconomicEvent`にこのカラムを残す案で設計したが(3.2節)、**HQ方針からの独自追加であるため、追加してよいか確認したい**(8章確認事項2)。

### 1.6 Ingestionログ(FEAT-150)がEntity一覧から欠落

- 機能一覧v1.3のFEAT-150(Ingestionログ、P1)に対応する記録先が、今回のEntity一覧にない。
- 運用ログであり、ユーザー向けデータモデルとは性質が異なるため、**今回のDB設計スコープ外(別途運用テーブルとして後続で設計)という理解でよいか確認したい**。本書ではテーブル定義を追加していない。

### 1.7 データベースホスティング方針への言及

- `implementation-notes-for-hq.md` 4章は「DBホスティング(自前運用 or マネージドPostgreSQL)」「Auth service」を未確定事項として記載していた。
- 今回「Supabase RLSを前提として」という指示があったが、これが**DBホスティング・Auth基盤としてSupabaseを採用することの確定**を意味するのか、それとも本書のRLS設計を具体化するための参考モデルに過ぎないのかを確認したい(8章確認事項10)。本書では後者(RLS設計の前提)として扱い、4章6.4節も参照。

---

## 2. Entity一覧・ER図

```
User(認証基盤に委譲、DB内に物理テーブルなし)
   │
   └── Profile
          │
          ├── Subscription[]
          └── Entitlement[]

EconomicIndicator
   │
   ├── IndicatorFxPair ── FxPair ── FxPrice
   │
   └── EconomicEvent
          │
          ├── EventSnapshot     … 発表時点の値(forecast/actual/previous)、immutable
          ├── EventRevision[]   … 後日の改定履歴(参考情報)
          └── EventPriceReaction ── (参照) FxPair
```

| Entity | 概要 |
|---|---|
| `Profile` | アプリ固有のユーザー情報(認証情報自体は認証基盤が保持) |
| `Subscription` | ユーザーのプラン契約状態 |
| `Entitlement` | 機能単位のアクセス権フラグ |
| `EconomicIndicator` | 経済指標マスタ |
| `EconomicEvent` | 特定日時に発表される1回のイベント(メタデータ) |
| `EventSnapshot` | 発表時点でユーザーに提供されていた値。immutable |
| `EventRevision` | 後日判明した改定情報(参考情報、分析には使わない) |
| `IndicatorFxPair` | Indicator↔FXPairの多対多関連 |
| `FxPair` | 通貨ペアマスタ |
| `FxPrice` | FX価格ローソク足 |
| `EventPriceReaction` | イベント×通貨ペア×時間軸ごとの価格反応 |

**Entity一覧から今回除外したもの(1章参照)**: `EventExplanation`(1.2節)・Ingestionログ(1.6節)・`currencies`(1.4節)。

---

## 3. Table定義

`PK`=主キー、`FK`=外部キー、`UQ`=UNIQUE制約、`IDX`=インデックス、`NN`=NOT NULL、`DEF`=DEFAULT。Timestamp系カラムはすべて`timestamptz`(UTC保存、8.1節の既存方針を踏襲、4.1節参照)。

### 3.1 Profile

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | 認証基盤のuser idと同値(例: Supabase `auth.users.id`) |
| display_name | text | nullable | |
| deleted_at | timestamptz | nullable | ソフトデリート。Apple 5.1.1(v)対応(kashikariプロジェクトの実装経験を踏襲、8章確認事項9) |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

**HQ方針からの補足**: HQ指示10章は「User/Subscription/Entitlement」の設計方針(認証は外部基盤に委譲)を示しているが、`Profile`自体のColumn一覧は提示されていない。本書では最小限の項目(kashikariプロジェクトの実装パターンを参考)を提案した。8章確認事項9で確認したい。

**RLS**: `id = auth.uid()`の本人のみ参照・更新可。

### 3.2 Subscription

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→Profile.id, NN | |
| plan | enum(`free`,`pro`) | NN, DEF `free` | |
| status | enum(`active`,`canceled`,`expired`,`trial`) | NN | 値セットは8章確認事項6 |
| provider | text | NN | 現状`app_store`のみ想定。将来の拡張を考慮しenumではなくtextとした |
| provider_customer_id | text | nullable | |
| provider_subscription_id | text | nullable | |
| started_at | timestamptz | NN | |
| expires_at | timestamptz | nullable | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

IDX(user_id)
UQ: `status = 'active'`の行はuser_idにつき1件まで(部分UNIQUE index)を提案。履歴として過去の契約行は複数残る設計(8章確認事項6)。

**RLS**: 本人のみ参照可。書き込みはservice_role(決済処理・Read API)のみ。

### 3.3 Entitlement

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→Profile.id, NN | |
| feature_code | text | NN | 値セットはFree/Pro機能境界確定後(8章確認事項12) |
| enabled | boolean | NN, DEF false | |
| expires_at | timestamptz | nullable | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(user_id, feature_code)
IDX(user_id)

**RLS**: 本人のみ参照可。書き込みはservice_roleのみ。

### 3.4 EconomicIndicator

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| code | text | UQ, NN | 内部コード(Provider非依存) |
| name | text | NN | |
| country_code | text | NN | ISO 3166-1 alpha-2を想定 |
| currency_code | text | NN | ISO 4217を想定(1.4節、FKなし) |
| importance | enum(`high`,`medium`,`low`) | NN | 値セットは8章確認事項5 |
| description | text | nullable | |
| frequency | enum(`monthly`,`quarterly`,`irregular`) | NN | 要件定義書4.2節の履歴年数要件に対応 |
| unit | text | nullable | |
| source | text | nullable | |
| source_url | text | nullable | |
| is_active | boolean | NN, DEF true | 論理削除相当(廃止指標の扱い) |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

**`favorable_direction`が欠落**: 概要設計書v1.3 5.2節・9.2節で必須とされる`favorable_direction`(higher_is_favorable/lower_is_favorable/not_applicable、Surpriseの符号判定に必須)が今回のHQ方針のColumn一覧にない。Surprise計算(9章)に直接影響するため、追加が必要と考えるが独自に追加せず8章確認事項3として確認したい。

### 3.5 EconomicEvent

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→EconomicIndicator.id, NN | |
| release_datetime | timestamptz | NN | |
| release_datetime_precision | enum(`exact`,`approximate`) | NN | 1.5節、追加要否は8章確認事項2 |
| importance | enum(`high`,`medium`,`low`) | NN | 指標マスタと異なる場合があり得るため、イベント単位でも保持(既存設計踏襲) |
| status | enum(`SCHEDULED`,`RELEASED`,`CANCELLED`) | NN, DEF `SCHEDULED` | |
| data_status | enum(`PENDING`,`AVAILABLE`,`PARTIAL`,`UNAVAILABLE`) | NN, DEF `PENDING` | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(indicator_id, release_datetime) — 同一指標・同一発表時刻の重複防止(8章確認事項4)
IDX(indicator_id)
IDX(release_datetime)
IDX(status)

### 3.6 EventSnapshot

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| snapshot_type | text | NN | 用途未確定(1.1節、8章確認事項1) |
| forecast | numeric(18,6) | nullable | 存在しない場合null(0にしない) |
| actual | numeric(18,6) | nullable | 発表前はnull |
| previous | numeric(18,6) | nullable | |
| unit | text | nullable | |
| source | text | nullable | |
| source_url | text | nullable | |
| captured_at | timestamptz | NN | Snapshotを取得・確定した時刻 |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, snapshot_type) — snapshot_typeが実質固定値なら`UQ(event_id)`と同義になる(8章確認事項1)
IDX(event_id)

**不変性**: `forecast`/`actual`/`previous`は一度確定したら書き換えない(概要設計書5.1節原則)。DBレベルでの強制方法(トリガー/権限制御)かアプリケーション層の規律のみに頼るかは`implementation-notes-for-hq.md`既出の未確定事項であり、8章確認事項7で再掲する。

### 3.7 EventRevision

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| field_name | enum(`actual`,`previous`) | NN | 値セットは8章確認事項8 |
| old_value | numeric(18,6) | NN | |
| new_value | numeric(18,6) | NN | |
| effective_at | timestamptz | NN | 改定が判明した日時(既存資料の`revised_at`に相当すると解釈。8章確認事項8) |
| source | text | nullable | |
| created_at | timestamptz | NN, DEF now() | レコード登録時刻(effective_atとは別) |

IDX(event_id)

**追記専用(append-only)**: UPDATE/DELETEは想定しない。UI表示時は「改定後」ラベルで`EventSnapshot`の値と区別する(概要設計書5.4節)。

### 3.8 IndicatorFxPair

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→EconomicIndicator.id, NN | |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| priority | smallint | NN, DEF 100 | 数値が小さいほど優先(主要ペア)、8章確認事項8 |
| is_active | boolean | NN, DEF true | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

UQ(indicator_id, fx_pair_id)
IDX(indicator_id)
IDX(fx_pair_id)

### 3.9 FxPair

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| symbol | text | UQ, NN | 例: `USDJPY` |
| base_currency | text | NN | ISO 4217コード(1.4節、FKなし) |
| quote_currency | text | NN | |
| pip_size | numeric(10,6) | NN | |
| price_precision | smallint | NN | |
| is_active | boolean | NN, DEF true | |
| created_at | timestamptz | NN, DEF now() | |
| updated_at | timestamptz | NN, DEF now() | |

### 3.10 FxPrice

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | bigserial | PK | 時系列データのため連番整数を推奨(8章確認事項11) |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| timestamp | timestamptz | NN | open time基準(8.1節) |
| timeframe | enum(`1m`,`5m`,`15m`,`30m`,`60m`) | NN | |
| open | numeric(18,6) | NN | |
| high | numeric(18,6) | NN | |
| low | numeric(18,6) | NN | |
| close | numeric(18,6) | NN | |
| volume | numeric | nullable | 提供元により意味が異なるため必須にしない |
| source | text | nullable | |
| created_at | timestamptz | NN, DEF now() | |

UQ(fx_pair_id, timeframe, timestamp) — HQ指示通り重複防止
IDX(fx_pair_id, timestamp)
IDX(fx_pair_id, timeframe, timestamp)

### 3.11 EventPriceReaction

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→EconomicEvent.id, NN | |
| fx_pair_id | uuid | FK→FxPair.id, NN | |
| timeframe | enum(`1m`,`5m`,`15m`,`30m`,`60m`) | NN | `before`(発表直前)を含めるかは8章確認事項13 |
| pre_release_price | numeric(18,6) | nullable | |
| post_release_price | numeric(18,6) | nullable | |
| movement | numeric(18,6) | nullable | 絶対変化(post - pre) |
| pips | numeric(10,4) | nullable | Backendが正(9.3節) |
| change_percent | numeric(10,4) | nullable | |
| max_upward | numeric(18,6) | nullable | 意味の解釈は8章確認事項14 |
| max_downward | numeric(18,6) | nullable | 同上 |
| calculated_at | timestamptz | NN | |
| created_at | timestamptz | NN, DEF now() | |

UQ(event_id, fx_pair_id, timeframe)
IDX(event_id)
IDX(fx_pair_id)
IDX(event_id, fx_pair_id, timeframe)

**名称確定の反映**: 本テーブルは「MarketReaction」ではなく`EventPriceReaction`として設計する(HQ確認、2026-09-16、機能一覧v1.3参照)。

**データ品質判定**: 統計計算からの除外判定(概要設計書10.2節)は`EconomicEvent.data_status`を参照する。`EventPriceReaction`自体には`data_status`列を持たせない(値がnullであること自体が未計算・欠損を表すため)。

---

## 4. 横断的な設計方針

### 4.1 Timestampのタイムゾーン方針

全テーブルの時刻系カラムは`timestamptz`(内部はUTC)で統一する。ユーザー表示時にクライアント側でローカルタイムゾーンへ変換する(概要設計書8.1節・要件定義書9.1節で既に確定済みの方針を踏襲。新たな確認事項ではない)。

### 4.2 Decimal/Numeric精度

- 指標値(forecast/actual/previous)・FX価格(open/high/low/close/pre_release_price/post_release_price)は`numeric(18,6)`を暫定案とした。指標により%・指数値・千人単位など単位が大きく異なるため、この精度で全ケースをカバーできるか、8章確認事項15で確認したい。
- pips/change_percentは`numeric(10,4)`を暫定案とした。

### 4.3 Cascade方針・Delete方針

- **歴史的record(`EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventPriceReaction`/`FxPrice`)**: 物理削除は原則想定しない。子テーブルの外部キーは`ON DELETE RESTRICT`を基本とし、親の削除ミスによる意図しない履歴消失を防ぐ。
- **マスタ系(`EconomicIndicator`/`FxPair`)**: 廃止は`is_active = false`による論理削除で表現し、物理削除は行わない。既存の`EconomicEvent`/`IndicatorFxPair`が参照しているため、物理削除はFK制約上も不可能な設計とする(`ON DELETE RESTRICT`)。
- **関連テーブル(`IndicatorFxPair`)**: 親(`EconomicIndicator`/`FxPair`)が論理削除ではなく万一物理削除された場合は`ON DELETE CASCADE`でよいと考えるが、上記の通りマスタの物理削除自体を想定しない設計のため実質的には発生しない。
- **ユーザー系(`Profile`/`Subscription`/`Entitlement`)**: `Profile`はソフトデリート(3.1節)。`Subscription`/`Entitlement`は`Profile`への`ON DELETE CASCADE`を提案(ユーザー削除時に契約情報も削除)。

これらは提案であり、8章確認事項16として最終確認をお願いしたい。

### 4.4 Soft Deleteの要否(まとめ)

| テーブル | 方式 |
|---|---|
| `Profile` | `deleted_at`によるソフトデリート(Apple 5.1.1(v)対応) |
| `EconomicIndicator` / `FxPair` | `is_active`による論理無効化(削除ではなく非表示) |
| `EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventPriceReaction`/`FxPrice` | 削除非対応(不変の歴史的record) |
| `Subscription`/`Entitlement` | `status`/`enabled`により状態管理(物理削除は基本的に不要) |

### 4.5 データ保持期間

| データ | 方針 |
|---|---|
| `EconomicEvent`/`EventSnapshot`/`EventRevision`/`EventPriceReaction` | 無期限保持(「過去イベント比較」が中核価値のため、要件定義書37章) |
| `FxPrice` | **未確定**。イベント時間窓(発表直前〜+60分)に限定した保存で要件を満たせるか、連続した市場全体の1分足を無期限保持する必要があるかは8章確認事項17 |
| `Profile`(削除済みアカウント) | ソフトデリート後、匿名化した状態で保持(外部キー整合性維持のため) |

### 4.6 外部APIデータとのMapping

具体的なフィールド対応表は、Economic Data Provider / FX Price Providerの正式選定後でなければ確定できない(`implementation-notes-for-hq.md` 3章で既出)。`EconomicDataProvider` / `FXPriceDataProvider`というAdapterインターフェース(HQ方針)が最終的に正規化すべきカラムセットは以下の通り:

- `EventSnapshot`: `forecast` / `actual` / `previous` / `unit`
- `EconomicEvent`: `release_datetime` + `release_datetime_precision`(1.5節の追加提案が採用された場合)
- `FxPrice`: `timestamp`(open time基準へ正規化) / `open` / `high` / `low` / `close`
- タイムゾーンはAdapter層でUTCへ正規化してから保存する(4.1節)

### 4.7 Revision管理・Snapshot管理

- `EventSnapshot`は発表確定時に1回生成し、以後書き換えない(不変性の担保方法は8章確認事項7)。
- `EventRevision`は改定が判明するたびに追記のみ行う(UPDATE/DELETEなし)。
- 分析(Surprise計算・pips計算・統計)は常に`EventSnapshot`の値を用い、`EventRevision`の値では再計算しない(概要設計書5.1節原則)。

### 4.8 FX価格データ保持

`FxPrice`は`fx_pair_id + timeframe`単位で連続的に蓄積する設計としたが、保存範囲(イベント時間窓限定か市場全体の連続保存か)は4.5節・8章確認事項17の通り未確定。

### 4.9 EventPriceReaction生成タイミング

該当`timeframe`の`FxPrice`が確定した時点で、その都度該当`timeframe`の行だけを生成・upsertする方式(段階的生成)を推奨する。理由: ユーザーは+1m時点の反応を早く見たいと考えられ(Home画面の即時性)、`EconomicEvent.data_status = PARTIAL`と組み合わせることで、全timeframeが揃うのを待たずに段階的に情報を提供できる(8章確認事項13で詳細確認)。

### 4.10 Surprise計算方式(保存 vs 都度計算)

**選択肢A(保存)**: `EventSnapshot`に`surprise`列(numeric、nullable)を追加し、`actual`確定時に算出してDBに保存する。
**選択肢B(都度計算)**: `surprise`列を持たず、Read APIレスポンス生成時に`actual - forecast`(forecastがnullならnull)を都度計算する。

**推奨: 選択肢A(保存)。** 理由:
1. 概要設計書12章のキャッシュ方針(「計算済みの値は算出時点でDBに保存する」)と整合する。
2. `EventSnapshot`は不変のため、一度計算したSurpriseが再計算で変わることはなく、保存してもデータ不整合のリスクがない(計算コストの回避が主目的で、整合性リスクはゼロ)。
3. 「上振れ/下振れでフィルタ・ソートする」といった将来のSearch/一覧機能(9.2節・FEAT-110〜115)でDBレベルのフィルタ・ソートが可能になる。

ただし計算ロジック自体は都度計算でも成立するため、最終判断はHQに委ねる(8章確認事項18)。

---

## 5. 今回のHQ方針に含まれないEntity(参考、今回は設計対象外)

`EventExplanation`(1.2節、欠落として報告)。将来拡張(P2): `favorite_indicators` / `favorite_pairs` / `alert_settings`(FEAT-221〜223) / `Person` / `SpeechEvent` / `SpeechPriceReaction`(要人発言、概要設計書14章) / Community関連テーブル(FEAT-225)。Ingestionログ(FEAT-150、1.6節)。

---

## 6. RLS方針

Supabase RLSを前提とする(1.7節、8章確認事項10)。

| 区分 | 対象テーブル | 方針 |
|---|---|---|
| ユーザー固有 | `Profile` / `Subscription` / `Entitlement` | `user_id = auth.uid()`(または`id = auth.uid()`)による本人のみSELECT/UPDATE可。INSERT/DELETEはservice_roleのみ |
| 共有データ | `EconomicIndicator` / `EconomicEvent` / `EventSnapshot` / `EventRevision` / `IndicatorFxPair` / `FxPair` / `FxPrice` / `EventPriceReaction` | 認証済みユーザー全員にSELECTのみ許可。INSERT/UPDATE/DELETEはservice_role(Ingestion Worker・管理者機能)のみ |

具体的なポリシー文(SQL)は、認証方式・Supabase採用そのものが確定してから記述する(8章確認事項10)。

---

## 7. Index一覧(まとめ)

| テーブル | Index |
|---|---|
| `EconomicEvent` | `indicator_id` / `release_datetime` / `status` |
| `EventSnapshot` | `event_id` |
| `EventRevision` | `event_id` |
| `IndicatorFxPair` | `indicator_id` / `fx_pair_id` |
| `FxPrice` | `(fx_pair_id, timestamp)` / `(fx_pair_id, timeframe, timestamp)` |
| `EventPriceReaction` | `event_id` / `fx_pair_id` / `(event_id, fx_pair_id, timeframe)` |

Search機能(FEAT-110〜115)向けの追加Index(全文検索等)は、検索要件がAPI詳細設計で確定してから追加する(8章確認事項19)。

---

## 8. HQ確認事項

以下は本書を作成する過程で判明した、HQの判断が必要な事項。技術的な選択肢と推奨案を示すのみで、独自に確定していない。

1. **`EventSnapshot.snapshot_type`の用途**(1.1節): 1イベント1種類固定(MVPでは`release`のみ)か、複数種類(例: 発表前の暫定値/発表後の確定値)を想定するか。生成タイミングの選択肢: A) 発表確定を検知した瞬間に1回だけ生成(推奨)、B) スケジュール時点の暫定Snapshotと発表後の確定Snapshotを2段階で生成。
2. **`release_datetime_precision`の追加要否**(1.5節): 概要設計書8.2節の要件を満たすため、`EconomicEvent`にこのカラムを追加する案(3.5節)でよいか。
3. **`EconomicIndicator.favorable_direction`の追加要否**(3.4節): Surprise計算(9.2節)に必須の既存カラムが今回のHQ方針にないため、追加が必要と考えるが確認したい。
4. **`EconomicEvent`の`UNIQUE(indicator_id, release_datetime)`制約**(3.5節): 同一指標・同一時刻の重複防止として妥当か。
5. **`EconomicIndicator.importance`の値セット**: `high`/`medium`/`low`の3段階を暫定案としたが妥当か(数値スコアの方が将来のフィルタ・ソートに適する可能性もある)。
6. **`Subscription.status`の値セットと一意性制約**(3.2節): `active`/`canceled`/`expired`/`trial`を暫定案とした。また「アクティブな契約は1ユーザー1件」という部分UNIQUE制約の方針でよいか。
7. **Snapshot不変性の担保方法**(3.6節): `EventSnapshot`の`forecast`/`actual`/`previous`のUPDATE禁止を、DB制約(トリガー・権限)で強制するか、アプリケーション層の規律のみに頼るか(`implementation-notes-for-hq.md`既出、再掲)。
8. **`EventRevision.field_name`の値セットと`effective_at`の意味**(3.7節): `actual`/`previous`のenumで十分か。`effective_at`は既存資料の「改定が判明した日時」(revised_at相当)という解釈で正しいか。
9. **`IndicatorFxPair.priority`の意味**(3.8節): 数値が小さいほど優先という解釈でよいか、それとも「主要/準主要」のような区分値として使うのか。
10. **DBホスティング・認証基盤としてのSupabase採用**(1.7節): 「Supabase RLSを前提として」という指示は、DBホスティング・Auth基盤としてSupabaseを採用する確定と理解してよいか、それとも本書のRLS設計上の参考モデルに過ぎないか。
11. **`FxPrice.id`の型**(3.10節): 時系列データの量を考慮し`bigserial`を提案したが、`uuid`で統一すべきという方針があれば従う。
12. **Entitlementの`feature_code`一覧**(3.3節): Free/Proの機能境界(`implementation-notes-for-hq.md` 4章で既出の未確定事項)が確定してから、具体的な値一覧を定義する。
13. **`EventPriceReaction.timeframe`に`before`(発表直前)を含めるか**(3.11節): 現在は`1m`/`5m`/`15m`/`30m`/`60m`のみとしたが、`pre_release_price`列で発表直前価格を別途保持する設計と役割が重複しないか確認したい。
14. **`max_upward`/`max_downward`の意味**(3.11節): 各timeframe行の値が「その時間軸内での最大上昇/下落」を表すのか、「発表からその時点までの累積最大値」を表すのか(ui-screens.md SCR-005の「最大上昇/最大下落」表示に対応する想定)。
15. **Decimal/Numeric精度**(4.2節): `numeric(18,6)`(指標値・FX価格)・`numeric(10,4)`(pips/change_percent)で全指標・全通貨ペアのケースをカバーできるか。
16. **Cascade/Delete方針**(4.3節): 提案した`ON DELETE RESTRICT`中心の方針でよいか。
17. **`FxPrice`のデータ保持範囲**(4.5節・4.8節): イベント時間窓限定か、連続保存が必要か。
18. **Surpriseの保存 vs 都度計算**(4.10節): 保存(選択肢A)を推奨するが、最終判断を確認したい。
19. **Search機能に必要なIndex**(7章): FEAT-110〜115の検索要件がAPI詳細設計で確定してから追加する、という進め方でよいか。

**1章の6項目(1.1〜1.7)とあわせて、計19+6=25項目をHQ確認事項として本章にまとめた。**

---

## 9. 次のフェーズ

HQレビューの後、DB設計が確定次第、API詳細設計(Endpoint・Request/Response・Error Code)へ進む。今回はDB設計の実装(migration実行・Table作成・API実装・Swift実装・Supabase変更)は行わない。
