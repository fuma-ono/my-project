# FX Event Analyzer: API詳細設計書 v1.28

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
- **v1.20**(2026-10-13): SCR-005 指標一覧の次回発表(HQ指示 2026-10-13)。`GET /indicators`の各行と`GET /indicators/{id}`の`indicator`に`next_release_datetime`(次回発表日時。現在以降で最も早い`status = SCHEDULED`のEvent、無ければ`null`)・`next_event_id`(そのEventのID、無ければ`null`)・`latest_release_datetime`(最新の`status = RELEASED`のEventの発表日時、無ければ`null`。次回発表が無いときの表示用)を追加(13.2節)。`GET /indicators`の`sort`に`next_release`(次回発表の昇順、次回発表が無い指標は後ろ、同じなら名前順)を追加(13.1節)。既定の並び順(`name`)は変えない
- **v1.21**(2026-10-13): 指標の一覧画面の表示名(HQ指示 2026-10-13)。`GET /indicators`の各行と`GET /indicators/{id}`の`indicator`に`display_name`(一覧画面の表示名。例: `消費者物価指数（CPI）`・`FOMC政策金利`。HQの表示名ルール(indicator-display-names.md)に従って人が登録した短い名前、未登録は`null`)を追加(13.2節)。同じ名前をどの画面でも使えるよう、`GET /calendar`の`INDICATOR`の行(14.6節、`SPEECH`は`null`)と`GET /home`の`events`(12章)にも`display_name`を追加。`name`・`title`・`indicator_name`は変えない
- **v1.22**(2026-10-13): 指標の表示名をすべての画面に(HQ指示 2026-10-13)。v1.21の`display_name`(`economic_indicators.display_name`、未登録は`null`)を次にも追加: `GET /events/{event_id}`の`event`(14.1節)、`GET /events/{event_id}/history`の`event`(20章)、`GET /indicators/{indicator_id}/comparison`の`indicator`(21章、timeframe単一指定・`all`の両方)、`GET /notifications/upcoming`の各`items`(24.6節、`INDICATOR`のみ。`SPEECH`は`null`)、`GET /search`の`indicators`の各行と`events`の各行(23章)。`GET /indicators/{indicator_id}/events`の各行は指標名を持たないため追加しない。`name`・`title`・`indicator_name`は変えない
- **v1.24**(2026-10-13): 要人の公式写真(HQ指示 2026-10-13「FRBは公式写真で、そのほかは頭文字と機関の色で」)。`speakers.photo_url`(text, null可)を追加し、`GET /speeches`・`GET /speeches/{id}`の`speaker`に`photo_url`(string|null)を追加。入れてよいのは自由に使える公式写真だけ(FRB理事の公式写真は米国政府の著作物でパブリックドメイン)。null の要人はアプリが名前の頭文字と機関の色で表示する
- **v1.23**(2026-10-13): アプリ内の通知一覧(HQ指示 2026-10-13「おすすめの通知仕様」、notification-inbox-spec.md 6章)。`GET /notifications`(24.9節。`GET /notifications/upcoming`と同じ条件で選んだ通知のうち通知時刻を過ぎたものをサーバーに記録して返す。`order=desc|asc`・`kind`、`{ items, unread_count }`)、`POST /notifications/{id}/read`(24.10節、`{ id, read_at }`)、`POST /notifications/read-all`(24.11節、`{ updated }`)を追加。テーブル`notification_inbox`(一意制約`(user_id, kind, target_id, trigger)`、保存期間 INDICATOR/SPEECH/SYSTEM 30日・RATE_ALERT/CALENDAR_UPDATE 7日)と、期限切れを消す日次ジョブ`npm run jobs:cleanup-notifications`を追加。`GET /notifications/upcoming`は変えない
- **v1.26**(2026-10-14): 過去イベント比較の表(HQ指示 2026-10-14の参考画像)。`GET /indicators/{indicator_id}/comparison`の`events[]`に`pips_by_timeframe`(`{"1m", "5m", "15m"}`、値は number|null。選んだ`timeframe`に関係なく常に付く)を、`indicator`に`country_code`・`currency_code`・`unit`を追加。統計(`stats`/`stats_by_timeframe`)は従来どおり選んだ時間足だけで計算する
- **v1.25**(2026-10-13): 要人の写真を自前で配信。federalreserve.gov の利用条件(特に断りがなければパブリックドメインで許可なく複製・配布可、出典として FRB を示す。リンクは可だがフレーム内表示は不可)に従い、直リンクをやめて Backend が複製を配信する。`GET /api/v1/speaker-photos/{file}`(14.7節。**認証なし**、`Cache-Control: public, max-age=86400`)を追加。`speakers.photo_url`は`null` / 絶対URL / key`speaker-photos/<file>`のいずれかを持ち、APIは常に**絶対URL**(key は`${PUBLIC_BASE_URL}/api/v1/speaker-photos/<file>`。環境変数`PUBLIC_BASE_URL`が未設定ならリクエストの`protocol://host`)か`null`で返す(`GET /speeches`・`GET /speeches/{id}`の`speaker.photo_url`)。`GET /calendar`の各行に`speaker_photo_url`(SPEECHは発言者の写真、INDICATORと写真の無い要人は`null`)を追加。FRB理事会の現メンバーに合わせ、パウエル氏の役職を「FRB理事」に直し、ケビン・ウォーシュ(FRB議長)・フィリップ・ジェファーソン(FRB副議長)・ミシェル・ボウマン(FRB副議長（金融監督担当）)・マイケル・バー(FRB理事)・リサ・クック(FRB理事)を追加(Migration `20261013000004_frb_speakers_self_hosted_photos.sql`)。写真を入れるのは FRB の要人だけ(ほかの機関は利用条件が未確認のため`null`)。`GET /home`は要人発言を返さないため変更なし(UIスクリーンショット用モックの`speeches`の各行には`speaker_photo_url`を追加)。`GET /search`は要人を返さないため変更なし

- **v1.27**(2026-10-15): ホームの要人発言と、レートアラート・カレンダー更新の通知(notification-inbox-spec.md 7章・8章)。`GET /home`に`speeches`(直近7日の発言済み(`DELIVERED`)の要人発言、新しい順・最大3件。UIスクリーンショット用モックと同じ形。値動きの`reaction_*`はデータが無いため`null`)を追加(12章)。`GET /rate-alerts`・`POST /rate-alerts`・`DELETE /rate-alerts/{id}`を追加(24.12〜24.14節。有効なアラートの上限 FREE 1件・PRO 10件、28.1節)。`GET /notifications`は、本人の有効なレートアラートを最新の価格で判定して`RATE_ALERT`の行を、直近7日の予定の変更(日時の変更・中止)から`CALENDAR_UPDATE`の行を記録する(24.9節)。テーブル`rate_alerts`・`event_schedule_changes`(DBトリガーで記録)と、全員分を判定するジョブ`npm run jobs:evaluate-rate-alerts`を追加
- **v1.28**(2026-10-15): 要人発言の値動き(HQ指示 2026-10-15)。`GET /speeches/{id}`に`reactions`(発言者の通貨を含む主要ペア最大4件 × 発言前の価格と`1m`・`5m`・`15m`の`pips`。発言済み(`DELIVERED`)の発言だけ、それ以外は`[]`)を追加(14.5節)。`GET /speeches/{id}/reaction`(14.8節、`GET /events/{id}/reaction`と同じ形)・`GET /speeches/{id}/reaction/chart`(14.9節、`GET /events/{id}/reaction/chart`と同じ形・同じ表示範囲)・`GET /speakers/{speaker_id}/comparison`(14.10節、要人ごとの過去の発言の比較。上限は`history_events_max`)を追加。要人発言の値動きは保存せず、`fx_prices`の1分足から**API応答時に計算する**(14.11節。保存テーブル・ジョブは追加しない。18.1節の「pips系はDB保存値を返す」は経済指標イベントのみの方針)。価格が無い値は`null`(`DATA_UNAVAILABLE`)で、補った値は返さない。Error Code `SPEAKER_NOT_FOUND`(404)を追加

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
- SPEAKER_NOT_FOUND(v1.28で追加。404)
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
  "major_fx": [],
  "speeches": []
}
```

Eventには以下を含む。

- event_id
- indicator_id
- indicator_name
- display_name(v1.21で追加。指標の一覧画面の表示名、13.2節。未登録は`null`)
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

**speeches(v1.27で追加、直近の要人発言)**: 現在時刻から7日前までに発言済み(`status = DELIVERED`)の要人発言を、`statement_datetime`の新しい順に最大3件。`date`・`timezone`には関係しない。無ければ`[]`。各行の形はUIスクリーンショット用モック(`scripts/ui-screenshot-mock-server.mjs`)と同じ：

```json
{
  "speech_id": "50000000-0000-0000-0000-000000000001",
  "country_code": "US",
  "speaker_name": "パウエルFRB理事",
  "statement_datetime": "2026-10-14T18:30:00Z",
  "headline": "政策金利の据え置きを説明し、今後の判断はデータ次第との認識を示した。",
  "organization": "FRB",
  "speaker_photo_url": "https://api.example.com/api/v1/speaker-photos/powell.jpg",
  "reaction_fx_symbol": null,
  "reaction_price_before": null,
  "reaction_price_after": null,
  "reaction_pips": null
}
```

- `speaker_name`：発言者の姓 + 役職。名前に「・」があれば最後の「・」より後(「ジェローム・パウエル」+「FRB理事」→「パウエルFRB理事」)、無ければ名前全体(「植田和男日本銀行総裁」)
- `statement_datetime`：秒精度のUTC(`Z`)
- `headline`：`summary`があればそれ、無ければ`title`
- `speaker_photo_url`：14.4節の`speaker.photo_url`と同じく絶対URLか`null`(14.7節)
- `reaction_fx_symbol` / `reaction_price_before` / `reaction_price_after` / `reaction_pips`：発言前後の値動き。要人発言の値動きのデータ(`SpeechPriceReaction`)は無いため、今は常に`null`(値を作らない)。アプリは`null`のとき値動きを出さない

**「今日の注目イベント」と「最近のイベント」の扱い(v1.3で確定、H-2)**: `events`は`date`でスコープされた当日分の一覧であり、「最近のイベント」は**当日中に`status = RELEASED`になったイベント**を指す(複数日にまたがる履歴ではない)。専用APIや`recent_events`フィールドは追加せず、Clientが`events`配列を`status`(`SCHEDULED`/`RELEASED`/`CANCELLED`)で「今日の注目イベント」(主にSCHEDULED)と「最近のイベント」(RELEASED)に表示分けする。

---

# 13. Indicator API

## 13.1 GET /api/v1/indicators

経済指標一覧を取得する。

Query：q / country_code / currency_code / importance / page / limit / sort

qはIndicator name / codeの部分一致検索に使用する。

sort：`name`(既定)/ `importance` / `created_at` / `next_release`(v1.20)。`next_release`は`next_release_datetime`の昇順で、`next_release_datetime`が`null`の指標は後ろに置き、同じ日時(または両方`null`)は`name`順。Paginationは並べ替えた後に掛ける。SCR-005 指標一覧は`sort=next_release&limit=100`で呼ぶ。

各行は13.2の`indicator`オブジェクトと同じ形(`next_release_datetime` / `next_event_id` / `latest_release_datetime`を含む)。

## 13.2 GET /api/v1/indicators/{indicator_id}

経済指標詳細を取得する。

Responseには以下を含む：indicator / favorable_direction / related_fx_pairs / latest_event

Indicator Detailでは、name / code / country / currency / importance / description / frequency / unit / source / source_url / favorable_direction などを取得可能とする。

**indicatorオブジェクトの項目(v1.16で`name_en`・`key_points`、v1.18で`market_view_above`・`market_view_below`、v1.20で`next_release_datetime`・`next_event_id`・`latest_release_datetime`、v1.21で`display_name`を追加)**: 13.1の一覧の各行と13.2の`indicator`は同じ形：

```json
{
  "id": "10000000-0000-0000-0000-000000000001",
  "code": "US_CPI",
  "name": "米国CPI(消費者物価指数)",
  "display_name": "消費者物価指数（CPI）",
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
  "market_view_below": "米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。",
  "next_release_datetime": "2026-11-10T13:30:00Z",
  "next_event_id": "30000000-0000-0000-0000-000000000011",
  "latest_release_datetime": "2026-09-10T12:30:00Z"
}
```

- `display_name`(v1.21)：一覧画面の表示名(`economic_indicators.display_name`)。HQの表示名ルール(indicator-display-names.md。例: 短い日本語名はそのまま`小売売上高`、定着した略称は併記`消費者物価指数（CPI）`、政策金利は機関名を残す`FOMC政策金利`、発表区分が重要なものは`GDP（改定値）`)に従って人が登録した40文字以内の名前。SCR-005 指標一覧・SCR-010 カレンダー・ホームで指標名として表示する。未登録は`null`(画面側は`name`を表示する)。`name`(正式名)は変えない
- `name_en`(v1.16)：指標の英語名(`economic_indicators.name_en`)。SCR-006で日本語名の下に表示する。未登録は`null`
- `description`：SCR-006の「概要」。日本語1〜2文(v1.16でseedを日本語化)。未登録は`null`
- `key_points`(v1.16)：SCR-006の「注目される理由」。日本語の短文の配列(2〜4件程度、DB上の上限6件)、配列順 = 表示順。**未登録(DBの`NULL`)は`[]`で返し、`null`にはしない**
- `market_view_above` / `market_view_below`(v1.18)：一般的な見方。SCR-008で結果と予想の差に応じて表示(結果が予想を上回ったら`market_view_above`、下回ったら`market_view_below`)。実際の値動きの原因と断定する表示はしない。人が書いた日本語1文(200文字以内、AI生成ではない)。未登録は`null`(画面側で項目を出さない)
- `next_release_datetime` / `next_event_id`(v1.20)：SCR-005の次回発表。その指標の`economic_events`のうち`status = SCHEDULED`かつ`release_datetime`が現在以降で最も早いEvent(同時刻はEvent IDの小さい方)の`release_datetime`とID。該当が無ければ両方`null`。発表時刻を過ぎてもまだ`SCHEDULED`のEvent(取り込み待ち)と`CANCELLED`は次回発表にしない
- `latest_release_datetime`(v1.20)：最新の`status = RELEASED`のEventの`release_datetime`。無ければ`null`。次回発表が無い指標で「前回発表」として表示する。13.2の`latest_event`(状態を問わず最新のEvent)とは別の項目
- 3項目は一覧の1ページ分をまとめて求める(指標ごとに問い合わせない)

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
    "id": "xxx",
    "indicator_id": "xxx",
    "indicator_name": "米国CPI(消費者物価指数)",
    "display_name": "消費者物価指数（CPI）",
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

**`event.display_name`(v1.22で追加)**: 指標の一覧画面の表示名(13.2節の`display_name`、未登録は`null`)。画面は`display_name`を指標名として表示し、`null`なら`indicator_name`(正式名)を表示する。`indicator_name`は変えない。

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
    "title": "FRB理事",
    "organization": "FRB",
    "country_code": "US",
    "currency_code": "USD",
    "photo_url": "https://api.example.com/api/v1/speaker-photos/powell.jpg"
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
- `speaker.photo_url`(v1.24、v1.25で絶対URLに統一)：要人の公式写真の**絶対URL**、無ければ`null`(アプリは頭文字と機関の色で表示)。14.7節

## 14.5 GET /api/v1/speeches/{speech_id}(v1.6で追加)

要人発言1件(SpeechSummary、14.4節と同じ形)。`speech_id`がUUID形式でなければ`422 VALIDATION_ERROR`、存在しなければ`404 SPEECH_NOT_FOUND`。必要なfeature_code：`VIEW_BASIC_EVENT`。

**reactions(v1.28で追加、主要通貨ペアの値動き)**: SpeechSummaryに`reactions`を加えて返す。発言済み(`status = DELIVERED`)の発言だけ、発言者の`currency_code`を含む有効な通貨ペア最大4件(14.11節の順)。発言前(`SCHEDULED`)・中止(`CANCELLED`)は`[]`。

```json
{
  "reactions": [
    {
      "fx_pair_id": "20000000-0000-0000-0000-000000000001",
      "symbol": "USDJPY",
      "pre_statement_price": 155.31,
      "pips": { "1m": 9.8, "5m": 21.4, "15m": 34.6 }
    }
  ]
}
```

- `pre_statement_price`：発言前の価格(14.11節)。価格が無ければ`null`
- `pips`：各時間足の`pips`(14.11節)。価格が無い・まだその時刻になっていない時間足は`null`
- 必要なfeature_codeは`GET /events/{id}`の`major_fx_reactions`と同じく`VIEW_BASIC_EVENT`のみ

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
  "display_name": "非農業部門雇用者数（NFP）",
  "speaker_name": null,
  "speaker_photo_url": null,
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
- `display_name`(v1.21)：`INDICATOR`は指標の一覧画面の表示名(13.2節の`display_name`、未登録は`null`)、`SPEECH`は常に`null`
- `speaker_name`：`SPEECH`だけ。発言者の表示名。`INDICATOR`は`null`
- `speaker_photo_url`(v1.25)：`SPEECH`だけ。発言者の公式写真の絶対URL(14.7節、14.4節の`speaker.photo_url`と同じ値)。写真の無い要人と`INDICATOR`は`null`
- `country_code` / `currency_code`：`INDICATOR`は指標の値、`SPEECH`は発言者の値
- `datetime`：`INDICATOR`は`release_datetime`、`SPEECH`は`statement_datetime`
- `datetime_precision`：`INDICATOR`は`release_datetime_precision`(6章)、`SPEECH`は常に`EXACT`
- `status`：`INDICATOR`はイベントの`status`(`SCHEDULED` / `RELEASED` / `CANCELLED`)、`SPEECH`は発言の`status`(`SCHEDULED` / `DELIVERED`)。**`CANCELLED`の要人発言は返さない**
- 並び順：`datetime`昇順 → 同時刻は`INDICATOR`が先 → `id`昇順

## 14.7 GET /api/v1/speaker-photos/{file}(v1.25で追加)

要人の公式写真の画像ファイル。14.4節の`speaker.photo_url`・14.6節の`speaker_photo_url`が指す先。**認証なし**(画像の読み込みにはJWTを付けない)。Entitlementなし。

- `file`：`^[a-z0-9-]+\.(jpg|png)$`に合うファイル名だけを受け付ける(`/`・`..`・大文字などを含む名前は読まない)。合わない名前・存在しないファイルは`404 NOT_FOUND`
- Response：画像そのもの。`Content-Type`は`.jpg`が`image/jpeg`、`.png`が`image/png`。`Cache-Control: public, max-age=86400`
- ファイルは Backend の`assets/speaker-photos/`に置く。出典・取得日・利用条件は同じ場所の`SOURCES.md`

写真の扱い：

- 置くのは FRB の公式写真だけ(federalreserve.gov、2026-10-13取得)。利用条件(https://www.federalreserve.gov/disclaimer.htm)は「特に断りがなければパブリックドメインで、許可なく複製・配布できる。出典として FRB を示す」。リンクは可だがフレーム内表示は不可のため、直リンクせず複製を自前で配信する
- 写真を表示する画面では「出典: 米国連邦準備制度理事会(FRB)」を示す
- ほかの機関の要人の写真は利用条件を確かめていないので置かない(`photo_url`は`null`、アプリは頭文字と機関の色で表示)

`speakers.photo_url`(DB)からResponseの値への変換：

| DBの値 | Responseの値 |
|---|---|
| `null` | `null` |
| 絶対URL(`https://…`) | そのまま |
| `speaker-photos/<file>`(`<file>`は上の形式) | `${base}/api/v1/speaker-photos/<file>`。`base`は環境変数`PUBLIC_BASE_URL`(末尾の`/`は除く)、未設定ならリクエストの`protocol://host` |
| それ以外 | `null`(壊れたリンクを返さない) |

## 14.8 GET /api/v1/speeches/{speech_id}/reaction(v1.28で追加)

要人発言の値動き。**`GET /events/{event_id}/reaction`(18章)と同じQuery・同じ形**(アプリは同じデコーダーを使う)。`event_id`には`speech_id`、`pre_release_price`には発言前の価格(14.11節)が入る。必要なfeature_code：`VIEW_MARKET_REACTION`。

Query：`fx_pair_id`(必須、UUID) / `timeframe`(`1m` / `5m` / `15m` / `30m` / `60m` / `all`、省略時`all`)

- `timeframe=all`(省略時)：`{ event_id, fx_pair_id, pre_release_price, reactions: [...] }`。`reactions`は`1m`・`5m`・`15m`・`30m`・`60m`の5件、各要素は`timeframe` / `post_release_price` / `movement` / `pips` / `change_percent` / `max_upward` / `max_downward` / `max_upward_pips` / `max_downward_pips` / `analysis_status`
- 単一の`timeframe`：`{ event_id, fx_pair_id, timeframe, pre_release_price, post_release_price, movement, pips, change_percent, max_upward, max_downward, max_upward_pips, max_downward_pips, analysis_status }`
- `analysis_status`：発言前(`SCHEDULED`) = `DATA_PENDING`、中止(`CANCELLED`) = `NOT_ANALYZABLE`(どちらも数値はすべて`null`)。発言済みは、発言時刻 + N分がまだ来ていなければ`DATA_PENDING`、発言前の価格かN分後の価格が無ければ`DATA_UNAVAILABLE`(数値は`null`)、そろっていれば`READY`。要人発言には時刻の精度(`release_datetime_precision`)が無いため、`EXACT`と同じ扱い
- Error：`speech_id`・`fx_pair_id`がUUID形式でない・`timeframe`が不正 → `422 VALIDATION_ERROR`。発言が無い → `404 SPEECH_NOT_FOUND`。通貨ペアが無い → `404 FX_PAIR_NOT_FOUND`

## 14.9 GET /api/v1/speeches/{speech_id}/reaction/chart(v1.28で追加)

要人発言のチャート。**`GET /events/{event_id}/reaction/chart`(19章)と同じQuery・同じ形・同じ表示範囲**。`event_id`には`speech_id`、`release_datetime`には`statement_datetime`が入る。必要なfeature_code：`VIEW_MARKET_REACTION`。

Query：`fx_pair_id`(必須、UUID) / `timeframe`(必須、`1m` / `5m` / `15m` / `30m` / `60m`)

Response：`{ event_id, fx_pair_id, timeframe, release_datetime, window_from, window_to, prices: [{ timestamp, open, high, low, close, volume }] }`。表示範囲は発言時刻を基準に19章と同じ(`1m`前後15分・`5m`前後60分・`15m`前後3時間・それ以外は前30分〜後60分)。`prices`は`fx_prices`にある足だけ(補った足は返さない)。発言の状態に関係なく、範囲内にある実際の足を返す。

## 14.10 GET /api/v1/speakers/{speaker_id}/comparison(v1.28で追加)

要人ごとの過去の発言の比較(過去イベント比較(21章)の要人発言版)。その要人の**発言済み(`DELIVERED`)**の発言を`statement_datetime`の新しい順に、プランの`history_events_max`件(FREE 5件・PRO 20件、28.1節)まで。必要なfeature_code：`VIEW_HISTORICAL`(21章と同じ)。

Query：`fx_pair_id`(UUID、省略時はその要人の通貨の1件目のペア(14.11節の順)。該当するペアが無ければ`fx_pair_id`・`symbol`は`null`、`pips_by_timeframe`はすべて`null`)

```json
{
  "speaker": {
    "speaker_id": "40000000-0000-0000-0000-000000000001",
    "name": "ジェローム・パウエル",
    "title": "FRB理事",
    "organization": "FRB",
    "country_code": "US",
    "currency_code": "USD",
    "photo_url": "https://api.example.com/api/v1/speaker-photos/powell.jpg"
  },
  "fx_pair_id": "20000000-0000-0000-0000-000000000001",
  "symbol": "USDJPY",
  "events": [
    {
      "speech_id": "50000000-0000-0000-0000-000000000001",
      "title": "FOMC後の記者会見",
      "statement_datetime": "2026-09-17T18:30:00+00:00",
      "importance": "HIGH",
      "pips_by_timeframe": { "1m": 9.8, "5m": 21.4, "15m": 34.6 }
    }
  ],
  "history_limit": { "applied": 1, "max_for_plan": 20, "pro_max": 20 }
}
```

- `speaker.photo_url`：14.4節と同じ(絶対URLか`null`)
- `pips_by_timeframe`：14.11節の計算の`1m`・`5m`・`15m`の`pips`。価格が無ければ`null`
- `history_limit`：21章と同じ意味(`applied` = 実際に使った発言の件数 = min(発言済みの件数, `max_for_plan`))
- ページングは無い(最大でも`history_events_max`件)。統計は返さない
- Error：`speaker_id`・`fx_pair_id`がUUID形式でない → `422 VALIDATION_ERROR`。要人が無い → `404 SPEAKER_NOT_FOUND`。指定した通貨ペアが無い → `404 FX_PAIR_NOT_FOUND`

## 14.11 要人発言の値動きの計算(v1.28で追加)

経済指標イベントの値動き(`event_price_reactions`、Ingestion Workerが書く)と違い、要人発言の値動きは**保存しない**。14.5節・14.8節・14.10節は、応答のたびに`fx_prices`の**1分足**(`timeframe = '1m'`)から計算する(`src/domain/speechReactions.ts`)。保存用のテーブル・ジョブは追加していない(発言は経済指標より少なく、1回の応答で読む足は通貨ペアあたり最大75本のため)。

- 足の`timestamp`は足の始まり(db-design.md 3.11節)なので、1分足は`timestamp` + 1分に終わる。**「時刻Xの価格」= Xに終わる1分足(`timestamp` = X − 1分)の終値**(seedの経済指標イベントと同じ: 12:30の発表 → 発表前 = 12:29の足の終値、1m = 12:30の足の終値)
- **発言前の価格**(`pre_statement_price` / `pre_release_price`)：`statement_datetime`以前に終わった最後の1分足の終値。発言の15分より前に終わった足は使わない(無ければ`null`)
- **N分後の価格**(`post_release_price`)：`statement_datetime` + N分に終わる1分足の終値。その足が無ければ`null`(前後の足で補わない)
- `movement` = N分後 − 発言前、`pips` = `movement` ÷ pip_size(**円が後ろの通貨ペア(…JPY)は0.01 = ×100、それ以外は0.0001 = ×10000**)、`change_percent` = `movement` ÷ 発言前 × 100(10章と同じ式)
- `max_upward` / `max_downward`(と`_pips`)：発言時刻からN分後までに終わる1分足の高値・安値の、発言前の価格との差の最大・最小(10.4・10.5節と同じ定義)
- 丸め：`pips`系は0.1(実際の気配の最小単位)、価格・`movement`系は小数6桁、`change_percent`は小数4桁
- 発言済み(`DELIVERED`)の発言だけ数値を出す。`analysis_status`は14.8節
- **通貨ペアの選び方**(14.5節・14.10節の省略時)：有効な(`is_active`)通貨ペアのうち、発言者の`currency_code`を含むもの。順番は`USDJPY`・`EURUSD`・`GBPUSD`・`AUDUSD`・`USDCHF`・`USDCAD`・`EURJPY`・`GBPJPY`・`AUDJPY`・`CADJPY`(14.1節の主要ペアの順)・`EURGBP`・`EURCHF`・`CHFJPY`・`NZDUSD`・`NZDJPY`・`EURAUD`、それ以外は通貨ペア名の順。最大4件。例：USD → USDJPY・EURUSD・GBPUSD・AUDUSD、JPY → USDJPY・EURJPY・GBPJPY・AUDJPY、EUR → EURUSD・EURJPY・EURGBP…

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

`event`は`id`・`indicator_name`・`display_name`(v1.22で追加。13.2節の`display_name`、未登録は`null`)・`release_datetime`・`importance`。

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

`indicator`は`id`・`code`・`name`・`display_name`(v1.22で追加。13.2節の`display_name`、未登録は`null`)。timeframe単一指定・`all`の両方で同じ形。

### 21.1 Response(timeframe単一指定時)

```json
{
  "indicator": { "id": "xxx", "code": "US_CPI", "name": "米国CPI(消費者物価指数)", "display_name": "消費者物価指数（CPI）" },
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
  "indicator": { "id": "xxx", "code": "US_CPI", "name": "米国CPI(消費者物価指数)", "display_name": "消費者物価指数（CPI）" },
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

**表示名(v1.22で追加)**: `indicators`の各行(`id`・`code`・`name`・`display_name`・`country_code`・`currency_code`)と`events`の各行(`id`・`indicator_id`・`indicator_name`・`display_name`・`release_datetime`・`status`)に`display_name`(13.2節、未登録は`null`)を返す。検索対象は変えない(`display_name`では検索しない)。

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
      "display_name": null,
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
- `display_name`(v1.22で追加)：INDICATORは指標の一覧画面の表示名(13.2節の`display_name`、未登録は`null`)、SPEECHは常に`null`。`title`(指標の正式名)は変えない
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

## 24.9 GET /api/v1/notifications(v1.23で追加)

アプリ内の通知一覧(ホームの通知ベル → 通知一覧、notification-inbox-spec.md)。サーバーに記録した呼び出しユーザー本人の通知を返す。必要なfeature_code：`VIEW_BASIC_EVENT`(24.6節と同じ)。

Query：

- `order`(任意):`desc`(既定、`notify_at`の新しい順) / `asc`(古い順)。同じ`notify_at`は記録した順
- `kind`(任意):`INDICATOR` / `SPEECH` / `RATE_ALERT` / `CALENDAR_UPDATE` / `SYSTEM`。`items`だけを絞り込む
- それ以外の値は`422 VALIDATION_ERROR`

Response：

```json
{
  "items": [
    {
      "id": "6f1c0a3e-2d4b-4c1a-9e7f-3b2a1c0d9e8f",
      "kind": "INDICATOR",
      "target_id": "3a000000-0000-0000-0000-000000000001",
      "trigger": "LEAD_5",
      "lead_minutes": 5,
      "title": "日本CPI(消費者物価指数)",
      "body": "発表の5分前です（10/16 8:30発表・重要度 高）",
      "display_name": "消費者物価指数（CPI）",
      "speaker_name": null,
      "country_code": "JP",
      "importance": "HIGH",
      "scheduled_at": "2026-10-15T23:30:00Z",
      "notify_at": "2026-10-15T23:25:00Z",
      "read_at": null,
      "expires_at": "2026-11-14T23:25:00Z"
    }
  ],
  "unread_count": 1
}
```

- `id`：通知一覧の行のID(24.10節で使う)。イベントのIDは`target_id`
- `kind` / `target_id`：`INDICATOR`は`economic_events.id`、`SPEECH`は`speech_events.id`(24.6節の`id`)、`RATE_ALERT`(v1.27)は`rate_alerts.id`(24.12節)、`CALENDAR_UPDATE`(v1.27)は`event_schedule_changes.id`。`SYSTEM`はまだ作られない(将来用)
- `trigger`：通知の種類。発表の何分前か(`lead_minutes`)が N のとき`LEAD_N`、0のとき`AT_RELEASE`。`RATE_ALERT`は`CROSSED`、`CALENDAR_UPDATE`は`RESCHEDULED`(日時の変更)/ `CANCELLED`(中止)
- `lead_minutes`：`trigger`から求めた何分前か(`AT_RELEASE` = 0)。それ以外の`trigger`(システム通知など)は`null`
- `title`：24.6節の`title`(指標の正式名・発言のタイトル)。`display_name`・`speaker_name`も24.6節と同じ(INDICATORの`speaker_name`、SPEECHの`display_name`は`null`)
- `body`：本文。アプリのローカル通知と同じ書き方で、時刻は`display.timezone`(解決できない場合は`Asia/Tokyo`)。「発表の5分前です（M/d H:mm発表・重要度 高）」、0分前は「まもなく発表です（…）」、SPEECHは「発表」が「発言」
- `scheduled_at` / `notify_at` / `read_at` / `expires_at`：秒精度のUTC(`Z`、小数秒なし)。`read_at = null`は未読
- `expires_at` = `notify_at` + 保存期間(INDICATOR / SPEECH / SYSTEM 30日、RATE_ALERT / CALENDAR_UPDATE 7日。Backend実装: `src/domain/notificationInbox.ts`の`NOTIFICATION_RETENTION_DAYS`)
- `unread_count`：期限切れでない未読の件数。`kind`では絞り込まない(通知ベルのバッジ用)
- Paginationなし(保存期間で件数が限られるため)

呼び出しのたびに次の順で処理する：

1. **記録**：24.6節の抽出ルール(通知設定・プランの上限・`lead_minutes`・通知しない時間帯)で選んだ通知のうち、`notify_at <= 現在時刻`かつ期限切れでないものを`notification_inbox`に入れる。24.6節との違いは次のとおり
   - `status`は`SCHEDULED`に加えて発表済み(`RELEASED`)・発言済み(`DELIVERED`)も対象(5分前に通知した指標は、一覧を開くころには発表済みのことが多いため)。`CANCELLED`は対象外
   - 60件の上限なし
   - さかのぼるのは保存期間(30日)まで、かつ通知設定を最後に保存した時刻(`user_settings.updated_at`)まで。初めて使う人や`lead_minutes`を変えた人に、受け取る設定ではなかった過去の通知を並べないため
   - 同じ`(kind, target_id, trigger)`の行があれば何もしない(重複しない)。`LEAD_5`と`AT_RELEASE`は別の行
   - `push = false`のときは記録しない(記録済みの行は返す)。下の`RATE_ALERT`・`CALENDAR_UPDATE`も同じ
   - **`RATE_ALERT`(v1.27)**：呼び出しユーザーの有効なレートアラート(プランの上限の件数まで、古い順)を最新の価格(24.12節)で判定し、`ABOVE`は価格 >= `target_price`、`BELOW`は価格 <= `target_price`なら行を入れて、アラートを`is_active = false`・`triggered_at` = 現在時刻にする。行は`target_id` = アラートのID、`trigger` = `CROSSED`、`title`「USD/JPY が 155.00 を上回りました」/「…を下回りました」、`body`「現在 155.42（アラート: 155.00 以上）」/「…以下）」、`importance` = `HIGH`、`notify_at` = 現在時刻、`scheduled_at`・`country_code`・`display_name`・`speaker_name` = `null`、`lead_minutes` = `null`
   - **`CALENDAR_UPDATE`(v1.27)**：`changed_at`が直近7日(かつ`user_settings.updated_at`以降)の`event_schedule_changes`のうち、イベントが上の抽出ルールの通知設定(種類ごとのオンオフ・重要度・通貨ペア・プランの上限、指標は`EXACT`のみ)を満たすもの。`lead_minutes`・通知しない時間帯は使わない。行は`target_id` = 変更のID、`trigger` = `change_type`、`title`「日本の消費者物価指数（CPI）の発表日時が変更されました」/「…の発表が中止されました」(指標は国名 + `display_name`、未登録なら正式名。発言は12章の`speaker_name`と同じ「パウエルFRB理事」+「の発言日時が変更されました」/「の発言が中止されました」)、`body`「発表日時 10/16 8:30 → 10/17 8:30（重要度 高）」/ 中止は「10/16 8:30の発表は行われません（重要度 高）」(時刻は`display.timezone`)、`importance` = イベントの重要度、`scheduled_at` = 変更後の日時(中止は変更前)、`notify_at` = `changed_at`。`display_name` / `speaker_name` / `country_code`は`INDICATOR` / `SPEECH`と同じ
2. **期限切れの削除**：呼び出しユーザーの`expires_at <= 現在時刻`の行を消す
3. **返す**：`expires_at > 現在時刻`の行だけを返す

設定を変えても記録済みの行は変わらない。発表時刻が変わったイベントは、記録済みの行の時刻のまま残り、変更は別の`CALENDAR_UPDATE`の行で知らせる(v1.27)。

**テーブル`event_schedule_changes`**(v1.27、`supabase/migrations/20261015000002_event_schedule_changes.sql`)：予定の変更の記録。DBのトリガーが書く(`economic_events`の`release_datetime`・`speech_events`の`statement_datetime`が変わったとき、または`status`が`CANCELLED`になったとき。変更前が`SCHEDULED`のイベントだけ)。

| 列 | 型 | 内容 |
|---|---|---|
| `id` | uuid | 主キー |
| `kind` | text not null | `INDICATOR` / `SPEECH`(CHECK) |
| `target_id` | uuid not null | `economic_events.id` / `speech_events.id`(FKなし。消えたイベントの変更は使わない) |
| `change_type` | text not null | `RESCHEDULED` / `CANCELLED`(CHECK) |
| `old_datetime` | timestamptz not null | 変更前の日時 |
| `new_datetime` | timestamptz | 変更後の日時(`CANCELLED`は`null`) |
| `changed_at` | timestamptz not null | 既定`now()` |

- RLS：`economic_events`と同じ共有データ(認証済みならSELECT可、書き込みはトリガーのみ)
- 7日を過ぎた行は日次ジョブ`npm run jobs:cleanup-notifications`が消す

**テーブル`notification_inbox`**(`supabase/migrations/20261013000002_notification_inbox.sql`)：

| 列 | 型 | 内容 |
|---|---|---|
| `id` | uuid | 主キー(`gen_random_uuid()`) |
| `user_id` | uuid not null | `profiles(id)`、`on delete cascade` |
| `kind` | text not null | `INDICATOR` / `SPEECH` / `RATE_ALERT` / `CALENDAR_UPDATE` / `SYSTEM`(CHECK) |
| `target_id` | text not null | イベントIDなど |
| `trigger` | text not null | `LEAD_5` / `AT_RELEASE` など |
| `title` | text not null | 見出し |
| `body` | text | 本文 |
| `display_name` / `speaker_name` / `country_code` / `importance` | text | 24.6節の同名の項目 |
| `scheduled_at` | timestamptz | 発表・発言の時刻 |
| `notify_at` | timestamptz not null | 通知の時刻 |
| `read_at` | timestamptz | 既読にした時刻(未読は`null`) |
| `expires_at` | timestamptz not null | `notify_at` + 保存期間 |
| `created_at` | timestamptz | 既定`now()` |

- 一意制約`(user_id, kind, target_id, trigger)`、インデックス`(user_id, expires_at)`と`(expires_at)`
- RLS：本人は自分の行だけSELECT可。書き込みはBackend(service_role)だけ(`user_settings`と同じ形)
- 期限切れの削除(全員分)：SQL関数`delete_expired_notification_inbox()`(削除件数を返す。service_roleのみ実行可)を、日次ジョブ`npm run jobs:cleanup-notifications`(`src/jobs/cleanupNotifications.ts`、ビルド後は`node dist/jobs/cleanupNotifications.js`)がcronから呼ぶ。成功で終了コード0、失敗で1

## 24.10 POST /api/v1/notifications/{id}/read(v1.23で追加)

通知一覧の1件を既読にする(行を開いたとき)。Authentication Required / Entitlementなし。Request bodyなし。

Response：

```json
{ "id": "6f1c0a3e-2d4b-4c1a-9e7f-3b2a1c0d9e8f", "read_at": "2026-10-15T23:40:12Z" }
```

- 何度呼んでもよい。既読の行は最初の`read_at`のまま返す
- 他のユーザーの行・存在しない行・期限切れの行は`404 NOT_FOUND`。`id`がUUIDでなければ`422 VALIDATION_ERROR`

## 24.11 POST /api/v1/notifications/read-all(v1.23で追加)

呼び出しユーザーの期限切れでない未読をすべて既読にする(「すべて既読」)。Authentication Required / Entitlementなし。Request bodyなし。

Response：

```json
{ "updated": 2 }
```

- `updated`：既読にした件数(未読が無ければ0)。他のユーザーの行は変えない

## 24.12 GET /api/v1/rate-alerts(v1.27で追加)

呼び出しユーザーのレートアラート(通貨ペアの価格が決めた値を上回った・下回ったら通知一覧に入れる。notification-inbox-spec.md 7章)。Authentication Required / Entitlementなし。

Response：

```json
{
  "items": [
    {
      "id": "abababab-abab-abab-abab-000000000001",
      "fx_pair_id": "20000000-0000-0000-0000-000000000001",
      "symbol": "USDJPY",
      "direction": "ABOVE",
      "target_price": 156,
      "is_active": true,
      "triggered_at": null,
      "created_at": "2026-10-13T06:00:00Z"
    }
  ],
  "limit": { "max_for_plan": 1, "pro_max": 10 }
}
```

- `items`：通知済み(`is_active = false`)も含め、作った順(古い順)。Paginationなし
- `symbol`：`fx_pairs.symbol`(`/fx-pairs`と同じ`USDJPY`形式)
- `direction`：`ABOVE`(価格 >= `target_price`で通知) / `BELOW`(価格 <= `target_price`で通知)
- `target_price`：number
- `is_active`：まだ通知していない。通知すると`false`になり、`triggered_at`に通知した時刻が入る(1回だけ通知する)
- `triggered_at` / `created_at`：秒精度のUTC(`Z`)
- `limit.max_for_plan`：今のプランで持てる有効なアラートの数(FREE 1・PRO 10、28.1節)。`limit.pro_max`：PROの数

**価格と判定**：価格は`fx_prices`の最新の行(`timestamp`が最も新しい行、時間足は問わない)の`close`で、`GET /home`の`major_fx`の`price`と同じ。価格の無い通貨ペアは通知しない。判定は`GET /notifications`(本人の分、24.9節)と、ジョブ`npm run jobs:evaluate-rate-alerts`(全員分。`src/jobs/evaluateRateAlerts.ts`、ビルド後は`node dist/jobs/evaluateRateAlerts.js`。価格の取り込みのたびにcronで動かす。成功で終了コード0、失敗で1)が行う。どちらも`push = false`のユーザーは判定しない(アラートは有効なまま)。有効なアラートがプランの上限より多いユーザー(PROからFREEに戻った人)は、古い順に上限の件数だけ判定する。

**テーブル`rate_alerts`**(`supabase/migrations/20261015000001_rate_alerts.sql`)：

| 列 | 型 | 内容 |
|---|---|---|
| `id` | uuid | 主キー |
| `user_id` | uuid not null | `profiles(id)`、`on delete cascade` |
| `fx_pair_id` | uuid not null | `fx_pairs(id)`、`on delete cascade` |
| `direction` | text not null | `ABOVE` / `BELOW`(CHECK) |
| `target_price` | numeric(12, 6) not null | 0より大きい(CHECK) |
| `is_active` | boolean not null | 既定`true` |
| `triggered_at` | timestamptz | 通知した時刻(未通知は`null`)。通知済みは`is_active = false`(CHECK) |
| `created_at` / `updated_at` | timestamptz not null | 既定`now()` |

- RLS：本人は自分の行だけSELECT可。書き込みはBackend(service_role)だけ(`user_settings`と同じ形)

## 24.13 POST /api/v1/rate-alerts(v1.27で追加)

レートアラートを作る。Authentication Required / Entitlementなし。

Request：

```json
{ "fx_pair_id": "20000000-0000-0000-0000-000000000001", "direction": "ABOVE", "target_price": 156.0 }
```

Response：`201`で、作った1件(24.12節の`items`の1件と同じ形。`is_active: true`、`triggered_at: null`)

- `fx_pair_id`がUUIDでない・有効な通貨ペアでない、`direction`が`ABOVE` / `BELOW`以外、`target_price`が0以下・1,000,000以上・数値でない：`422 VALIDATION_ERROR`
- 有効なアラートがすでにプランの上限(FREE 1件・PRO 10件)ある：FREEは`403 PLAN_LIMIT_EXCEEDED`(`required_plan: "PRO"`)、PROは`422 VALIDATION_ERROR`(4章・28.1節)。通知済みのアラートは数えない
- 判定はValidation(`422`)の後にプランの上限(`403`)

## 24.14 DELETE /api/v1/rate-alerts/{id}(v1.27で追加)

レートアラートを消す(通知済みも消せる)。Authentication Required / Entitlementなし。

Response：`204`(Bodyなし)

- 他のユーザーのアラート・存在しないアラートは`404 NOT_FOUND`。`id`がUUIDでなければ`422 VALIDATION_ERROR`
- 記録済みの通知一覧の`RATE_ALERT`の行は消えない

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
| 要人発言の値動き(v1.28で追加) | `GET /speeches/{id}/reaction`、`GET /speeches/{id}/reaction/chart` | `VIEW_MARKET_REACTION` |
| 要人ごとの過去比較(v1.28で追加) | `GET /speakers/{speaker_id}/comparison` | `VIEW_HISTORICAL`(件数はプランの`history_events_max`、28.1節) |
| 経済カレンダー(v1.14で追加) | `GET /calendar` | `VIEW_BASIC_EVENT` |
| 通知予約対象(v1.6で追加) | `GET /notifications/upcoming` | `VIEW_BASIC_EVENT` |
| 通知一覧(v1.23で追加) | `GET /notifications` | `VIEW_BASIC_EVENT` |
| 通知の既読(v1.23で追加) | `POST /notifications/{id}/read`、`POST /notifications/read-all` | **Authentication Required / Entitlementなし** |
| 要人の写真(v1.25で追加) | `GET /speaker-photos/{file}` | **認証なし / Entitlementなし**(14.7節) |
| レートアラート(v1.27で追加) | `GET /rate-alerts`、`POST /rate-alerts`、`DELETE /rate-alerts/{id}` | **Authentication Required / Entitlementなし**(件数はプランの上限、28.1節) |
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
| 過去イベント比較の発表回(`history_events_max`) | 直近5回 | 直近20回 | `GET /indicators/{id}/comparison`(21章)、`GET /speakers/{speaker_id}/comparison`(14.10節、v1.28。要人の発言済みの発言の件数) |
| 有効なレートアラート(`rate_alerts_max`、v1.27) | 1件 | 10件 | `POST /rate-alerts`(24.13節)、`GET /rate-alerts`の`limit`(24.12節)。`GET /entitlements`の`limits`には含めない |

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
- 要人の写真の配信(`GET /speaker-photos/{file}`、v1.25、14.7節)は認証なしだが、ファイル名を`^[a-z0-9-]+\.(jpg|png)$`に限り、`assets/speaker-photos/`の外は読めない
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
