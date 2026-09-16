# FX Event Analyzer: DB詳細設計 v1.0

**出典**: HQより2026-09-16指示(「機能一覧 v1.0確定処理完了・次工程はDB詳細設計」)を受けて作成。要件定義書v1.3・概要設計書v1.3・機能一覧v1.3の内容をテーブルレベルに落とし込んだもの。

**位置づけ**: 本書はDB設計ドキュメントであり、実際のマイグレーション・schema.sql・DB作成などの**実装ではない**(HQ指示、2026-09「今回はDB設計の実装は行わない」)。詳細設計としてHQレビューを受けた後、DB実装(マイグレーションファイル作成・実DB反映)は別途の実装フェーズで行う。

**対象範囲**: MVP必須(P0/P1)のエンティティを対象とする。Watchlist・イベント通知・パーソナライズ・Community・要人発言・Web版などP2/将来拡張のエンティティは、7章で名称のみ触れ、カラムレベルの設計は今回対象外とする(機能が具体化してから設計する)。

**設計判断が必要な事項**: 本書中で確定できなかった項目は、断定せず全て**8章「HQ確認事項」**にまとめた。それ以外の設計内容は、既存の要件定義書・概要設計書に基づく具体化(既存原則の実装可能な形への落とし込み)であり、Claude Codeが独自に仕様を変更したものではない。

## 変更履歴

- **v1.0**(今回): 初版。要件定義書v1.3・概要設計書v1.3・機能一覧v1.3を基にテーブル定義・ER関係・RLS方針・データ保持方針・外部データMapping方針を整理

---

## 1. Entity一覧(MVP対象)

| Entity | 概要 | 参照元 |
|---|---|---|
| `users` | ユーザーアカウント | 概要設計書5.1節 |
| `entitlements` | Free/Proのプラン・機能アクセス権 | 概要設計書25章 |
| `subscription_transactions` | App Store決済トランザクション(将来利用、型のみ確保) | 概要設計書25章、FEAT-227 |
| `currencies` | 通貨マスタ | 概要設計書5.5節 |
| `fx_pairs` | 通貨ペアマスタ | 概要設計書5.5節 |
| `economic_indicators` | 経済指標マスタ | 概要設計書5.2節 |
| `indicator_fx_pairs` | Indicator↔FXPairの多対多関連 | 概要設計書5.2節 |
| `economic_events` | 経済イベント(= EventSnapshot、発表時点の不変値) | 概要設計書5.3節 |
| `event_revisions` | 改定履歴(参考情報、分析には使わない) | 概要設計書5.4節 |
| `event_explanations` | 乖離理由(MVP: 出典付き事実要約) | 概要設計書11章 |
| `event_price_reactions` | イベント×通貨ペア×時間軸ごとの価格反応 | 概要設計書8章・5.1節 |
| `fx_prices` | FX価格ローソク足 | 概要設計書7章 |
| `ingestion_logs` | データ取得ジョブの実行ログ(FEAT-150) | 機能一覧10章 |

将来拡張(7章参照、今回はテーブル設計対象外): `favorite_indicators` / `favorite_pairs` / `alert_settings` / `persons` / `speech_events` / `speech_price_reactions` / Community関連。

---

## 2. ER関係(HQ指定の3系統を中心に)

```
economic_indicators
   │
   ├── indicator_fx_pairs ── fx_pairs
   │
   └── economic_events (= EventSnapshot、発表時点で不変)
          │
          ├── event_revisions[]      … 改定履歴(追記のみ、economic_eventsは書き換えない)
          ├── event_explanations     … 乖離理由(事実要約)
          └── event_price_reactions
                 │
                 └── fx_prices(該当時間軸・時刻のレコードを参照)

users
   │
   └── entitlements (1:1)
          │
          └── subscription_transactions[](将来。決済実装後に行が入る)
```

**HQ提示の「EconomicIndicator → EconomicEvent → EventRevision → EventSnapshot」という記載について**: 概要設計書v1.3 5.3節で`EconomicEvent`と`EventSnapshot`は**同一エンティティ**(発表時点の不変値を持つ1つのテーブル)と定義済みのため、本書では`economic_events`という1テーブルとして設計し、`EventRevision`はそこから分岐する別テーブル(改定履歴)として扱った。この理解で正しいか、8章のHQ確認事項1で確認をお願いしたい。

---

## 3. テーブル定義

以下、`PK`=主キー、`FK`=外部キー、`UQ`=UNIQUE制約、`IDX`=インデックス、`NN`=NOT NULL。型はPostgreSQL準拠。

### 3.1 users

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| email | text | UQ, NN | 認証プロバイダ次第で変更あり(8章参照) |
| display_name | text | | |
| plan_migration_note | text | nullable | 「当面は全ユーザーをPro相当で扱う」等の移行運用メモ用(25.1節) |
| deleted_at | timestamptz | nullable | ソフトデリート(下記参照) |
| created_at | timestamptz | NN, default now() | |
| updated_at | timestamptz | NN, default now() | |

**Soft Delete**: kashikariプロジェクトの経験上、iOSアプリはApple Appleガイドライン5.1.1(v)によりアカウント削除機能が事実上必須になる。関連データ(economic_events等)への外部キー整合性を保つため、`deleted_at`によるソフトデリート(物理削除ではなく匿名化)を推奨する。ただし、削除時に何を匿名化するか(email等の扱い)は認証方式確定後にあわせて確定する(8章確認事項11)。

**RLS**: `id = auth.uid()`相当の「本人のみ参照・更新可」ポリシーを想定。具体的な関数名・実装は認証方式確定後(8章確認事項8)。

### 3.2 entitlements

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| user_id | uuid | PK, FK→users.id | 1ユーザー1行 |
| plan | enum(`free`,`pro`) | NN, default `free` | |
| source | enum(`default`,`manual_grant`,`app_store`) | NN, default `default` | Entitlementの根拠。移行期は`manual_grant`で全員Pro付与も可能 |
| valid_until | timestamptz | nullable | `app_store`起因の場合のみ利用。決済未実装時はnull |
| created_at | timestamptz | NN, default now() | |
| updated_at | timestamptz | NN, default now() | |

**設計意図**: 「Entitlement判定ロジックはMVP必須、決済実装(StoreKit)はタイミング未定」という方針(概要設計書25.1節)に沿い、`source`列で「決済なしで付与された状態」と「実際の購入による状態」を区別できるようにした。Read APIは`plan`のみを見ればよく、決済実装が入っても`plan`の意味は変わらない。

**RLS**: users同様、本人のみ参照可。書き込みはRead API(Worker含む)のサービスロールのみを想定。

### 3.3 subscription_transactions(将来利用、型のみ確保)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK→users.id, NN | |
| provider | enum(`app_store`) | NN | 将来RevenueCat等を挟む場合は値追加 |
| transaction_id | text | UQ, NN | App Store側のトランザクションID |
| product_id | text | NN | |
| status | enum(`purchased`,`renewed`,`cancelled`,`expired`,`refunded`) | NN | |
| purchased_at | timestamptz | NN | |
| expires_at | timestamptz | nullable | |
| raw_receipt | jsonb | nullable | 検証用の生データ |
| created_at | timestamptz | NN, default now() | |

**注記**: FEAT-227(決済実装)の着手タイミングが未定のため、このテーブルはMVP時点では**行が入らない**(空テーブル)。型だけ先に確保しておく方針(`EventExplanation`の将来拡張フィールドと同じ考え方、概要設計書11.2節)。

### 3.4 currencies

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| code | char(3) | PK | ISO 4217(USD/JPY/EUR等) |
| name | text | NN | |

### 3.5 fx_pairs

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| symbol | text | UQ, NN | 例: `USDJPY` |
| base_currency | char(3) | FK→currencies.code, NN | |
| quote_currency | char(3) | FK→currencies.code, NN | |
| pip_size | numeric | NN | 概要設計書5.5節「pipsはBackendを正とする」 |
| decimal_digits | smallint | NN | |
| is_active | boolean | NN, default true | 将来ペア追加・廃止に対応(要件定義書7章) |
| created_at | timestamptz | NN, default now() | |

### 3.6 economic_indicators

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| name | text | NN | |
| country | text | NN | |
| currency | char(3) | FK→currencies.code, NN | |
| category | text | | |
| unit | text | | |
| importance | enum(`high`,`medium`,`low`) | NN | 値セットは8章確認事項9 |
| favorable_direction | enum(`higher_is_favorable`,`lower_is_favorable`,`not_applicable`) | NN | Surprise方向性判定(9.2節) |
| release_frequency | enum(`monthly`,`quarterly`,`irregular`) | NN | 4.2節の履歴年数要件に対応するため新設(8章確認事項10) |
| description | text | | |
| source | text | | |
| created_at | timestamptz | NN, default now() | |
| updated_at | timestamptz | NN, default now() | |

**`release_frequency`について**: 要件定義書4.2節「指標ごとの発表頻度と必要な履歴期間」を満たすため、指標マスタに発表頻度を持たせる案を追加した。既存の概要設計書5.2節のカラム列挙にはなかった項目のため、新規追加として明示する(8章確認事項10で運用方法とあわせて確認をお願いしたい)。

### 3.7 indicator_fx_pairs

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→economic_indicators.id, NN | |
| fx_pair_id | uuid | FK→fx_pairs.id, NN | |
| relation_type | enum(`primary`,`secondary`) | NN, default `primary` | 「主要ペア/準主要ペアの区別」(概要設計書5.2節で持ち越された決定、8章確認事項2) |
| created_at | timestamptz | NN, default now() | |

UQ(indicator_id, fx_pair_id)

### 3.8 economic_events(= EventSnapshot)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| indicator_id | uuid | FK→economic_indicators.id, NN | |
| release_datetime | timestamptz | NN | スケジュール時刻(9.2節、自動推定はしない) |
| release_datetime_precision | enum(`exact`,`approximate`) | NN | 5.3節 |
| forecast | numeric | nullable | 存在しない場合null(0にしない) |
| actual | numeric | nullable | 発表前はnull |
| previous | numeric | nullable | |
| surprise | numeric | nullable | `actual - forecast`。forecastがnullならnull(9.3節) |
| importance | enum(`high`,`medium`,`low`) | NN | イベント単位でも保持(指標マスタと異なる場合があり得るため、既存設計を踏襲) |
| data_status | enum(`scheduled`,`fetching`,`complete`,`incomplete`,`delayed`) | NN, default `scheduled` | 値セットは8章確認事項3 |
| source | text | | |
| snapshot_created_at | timestamptz | NN, default now() | Snapshot確定時刻 |
| created_at | timestamptz | NN, default now() | |

UQ(indicator_id, release_datetime) — 同一指標・同一発表時刻の重複防止(想定。8章確認事項1で運用と合わせて確認)
IDX(release_datetime)
IDX(indicator_id, release_datetime DESC) — 「過去N件比較」クエリ用
IDX(data_status) — 品質管理機能(概要設計書13章)の「不確実なデータをクエリ一発で抽出」用

**不変性(immutability)の担保**: `actual`・`previous`は発表後に書き換えない(概要設計書5.1節原則)。DBレベルでの強制方法(トリガー/権限制御)かアプリケーション層の規律のみに頼るかは、`implementation-notes-for-hq.md`で既に未確定事項として報告済み。本書でも8章確認事項1として再掲する。

### 3.9 event_revisions

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→economic_events.id, NN | |
| field | enum(`actual`,`previous`) | NN | |
| old_value | numeric | NN | |
| new_value | numeric | NN | |
| revised_at | timestamptz | NN | 改定が判明した日時 |
| revision_source | text | | |
| created_at | timestamptz | NN, default now() | レコード登録時刻(revised_atとは別) |

IDX(event_id, revised_at)

**追記専用(append-only)**: UPDATE/DELETEは想定しない。UI表示時は必ず「改定後」ラベルで`economic_events`の値と区別する(概要設計書5.4節)。

### 3.10 event_explanations

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→economic_events.id, NN | |
| summary_text | text | nullable | 出典が無い場合はnull(「情報なし」表示) |
| source_url | text[] | nullable | |
| source_type | enum(`official`,`news`,`other`) | nullable | |
| generated_by | enum(`human_curated`,`ai_generated`) | NN, default `human_curated` | MVPは基本human_curated想定(8章確認事項4) |
| generation_type | enum(`fact_summary`,`ai_analysis`,`ai_speculation`) | NN, default `fact_summary` | MVPは`fact_summary`固定 |
| source_references | jsonb | nullable | 将来のAI拡張用(概要設計書11.2節、値の投入は将来) |
| confidence_note | text | nullable | 将来のAI拡張用 |
| generated_at | timestamptz | NN, default now() | |
| created_at | timestamptz | NN, default now() | |
| updated_at | timestamptz | NN, default now() | |

UQ(event_id) — MVPでは1イベント1件(上書き運用)を想定。再生成時に履歴を残すかは8章確認事項5。

### 3.11 event_price_reactions

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| event_id | uuid | FK→economic_events.id, NN | |
| fx_pair_id | uuid | FK→fx_pairs.id, NN | |
| timeframe | enum(`before`,`1m`,`5m`,`15m`,`30m`,`60m`) | NN | `before`=発表直前価格 |
| price | numeric | nullable | |
| change_absolute | numeric | nullable | |
| change_pips | numeric | nullable | Backend算出(pipsはBackendが正) |
| change_percent | numeric | nullable | |
| price_timestamp | timestamptz | nullable | 参照した1分足のtimestamp |
| data_status | enum(`complete`,`incomplete`) | NN | 統計除外判定に使用(10.2節) |
| created_at | timestamptz | NN, default now() | |

UQ(event_id, fx_pair_id, timeframe)
IDX(event_id, fx_pair_id) — SCR-004「1イベント×複数ペア」概要取得用(ui-screens.md 8.3節-1)
IDX(fx_pair_id, timeframe, event_id) — SCR-006の指標×ペア単位の統計集計用

**名称確定の反映**: 本テーブルは「MarketReaction」ではなく`EventPriceReaction`として設計する(HQ確認、2026-09。9章参照)。

### 3.12 fx_prices

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| fx_pair_id | uuid | FK→fx_pairs.id, PK(複合) | |
| timeframe | enum(`1m`,`5m`,`15m`,`30m`,`60m`) | PK(複合) | |
| timestamp | timestamptz | PK(複合) | open time基準(8.1節) |
| open | numeric | NN | |
| high | numeric | NN | |
| low | numeric | NN | |
| close | numeric | NN | |
| volume | numeric | nullable | 提供元により意味が異なるため必須にしない |
| source | text | | |
| created_at | timestamptz | NN, default now() | |

PK(fx_pair_id, timeframe, timestamp)
IDX(fx_pair_id, timeframe, timestamp DESC) — イベント時刻近傍の範囲検索用

**保存範囲**: 本要件でFX価格が必要なのは「イベント発表前後」の範囲(発表直前〜+60分)であり、市場の連続した全時間帯の1分足を無期限に保持する必要があるかは未確定。8章確認事項6で確認をお願いしたい。

### 3.13 ingestion_logs(FEAT-150)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | uuid | PK | |
| job_type | enum(`economic_calendar`,`fx_price`,`revision_check`) | NN | |
| target_ref | text | | 対象のindicator_id/fx_pair_id等を文字列で記録 |
| status | enum(`success`,`failure`,`partial`) | NN | |
| error_message | text | nullable | |
| started_at | timestamptz | NN | |
| finished_at | timestamptz | nullable | |
| created_at | timestamptz | NN, default now() | |

IDX(job_type, started_at DESC)

---

## 4. RLS方針

- **公開・共有データ**(`currencies` / `fx_pairs` / `economic_indicators` / `indicator_fx_pairs` / `economic_events` / `event_revisions` / `event_explanations` / `event_price_reactions` / `fx_prices` / `ingestion_logs`): 全ユーザー共通のマスタ・分析データであり、ユーザー単位のRLSは不要。読み取りはRead API経由のみ(要件定義書26章「外部APIキーをクライアントに置かない」と同じ考え方で、書き込みはIngestion Worker/管理者機能のみに限定)。
- **ユーザー固有データ**(`users` / `entitlements` / `subscription_transactions`): 本人のみ参照・更新可能なRLSを想定。具体的なポリシー実装(`auth.uid()`相当の仕組み)は、認証方式が確定してから確定する(8章確認事項8)。
- **管理者向け機能**(概要設計書13章のデータ品質管理): 一般ユーザーAPIとは別の管理者向けAPI/画面に分離する方針を踏襲し、RLSではなくAPI層でのアクセス制御を基本とする(権限設計自体は概要設計書30章「詳細設計へ引き継ぐ項目」のまま未確定)。

---

## 5. データ保持方針

| データ | 方針 | 根拠 |
|---|---|---|
| `economic_events` / `event_revisions` / `event_price_reactions` | 無期限保持 | 「過去イベント比較」が中核価値のため(要件定義書37章) |
| `event_explanations` | 無期限保持 | 同上 |
| `fx_prices` | **未確定**(8章確認事項6) | イベント時間窓限定か連続保存か |
| `ingestion_logs` | ローリング保持(例: 90日)を提案 | 運用ログであり分析対象データではないため |
| `users` (削除済みアカウント) | ソフトデリート後、匿名化した状態で保持 | kashikariプロジェクトの実装経験(外部キー整合性維持のため物理削除を避ける) |

---

## 6. 外部データとのMapping方針

具体的なフィールド対応表は、Economic Data Provider / FX Price Providerの正式選定後でなければ確定できない(`implementation-notes-for-hq.md` 3章「API依存部分」で既出)。本書では、`EconomicDataProvider` / `FXPriceDataProvider`というAdapterインターフェース(HQ方針)が最終的にどのカラムセットへ正規化する必要があるかを明確にする:

- `economic_events`: `forecast` / `actual` / `previous` / `release_datetime` + `release_datetime_precision`
- `fx_prices`: `timestamp`(open time基準へ正規化) / `open` / `high` / `low` / `close`
- タイムゾーン: Provider側がどのtimezone表現を返しても、Adapter層でUTCへ正規化してから保存する(8.1節)

Provider選定後、Adapterの実装ガイドとして各Provider個別のフィールド名対応表を追補する。

---

## 7. 将来拡張エンティティ(名称のみ、今回は設計対象外)

`favorite_indicators` / `favorite_pairs` / `alert_settings`(FEAT-221〜223、P2) / `persons` / `speech_events` / `speech_price_reactions`(要人発言、概要設計書14章) / Community関連テーブル(FEAT-225、P2)。

いずれも`users`または`economic_indicators`/`fx_pairs`/`economic_events`を参照する形になる見込みだが、機能仕様が具体化してから設計する。

---

## 8. HQ確認事項

以下は本書を作成する過程で判明した、HQの判断が必要な事項。独自に確定していない。

1. **Snapshot不変性の担保方法**: `economic_events.actual`/`previous`のUPDATE禁止を、DB制約(トリガー・権限)で強制するか、アプリケーション層の規律のみに頼るか。また`economic_events`の`UNIQUE(indicator_id, release_datetime)`制約案、および「EconomicEvent = EventSnapshot」という1テーブル理解(2章参照)でよいか。
2. **`indicator_fx_pairs.relation_type`**: 主要ペア/準主要ペアの区別を`primary`/`secondary`という2値で持たせる案でよいか。他に必要な区分はあるか。
3. **`data_status`の値セット**: 本書では`economic_events`に`scheduled`/`fetching`/`complete`/`incomplete`/`delayed`の5値、`event_price_reactions`に`complete`/`incomplete`の2値を仮置きした。名称・粒度が実際の運用に合っているか確認をお願いしたい。
4. **`event_explanations`のMVP生成方式**: 「出典付き事実要約」は運営者が手動作成するのか、非AIの自動抽出処理(要約ロジックのみ、生成AIは使わない)で作成するのか。`generated_by`のデフォルトを`human_curated`としたが、この前提でよいか。
5. **`event_explanations`の再生成時の扱い**: UNIQUE(event_id)として上書き運用にしたが、改定時等に過去バージョンを履歴として残す必要があるか。
6. **`fx_prices`の保存範囲**: イベント発表前後(発表直前〜+60分)の時間窓に限定した保存で要件を満たせるか、それとも連続した市場全体の1分足を無期限に保持する必要があるか(将来のチャート機能等を見据えた判断)。
7. **`ingestion_logs`の保持期間**: 90日程度のローリング保持を提案したが、妥当か。
8. **RLSの具体的な実装**: `users`/`entitlements`のRLSポリシーは、認証方式(自前実装 / 外部Authサービス等、`implementation-notes-for-hq.md` 6章で既出の未確定事項)が決まってから確定する。本書ではポリシーの「考え方」のみ提示した。
9. **`importance`の値セット**: `high`/`medium`/`low`の3段階を仮置きしたが、要件定義書・概要設計書には具体的な値セットの記載がなかったため確認をお願いしたい(数値スコアの方が将来のフィルタ・ソートに適する可能性もある)。
10. **`economic_indicators.release_frequency`の新設**: 要件定義書4.2節の「指標ごとの必要履歴年数」要件を満たすために追加したカラム案。この方式(指標マスタに発表頻度を持たせ、Ingestion Workerが頻度に応じた取得期間を決定する)でよいか、それとも指標ごとに必要履歴年数を直接カラムとして持たせるべきか。
11. **`users`のソフトデリート仕様**: Apple審査対応(5.1.1(v)相当)を見据えてソフトデリートを推奨したが、削除時にどの項目を匿名化するか(email等)は、認証方式確定後にあわせて設計する。

**Search API(FEAT-110〜115)について**: HQ指示の通り、本書では最終仕様を確定しない。3.6〜3.12節のテーブル構造(especially `economic_indicators`/`economic_events`/`fx_pairs`/`currencies`)がSearch APIの検索対象データになる見込みであることのみ記録し、複数エンティティ横断検索の実装方式(全文検索・複数クエリの組み合わせ等)はAPI詳細設計に持ち越す(`features.md` 15.4節と同じ申し送り)。

---

## 9. 次のフェーズ

HQレビューの後、DB設計が確定次第、API詳細設計(Endpoint・Request/Response・Error Code)へ進む(概要設計書30章「詳細設計へ引き継ぐ項目」参照)。今回はDB設計の実装(マイグレーションファイル作成・実DB反映)は行わない。
