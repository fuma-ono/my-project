# FX Event Analyzer: API詳細設計書 v1.4

**出典**: HQより2026-09-16共有(v1.0、本文)。同日、APIレビュー(Claude Code実施)でのAランク8件・Bランク7件の指摘に対するHQ方針確定を受けv1.1を作成。続けて同日、残課題6件(B-1/B-6/B-7/A-1/B-5/A-6/timezone)への最終回答を受け、v1.2として更新した。

**位置づけ**: 本書はAPI設計ドキュメントであり、API実装・Swift実装・DB Migration・Supabase変更・コード変更は一切行っていない(HQ指示「設計書の修正のみ」)。要件定義書・概要設計書・DB詳細設計書は本書の作成にあたり変更していない。変更が必要と考えられる箇所は43章「他ドキュメントへの変更候補」として報告するに留める。

## 変更履歴

- **v1.0**: HQ作成・共有(本書のベース)
- **v1.1**(今回): APIレビューのAランク8件・Bランク7件に対するHQ方針確定(2026-09-16)を反映
  - A-1: `GET /events/{event_id}/revisions`を新設(16.1節)。Event Detail APIに改定有無を判定できる情報を追加(14章)
  - A-2: Event Detailの`related_fx_pairs`に軽量なMarket Reaction Summary(5m基準)を追加(14章)
  - A-3: Data QualityのDB↔API状態名マッピング表を明記。`NOT_ANALYZABLE`はBackendの分析可否判定により生成される旨を明記(7章)
  - A-4: `Profile.timezone`案を撤回。Home等のRequestで明示的にtimezoneを受け取る方式に変更。Account APIからtimezone項目を削除(6章・24章)
  - A-5: Currencyマスタは復活させず、静的Code→Nameマッピングで対応する方針を明記(23章)
  - A-6: `event_name`はDBに追加せず、Event検索は`EconomicIndicator.name`/`code`基準に変更。要件定義書等の`event_name`記載は変更候補として報告(23章、43章)
  - A-7: `DATA_PENDING`/`DATA_UNAVAILABLE`をError Codeから削除。200 OK + status fieldの原則を明記(4章・7章)
  - A-8: Historical Comparison APIに`timeframe=all`を追加(21章)
  - B-1: Entitlement・Endpoint対応表を追加(27.1節)
  - B-2: Reaction API `timeframe=all`のResponse形状(配列)を明記(18章)
  - B-3: Search Filterの範囲をfeatures.md/要件定義書のSource of Truthに基づき現状維持と確認(23章)
  - B-4: Historical ComparisonのeventsにPaginationを追加(21章)
  - B-5: Partial Match Search性能についてpg_trgm + GIN Index案を技術検討として明記、DB設計への変更候補として報告(23章、43章)
  - B-6: `available_timeframes`の算出条件に`release_datetime_precision`を反映するルールを明記(11.1節)
  - B-7: Backend↔Postgres接続方式について技術提案を明記(2.3節)
- **v1.2**(今回): v1.1で残課題として提示した6件(B-1/B-6/B-7/A-1/B-5/A-6/timezone)への最終回答(2026-09-16)を反映
  - B-1: Advanced Statisticsを段階的制御(`available`/`required_entitlement`/`data`)の具体的なResponse形状として確定(21.2節・27.1節)
  - B-6: `release_datetime_precision`→`available_timeframes`ルールを保守的な初期ルールとして正式確定(将来調整可能)(11.1節)
  - B-7: service_role接続 + Backend Authorizationを正式採用。7段階の処理順序を明記(2.3.1節)
  - A-1: Revision APIはEntitlement制限なし(認証済みユーザーなら取得可能)と確定(27.1節)
  - B-5: pg_trgm + GIN Index案を正式採用。対象カラムをdb-design.mdへ追記(db-design.md側の変更、本書23.2章から参照)
  - A-6: `event_name`関連は要件定義書側の変更候補として確定(要件定義書は今回も変更していない)(43章)
  - timezone: Request Parameter方式を正式採用として再確認(6章、変更なし)
- **v1.3**(今回): 全設計横断監査(H-2/M-3/L-5/L-6)での確定事項を反映(2026-09-16)
  - H-2: Homeの「最近のイベント」は当日中に`RELEASED`になったイベントを指すと定義を明確化。専用API・フィールド追加は不要と確認(12章)
  - M-3: `max_upward_pips`/`max_downward_pips`をDB保存値としてそのまま返す方式に変更(旧: API応答時に都度計算。18.1節)
  - L-5: 30章の画面対応表にSCR-010(Login)を追加。Supabase Auth SDK直接利用のためBackend Endpointなしと明記
  - L-6: `event.revision_status`がDB保存値ではなくBackendによる動的算出値であることを明記(14.3節)
- **v1.4**(今回): 設定サブ画面SCR-018〜026の正式仕様(HQ確定 2026-10-02)を反映
  - `DELETE /account`を新設。物理削除(24.3節)
  - `GET /settings`・`PATCH /settings`を新設。通知対象・表示・チャート設定の保存(24.4節・24.5節)
  - `POST /subscription/verify`を新設。StoreKit 2の署名済みTransactionをBackendで検証し購読状態を保存(25.1節)
  - Pro商品(月額・年額)とPRO Entitlement付与ルールを確定(25.2節・28章)
  - 30章の画面対応表にSCR-018〜026を追加

---

## 1. 文書情報

- プロダクト名：FX Event Analyzer
- 対象プラットフォーム：iOS / iPadOS
- Backend：Supabase / PostgreSQL
- API形式：REST API
- API Version：v1
- Base URL：`/api/v1`
- JSON形式：JSON
- 認証：Supabase Auth JWT
- DB時刻：UTC
- API時刻：ISO 8601 UTC
- JSON Field：snake_case

本API設計は、以下の設計を前提とする。

```
Requirements
↓
Overview Design
↓
Screen Detailed Design
↓
DB Detailed Design
↓
API Detailed Design
↓
Implementation
```

---

# 2. API基本方針

## 2.1 API方式

REST APIを採用する。

Base Path：`/api/v1`

例：`GET /api/v1/events/{event_id}`

## 2.2 認証

原則としてクライアント向けAPIは認証必須。

認証方式：Supabase Auth JWT

Request Header：`Authorization: Bearer <access_token>`

認証失敗：HTTP 401

## 2.3 Authorization

認証だけでなくBackend側で権限チェックを行う。

ユーザー固有データ：Profile / Subscription / Entitlement

共有市場データ：EconomicIndicator / EconomicEvent / EventRevision / EventSnapshot / EventExplanation / IndicatorFxPair / FxPair / FxPrice / EventPriceReaction

ユーザー固有データについてはSupabase RLSも利用する。

### 2.3.1 Backend↔Postgres接続方式(v1.2で確定、B-7)

**正式採用**: Backendは**service_role接続 + Backend Authorization**を使用する。RLSを無効化したことを理由にAuthorizationを省略してよい設計にはしない。**Backend Authorizationを必須とする。**

**処理順序(確定)**:

1. ClientからSupabase JWTを受信
2. BackendでJWTを検証
3. `user_id`を確定
4. Endpoint権限を確認(27.1節のEndpoint×feature_code対応表)
5. Entitlementを確認
6. BackendからPostgreSQLへアクセス(service_role接続)
7. DTOとしてResponseを返す

service_role credentialはClientへ絶対に公開しない。db-design.md 6章のRLS方針(ユーザー固有データ: 本人のみSELECT可・共有データ: 認証済み全員SELECT可、書き込みはservice_roleのみ)は、万一Backendを経由しない直接アクセスが将来発生した場合の防御としてテーブル側に維持する(RLSポリシー自体は有効なまま残すが、Backend経由の通常フローではservice_role接続によりRLSはバイパスされ、Authorization4〜5がアクセス制御の主たる境界となる)。

---

# 3. HTTP Status

| Status | 用途 |
|---|---|
| 200 | 正常取得・更新 |
| 201 | 作成成功 |
| 204 | Bodyなしの成功 |
| 400 | 不正なRequest |
| 401 | 未認証 |
| 403 | 権限不足 |
| 404 | Resource不存在 |
| 409 | Conflict |
| 422 | Validation Error |
| 429 | Rate Limit |
| 500 | Internal Server Error |
| 503 | 外部データ等のService Unavailable |

---

# 4. Error Response

すべてのAPIで基本的に以下の形式を使用する。

```json
{
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found."
  }
}
```

## Error Code

- UNAUTHORIZED
- FORBIDDEN
- NOT_FOUND
- VALIDATION_ERROR
- CONFLICT
- RATE_LIMITED
- INTERNAL_ERROR
- SERVICE_UNAVAILABLE
- EVENT_NOT_FOUND
- INDICATOR_NOT_FOUND
- FX_PAIR_NOT_FOUND
- SUBSCRIPTION_REQUIRED
- FEATURE_NOT_ENTITLED

**(v1.1で変更、A-7)**: `DATA_PENDING`/`DATA_UNAVAILABLE`/`ANALYSIS_NOT_AVAILABLE`をError Codeから削除した。これらは「Resourceは存在するがデータがまだ準備できていない状態」であり、HTTPエラーとしては扱わない。**HTTP 200 + Response Body内のstatus field(`data_status`/`analysis_status`等)で表現する。** 詳細は7章参照。

HTTPエラーとして扱うのは以下のケースに限定する:

- Resource不存在(`EVENT_NOT_FOUND`等)
- Authentication failure(`UNAUTHORIZED`)
- Authorization failure(`FORBIDDEN`, `SUBSCRIPTION_REQUIRED`, `FEATURE_NOT_ENTITLED`)
- Validation error(`VALIDATION_ERROR`)
- Conflict(`CONFLICT`)
- Rate Limit(`RATE_LIMITED`)
- Server Error / Service Unavailable(`INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`)

---

# 5. Pagination

一覧APIではPaginationを利用する。

Query：page / limit

Default：`limit = 20`

Maximum：`limit = 100`

Response：

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "has_next": true
  }
}
```

---

# 6. Date / Time

DBはUTCで保存する。APIもUTCで返却する。

形式：ISO 8601(例: `2026-09-12T13:30:00Z`)

一覧APIのfrom / toについては以下とする。

- from：inclusive
- to：exclusive

**(v1.1で変更、A-4)**: 「API上で日付のみが指定された場合は、対象ユーザーのtimezoneを基準に解釈し、内部ではUTCに変換する」という原則は維持するが、**timezoneの取得元をProfileへの永続化ではなく、Requestで明示的に受け取る方式に変更する。** `Profile`にtimezoneカラムは追加しない(要件定義書・概要設計書の「DB内部はUTC、表示時にクライアント側でローカル変換」という原則をそのまま維持するため)。

**原則(確定)**: サーバー側で日付のみのパラメータ(例: Homeの`date`)を解釈する必要があるEndpointは、**timezoneをRequest Query/Headerで明示的な必須パラメータとして受け取る。** Profileや他のユーザー設定から暗黙的にtimezoneを取得することはしない。

例: `GET /api/v1/home?date=2026-09-12&timezone=Asia/Tokyo`(12章参照)

---

# 7. Data Quality

市場データ・経済指標データには以下のAPI状態を使用する。

- READY
- DATA_PENDING
- DATA_UNAVAILABLE
- NOT_ANALYZABLE

## 7.1 DB↔APIマッピング(v1.1で追加、A-3)

DBの内部状態(db-design.md参照)とAPIが返す状態は、役割を分離した上で以下のように対応させる。

| DB状態(`EconomicEvent.data_status`) | API状態 |
|---|---|
| `AVAILABLE` | `READY` |
| `PENDING` | `DATA_PENDING` |
| `PARTIAL` | `DATA_PENDING` |
| `UNAVAILABLE` | `DATA_UNAVAILABLE` |

| DB状態(`EventPriceReaction.data_status`) | API状態 |
|---|---|
| `AVAILABLE` | `READY` |
| `PENDING` | `DATA_PENDING` |
| `UNAVAILABLE` | `DATA_UNAVAILABLE` |

`NOT_ANALYZABLE`はDBの`data_status`列を直接反映したものではなく、**Backend側の分析可否判定ロジック**(例: 統計計算対象外、`release_datetime_precision`が低精度で該当timeframeの分析が不可能、等)によって生成されるAPI固有の状態である。DBの`data_status`が`AVAILABLE`であっても、分析条件を満たさない場合は`NOT_ANALYZABLE`を返しうる。

## 7.2 重要ルール

「データが存在しない」と「0」は完全に別物として扱う。例えばForecastが存在しない場合：

```
forecast = null
```

以下のように0として扱ってはいけない。

```
forecast = 0  # NG
```

DATA_PENDING / DATA_UNAVAILABLE / NOT_ANALYZABLEはいずれも**HTTP 200のResponse Body内のstatus fieldとして**表現し、HTTPエラーとしては返さない(4章・7章参照)。

---

# 8. Backend Calculation Source of Truth

以下の計算はBackendをSource of Truthとする。

- Surprise
- Surprise Direction
- Movement
- Pips
- Change Percent
- Max Upward
- Max Downward
- Historical Statistics

iOS側でこれらを再計算して表示することを前提としない。iOSはBackendから返された計算済み結果を表示する。

---

# 9. Surprise Calculation

基本式：`Actual - Forecast`

例：Forecast = 3.0、Actual = 3.2 → Surprise = 0.2

ForecastまたはActualが存在しない場合：`surprise = null`

Surprise = 0の場合：`surprise_direction = NEUTRAL`

Positive / Negativeの意味は`EconomicIndicator.favorable_direction`を使用して判定する。`favorable_direction`によって、POSITIVE / NEGATIVE / NEUTRALを判定する。

Forecastが存在しない場合はSurprise分析対象外とし、0として扱わない。

---

# 10. Market Reaction Calculation

## 10.1 Movement

`movement = post_release_price - pre_release_price`

## 10.2 Pips

`pips = movement / pip_size`

## 10.3 Change Percent

`change_percent = movement / pre_release_price × 100`

## 10.4 Max Upward

Release前価格を基準とした期間内最大上昇幅。`max_upward = max(price - pre_release_price)`

## 10.5 Max Downward

Release前価格を基準とした期間内最大下降幅。`max_downward = min(price - pre_release_price)`

これらはBackendで計算し、DBに保存する。iOS側では再計算しない。

---

# 11. Timeframe

MVPで対応するTimeframe：1m / 5m / 15m / 30m / 60m

BEFOREというTimeframeは作らない。Release前価格は`pre_release_price`として別管理する。`EventPriceReaction`のtimeframeには、1m / 5m / 15m / 30m / 60mのみを許可する。

## 11.1 available_timeframesの算出条件(v1.2で確定、B-6)

Event Detail API(14章)が返す`available_timeframes`は、`EconomicEvent.release_datetime_precision`を考慮して算出する。**発表時刻の精度が低いイベントを、1m等の高精度な市場反応分析対象として扱わない**という概要設計書8.2節の原則を、以下のルールとして正式確定する(HQ確定、2026-09-16)。

| `release_datetime_precision` | 除外するtimeframe | 提供するtimeframe |
|---|---|---|
| `EXACT` | なし | 1m / 5m / 15m / 30m / 60m すべて |
| `APPROXIMATE` | `1m`のみ除外 | 5m / 15m / 30m / 60m |
| `DATE_ONLY` | `1m`/`5m`を除外 | 15m / 30m / 60m |
| `UNKNOWN` | `1m`/`5m`を除外 | 15m / 30m / 60m |

**これはデータ精度を踏まえた保守的な初期ルールとして扱う。** 将来的に実データを検証し、必要であれば閾値・ルールを変更可能な設計とする(固定値としてハードコードせず、設定変更で調整できる実装を推奨)。

---

# 12. API一覧

## Home

### GET /api/v1/home

Home画面に必要なデータを取得する。

Query：

- `date`(必須)
- `timezone`(必須。v1.1で必須化、A-4。IANA timezone名、例: `Asia/Tokyo`)

Response：

```json
{
  "date": "2026-09-12",
  "timezone": "Asia/Tokyo",
  "events": [],
  "major_fx": []
}
```

Eventには以下を含む。

- event_id
- indicator_id
- indicator_name
- country_code
- currency_code
- importance
- release_datetime
- release_datetime_precision
- status
- data_status
- forecast
- actual
- previous
- surprise
- surprise_direction
- related_fx_pairs

major_fxにはHomeで表示する主要FX Pairの最新情報を含める。想定項目：fx_pair_id / symbol / price / change / change_percent / timestamp。実際の価格データProviderには依存しない。

**「今日の注目イベント」と「最近のイベント」の扱い(v1.3で確定、H-2)**: `events`は`date`でスコープされた当日分の一覧であり、「最近のイベント」は**当日中に`status = RELEASED`になったイベント**を指す(複数日にまたがる履歴ではない)。専用APIや`recent_events`フィールドは追加せず、Clientが`events`配列を`status`(`SCHEDULED`/`RELEASED`/`CANCELLED`)で「今日の注目イベント」(主にSCHEDULED)と「最近のイベント」(RELEASED)に表示分けする。

---

# 13. Indicator API

## 13.1 GET /api/v1/indicators

経済指標一覧を取得する。

Query：q / country_code / currency_code / importance / page / limit / sort

qはIndicator name / codeの部分一致検索に使用する。

## 13.2 GET /api/v1/indicators/{indicator_id}

経済指標詳細を取得する。

Responseには以下を含む：indicator / favorable_direction / related_fx_pairs / latest_event

Indicator Detailでは、name / code / country / currency / importance / description / frequency / unit / source / source_url / favorable_direction などを取得可能とする。

## 13.3 GET /api/v1/indicators/{indicator_id}/events

指定Indicatorの過去・未来Event一覧を取得する。

Query：from / to / status / page / limit / sort

fromはinclusive。toはexclusive。

## 13.4 GET /api/v1/indicators/{indicator_id}/fx-pairs

指定Indicatorに関連するFX Pair一覧を取得する。IndicatorとFX Pairは、IndicatorFxPairによるMany-to-Many関係とする。

Response：fx_pair_id / symbol / priority / is_active

priorityの小さいものを優先対象とする。

---

# 14. Event API

## 14.1 GET /api/v1/events/{event_id}

特定Economic Eventの詳細を取得する。Event Detail画面の主要API。

Response：

```json
{
  "event": {
    "revision_status": "NONE"
  },
  "snapshot": {},
  "analysis": {
    "surprise": null,
    "surprise_direction": null
  },
  "explanation": {},
  "related_fx_pairs": [
    {
      "fx_pair_id": "xxx",
      "symbol": "USDJPY",
      "priority": 1,
      "reaction": {
        "timeframe": "5m",
        "pips": 30.0,
        "change_percent": 0.1909,
        "analysis_status": "READY"
      }
    }
  ],
  "available_timeframes": [
    "1m",
    "5m",
    "15m",
    "30m",
    "60m"
  ]
}
```

Event Detailでは以下を1回のAPIで取得可能とする。

- EconomicEvent
- RELEASE EventSnapshot
- Surprise
- 最新EventExplanation
- Related FX Pair(軽量なMarket Reaction Summary込み、下記14.2参照)
- Available Timeframe
- 改定の有無を判定できる情報(下記14.3参照)

Movement Chart等の比較的重いデータ、および特定timeframe・特定ペアの詳細Reaction、全revision履歴は別APIで取得する。

## 14.2 related_fx_pairsのMarket Reaction Summary(v1.1で追加、A-2)

`related_fx_pairs`の各要素に、基本情報(fx_pair_id / symbol / priority)に加えて軽量な`reaction`オブジェクトを含める。

- `reaction.timeframe`: MVPでは`5m`固定(主要timeframeとして採用)
- `reaction.pips`
- `reaction.change_percent`
- `reaction.analysis_status`: `READY` / `DATA_PENDING` / `DATA_UNAVAILABLE` / `NOT_ANALYZABLE`(7章参照)

詳細なOHLC Chartや全timeframeの詳細Reactionは、既存の`GET /events/{id}/reaction`・`GET /events/{id}/reaction/chart`を利用する(18章・19章)。これにより、Event Detail画面で複数FX Pairの反応を1回のAPI取得で表示できる。

## 14.3 改定状態の判定情報(v1.1で追加、A-1)

`event.revision_status`として、以下のいずれかを返す。

- `NONE`: 改定なし
- `REVISED`: 1件以上の改定が存在する

**算出方法(v1.3で明記、L-6)**: `revision_status`はDBに保存された列ではなく、`EventRevision`の存在有無(`event_id`に紐づく行数)からBackendが都度動的に算出する値である。RELEASE Snapshotの値自体は一切変更しない。

詳細な改定履歴(誰が・いつ・どの値を、等)が必要な場合は、16.1節の`GET /events/{event_id}/revisions`を別途呼び出す。Event Detail API自体には改定履歴の全件を含めない(Responseの肥大化を避けるため)。

---

# 15. Event Snapshot

Event分析では、`EventSnapshot(snapshot_type = RELEASE)`をSource of Truthとする。Release時点の以下の値を保持する：Forecast / Actual / Previous / Unit / Source / Source URL。

RELEASE SnapshotはImmutableとする。後からRevisionが発生してもRelease Snapshotを書き換えない。これにより、「発表時点で市場が知ることができた情報」を後から再現できるようにする。

---

# 16. Event Revision

後から改定された値はEventRevisionで管理する。Release時点の値と改定後の値を明確に区別する。EconomicEventにmutableな`revised_previous`を追加しない。

Revisionが発生した場合はEventRevisionに、field_name / old_value / new_value / effective_at / source / created_at などを記録する。Event分析の基準値はあくまでRELEASE Snapshotとする。

## 16.1 GET /api/v1/events/{event_id}/revisions(v1.1で新設、A-1)

指定Eventの改定履歴一覧を取得する。FEAT-045「Revised Previous表示」に対応するAPI。

Query：page / limit(5章のPagination規約に準拠。改定件数は通常少数のためdefault limitで十分な想定)

Response：

```json
{
  "data": [
    {
      "revision_id": "xxx",
      "event_id": "xxx",
      "field_name": "PREVIOUS",
      "old_value": 3.1,
      "new_value": 3.3,
      "effective_at": "2026-10-05T00:00:00Z",
      "source": "BLS revision release",
      "created_at": "2026-10-05T01:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "has_next": false
  }
}
```

UI表示時は必ず「改定後」等のラベルを付し、Release Snapshotの値と明確に区別すること(概要設計書v1.6 5.5節のUI表示ルールに準拠)。本APIはRELEASE Snapshotの値を変更しない、参照専用のEndpointである。

---

# 17. Event Explanation

EventExplanationはVersion管理する。MVPではAIによる自由形式の説明ではなく、公式情報に基づく事実ベースのSummary / Sourceを提供する。

Event Detail APIでは最新Versionを返す。最新Versionの判定：event_idごとの最大version とする。created_atだけを基準に最新版を判定しない。

将来的にExplanation履歴APIを追加可能とする。MVPでは履歴取得APIは提供しない。

---

# 18. Event Reaction API

## GET /api/v1/events/{event_id}/reaction

指定EventのMarket Reactionを取得する。

Query：fx_pair_id / timeframe

timeframe：1m / 5m / 15m / 30m / 60m / all

### 18.1 Response形状(v1.1で明確化、B-2)

**timeframeを単一値で指定した場合**(例: `timeframe=5m`)、Responseは単一オブジェクトを返す：

```json
{
  "event_id": "xxx",
  "fx_pair_id": "xxx",
  "timeframe": "5m",
  "pre_release_price": 157.123,
  "post_release_price": 157.423,
  "movement": 0.300,
  "pips": 30.0,
  "change_percent": 0.1909,
  "max_upward": 0.350,
  "max_downward": -0.100,
  "max_upward_pips": 35.0,
  "max_downward_pips": -10.0,
  "analysis_status": "READY"
}
```

**`timeframe=all`を指定した場合**、Responseは`reactions`キーを持つ配列形式を返す：

```json
{
  "event_id": "xxx",
  "fx_pair_id": "xxx",
  "pre_release_price": 157.123,
  "reactions": [
    {
      "timeframe": "1m",
      "post_release_price": 157.200,
      "movement": 0.077,
      "pips": 7.7,
      "change_percent": 0.049,
      "max_upward": 0.080,
      "max_downward": -0.010,
      "max_upward_pips": 8.0,
      "max_downward_pips": -1.0,
      "analysis_status": "READY"
    }
  ]
}
```

`pre_release_price`は全timeframeで共通のため配列の外側(トップレベル)に1つだけ持たせ、各timeframe固有の値(`post_release_price`/`movement`/`pips`等)のみを`reactions`配列の各要素に含める(冗長なデータ重複を避ける)。

`analysis_status`を使用し、Event自体のstatusとは区別する(7章参照、200 OK + status field方式)。

**`max_upward_pips`/`max_downward_pips`の算出方針(v1.3で確定、M-3)**: これらは`EventPriceReaction`テーブルにDB保存された値をそのまま返す。通常の`pips`列と同様にIngestion Worker側で算出・保存し、**API応答時に`pip_size`を用いて都度計算する設計は採用しない**(pips系カラムの保存方針を統一するため)。db-design.md 3.12節参照。

---

# 19. Event Reaction Chart API

## GET /api/v1/events/{event_id}/reaction/chart

Chart表示用の価格データを取得する。

Query：fx_pair_id / timeframe

MVP Chart Window：Release前30分 + Release後60分

ResponseにはChart描画に必要なOHLCデータを含める。想定項目：timestamp / open / high / low / close / volume。

Release時刻をChart上のEvent Markerとして表示できるデータ構造とする。Chart APIはEventPriceReactionそのものではなく、チャート描画に必要なFxPriceデータを返す。

---

# 20. Historical Event API

## GET /api/v1/events/{event_id}/history

過去Eventの詳細を取得する。Historical Event Detail画面で使用する。

以下を取得できる：Release Snapshot / Forecast / Actual / Previous / Surprise / Explanation / Market Reaction / Related FX Pair / Indicator ID

Release時点のSnapshotを使用して過去イベントを再現する。Historical Event DetailからIndicator Detailへ遷移できるよう、`indicator_id`を必ず返す。

---

# 21. Historical Comparison API

## GET /api/v1/indicators/{indicator_id}/comparison

指定Indicatorの過去Eventを比較する。

Query：

- fx_pair_id
- timeframe(1m / 5m / 15m / 30m / 60m / all。**v1.1で`all`追加、A-8**)
- from / to
- page / limit(**v1.1で追加、B-4**。default = 20、max = 100。Statisticsはページング対象外)

### 21.1 Response(timeframe単一指定時)

```json
{
  "indicator": {},
  "fx_pair": {},
  "timeframe": "5m",
  "total_events": 20,
  "analyzable_events": 18,
  "stats": {
    "average_movement": 0.21,
    "average_pips": 21.0,
    "max_movement": 0.55,
    "min_movement": -0.30,
    "upward_count": 12,
    "downward_count": 6,
    "no_change_count": 0
  },
  "advanced_statistics": {
    "available": true,
    "required_entitlement": null,
    "data": {
      "average_absolute_movement": 0.28,
      "average_absolute_pips": 28.0
    }
  },
  "events": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 20,
    "has_next": false
  }
}
```

### 21.2 Response(timeframe=all指定時、v1.1で追加、A-8)

`stats`/`advanced_statistics`と`events`内の各要素をtimeframeごとに配列化する。18.1節のReaction APIと同様の考え方で、各eventオブジェクトの中に`reactions: []`(1m〜60mの反応)を持たせる:

```json
{
  "indicator": {},
  "fx_pair": {},
  "total_events": 20,
  "analyzable_events": 18,
  "stats_by_timeframe": [
    { "timeframe": "1m", "stats": {}, "advanced_statistics": { "available": true, "required_entitlement": null, "data": {} } },
    { "timeframe": "5m", "stats": {}, "advanced_statistics": { "available": true, "required_entitlement": null, "data": {} } }
  ],
  "events": [
    {
      "event_id": "xxx",
      "release_datetime": "2026-09-12T13:30:00Z",
      "forecast": 3.0,
      "actual": 3.2,
      "previous": 3.1,
      "surprise": 0.2,
      "surprise_direction": "POSITIVE",
      "reactions": [
        { "timeframe": "1m", "pips": 7.7, "change_percent": 0.049, "analysis_status": "READY" }
      ]
    }
  ],
  "meta": {}
}
```

これにより、SCR-006(1m〜60mの反応を含む一覧表示)を不要なAPI連打なしで取得できる。

### 21.3 Advanced Statisticsの段階的制御(v1.2で確定、B-1)

Advanced Statistics全体を403で拒否するのではなく、**`VIEW_HISTORICAL`を持つユーザーであれば`stats`(Basic Statistics)は常に取得可能**とし、`VIEW_ADVANCED_STATS`を持たないユーザーには`advanced_statistics`オブジェクト自体は返しつつ、中身を以下のように制御する。

**`VIEW_ADVANCED_STATS`を持たない場合**:

```json
{
  "advanced_statistics": {
    "available": false,
    "required_entitlement": "VIEW_ADVANCED_STATS",
    "data": null
  }
}
```

**`VIEW_ADVANCED_STATS`を持つ場合**:

```json
{
  "advanced_statistics": {
    "available": true,
    "required_entitlement": null,
    "data": {
      "average_absolute_movement": 0.28,
      "average_absolute_pips": 28.0
    }
  }
}
```

`available: false`は「データが存在しない」のではなく「Entitlement不足で見られない」ことを意味し、Clientはこれを明確に区別して表示する(例: 「Proで解放」バナー等)。この区別を必須のResponse契約とする。

分析不能EventはStatisticsから除外する。ただし`total_events`と`analyzable_events`は分けて返す。これにより、「過去20回あるが、分析可能なのは18回」という状態をUI上で表現できる。

---

# 22. Historical Statistics

Statisticsでは以下を扱う。

- average_movement
- average_absolute_movement
- average_pips
- average_absolute_pips
- max_movement
- min_movement
- max_pips
- min_pips
- upward_count
- downward_count
- no_change_count

Direction判定：pips > 0 → upward、pips < 0 → downward、pips = 0 → no_change

DATA_PENDING / DATA_UNAVAILABLE / NOT_ANALYZABLEはStatisticsに含めない。StatisticsはBackendで計算する。

---

# 23. Search API

## GET /api/v1/search

MVPでは横断検索を提供する。

Query：q / type / page / limit(**v1.1で確認、B-3: 現状のtype以外の追加Filterは、features.md/要件定義書に具体的な要求記載がないため追加しない**)

type：all / indicator / event / fx_pair / currency

### 23.1 検索対象(v1.1で修正、A-5・A-6)

**Indicator**: `EconomicIndicator.name` / `EconomicIndicator.code`

**Event**(v1.1で修正、A-6): ~~event name~~ → `EconomicIndicator.name` / `EconomicIndicator.code`(Eventは`indicator_id`経由でIndicatorに紐づくため、Indicator名・コードを検索基準とする)。加えて`release_datetime`等の日付属性による絞り込みを想定する。**`EconomicEvent`に独立した`event_name`カラムは存在しないため、これへの直接検索は行わない。** 要件定義書5.2節等に残る`event_name`の記載は43章「他ドキュメントへの変更候補」で報告する。

**FX Pair**: `FxPair.symbol`

**Currency**(v1.1で修正、A-5): `currency_code`(DB上のSource of Truth)に加え、**アプリケーション側の静的なCode→Nameマッピング**(例: `USD → US Dollar`、`JPY → Japanese Yen`、`EUR → Euro`)を用いてcurrency nameでも検索可能にする。DBに`currencies`マスタテーブルは追加しない。将来Currency情報が大幅に増える場合のみマスタテーブル化を再検討する。

MVPでは部分一致検索。Full Text SearchはMVP対象外。

### 23.2 Search Index方針(v1.2で確定、B-5)

**pg_trgm + GIN Indexを正式採用する。** 部分一致検索(`ILIKE '%…%'`)は標準のB-tree Indexでは効率的に利用できないため、以下のカラムに`pg_trgm`拡張によるGIN Indexを追加する方針を確定した。

| テーブル.カラム | 目的 |
|---|---|
| `EconomicIndicator.name` | Indicator検索(23.1節) |
| `EconomicIndicator.code` | Indicator検索(23.1節) |
| `FxPair.symbol` | FX Pair検索(23.1節) |

`currency_code`は静的マッピングによる検索(DBクエリ不要)のためIndex対象外。`event`検索は`EconomicIndicator.name`/`code`のIndexを経由するため、`EconomicEvent`側への追加Indexは不要。

**この変更はdb-design.mdへの追記対象であり、本ラウンドでdb-design.md v4.1として反映した(DB Migrationは未実施、ドキュメント上の追記のみ)。** 詳細はdb-design.md 7章「Index一覧」参照。

---

# 24. Account API

## 24.1 GET /api/v1/account

現在のユーザー情報を取得する。

Response：

- user_id
- created_at
- updated_at

**(v1.1で変更、A-4)**: `timezone`をResponseから削除した。timezoneはProfileに永続化せず、必要なEndpoint(Home等)でRequestごとに明示的に受け取る方式に変更したため(6章参照)。

## 24.2 PATCH /api/v1/account

Account情報を更新する。

**(v1.1で変更、A-4)**: `timezone`の更新機能を削除した。Account APIはDBの`Profile`テーブルに実在するカラムのみを更新対象とする。

Email / PasswordはSupabase Auth側で管理する。Backend APIから直接Auth情報を変更しない。

## 24.3 DELETE /api/v1/account(v1.4で追加)

ログイン中のユーザーを**物理削除**する(SCR-026、HQ確定 2026-10-02)。

- Supabase Authのユーザー(`auth.users`)をAdmin APIで削除し、`profiles`以下(`subscriptions` / `entitlements` / `user_settings`)はFKのON DELETE CASCADEで同時に削除される(db-design.md §7)
- Response：`204 No Content`
- App Storeの自動更新サブスクリプションはAppleが管理するため本APIでは解約されない。iOS側の削除画面で、事前にApp Storeで解約するよう案内する
- 削除後、iOSはローカルのセッションを破棄してサインアウトする

## 24.4 GET /api/v1/settings(v1.4で追加)

ユーザー設定を取得する(SCR-018 通知設定 / SCR-020 表示・地域設定 / SCR-021 チャート設定)。初回アクセス時はDBの既定値で行を作成して返す。

```json
{
  "notifications": {
    "pre_release": true,
    "result": true,
    "favorites": true,
    "min_importance": 3
  },
  "display": {
    "language": "ja",
    "region": "JP",
    "timezone": "Asia/Tokyo"
  },
  "chart": {
    "default_fx_pair_symbol": null,
    "default_timeframe": "5m"
  },
  "updated_at": "2026-10-02T00:00:00Z"
}
```

- `notifications`：**通知対象の保存のみ**。MVPではPush通知の送信そのものは実装しない(HQ確定)。Push基盤追加時は本設定を送信条件として参照し、デバイストークンは別テーブルで管理する想定
  - `pre_release`：重要指標の発表前通知 / `result`：重要指標の結果通知 / `favorites`：お気に入りイベント通知
  - `min_importance`：通知する重要度の下限(★1〜★5の整数)。指標のimportance(3段階)とは**暫定マッピング** LOW→★1 / MEDIUM→★3 / HIGH→★5 で対応付ける(Push通知実装時に最終確認、db-design.md §3.14)
- `display.language`：`ja` / `en`、`display.region`：ISO 3166-1 alpha-2、`display.timezone`：IANA timezone名。Home等のRequestに渡すtimezoneの既定値としてiOSが利用する(6章の「Requestで明示的に受け取る」方針は変更しない)
- `chart.default_fx_pair_symbol`：`fx_pairs.symbol`または`null`、`chart.default_timeframe`：`1m` / `5m` / `15m` / `30m` / `60m`

## 24.5 PATCH /api/v1/settings(v1.4で追加)

ユーザー設定を部分更新する。Bodyは24.4節と同じ構造で、**送ったフィールドのみ**更新する。未知のフィールドは`422 VALIDATION_ERROR`。存在しない`default_fx_pair_symbol`も`422`。Responseは更新後の24.4節と同じ形。

---

# 25. Subscription API

## GET /api/v1/subscription

現在のSubscription状態を取得する。

Response：plan / status / started_at / expires_at

Plan：FREE / PRO

Status：ACTIVE / CANCELED / EXPIRED / TRIAL

有効な(ACTIVE / TRIAL、または期限内のCANCELED)行がない場合は`plan: FREE`、他項目`null`を返す(404にはしない)。

## 25.1 POST /api/v1/subscription/verify(v1.4で追加)

StoreKit 2で購入・復元した購読をBackendで検証し、保存する(SCR-019、HQ確定 2026-10-02)。

処理の流れ：

1. iOSはStoreKit 2で購入する。購入時の`appAccountToken`にSupabaseのuser idを設定する
2. iOSは`Transaction.jwsRepresentation`(と取得できれば`RenewalInfo.jwsRepresentation`)をBackendへ送る
3. BackendがAppleの署名を検証する(下記)
4. 検証済みの購読状態を`subscriptions`へ保存し、PRO Entitlementを同期する(1トランザクション)
5. iOSは本APIまたは`GET /subscription` / `GET /entitlements`の結果でPro機能の可否を判断する(StoreKitの端末上の状態は使わない)

Request：

```json
{
  "signed_transaction": "<JWS>",
  "signed_renewal_info": "<JWS, 任意>"
}
```

Response：`GET /subscription`と同じ形(plan / status / started_at / expires_at)。

署名検証(オフライン、Apple App Store Server Libraryと同等)：

- JWSヘッダー`alg = ES256`、`x5c`の証明書チェーンが**Backendに固定したApple Root CA - G3**に連なること(`x5c`内のRootは信用しない)
- 中間証明書・リーフ証明書にAppleのマーカー拡張(1.2.840.113635.100.6.2.1 / 1.2.840.113635.100.6.11.1)があること
- リーフの公開鍵で署名が検証できること、`signedDate`時点で各証明書が有効であること

Payload検証：

- `bundleId`が本アプリ、`type = Auto-Renewable Subscription`、`productId`がPro商品(25.2節)であること → 違反は`422`
- `appAccountToken`がリクエストユーザーのidと一致すること → 違反は`403`(他人の購入の流用を防ぐ)
- 同じ購読(`originalTransactionId`)が別ユーザーに紐付いている場合 → `409 CONFLICT`

状態の決定(26章)：取消(`revocationDate`あり)または`expiresDate`経過 → `EXPIRED`、自動更新OFF → `CANCELED`、無料トライアルの導入オファー → `TRIAL`、それ以外 → `ACTIVE`。

**APIキー・秘密鍵はiOSアプリに含めない**。本APIはAppleの公開証明書のみで検証するため、App Store Connectの鍵も不要。

MVP対象外(HQ確定)：App Store Server APIによる照会、App Store Server Notifications、OCSPによる証明書失効確認。将来、Notificationsの`signedPayload`も同じ署名検証と保存処理(`apply_app_store_subscription`)を再利用できる構造にしてある(自動更新状態・解約・更新失敗・返金の追跡)。

## 25.2 Pro商品(v1.4で追加)

自動更新サブスクリプション。Subscription Group：`FX Event Analyzer Pro`(月額・年額は同一Group内の選択肢)。App Store Connectへの商品登録はHQが行う。

| 商品 | Product ID | 価格 |
|---|---|---|
| 月額 | `com.fumaono.fxeventanalyzer.pro.monthly` | ¥980/月 |
| 年額 | `com.fumaono.fxeventanalyzer.pro.yearly` | ¥9,800/年 |

---

# 26. Subscription Status Rule

CANCELEDは、「ユーザーが継続をキャンセルした状態」を表す。CANCELEDになってもexpires_atまでは有効なEntitlementを維持できる。EXPIREDになった時点で有効なPRO Entitlementを失う。TRIALは試用期間中の状態。

実際のEntitlement判定はSubscription statusだけではなく、EntitlementをSource of TruthとしてBackendで確認する。

---

# 27. Entitlement API

## GET /api/v1/entitlements

現在ユーザーが利用可能なFeatureを取得する。

MVP：VIEW_BASIC_EVENT / VIEW_HISTORICAL / VIEW_MARKET_REACTION / VIEW_ADVANCED_STATS

将来：AI_ANALYSIS / SPEECH_ANALYSIS / ALERT

EntitlementはPlan名ではなくFeature単位で管理する。

## 27.1 Endpoint × feature_code対応表(v1.2で確定、B-1・A-1)

Backend側の各Endpointが要求するEntitlementを以下の通り確定する。満たさない場合`403 FEATURE_NOT_ENTITLED`を返す。

| 対象 | Endpoint | 必要なfeature_code |
|---|---|---|
| Event Detail | `GET /events/{id}` | `VIEW_BASIC_EVENT` |
| **Event Revision(v1.2で追加)** | `GET /events/{id}/revisions` | **Authentication Required / Entitlementなし** |
| Historical Comparison(Basic Statistics) | `GET /indicators/{id}/comparison`の`stats` | `VIEW_HISTORICAL` |
| Historical Comparison(Advanced Statistics) | `GET /indicators/{id}/comparison`の`advanced_statistics` | `VIEW_ADVANCED_STATS`(21.3節参照。403にはせず`available:false`で表現) |
| Market Reaction | `GET /events/{id}/reaction`、`GET /events/{id}/reaction/chart` | `VIEW_MARKET_REACTION` |
| Historical Event Detail | `GET /events/{id}/history` | `VIEW_HISTORICAL` |

Home / Indicators / Indicator Detail / Search / Account / Subscription / Entitlement APIは、認証済みであれば全ユーザーがアクセス可能とし、特定feature_codeを要求しない。

**Event Revision APIについて(HQ確定、v1.2)**: `GET /events/{id}/revisions`はMVPではEntitlement制限を設けない。認証済みユーザーであれば取得可能とする。理由: Revisionは課金対象となる高度分析そのものではなく、イベントデータの履歴・事実情報であるため。

**Advanced Statisticsについて(HQ確定、v1.2)**: `GET /indicators/{id}/comparison`自体を403にするのではなく、`VIEW_HISTORICAL`を持つユーザーには常に`stats`(Basic Statistics)を返し、`advanced_statistics`は`VIEW_ADVANCED_STATS`の有無に応じて`available`/`required_entitlement`/`data`の3フィールドで利用可否を明示する(21.3節参照)。

---

# 28. MVP Entitlement

現在のMVP設計：

FREE：VIEW_BASIC_EVENT / VIEW_HISTORICAL / VIEW_MARKET_REACTION

PRO：VIEW_BASIC_EVENT / VIEW_HISTORICAL / VIEW_MARKET_REACTION / VIEW_ADVANCED_STATS

~~ただし価格・正式な課金条件はBeta前に最終決定する。実際のStoreKit購入・更新・キャンセル・Receipt検証はBeta時期に実装する。~~ (v1.4で確定: 価格・商品は25.2節、購入検証は25.1節)

PRO Entitlementの付与(v1.4): `POST /subscription/verify`の保存時に、FREEとの差分である`VIEW_ADVANCED_STATS`の`entitlements`行を、購読が有効(ACTIVE / TRIAL / 期限内CANCELED)なら`enabled = true`・`expires_at = 購読のexpires_at`、EXPIREDなら`enabled = false`で更新する。

重要：課金制御をiOS側だけに依存しない。Backend側でもEntitlementを確認する(27.1節)。

---

# 29. Authentication

認証処理はSupabase Authを利用する。MVPでは独自Auth APIを作らない。Supabase Authで実施：Sign Up / Login / Logout / Password Reset / Token Refresh

Backend APIはSupabase JWTを検証する。

---

# 30. APIと画面の対応

| Screen | API |
|---|---|
| SCR-010 Login(v1.3で追加、L-5) | なし(Supabase Auth SDKを直接利用、Backend API Endpointを使用しない。29章参照) |
| SCR-001 Home | GET /home |
| SCR-002 Indicators | GET /indicators |
| SCR-003 Indicator Detail | GET /indicators/{id} |
| SCR-003 Indicator Events | GET /indicators/{id}/events |
| SCR-003 Related FX Pairs | GET /indicators/{id}/fx-pairs |
| SCR-004 Event Detail | GET /events/{id} |
| SCR-004 Revision履歴 | GET /events/{id}/revisions(v1.1で追加) |
| SCR-005 Movement Detail | GET /events/{id}/reaction |
| SCR-005 Chart | GET /events/{id}/reaction/chart |
| SCR-006 Historical Comparison | GET /indicators/{id}/comparison |
| SCR-007 Historical Event Detail | GET /events/{id}/history |
| SCR-008 Search | GET /search |
| SCR-009 Settings | GET /account |
| SCR-009 Subscription | GET /subscription |
| SCR-009 Entitlements | GET /entitlements |
| SCR-011 Account | GET /account |
| SCR-011 Account Update | PATCH /account |
| SCR-018 通知設定(v1.4で追加) | GET /settings、PATCH /settings |
| SCR-019 プラン・購読管理(v1.4で追加) | GET /subscription、POST /subscription/verify |
| SCR-020 表示・地域設定(v1.4で追加) | GET /settings、PATCH /settings |
| SCR-021 チャート設定(v1.4で追加) | GET /settings、PATCH /settings |
| SCR-022〜025 ヘルプ・規約・プライバシー・アプリ情報(v1.4で追加) | なし |
| SCR-026 アカウント削除(v1.4で追加) | DELETE /account |

---

# 31. APIとDBの責務

APIはDBの内部構造をそのまま公開しない。

DB Entity：EconomicIndicator / EconomicEvent / EventRevision / EventSnapshot / EventExplanation / IndicatorFxPair / FxPair / FxPrice / EventPriceReaction / Profile / Subscription / Entitlement / IngestionLog

APIでは画面・機能単位のDTOを返す。DBの内部カラム・内部ID・監査情報などを必要以上に公開しない。

---

# 32. Data Ingestion APIについて

外部Providerからのデータ取得・保存は、公開Client APIとは分離する。

```
External Provider
↓
Scheduler
↓
Queue
↓
Ingestion Worker
↓
Database
↓
Backend API
↓
iOS
```

MVPでは外部Provider向けのIngestion APIをクライアント公開APIとして設計しない。Worker / Service LayerからDBへ保存する。IngestionLogはClient APIから直接操作しない。

---

# 33. Provider Abstraction

外部データProviderへの依存をAPI内部に直接埋め込まない。Provider Adapterを設ける。

## EconomicDataProvider

getUpcomingEvents() / getHistoricalEvents() / getEventSnapshot()

## FXPriceDataProvider

getPrices() / getIntradayPrices()

将来的にProvider変更・追加が可能な構造とする。Provider固有のResponse形式をiOSへ直接返さない。

---

# 34. Caching

MVPではRedisを導入しない。基本方針：

### Cache可能

Indicator / FX Pair

### 短時間Cache

Historical Comparison

### 長時間Cacheしない

Home / Released Event / Event Reaction

Market dataは鮮度を優先する。Cacheを利用する場合でも、Data Qualityや最新値の整合性を壊さないこと。

---

# 35. Rate Limit

MVPの初期値として、通常API：60 requests / minute / user、Search：30 requests / minute / user を基準とする。

超過時：HTTP 429

Rate Limit値は将来的に実測値に基づいて調整可能とする。

---

# 36. API Versioning

VersionをURLに含める。`/api/v1`

Breaking Changeが発生する場合は`/api/v2`を作成する。既存v1を破壊的に変更しない。

---

# 37. Security

最低限以下を実施する。

- JWT検証
- Backend Authorization
- Supabase RLS
- Rate Limit
- Request Validation
- SQL Injection対策
- 外部Provider情報の必要以上の露出禁止
- DB内部情報の直接公開禁止
- ユーザー固有データへのアクセス制御
- IDOR対策
- 不正なPagination / Filter値の拒否

ユーザー固有データは必ず認証ユーザー本人のものだけを取得できるようにする。

---

# 38. Future Extension

MVPでは実装しないが、以下を追加できる構造とする。

AI Analysis / Speech Analysis / Alert / Watchlist / Community / Web Analysis Dashboard / Advanced Statistics / 複数Data Provider / Additional FX Pairs / Additional Timeframes

ただし、将来機能をMVP APIに過剰に組み込まない。

---

# 39. MVP Scope

## MUST

Home API / Indicator API / Event API / Event Snapshot / Event Revision(v1.1でAPI化) / Event Explanation / Surprise / Event Reaction / Chart / Historical Event / Historical Comparison / Search / Account / Subscription / Entitlement / Authentication integration / Data Quality / Backend calculation / Provider abstraction

## FUTURE

AI Analysis / Speech Analysis / Alert / Watchlist / Community / Web Dashboard / Advanced notification / StoreKit purchase implementation / Advanced Search / Full Text Search

---

# 40. 非対応

以下は本プロダクトのAPIでは提供しない。

自動売買 / Broker Order / Price Prediction / Trading Signal / 自動投資判断 / Broker Account操作

---

# 41. 設計原則

FX Event AnalyzerのAPI設計では、「予想と結果、その結果による相場の反応を一画面で理解する」というプロダクト価値を最優先する。特に、

```
Economic Event
↓
Forecast
↓
Actual
↓
Surprise
↓
Market Reaction
↓
Historical Comparison
```

という分析フローがAPIによって自然に実現できることを重視する。また、以下を重要原則とする。

1. Release時点の情報をSnapshotで固定する
2. 改定情報はRevisionとして別管理する(v1.1で取得APIを新設)
3. Market ReactionはBackendをSource of Truthとする
4. Missing Dataを0として扱わない
5. iOS側に重要な計算ロジックを分散させない
6. Provider固有仕様をClient APIに露出させない
7. DB構造とAPI DTOを分離する
8. ユーザー固有データはBackend Authorization + RLSで保護する
9. MVPでは必要以上に複雑なMicroservice構成を採用しない
10. 将来のWeb / AI / Subscription拡張を阻害しない
11. **(v1.1で追加)** データが未準備の状態はHTTPエラーではなく200 OK + status fieldで表現する

---

# 42. 実装前レビュー

本API設計は、実装前に以下との整合性レビューを実施する。

```
Requirements
↓
Features
↓
Overview Design
↓
Screen Detailed Design
↓
DB Detailed Design
↓
API Detailed Design
```

レビューでは以下を確認する：APIの網羅性 / APIと画面の整合性 / APIとDBの整合性 / Request・Responseの妥当性 / Error設計 / Data Quality / Snapshot・Revision / Surprise計算 / Market Reaction計算 / Historical Statistics / Search / Authentication / Authorization / RLS / Subscription / Entitlement / Pagination / Rate Limit / Security / Performance / 将来拡張性

レビューで問題が発見された場合、ClaudeがHQ承認なしに仕様変更・実装を行ってはいけない。問題がある場合は「現在の仕様/問題点/影響範囲/修正案/修正理由」の形式で報告する。

API設計確定後に実装へ移行する。

---

# 43. 他ドキュメントへの変更候補(v1.2で新設)

本書の作成にあたり、要件定義書・概要設計書・DB詳細設計書は変更していない。以下は、本書の内容と既存ドキュメントとの間で修正が必要と考えられる箇所を、変更候補として報告するものである。

### 43.1 要件定義書5.2節「event_name」(A-6、**v1.3で解決**)

要件定義書v1.4 5.2節は`event_name`をイベントの必須管理項目として記載していたが、db-design.md(EconomicEvent/EventSnapshot)にはこれに相当するカラムが存在せず、本書23.1節でもEvent検索を`EconomicIndicator.name`/`code`基準とする設計にした。**全設計横断監査(A-6)でHQが正式に反映を指示し、要件定義書v1.5 5.2節を「Indicator基準のEvent管理・検索」に整合するよう修正済み。**

### 43.2 要件定義書9.1節・概要設計書8.1節「timezone」の扱い(**v1.3で解決**)

要件定義書・概要設計書は「DB内部はUTC、表示時にクライアント側でローカル変換」という原則を定めている。本書のHome等一部APIにおける「Requestでtimezoneを明示的に受け取る」運用(6章)は、**全設計横断監査(M-5)でHQが正式に反映を指示し、概要設計書v1.6 8.1節に追記済み。**

### 43.3 db-design.md「Search Index」(B-5、反映済み)

pg_trgm + GIN Indexの追加(23.2節)は、HQ指示に基づき**db-design.md側に既に反映済み**(db-design.md v4.1、本章とは別に実施)。ドキュメント上の追記のみで、DB Migrationは実施していない。

**本章に記載していた事項はすべて解決済みとなった(2026-09-16、全設計横断監査クリーンアップ)。**

---

# API詳細設計書 v1.4 END
