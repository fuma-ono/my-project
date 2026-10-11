# FX Event Analyzer: API詳細設計書 v1.19

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
- **v1.5**(2026-10-05): SCR-015 アカウント情報(HQ参考画像)の実装に伴い、`GET/PATCH /account`に`display_name`・`birth_date`を追加(24.1節・24.2節)
- **v1.6**(2026-10-05): SCR-016 通知設定の作り直しと要人発言(HQ指示 2026-10-05)
  - `GET/PATCH /settings`の`notifications`を新形状に変更(24.4節・24.5節)。通知は「保存のみ」から端末内ローカル通知へ
  - `GET /notifications/upcoming`を新設(24.6節)
  - `GET /speeches`・`GET /speeches/{speech_id}`を新設(14.4節・14.5節)。Error Code `SPEECH_NOT_FOUND`を追加
  - `GET /fx-pairs`を新設(13.5節)
- **v1.7**(2026-10-06): SCR-016 通知設定に「通知しない時間帯」を追加。`GET/PATCH /settings`の`notifications`に`quiet_hours_enabled`・`quiet_start`・`quiet_end`を追加し(24.4節・24.5節)、`GET /notifications/upcoming`で該当時間帯の通知を除外する(24.6節)
- **v1.8**(2026-10-06): SCR-017 プラン・購読管理の画面実装に合わせ、`GET /subscription`のResponseに`product_id`(月額・年額の商品)を追加(25章)
- **v1.9**(2026-10-06): SCR-018 表示・地域設定 / SCR-019 チャート設定(画面番号はui-screens.mdに合わせる。30章の表は旧番号SCR-020 / SCR-021のまま)の項目を追加。`GET/PATCH /settings`の`display`に`theme`・`text_size`・`date_format`・`time_format`・`currency`・`week_start`、`chart`に`chart_type`・`show_indicators`・`indicator_ma`・`indicator_bollinger`・`indicator_macd`・`indicator_rsi`・`indicator_stochastic`・`crosshair`・`price_line`を追加(24.4節・24.5節)
- **v1.10**(2026-10-06): SCR-020 ヘルプ・お問い合わせ(画面番号はui-screens.md)のSupport APIを追加。`POST /support/requests`・`GET /support/requests`を新設(24.7節・24.8節)。問い合わせ・フィードバックを保存し、ルールとテンプレートで自動返信する(LLMは使わない)。意味のない内容・迷惑な内容には返信しない。不具合の報告はBackendがGitHub Issueとして登録する。1ユーザー1時間あたり5件を超えると`429 RATE_LIMITED`(35章)。Backend環境変数`GITHUB_ISSUES_TOKEN`・`GITHUB_ISSUES_REPO`を追加(任意、サーバーのみ)
- **v1.11**(2026-10-07): レビュー指摘の修正。`POST /support/requests`の判定ルールを調整(NFKC正規化、丁寧語・短い日本語の扱い、相場の「落ちた」や否定表現を不具合にしない、画像共有URLは件数に数えない、禁止語の誤判定の削減)、送信回数の上限を保存と同時に判定する方式に変更(同時送信で上限を超えない)、GitHub Issueで削除する個人情報にカード番号・7桁以上の数字列を追加(24.7節)。`POST /subscription/verify`のResponseに`product_id`を追加し`GET /subscription`と同じ形にそろえた(25.1節)
- **v1.13**(2026-10-08): `GET /home`の`events`の各行に`unit`(指標の単位。`economic_indicators.unit`、未登録は`null`)を追加(12章)。ホームの「予想・前回」を単位付きで表示するため
- **v1.12**(2026-10-07): SCR-026 ホーム通貨ペア編集を追加。`GET/PATCH /settings`に`home.fx_pairs`(ホームに表示する通貨ペア。最大3件・配列の順 = 表示順、`null` = 既定)を追加(24.4節・24.5節)。`GET /home`の`major_fx`は`home.fx_pairs`の通貨ペアをその順で返し、未設定なら既定の`USDJPY`・`EURUSD`・`EURJPY`を返す(12章)。`major_fx`の各行の形は変えない
- **v1.14**(2026-10-08): SCR-010 経済カレンダー(画面番号はui-screens.md)のAPIを追加。`GET /calendar`を新設(14.6節)。期間内の経済指標イベントと要人発言を1つの一覧(`items`)にまとめ、日時の昇順で返す。期間は62日以内・Paginationなし。必要なfeature_codeは`VIEW_BASIC_EVENT`(27.1節)
- **v1.15**(2026-10-08): 無料プラン(FREE)と有料プラン(PRO)の利用上限(HQ決定 2026-10-08)を追加(28.1節)。`GET /entitlements`に`plan`・`limits`と`timezone` Queryを追加(27章)。`GET /calendar`に`timezone` Queryを追加し、プランの期間外は`403 PLAN_LIMIT_EXCEEDED`(PROなら見られる場合)/ `422 VALIDATION_ERROR`(どのプランでも見られない場合)にする(14.6節)。`PATCH /settings`で無料プランの通知の重要度・通貨ペアの上限を確認する(24.5節)。`GET /notifications/upcoming`は保存済みの設定に無料プランの上限を当てはめて絞り込む(24.6節)。`GET /indicators/{id}/comparison`は過去の発表回をプランの上限件数(直近から)に絞り、`history_limit`を返す(21章)。Error Code `PLAN_LIMIT_EXCEEDED`を追加(4章)
- **v1.16**(2026-10-09): SCR-006 指標詳細の再デザイン(HQ指示 2026-10-09)。`GET /indicators`・`GET /indicators/{id}`の`indicator`に`name_en`(英語名、未登録は`null`)と`key_points`(注目される理由の短文の配列、未登録は`[]`)を追加し、`description`(概要)は日本語1〜2文とした(13章)。`GET /calendar`の各行に`indicator_id`(`INDICATOR`はイベントの指標ID、`SPEECH`は`null`)を追加し、カレンダーから指標詳細を開けるようにした(14.6節)
- **v1.17**(2026-10-09): SCR-007 イベント詳細の再デザイン(HQ指示 2026-10-09)。`GET /events/{id}`に`major_fx_reactions`(主要通貨ペアの値動き。イベントの通貨を含む通貨ペア最大4件 × `1m`・`5m`・`15m`の`pips`・`change_percent`・`analysis_status`)を追加(14.1節)。`related_fx_pairs`は変えない。必要なfeature_codeは`related_fx_pairs[].reaction`と同じく`VIEW_BASIC_EVENT`のみ
- **v1.19**(2026-10-09): `GET /events/{event_id}/reaction/chart`の表示範囲を時間足ごとに(1m 前後15分・5m 前後60分・15m 前後3時間)。Responseに`window_from` / `window_to`を追加
- **v1.18**(2026-10-09): SCR-008 相場反応詳細の「一般的な見方」(HQ決定 2026-10-09)。`GET /indicators`・`GET /indicators/{id}`の`indicator`に`market_view_above`(結果が予想を上回ったときの一般的な見方)・`market_view_below`(下回ったとき)を追加(13.2節)。人が書いた日本語1文の定型文(AI生成ではない)で、未登録は`null`

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
- SPEECH_NOT_FOUND(v1.6で追加)
- SUBSCRIPTION_REQUIRED
- FEATURE_NOT_ENTITLED
- PLAN_LIMIT_EXCEEDED(v1.15で追加。403)

**`PLAN_LIMIT_EXCEEDED`(v1.15)**: 今のプランの利用上限(28.1節)を超えるが、上のプランなら使える場合に返す。`error`に`required_plan`(使えるプラン。MVPでは常に`"PRO"`)を追加する。どのプランでも使えない値は`422 VALIDATION_ERROR`にする。

```json
{
  "error": {
    "code": "PLAN_LIMIT_EXCEEDED",
    "message": "from: the FREE plan can go back to 2026-09-01T00:00:00Z (UTC).",
    "required_plan": "PRO"
  }
}
```

**(v1.1で変更、A-7)**: `DATA_PENDING`/`DATA_UNAVAILABLE`/`ANALYSIS_NOT_AVAILABLE`をError Codeから削除した。これらは「Resourceは存在するがデータがまだ準備できていない状態」であり、HTTPエラーとしては扱わない。**HTTP 200 + Response Body内のstatus field(`data_status`/`analysis_status`等)で表現する。** 詳細は7章参照。

HTTPエラーとして扱うのは以下のケースに限定する:

- Resource不存在(`EVENT_NOT_FOUND`等)
- Authentication failure(`UNAUTHORIZED`)
- Authorization failure(`FORBIDDEN`, `SUBSCRIPTION_REQUIRED`, `FEATURE_NOT_ENTITLED`, `PLAN_LIMIT_EXCEEDED`)
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
- unit(v1.13で追加。指標の単位、例: `%`・`千人`。未登録は`null`)
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

**major_fxの通貨ペアと順序(v1.12で追加、SCR-026 ホーム通貨ペア編集)**: 最大3件。

- ユーザーの`settings.home.fx_pairs`(24.4節)が設定済み：その通貨ペアを**保存した順**で返す。保存後に無効になった通貨ペアは除く(1件も残らない場合は既定と同じ)
- 未設定(`null`、または設定の行がない)：既定の`USDJPY` → `EURUSD` → `EURJPY`。既定の通貨ペアが無効な場合は、残りの有効な通貨ペアを`symbol`順で足して3件まで
- 各行の形(`fx_pair_id` / `symbol` / `price` / `change` / `change_percent` / `timestamp`)は従来と同じ。価格データのない通貨ペアは`price`等が`null`
- 価格を取得するのは表示する通貨ペア(最大3件)だけ。v1.11までは有効な通貨ペアをすべて返していた

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

**indicatorオブジェクトの項目(v1.16で`name_en`・`key_points`、v1.18で`market_view_above`・`market_view_below`を追加)**: 13.1の一覧の各行と13.2の`indicator`は同じ形：

```json
{
  "id": "10000000-0000-0000-0000-000000000001",
  "code": "US_CPI",
  "name": "米国CPI(消費者物価指数)",
  "name_en": "Consumer Price Index",
  "country_code": "US",
  "currency_code": "USD",
  "importance": "HIGH",
  "description": "消費者物価指数（CPI）は、消費者が購入するモノやサービスの価格の変動を測定する指標です。インフレの動向を示す重要な指標であり、金融政策の判断材料として注目されます。",
  "key_points": ["インフレの動向を把握できる", "金融政策への影響が大きい", "為替や株式市場に大きな影響を与える"],
  "frequency": "MONTHLY",
  "unit": "%",
  "source": "U.S. Bureau of Labor Statistics",
  "source_url": null,
  "favorable_direction": "HIGHER_IS_POSITIVE",
  "market_view_above": "米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。",
  "market_view_below": "米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。"
}
```

- `name_en`(v1.16)：指標の英語名(`economic_indicators.name_en`)。SCR-006で日本語名の下に表示する。未登録は`null`
- `description`：SCR-006の「概要」。日本語1〜2文(v1.16でseedを日本語化)。未登録は`null`
- `key_points`(v1.16)：SCR-006の「注目される理由」。日本語の短文の配列(2〜4件程度、DB上の上限6件)、配列順 = 表示順。**未登録(DBの`NULL`)は`[]`で返し、`null`にはしない**
- `market_view_above` / `market_view_below`(v1.18)：一般的な見方。SCR-008で結果と予想の差に応じて表示(結果が予想を上回ったら`market_view_above`、下回ったら`market_view_below`)。実際の値動きの原因と断定する表示はしない。人が書いた日本語1文(200文字以内、AI生成ではない)。未登録は`null`(画面側で項目を出さない)

## 13.3 GET /api/v1/indicators/{indicator_id}/events

指定Indicatorの過去・未来Event一覧を取得する。

Query：from / to / status / page / limit / sort

fromはinclusive。toはexclusive。

## 13.4 GET /api/v1/indicators/{indicator_id}/fx-pairs

指定Indicatorに関連するFX Pair一覧を取得する。IndicatorとFX Pairは、IndicatorFxPairによるMany-to-Many関係とする。

Response：fx_pair_id / symbol / priority / is_active

priorityの小さいものを優先対象とする。

## 13.5 GET /api/v1/fx-pairs(v1.6で追加)

有効な通貨ペアのマスタ一覧を返す(SCR-016「対象通貨ペア」・SCR-026 ホーム通貨ペア編集(v1.12)の選択肢)。認証済みであればfeature_code不要(Indicatorsと同じ扱い)。Paginationなし、`symbol`昇順。

```json
{
  "data": [
    { "fx_pair_id": "20000000-0000-0000-0000-000000000001", "symbol": "USDJPY", "base_currency": "USD", "quote_currency": "JPY" }
  ]
}
```

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
  "major_fx_reactions": [
    {
      "fx_pair_id": "xxx",
      "symbol": "USDJPY",
      "reactions": [
        { "timeframe": "1m", "pips": -8.2, "change_percent": -0.0551, "analysis_status": "READY" },
        { "timeframe": "5m", "pips": -24.5, "change_percent": -0.1646, "analysis_status": "READY" },
        { "timeframe": "15m", "pips": -41.3, "change_percent": -0.2775, "analysis_status": "READY" }
      ]
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

**`major_fx_reactions`(v1.17で追加)**: SCR-007「主要通貨ペアの値動き(pips)」の表。行 = 通貨ペア、列 = `1m`・`5m`・`15m`。「通貨ペアを選択して詳細を見る」で選んだ行の`fx_pair_id`・`symbol`でSCR-008 相場反応詳細(18章)を開く。

- 対象の通貨ペア：有効な(`is_active`)通貨ペアのうち、基軸通貨または決済通貨がイベントの通貨(`currency_code`)と同じもの。最大4件
- 並び順：指標の`related_fx_pairs`に含まれるペアを`priority`順で先に、残りは固定の主要順(`USDJPY`・`EURUSD`・`GBPUSD`・`AUDUSD`・`USDCHF`・`USDCAD`・`EURJPY`・`GBPJPY`・`AUDJPY`・`CADJPY`)、それ以外は`symbol`順
- イベントの通貨を含む通貨ペアが1件もない場合は、`related_fx_pairs`の通貨ペア(`priority`順、最大4件)を返す。どちらもなければ`[]`
- `reactions`は常に`1m`・`5m`・`15m`の3件(この順)。値は`event_price_reactions`の保存値で、14.2節の`reaction`・18章と同じ(10章の計算式)。発表前・価格データがないときは`pips`・`change_percent`が`null`で`analysis_status`が`DATA_PENDING`。`release_datetime_precision`で対象外のtimeframe(11.1節)は`NOT_ANALYZABLE`
- feature_code：`related_fx_pairs[].reaction`と同じく`VIEW_BASIC_EVENT`のみ(`VIEW_MARKET_REACTION`は不要)。SCR-008で使う`GET /events/{id}/reaction`は従来どおり`VIEW_MARKET_REACTION`が必要

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

## 14.4 GET /api/v1/speeches(v1.6で追加)

要人発言の一覧(HQ指示 2026-10-05)。必要なfeature_code：`VIEW_BASIC_EVENT`。

Query：`from` / `to`(ISO 8601。fromはinclusive、toはexclusive) / `importance`(`LOW` / `MEDIUM` / `HIGH`) / `currency`(発言者の通貨、ISO 4217の英大文字3桁) / `page` / `limit`。`statement_datetime`降順。

Response：`{ "data": SpeechSummary[], "meta": { page, limit, total, has_next } }`

```json
{
  "speech_id": "50000000-0000-0000-0000-000000000001",
  "speaker": {
    "speaker_id": "40000000-0000-0000-0000-000000000001",
    "name": "ジェローム・パウエル",
    "title": "FRB議長",
    "organization": "FRB",
    "country_code": "US",
    "currency_code": "USD"
  },
  "title": "FOMC後の記者会見",
  "summary": "政策金利の据え置きを説明し、今後の判断はデータ次第との認識を示した。",
  "statement_datetime": "2026-09-17T18:30:00+00:00",
  "importance": "HIGH",
  "status": "DELIVERED"
}
```

- `summary`：出典に基づく事実の要約。未発言・未作成は`null`
- `status`：`SCHEDULED` / `DELIVERED` / `CANCELLED`

## 14.5 GET /api/v1/speeches/{speech_id}(v1.6で追加)

要人発言1件(SpeechSummary、14.4節と同じ形)。`speech_id`がUUID形式でなければ`422 VALIDATION_ERROR`、存在しなければ`404 SPEECH_NOT_FOUND`。必要なfeature_code：`VIEW_BASIC_EVENT`。

## 14.6 GET /api/v1/calendar(v1.14で追加)

SCR-010 経済カレンダー(画面番号はui-screens.md)。期間内の経済指標イベントと要人発言を1つの一覧で返す。iOSは月のマス目(日ごとに重要度の色の点)と、選んだ日の一覧(時刻順)の両方をこのResponseから作る。必要なfeature_code：`VIEW_BASIC_EVENT`。

Query：
- `from` / `to`(必須。ISO 8601。fromはinclusive、toはexclusive)。`to`が`from`以前、または期間が62日を超える場合は`422 VALIDATION_ERROR`
- `importance`(任意。`LOW` / `MEDIUM` / `HIGH`。1つだけ指定。14.4節と同じ)
- `currency`(任意。ISO 4217の英大文字3桁。指標は指標の通貨、要人発言は発言者の通貨で絞り込む)
- `timezone`(任意、v1.15。IANA名。既定`UTC`)。プランの期間の上限(下記)を計算するタイムゾーン。`from` / `to`の解釈は変えない。解決できない名前は`422 VALIDATION_ERROR`

プランの期間の上限(v1.15、28.1節)。62日以内の確認の後に判定する：

- `from`が`limits.calendar_earliest_from`(27章。FREEは先月1日 00:00、PROは5年前の1月1日 00:00。いずれも`timezone`の現地時刻)より前：PROなら見られる場合は`403 PLAN_LIMIT_EXCEEDED`(`required_plan: "PRO"`)、PROでも見られない場合は`422 VALIDATION_ERROR`
- `to`が`limits.calendar_latest_to`(両プラン共通。2年後の1月1日 00:00 = 来年末まで)より後：`422 VALIDATION_ERROR`(PROでも変わらないため)
- 境界ちょうど(`from` = `calendar_earliest_from`、`to` = `calendar_latest_to`)は許可する

Paginationなし(期間の上限で件数を抑える)。

Response：`{ "from": string, "to": string, "items": CalendarItem[] }`(`from` / `to`はRequestの値をそのまま返す)

```json
{
  "kind": "INDICATOR",
  "id": "30000000-0000-0000-0000-000000000003",
  "indicator_id": "10000000-0000-0000-0000-000000000002",
  "title": "米国雇用統計(非農業部門雇用者数)",
  "speaker_name": null,
  "country_code": "US",
  "currency_code": "USD",
  "importance": "HIGH",
  "datetime": "2026-10-08T12:30:00+00:00",
  "datetime_precision": "EXACT",
  "status": "SCHEDULED"
}
```

- `kind`：`INDICATOR`(経済指標イベント)/ `SPEECH`(要人発言)
- `id`：`INDICATOR`は`event_id`(14.1節で詳細を取得)、`SPEECH`は`speech_id`(14.5節で詳細を取得)
- `indicator_id`(v1.16)：`INDICATOR`はイベントの指標ID(13.2節で指標詳細 SCR-006 を取得)、`SPEECH`は常に`null`
- `title`：`INDICATOR`は指標名、`SPEECH`は発言の題名(`speech_events.title`)。`GET /notifications/upcoming`(24.6節)と同じ付け方
- `speaker_name`：`SPEECH`だけ。発言者の表示名。`INDICATOR`は`null`
- `country_code` / `currency_code`：`INDICATOR`は指標の値、`SPEECH`は発言者の値
- `datetime`：`INDICATOR`は`release_datetime`、`SPEECH`は`statement_datetime`
- `datetime_precision`：`INDICATOR`は`release_datetime_precision`(6章)、`SPEECH`は常に`EXACT`
- `status`：`INDICATOR`はイベントの`status`(`SCHEDULED` / `RELEASED` / `CANCELLED`)、`SPEECH`は発言の`status`(`SCHEDULED` / `DELIVERED`)。**`CANCELLED`の要人発言は返さない**
- 並び順：`datetime`昇順 → 同時刻は`INDICATOR`が先 → `id`昇順

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

Chart Window(v1.19で時間足ごとに変更、HQ指示 2026-10-09)：発表時刻を基準に、`1m`は前後15分(初動)、`5m`は前後60分(短期の流れ)、`15m`は前後3時間(全体の流れ)。それ以外の`timeframe`は従来どおりRelease前30分 + Release後60分。Responseに`window_from` / `window_to`(表示範囲、ISO 8601)を含め、Clientはこの範囲で横軸を描く。データが存在する範囲だけ`prices`に入り、足りない分を補った架空の足は返さない

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

**過去の発表回の上限(v1.15、28.1節)**: 使う過去の発表回(`RELEASED`)は、直近から`history_events_max`件(FREE 5件・PRO 20件)だけ。`stats` / `stats_by_timeframe`・`total_events`・`analyzable_events`・`events`・`meta.total`はすべてこの件数の中で数える(上限より後のページは`events: []`)。Responseに`history_limit`を追加する(timeframe単一指定・`all`の両方)：

```json
{
  "history_limit": { "applied": 5, "max_for_plan": 5, "pro_max": 20 }
}
```

- `applied`：実際に使った過去の発表回の件数(= min(発表済みの件数, `max_for_plan`))
- `max_for_plan`：呼び出しユーザーのプランの上限
- `pro_max`：PROの上限(「PROなら20回分」の表示用)

`GET /events/{event_id}/history`(20章)は1回分の発表を返すAPIで、過去の発表回の一覧を使わないため、上限の対象外(変更なし)。

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
- display_name(v1.5で追加。未設定は`null`)
- birth_date(v1.5で追加。`YYYY-MM-DD`の暦日、タイムゾーンなし。未設定は`null`)
- created_at
- updated_at

ProfileはSupabase Authのユーザー作成時には作られないため、GET/PATCHとも先にProfileを作成(既存なら何もしない)してから処理する。

**(v1.1で変更、A-4)**: `timezone`をResponseから削除した。timezoneはProfileに永続化せず、必要なEndpoint(Home等)でRequestごとに明示的に受け取る方式に変更したため(6章参照)。

## 24.2 PATCH /api/v1/account

Account情報を更新する。

Body(v1.5、いずれも省略可・送ったフィールドのみ更新。未知のフィールドは`422 VALIDATION_ERROR`):

- display_name: 1〜200文字(前後の空白は除去)、または`null`で未設定に戻す
- birth_date: `YYYY-MM-DD`の実在する日付で1900-01-01〜今日(UTC)、または`null`

Responseは24.1節と同じ形。

**(v1.1で変更、A-4)**: `timezone`の更新機能を削除した。Account APIはDBの`Profile`テーブルに実在するカラムのみを更新対象とする。

Email / PasswordはSupabase Auth側で管理する。Backend APIから直接Auth情報を変更しない。

## 24.3 DELETE /api/v1/account(v1.4で追加)

ログイン中のユーザーを**物理削除**する(SCR-026、HQ確定 2026-10-02)。

- Supabase Authのユーザー(`auth.users`)をAdmin APIで削除し、`profiles`以下(`subscriptions` / `entitlements` / `user_settings`)はFKのON DELETE CASCADEで同時に削除される(db-design.md §7)
- Response：`204 No Content`
- App Storeの自動更新サブスクリプションはAppleが管理するため本APIでは解約されない。iOS側の削除画面で、事前にApp Storeで解約するよう案内する
- 削除後、iOSはローカルのセッションを破棄してサインアウトする

## 24.4 GET /api/v1/settings(v1.4で追加)

ユーザー設定を取得する(SCR-016 通知設定 / SCR-018 表示・地域設定 / SCR-019 チャート設定。30章の表では旧番号SCR-020 / SCR-021)。初回アクセス時はDBの既定値で行を作成して返す。

```json
{
  "notifications": {
    "push": true,
    "indicators": true,
    "speeches": true,
    "fx_pairs": null,
    "importances": ["HIGH", "MEDIUM"],
    "lead_minutes": 5,
    "quiet_hours_enabled": false,
    "quiet_start": "23:00",
    "quiet_end": "07:00"
  },
  "display": {
    "language": "ja",
    "region": "JP",
    "timezone": "Asia/Tokyo",
    "theme": "SYSTEM",
    "text_size": "STANDARD",
    "date_format": "YYYY/MM/DD",
    "time_format": "24H",
    "currency": "JPY",
    "week_start": "MONDAY"
  },
  "chart": {
    "default_fx_pair_symbol": null,
    "default_timeframe": "5m",
    "chart_type": "CANDLE",
    "show_indicators": true,
    "indicator_ma": true,
    "indicator_bollinger": false,
    "indicator_macd": true,
    "indicator_rsi": false,
    "indicator_stochastic": false,
    "crosshair": true,
    "price_line": true
  },
  "home": {
    "fx_pairs": null
  },
  "updated_at": "2026-10-02T00:00:00Z"
}
```

- `notifications`(v1.6で全面変更、SCR-016 通知設定、HQ指示 2026-10-05)：iOSは本設定に基づく24.6節の結果から**端末内のローカル通知**を予約する。旧方針「MVPは通知対象の保存のみ・Push送信なし」(HQ確定 2026-10-02)は本指示で置き換え。Backendからのリモートpush送信・デバイストークン管理は引き続き行わない
  - `push`：プッシュ通知(全体のON/OFF)。`false`なら他の項目に関わらず通知しない
  - `indicators`：重要な経済指標の通知 / `speeches`：要人発言の通知
  - `fx_pairs`：対象通貨ペア(`fx_pairs.symbol`の配列)。`null` = すべての通貨ペア
  - `importances`：通知する重要度(`HIGH` / `MEDIUM` / `LOW`の1件以上)。Responseは常に`HIGH`→`MEDIUM`→`LOW`の順
  - `lead_minutes`：通知タイミング。`0`(発表時) / `5` / `10` / `15` / `30` / `60`(分前)
  - `quiet_hours_enabled` / `quiet_start` / `quiet_end`(v1.7で追加)：通知しない時間帯。既定はOFF・`23:00`〜`07:00`。時刻は`"HH:MM"`(24時間制、`00:00`〜`23:59`)で、`display.timezone`の現地時刻として扱う。`quiet_start`を含み`quiet_end`を含まない`[quiet_start, quiet_end)`。`quiet_end < quiet_start`は日付をまたぐ(既定の23:00〜07:00)。`quiet_start = quiet_end`は抑止なし。適用は24.6節
  - 旧フィールド`pre_release` / `result` / `favorites` / `min_importance`は削除(既存値の移行はdb-design.md §3.14)
- `display.language`：`ja` / `en`、`display.region`：ISO 3166-1 alpha-2、`display.timezone`：IANA timezone名。Home等のRequestに渡すtimezoneの既定値としてiOSが利用する(6章の「Requestで明示的に受け取る」方針は変更しない)
- `display`の表示項目(v1.9で追加、SCR-018 表示・地域設定)。値は以下の列挙のみ(大文字小文字も一致)
  - `theme`：テーマ。`SYSTEM`(端末の設定に従う) / `DARK` / `LIGHT`。既定は`SYSTEM`
  - `text_size`：文字サイズ。`SMALL` / `STANDARD` / `LARGE`。既定は`STANDARD`
  - `date_format`：日付の表示形式。`YYYY/MM/DD` / `YYYY-MM-DD` / `MM/DD/YYYY` / `YYYY年M月D日`。既定は`YYYY/MM/DD`
  - `time_format`：時刻の表示形式。`24H`(24時間制) / `12H`(12時間制)。既定は`24H`
  - `currency`：表示通貨。`JPY` / `USD` / `EUR` / `GBP` / `AUD` / `CAD` / `CHF` / `NZD`。既定は`JPY`
  - `week_start`：週の始まり。`SUNDAY` / `MONDAY`。既定は`MONDAY`
  - いずれもiOSの表示に使う設定値で、Backendの他APIのResponse(日時はISO 8601のまま等)は変えない
- `chart.default_fx_pair_symbol`：`fx_pairs.symbol`または`null`、`chart.default_timeframe`：`1m` / `5m` / `15m` / `30m` / `60m`
- `chart`の表示項目(v1.9で追加、SCR-019 チャート設定)
  - `chart_type`：チャートの種類。`CANDLE`(ローソク足) / `LINE`(ライン) / `BAR`(バー)。既定は`CANDLE`
  - `show_indicators`：テクニカル指標を表示するか(全体のON/OFF)。既定は`true`。`false`なら`indicator_*`の値に関わらず表示しない(`indicator_*`の値は保持する)
  - `indicator_ma`(移動平均線、既定`true`) / `indicator_bollinger`(ボリンジャーバンド、既定`false`) / `indicator_macd`(MACD、既定`true`) / `indicator_rsi`(RSI、既定`false`) / `indicator_stochastic`(ストキャスティクス、既定`false`)：各テクニカル指標の表示
  - `crosshair`：クロスヘア(十字カーソル)の表示。既定は`true`
  - `price_line`：現在値ラインの表示。既定は`true`
- `home`(v1.12で追加、SCR-026 ホーム通貨ペア編集)
  - `fx_pairs`：ホームの主要通貨ペア欄に表示する通貨ペア(`fx_pairs.symbol`の配列、1〜3件)。配列の順 = 表示順。`null` = 既定(`USDJPY`・`EURUSD`・`EURJPY`の順)。設定例：`{ "fx_pairs": ["USDJPY", "EURUSD", "EURJPY"] }`。`GET /home`での使い方は12章
  - 選択肢は13.5節`GET /fx-pairs`の一覧

## 24.5 PATCH /api/v1/settings(v1.4で追加)

ユーザー設定を部分更新する。Bodyは24.4節と同じ構造で、**送ったフィールドのみ**更新する。未知のフィールドは`422 VALIDATION_ERROR`。存在しない`default_fx_pair_symbol`も`422`。Responseは更新後の24.4節と同じ形。

`notifications`のValidation(v1.6)。違反はいずれも`422 VALIDATION_ERROR`：

- `importances`：1件以上。重複は除去して保存する
- `fx_pairs`：`null`、または1件以上・重複なしの配列。`fx_pairs`テーブルに存在しない(または無効な)symbolを含む場合は`422`
- `lead_minutes`：`0` / `5` / `10` / `15` / `30` / `60`以外は`422`
- `quiet_hours_enabled`：真偽値のみ(v1.7)
- `quiet_start` / `quiet_end`：`"HH:MM"`(`00:00`〜`23:59`、時・分とも2桁)以外は`422`。`"7:00"`・`"24:00"`・秒付き`"23:00:00"`も`422`。`quiet_start = quiet_end`は許容する(抑止なし)(v1.7)

`display` / `chart`のValidation(v1.9)。違反はいずれも`422 VALIDATION_ERROR`で、Body全体を保存しない：

- `display.theme` / `text_size` / `date_format` / `time_format` / `currency` / `week_start`、`chart.chart_type`：24.4節の列挙以外は`422`。小文字(`"dark"`・`"24h"`等)や`null`も`422`
- `chart.show_indicators` / `indicator_ma` / `indicator_bollinger` / `indicator_macd` / `indicator_rsi` / `indicator_stochastic` / `crosshair` / `price_line`：真偽値のみ。`"true"`・`1`・`null`は`422`

`home`のValidation(v1.12)。違反はいずれも`422 VALIDATION_ERROR`で、Body全体を保存しない：

- `home.fx_pairs`：`null`、または1〜3件・重複なしの配列。空配列・4件以上・重複は`422`。`fx_pairs`テーブルに存在しない(または無効な)symbolを含む場合も`422`(`notifications.fx_pairs`と同じ確認)
- `home: { "fx_pairs": null }`で既定に戻す。`home`を送らない場合は保存済みの値を変えない

プランの上限(v1.15、28.1節)。上記のValidation(`422`)の後に判定し、違反は`403 PLAN_LIMIT_EXCEEDED`(`required_plan: "PRO"`)で、Body全体を保存しない。**送ったフィールドだけ**確認する(保存済みの値が上限より広くても、送らなければエラーにしない)。PROは制限なし：

- FREEの`notifications.importances`：`["HIGH"]`のみ。`MEDIUM` / `LOW`を含むと`403`
- FREEの`notifications.fx_pairs`：1件の配列のみ。`null`(すべての通貨ペア)・2件以上は`403`

## 24.6 GET /api/v1/notifications/upcoming(v1.6で追加)

ローカル通知の予約対象を返す(SCR-016、HQ指示 2026-10-05)。呼び出しユーザーの保存済み設定(24.4節)で絞り込む。必要なfeature_code：`VIEW_BASIC_EVENT`。

Query：

- `from`(任意、ISO 8601。既定: 現在時刻)
- `to`(任意、ISO 8601。既定: `from` + 7日)
- `to <= from`、または期間が14日を超える場合は`422 VALIDATION_ERROR`

Response：

```json
{
  "lead_minutes": 5,
  "items": [
    {
      "kind": "SPEECH",
      "id": "50000000-0000-0000-0000-000000000004",
      "title": "経済見通しに関する講演",
      "speaker_name": "ジェローム・パウエル",
      "importance": "HIGH",
      "scheduled_at": "2026-10-14T16:00:00Z",
      "notify_at": "2026-10-14T15:55:00Z",
      "country_code": "US",
      "currency_code": "USD",
      "related_fx_pairs": ["EURUSD", "USDJPY"]
    }
  ]
}
```

- `kind`：`INDICATOR`(`id` = `economic_events.id`、`title` = 指標名) / `SPEECH`(`id` = `speech_events.id`、`title` = 発言タイトル)
- `speaker_name`：SPEECHのみ。INDICATORは`null`
- `scheduled_at`：`release_datetime` / `statement_datetime`。`notify_at` = `scheduled_at` − `lead_minutes`。いずれも秒精度のUTC(`Z`、小数秒なし)
- `related_fx_pairs`：INDICATOR = `indicator_fx_pairs`のsymbol(priority順)、SPEECH = 発言者の通貨をbaseまたはquoteに含む有効な`fx_pairs`のsymbol(symbol順)

抽出ルール(Backend実装: `src/domain/notifications.ts`)：

1. `push = false`なら`items`は空
2. `indicators = true`なら経済指標、`speeches = true`なら要人発言を対象にする
3. `status = SCHEDULED`のみ。経済指標は`release_datetime_precision = EXACT`のみ(時刻が確定していないものは「N分前」を決められないため)
4. `importance`が`importances`に含まれること
5. `fx_pairs`が`null`でなければ、`related_fx_pairs`と1件以上共通すること
6. `notify_at >= from`かつ`scheduled_at <= to`
7. `quiet_hours_enabled = true`なら、`notify_at`を`display.timezone`(IANA名。解決できない場合は`Asia/Tokyo`)の現地時刻に直した値が`[quiet_start, quiet_end)`に入る項目を除外する(v1.7)。判定は`scheduled_at`ではなく`notify_at`で行う。`quiet_start = quiet_end`なら除外しない
8. `notify_at`昇順、最大60件(iOSのローカル通知予約上限64件に余裕を持たせる)。上限は上記の除外後に適用する

プランの上限(v1.15、28.1節)。4・5の判定の前に、保存済みの`importances` / `fx_pairs`へ呼び出し時点のプランの上限を当てはめる(PROの間に保存した広い設定が、FREEに戻った後も効かないようにするため。保存済みの値は書き換えない)：

- FREEの`importances`：`HIGH`だけ残す。`HIGH`を含まない場合は`["HIGH"]`として扱う
- FREEの`fx_pairs`：保存済みの先頭1件だけ使う。`null`(すべての通貨ペア)は`["USDJPY"]`として扱う
- PROは保存済みの値をそのまま使う

## 24.7 POST /api/v1/support/requests(v1.10で追加)

お問い合わせ・フィードバックを送信する(SCR-020 ヘルプ・お問い合わせ)。認証済みであれば全ユーザーが利用でき、特定feature_codeを要求しない。送信内容はすべて`support_requests`(db-design.md §3.17)に保存し、ルールとテンプレートで自動返信する(LLMは使わない。Backend実装: `src/domain/support.ts`)。

Request：

```json
{
  "kind": "INQUIRY",
  "category": "NOTIFICATION",
  "body": "通知が届く時間を変更できますか?",
  "app_version": "1.0.0",
  "os_version": "iOS 18.0",
  "device_model": "iPhone16,1"
}
```

- `kind`(必須)：`INQUIRY`(お問い合わせ) / `FEEDBACK`(ご意見・ご要望)
- `category`(必須)：`ACCOUNT` / `BILLING` / `NOTIFICATION` / `CHART` / `DATA` / `BUG`(不具合の報告) / `OTHER`。FEEDBACKのiOSは`OTHER`を送る
- `body`(必須)：前後の空白を除いて1〜2000文字。保存・返却は前後の空白を除いた値
- `app_version` / `os_version` / `device_model`(任意、各100文字以内、`null`可)：不具合調査用の端末情報。空文字は`null`として保存する。個人を特定する情報は送らない
- 上記以外のフィールドは`422 VALIDATION_ERROR`。意味のない内容は`422`にせず受け付ける(下記の判定で返信しない)

Response：`201 Created`

```json
{
  "id": "0d6f3c2e-5b1a-4c8e-9f4e-2a7b6c1d9e01",
  "kind": "INQUIRY",
  "category": "NOTIFICATION",
  "body": "通知が届く時間を変更できますか?",
  "status": "REPLIED",
  "reply_body": "お問い合わせありがとうございます。通知の対象や時間は、設定画面の「通知設定」から変更できます。通知が届かない場合は、iPhoneの「設定」アプリ > 通知で、本アプリの通知が許可されているかもご確認ください。",
  "replied_at": "2026-10-06T03:00:00Z",
  "created_at": "2026-10-06T03:00:00Z"
}
```

- `status`：`REPLIED`(返信あり) / `ESCALATED`(不具合として登録・返信あり) / `IGNORED`(返信しない)
- `reply_body` / `replied_at`：`IGNORED`は`null`。iOSは`IGNORED`のとき「受け付けました」とだけ表示する
- `replied_at` / `created_at`：秒精度のUTC(`Z`、小数秒なし)
- 判定結果(`classification`)とGitHub Issueの情報はクライアントに返さない

判定(上から順に最初に当てはまったもの。`kind`に関わらず同じルール)：

| 判定 | 条件 | status | 返信 |
|---|---|---|---|
| `SPAM` | URLだけの本文 / URLが3件以上(画像共有サービス`imgur.com`・`drive.google.com`・`photos.app.goo.gl`・`gyazo.com`のURLは数えない。v1.11) / 禁止語(暴言・広告の定型語の短いリスト)を含む。英語の汚い言葉(shit等)は、ほかにほとんど内容がない場合かURLと一緒の場合だけ。「氏ね」は直前がカタカナ・漢字でない場合だけ(「パウエル氏ねぇ」は対象外)(v1.11) | `IGNORED` | なし |
| `NONSENSE` | 5文字未満(かな・漢字を含む場合は2文字未満。「返金希望」等は対象外。v1.11) / 文字(かな・漢字・英字等)を含まない(数字・記号・絵文字のみ) / 1種類の文字が80%以上(「ああああああ」等) / 英字のみでキーボード連打とみなせる(「asdfghjkl」等、子音6文字以上の連続またはキー配列の並び。`GBPCHF`等の通貨コードの組み合わせは対象外(v1.11)) | `IGNORED` | なし |
| `BUG` | `category = BUG`(利用者が選んだ場合は常に)、または本文に不具合の語(落ちる / クラッシュ / 不具合 / バグ / エラー / フリーズ / 強制終了 / 固まる / 動かない / 表示・反映されない / 起動しない / ログインできない / 読み込めない / 開かない / crash / bug / error / freeze。v1.11で丁寧語・過去形(「表示されません」「落ちます」等)も対象。英語は単語単位)を含む。ただし「不具合ではない」「エラーが出ないように」等の否定・回避の表現と、直前に相場の語(円・ドル・レート等)がある「落ちた」は数えない(v1.11) | `ESCALATED` | 不具合受付のテンプレート + GitHub Issue作成 |
| `VALID` | 上記以外 | `REPLIED` | INQUIRYは`category`ごとのテンプレート、FEEDBACKはご意見用のテンプレート |

返信テンプレート(日本語・2〜4文)：

- `ACCOUNT`：設定画面の「アカウント情報」「アカウント削除」を案内
- `BILLING`：プランの支払いはApp Storeのサブスクリプションで管理され、解約・変更はiPhoneの「設定」アプリ > Apple ID > サブスクリプションから行う旨を案内
- `NOTIFICATION`：設定画面の「通知設定」と、端末の通知設定(本アプリの通知の許可)を案内
- `CHART`：設定画面の「チャート設定」を案内
- `DATA`：表示している値の出典と、発表直後の反映について案内
- `OTHER`：受付のお礼と、よくある質問の案内
- FEEDBACK：「ご意見ありがとうございます。…今後の改善の参考にさせていただきます。」
- BUG：「不具合のご報告ありがとうございます。開発チームで確認し、修正対象として登録しました。…」

GitHub Issue(`BUG`のみ)：

- Backend環境変数`GITHUB_ISSUES_TOKEN`(GitHubのトークン)・`GITHUB_ISSUES_REPO`(`owner/name`)が両方設定されている場合だけ、`POST https://api.github.com/repos/{GITHUB_ISSUES_REPO}/issues`で作成する。未設定なら作成しない(保存・返信は通常どおり)
- タイトル：`[アプリ不具合報告] ` + 本文先頭40文字。ラベル：`bug`、`from-app`
- 本文：受付ID(`support_requests.id`)・種別・カテゴリ・アプリバージョン・OS・端末と、本文。**`user_id`・メールアドレスは含めない**。本文と端末情報をNFKC正規化したうえで、メールアドレス・電話番号(日本の形式。`(03)1234-5678`も)・カード番号(空白・ハイフン区切りを含む)・7桁以上の数字列を`[削除済み]`に置き換えてから送る(v1.11)
- 作成に失敗しても(GitHubの障害・トークン不正等)利用者へのResponseは`201`のまま。ログに記録し、`status = ESCALATED`、Issue番号・URLは`null`のままとする
- **`GITHUB_ISSUES_TOKEN`はBackend(サーバー)だけに設定し、iOSアプリには含めない**。対象リポジトリのIssues書き込みだけを許可したfine-grained tokenを推奨する

送信回数の上限：1ユーザーにつき直近1時間で5件まで(`support_requests`の行数で判定。`IGNORED`も数える)。超えた場合は`429 RATE_LIMITED`(保存しない)。v1.11: 件数の確認と保存はDB関数`insert_support_request`(db-design.md §3.17)で1トランザクションとして行い、同じユーザーの同時送信でも上限を超えない。上限を超えた送信ではGitHub Issueも作成しない。

## 24.8 GET /api/v1/support/requests(v1.10で追加)

呼び出しユーザー本人の送信履歴を新しい順に最大50件返す(SCR-020)。他ユーザーの行は返さない。

Response：

```json
{
  "data": [
    {
      "id": "0d6f3c2e-5b1a-4c8e-9f4e-2a7b6c1d9e01",
      "kind": "INQUIRY",
      "category": "NOTIFICATION",
      "body": "通知が届く時間を変更できますか?",
      "status": "REPLIED",
      "reply_body": "お問い合わせありがとうございます。…",
      "replied_at": "2026-10-06T03:00:00Z",
      "created_at": "2026-10-06T03:00:00Z"
    }
  ]
}
```

各要素は24.7節のResponseと同じ形。Paginationなし。

---

# 25. Subscription API

## GET /api/v1/subscription

現在のSubscription状態を取得する。

Response：plan / status / started_at / expires_at / product_id

`product_id`(v1.8で追加)：購読中のApp Store商品(25.2節の月額・年額)。SCR-017で「月額 / 年額」と価格を出すのに使う。FREEは`null`。

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

Response：`GET /subscription`と同じ形(plan / status / started_at / expires_at / product_id)。`product_id`はv1.11で追加。

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

Query(v1.15)：`timezone`(任意。IANA名。既定`UTC`。解決できない名前は`422 VALIDATION_ERROR`)。`limits`の日時を計算するタイムゾーン。

Response(v1.15で`plan`・`limits`を追加。`features`は変更なし)：

```json
{
  "features": ["VIEW_BASIC_EVENT", "VIEW_HISTORICAL", "VIEW_MARKET_REACTION"],
  "plan": "FREE",
  "limits": {
    "calendar_earliest_from": "2026-08-31T15:00:00Z",
    "calendar_latest_to": "2027-12-31T15:00:00Z",
    "favorites_max": 3,
    "notification_importances": ["HIGH"],
    "notification_fx_pairs_max": 1,
    "history_events_max": 5
  }
}
```

(例は`timezone=Asia/Tokyo`、2026-10-08に呼んだ場合)

- `features`：有効な(`enabled = true`かつ期限内の)feature_codeのみ
- `plan`：`FREE` / `PRO`。判定は28.1節
- `limits`：28.1節の表の値。`calendar_earliest_from` / `calendar_latest_to`はUTCの秒精度(`Z`、小数秒なし)で、`GET /calendar`(14.6節)の`from`の下限(含む)と`to`の上限
- `favorites_max` / `notification_fx_pairs_max`：`null` = 上限なし
- `notification_importances`：通知に使える重要度(`HIGH`, `MEDIUM`, `LOW`の順)

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
| 要人発言(v1.6で追加) | `GET /speeches`、`GET /speeches/{id}` | `VIEW_BASIC_EVENT` |
| 経済カレンダー(v1.14で追加) | `GET /calendar` | `VIEW_BASIC_EVENT` |
| 通知予約対象(v1.6で追加) | `GET /notifications/upcoming` | `VIEW_BASIC_EVENT` |
| お問い合わせ(v1.10で追加) | `POST /support/requests`、`GET /support/requests` | **Authentication Required / Entitlementなし** |

Home / Indicators / Indicator Detail / FX Pairs(v1.6) / Search / Account / Settings / Subscription / Entitlement APIは、認証済みであれば全ユーザーがアクセス可能とし、特定feature_codeを要求しない。

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

## 28.1 プラン別の利用上限(v1.15で追加、HQ決定 2026-10-08)

プランの判定：有効な(`enabled = true`かつ期限内の)`VIEW_ADVANCED_STATS`を持つユーザーが`PRO`、それ以外の認証済みユーザーが`FREE`。`VIEW_ADVANCED_STATS`は`POST /subscription/verify`が購読の状態に合わせて付け外しする(上記)。プラン名をDBに保存する列は追加しない。

| 上限 | FREE | PRO | 使うAPI |
|---|---|---|---|
| カレンダーの過去(`calendar_earliest_from`) | 先月1日 00:00から | 5年前の1月1日 00:00から | `GET /calendar`(14.6節) |
| カレンダーの未来(`calendar_latest_to`) | 2年後の1月1日 00:00まで(= 来年末まで) | 同左 | `GET /calendar`(14.6節) |
| お気に入りの件数(`favorites_max`) | 3件 | 上限なし(`null`) | なし(お気に入りは端末内に保存。Backendは上限の値を返すだけ) |
| 通知の重要度(`notification_importances`) | `HIGH`のみ | `HIGH` / `MEDIUM` / `LOW` | `PATCH /settings`(24.5節)、`GET /notifications/upcoming`(24.6節) |
| 通知の通貨ペア(`notification_fx_pairs_max`) | 1件(`null` = すべての通貨ペアは不可。保存済みの`null`は`USDJPY`として扱う) | 上限なし(`null`) | `PATCH /settings`(24.5節)、`GET /notifications/upcoming`(24.6節) |
| 過去イベント比較の発表回(`history_events_max`) | 直近5回 | 直近20回 | `GET /indicators/{id}/comparison`(21章) |

- カレンダーの日時は、Requestの`timezone`(既定`UTC`)の現地時刻で計算する(「先月」「今年」もそのタイムゾーンで決める)
- 上限の値はBackendの`src/domain/planLimits.ts`だけで定義する。iOSは`GET /entitlements`の`limits`で受け取り、端末に値を持たない
- 上限を超える操作は`403 PLAN_LIMIT_EXCEEDED`(`required_plan`付き、4章)。どのプランでも許されない値は`422 VALIDATION_ERROR`

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
| SCR-016 通知設定(v1.4で追加、v1.6・v1.7で更新) | GET /settings、PATCH /settings、GET /fx-pairs、GET /notifications/upcoming |
| SCR-019 プラン・購読管理(v1.4で追加) | GET /subscription、POST /subscription/verify |
| SCR-020 表示・地域設定(v1.4で追加) | GET /settings、PATCH /settings |
| SCR-021 チャート設定(v1.4で追加) | GET /settings、PATCH /settings |
| SCR-022〜025 ヘルプ・規約・プライバシー・アプリ情報(v1.4で追加) | なし |
| SCR-026 アカウント削除(v1.4で追加) | DELETE /account |
| SCR-020 ヘルプ・お問い合わせ(v1.10で追加。番号はui-screens.md。上のSCR-022〜025は旧番号) | POST /support/requests、GET /support/requests |
| SCR-010 経済カレンダー(v1.14で追加。番号はui-screens.md。上のSCR-010 Loginは旧番号) | GET /calendar |

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

お問い合わせ(`POST /support/requests`、v1.10)：1ユーザーにつき直近1時間で5件まで。超過時は`429 RATE_LIMITED`(24.7節)。

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
- 外部サービスの秘密情報(`SUPABASE_SERVICE_ROLE_KEY`、`GITHUB_ISSUES_TOKEN`(v1.10)等)はBackendの環境変数だけに置き、iOSアプリ・Response・ログに含めない

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
