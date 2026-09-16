# FXイベント反応分析アプリ 概要設計書 v1.8

## 変更履歴

- **v1.0**: 初版
- **v1.1**: 設計レビューの指摘を反映
  - システム構成にScheduler / Queue / Ingestion Workerを追加(2章)
  - BackendをRead APIとIngestion Workerに責務分離(4章)
  - EventSnapshot / EventRevisionを追加、Event中心のER図を更新(5章)
  - API選定条件に「エンドユーザーへの商用配信権」を必須条件として追加(6章)
  - イベント時刻と価格データの同期ルールを明記(8章)
  - ForecastなしのSurprise処理を追加(9章)
  - 不完全データを統計対象から除外するルールを追加(10章)
  - AI機能をMVPでは出典付き事実要約に縮小、将来拡張の保存構造を明記(11章)
  - キャッシュ方針(DB保存値を返す、Redis等は現時点で必須としない)を追加(12章、新設)
  - データ品質管理・運営者向け機能の分離方針を追加(13章、新設)
  - MVP範囲を再定義(28章)
- **v1.2**(今回): 機能一覧レビューでの整合性確認3点(FEAT-045/224/028)に対するHQ回答を反映
  - Indicator↔FxPairの多対多関連(IndicatorFxPair)をER図・Indicator節に追加(5章)
  - EventRevisionのUI表示ルールを「改定後」ラベルで明示区別するよう強化(5.4節)
  - Subscriptionを「Entitlement設計・プラン概念はMVP対象、決済(StoreKit)実装のタイミングはBeta前後で別途判断」という方針に更新(25章)
- **v1.3**: HQが再発行した機能一覧v1.2との突き合わせで判明した差分を反映
  - 将来拡張の「コミュニティ」の説明を具体化: 一般的な掲示板ではなく、特定の経済イベントを中心とした共有機能として検討する(28章)
- **v1.4**(今回): DB詳細設計(HQ確定、2026-09-16)を受けて5章を全面改訂
  - `EconomicEvent`と`EventSnapshot`を別Entityとして分離(旧: 同一エンティティと記述していた。5.1/5.3/5.4節)
  - `EventSnapshot.snapshot_type`を追加。MVPでは`RELEASE`のみ使用し、将来の複数種類を想定した設計とする(5.4節)
  - `EventExplanation`を5章の正式なEntity一覧・サブセクションとして明記(5.6節、従来はER図のみへの記載)
  - `favorable_direction`のenum値をHIGHER_IS_POSITIVE/LOWER_IS_POSITIVE/NEUTRALに更新(5.2節、9.2節と整合)
  - `release_datetime_precision`の値セットをEXACT/DATE_ONLY/APPROXIMATE/UNKNOWNに具体化(5.3節、8.2節)
  - 5章の節番号を5.1〜5.7に整理(EventSnapshot挿入・EventExplanation昇格のため、旧5.4 EventRevision→5.5、旧5.5 FxPair→5.7に移動)
- **v1.5**: DB詳細設計の最終確定(HQ確定、2026-09-16 第3回)を受けて5.6節を更新
  - `EventExplanation`は上書きせず履歴保持とする(複数versionが存在しうる構造に変更、5.6節)
  - AI拡張カラムはMVPでは追加せず、実装時のMigrationで追加する方針を明記(5.6節)
- **v1.6**(今回): 全設計横断監査(M-2/M-4/M-5/L-1/L-2)での確定事項を反映(2026-09-16)
  - M-2: `data_status`のサンプル値を、DB詳細設計で確定した実際の値(`PARTIAL`/`UNAVAILABLE`/`AVAILABLE`)に更新(旧: incomplete/complete。8.5/10.2/10.3節)
  - M-4: `IngestionLog`をEntity一覧・ER図に追加(5.8節、新設)
  - M-5: 8.1節にtimezoneのRequest Parameter方式(API詳細設計で確定済み)を追記
  - L-1: ER図のEntity名を「User」から「Profile」に統一(db-design.md/api-design.mdの実体に合わせる。意味は変更なし)
  - L-2: 「FXPair」/「FXPrice」の表記を「FxPair」/「FxPrice」に統一(db-design.md/api-design.mdの表記に合わせる)
- **v1.7**(今回): HQ指示「Splash / Launch ScreenとApp Iconの追加」を反映(2026-09-16)
  - 15〜24章に15.1節「App起動フロー(SCR-000 Splash / Launch Screen)」を新設: iOSシステムLaunch ScreenとSCR-000の責務分離、起動フロー、Session Expired/API接続エラー時の遷移ロジックを追記(詳細UI仕様はui-screens.md 5.0節を参照)
  - 15〜24章に15.2節「App Icon / Brand Asset方針」を新設: ブランド方向性・Asset管理方針の概要を追記(詳細はui-screens.md 9章を参照)
  - 実装・コード変更・Asset生成は行っていない(設計ドキュメントのみの変更)
- **v1.8**(今回): HQ最終決定「技術スタック確定」を反映(2026-09-16)
  - 3.2節の技術候補「React Native + Expo」を、MVP正式採用「**SwiftUI + Xcode**」に置き換え(HQ確定理由: 主要プラットフォームがiOS/iPadOS、UI設計がSwiftUI/iOSネイティブの画面構造を前提、iOS Launch Screen/Asset Catalog/iOSネイティブUIとの整合性優先、クロスプラットフォーム対応はMVPの目的外)
  - 2.1節のシステム構成図の「iOS / iPad App」ブロックの実装技術表記を「React Native/Expo」から「SwiftUI」に更新
  - リポジトリ内にSwiftコード・Xcodeプロジェクトが存在しないことを確認済み(既存実装との衝突なし)
  - 具体的なSwiftUIコード・Xcodeプロジェクト構成は今回実装しない(設計方針の確定のみ)

---

## 1. システム概要

### 1.1 システム名称

FXイベント反応分析アプリ

### 1.2 システム目的

経済指標・中央銀行イベント・要人発言について、市場予想→実際の結果→予想との差(サプライズ)→発表前後の為替変動→過去イベントとの比較→結果が予想から乖離した理由、を一連の流れで確認できる分析プラットフォームを提供する。本システムはFX価格の予測・自動売買を目的としない。

### 1.3 プロダクトコンセプト

「経済イベントが発生するたびに、その結果と市場反応を過去データと比較して理解できるFXイベント分析プラットフォーム」。単なる経済指標カレンダーや過去チャート閲覧サービスではなく、イベントを起点として経済指標と為替変動を関連付けることを主要価値とする。

---

## 2. システム全体構成

### 2.1 全体アーキテクチャ(改訂)

レビュー指摘(Ingestion Architectureの欠如)を受け、Backendを**ユーザー向けの読み取り専用API(Read API)**と、**外部データを取り込むIngestion Worker**に分離する。マイクロサービス化はしない(Read APIとWorkerは同一コードベース内の別プロセスという粒度に留める)。

```
┌─────────────────────────┐
│       iOS / iPad App    │
│      SwiftUI(Xcode)     │
└────────────┬────────────┘
             │ HTTPS
             ▼
┌─────────────────────────┐
│        Read API         │  ← ユーザーからのリクエストに応答。
│  (ユーザー向けBackend)   │    外部APIを直接呼ばない。
└────────────┬────────────┘    DBの保存済みデータのみ参照。
             ▼
┌─────────────────────────┐
│        Database         │
│       PostgreSQL         │
└──────┬──────────┬───────┘
       ▲          │
       │          │(書き込み)
┌──────┴───────┐  │
│  Ingestion    │◄─┘
│  Worker       │
└──────┬────────┘
       ▲
       │ 起動
┌──────┴────────┐      ┌──────────┐
│  Scheduler     │─────▶│  Queue    │
└────────────────┘      └────┬─────┘
                              ▼
                     ┌─────────────────────────┐
                     │ External Data Providers │
                     ├─────────────────────────┤
                     │ Economic Data API       │
                     │ FX Price Data API       │
                     │ Official Sources        │
                     │ News Sources(将来)      │
                     └─────────────────────────┘
```

**責務**:

- **Read API**: アプリからのリクエストに応答する。外部APIを直接叩かず、DBに保存済みのデータのみを返す。これにより外部API障害・遅延がユーザー向けAPIの応答性に影響しない。
- **Scheduler**: 通常時は経済指標カレンダー・FX価格の定期取得ジョブをキューに投入する。重要イベントが近づくと、対象通貨ペアの取得頻度を上げるジョブに切り替える(具体的な間隔は6.2節参照)。
- **Queue**: 取得ジョブを保持し、Workerに処理させる。同一対象への重複ジョブ投入を防ぐ。
- **Ingestion Worker**: Queueからジョブを取り出し、外部APIを呼び出し、結果をDBに書き込む。Retry・Backoffはこの層の責務とする(9.4節)。

将来的にはWebクライアントを追加する。iOS/Web間でBackend(Read API)・DB・ユーザー・課金情報を共有する。

---

## 3. クライアントアプリ設計

### 3.1 対象プラットフォーム

MVPでは、iPhone / iPad を対象とする。Webは将来拡張を前提としてBackend/APIを設計する。

### 3.2 技術スタック(MVP正式採用、v1.8で確定)

**MVP正式採用: SwiftUI + Xcode(ネイティブiOS/iPadOSアプリ)**(HQ確定、2026-09-16)。

| 項目 | 採用技術 |
|---|---|
| Frontend | SwiftUI |
| IDE / Build | Xcode |
| Asset管理 | Xcode Asset Catalog |
| 認証SDK | Supabase Auth SDK(iOS) |

**確定理由**:

- 本プロジェクトの主要プラットフォームがiOS/iPadOSであること
- 現在のUI設計(ui-screens.md)がSwiftUI/iOSネイティブの画面構造を前提としていること
- iOS Launch Screen / Asset Catalog / iOSネイティブUIとの整合性を優先すること
- iPhone/iPadのレスポンシブUIをネイティブに最適化すること
- 本設計がクロスプラットフォーム対応をMVPの目的としていないこと

旧版(v1.0〜v1.7)で技術候補としていた「React Native + Expo」は、MVPの正式採用候補から外す。Backendは既存設計どおりBackend API + PostgreSQL / Supabaseを使用する(変更なし)。Web版展開時のクライアント技術は27章の通り別途検討する(将来拡張、MVP対象外)。

---

## 4. Backend設計

### 4.1 Backendの責務(Read APIとIngestion Workerに分離)

**Read API**が担当:

- 認証・ユーザー管理
- 経済イベント・FX価格データの参照(DB保存済みデータの返却のみ)
- お気に入り・通知条件・サブスクリプション状態の読み書き(外部API呼び出しを伴わないユーザーデータ)
- 統計・過去比較結果の返却(事前計算済み、または軽量なDBクエリで算出可能な範囲)

**Ingestion Worker**が担当:

- 経済イベント管理(外部APIからの取得・Snapshot保存)
- FX価格データ管理(外部APIからの取得)
- イベントと価格データの関連付け(9章の同期ルールに基づく)
- pips計算・サプライズ計算(Snapshotに基づく)
- 統計計算(結果をDBに保存し、Read APIはそれを返すのみ)
- AI分析データ生成(11章、将来拡張分を含む)

### 4.2 Backend方針

MVPではモノリシック構成(Read APIプロセス・Workerプロセスの2プロセス)を採用する。複雑なマイクロサービス構成は採用しない。

```
Backend(モノリポ)
├── apps/
│   ├── read-api/     … ユーザー向けAPI
│   └── worker/       … Ingestion Worker
└── packages/
    ├── auth
    ├── event
    ├── fx-price
    ├── analysis
    ├── historical
    ├── notification
    ├── subscription
    └── ai
```

内部的には責務を分離するが、初期段階ではこの2プロセス構成に留める。

---

## 5. Database概要

**Supabase + PostgreSQLを正式採用する**(DB詳細設計でHQ確定、2026-09-16)。RLS(Row Level Security)は参考モデルではなく実装前提の設計条件とする。データ特性に応じてRLS方針を分離する: ユーザー固有データ(Profile/Subscription/Entitlement)は本人のみアクセス可能なRLSを適用し、共有データ(EconomicIndicator/EconomicEvent/EventSnapshot/EventRevision/EventExplanation/IndicatorFxPair/FxPair/FxPrice/EventPriceReaction)はユーザー単位のRLSを前提としない(具体的なポリシーは`db-design.md`参照)。

### 5.1 主要エンティティ(改訂: EconomicEvent / EventSnapshotを別Entityに分離)

**HQ確定(2026-09-16、DB詳細設計)**: `EconomicEvent`と`EventSnapshot`は同一エンティティではなく、**別テーブル**として正式に採用する。`EconomicEvent`はイベントのメタデータ(いつ・どの指標が・どんな状態か)を、`EventSnapshot`は発表時点で利用可能だった値(forecast/actual/previous等)を保持する。旧版(v1.0〜v1.3)の「EconomicEvent(= EventSnapshot)」という表現はこの分離方針に置き換える。

```
Profile(認証基盤=Supabase Authのユーザーに対応するアプリ側データ。L-1でUserから改称)
 │
 ├── FavoriteIndicator
 ├── FavoritePair
 ├── AlertSetting
 ├── Subscription
 └── Entitlement

Indicator
 │
 ├── IndicatorFxPair[]    … Indicator×FxPairの多対多関連(5.2節)
 │        │
 │        └── FxPair
 │
 └── EconomicEvent                … イベントのメタデータ(不変ではない。status/data_status等は更新されうる)
        │
        ├── EventSnapshot[]       … 発表時点で利用可能だった値。immutable(5.4節)。MVPではRELEASE種別のみ使用
        ├── EventRevision[]       … 後日の改定履歴(参考情報。分析には使わない、5.5節)
        ├── EventExplanation      … 乖離理由(MVP: 出典付き事実要約 / 将来: AI解説、5.6節)
        └── EventPriceReaction
                  │
                  └── FxPrice

FxPair

IngestionLog(他Entityへの直接参照なし。外部データ取得・取り込みの運用ログ、5.8節)

Person
 │
 └── SpeechEvent
        │
        └── SpeechPriceReaction
```

### 5.2 Indicator

指標固有の情報: indicator_id / name / country / currency / category / unit / importance / description / **favorable_direction**(HIGHER_IS_POSITIVE / LOWER_IS_POSITIVE / NEUTRAL、9.2節。DB詳細設計でHQがenum名を確定) / source

**Indicator↔FxPairの関連**: 「関連通貨ペア表示」(機能一覧 FEAT-028)に必要な、指標ごとの分析対象FXペアを、固定文字列ではなく`IndicatorFxPair`という多対多の中間テーブルで管理する。指標ごとの主要/準主要ペアの区別は`priority`フィールドで表現する(DB詳細設計で確定、`db-design.md`参照)。

```
Indicator ── IndicatorFxPair ── FxPair
```

### 5.3 EconomicEvent

**特定日時に発表される1回のイベントのメタデータを管理するレコード。** 発表時点の値そのもの(forecast/actual/previous)は保持せず、5.4節の`EventSnapshot`が保持する。

管理情報: event_id / indicator_id / release_datetime / release_datetime_precision(時刻精度フラグ、8.2節。値はEXACT/DATE_ONLY/APPROXIMATE/UNKNOWN) / importance / status(SCHEDULED/RELEASED/CANCELLED) / data_status

### 5.4 EventSnapshot(改訂: EconomicEventから分離)

**最重要エンティティ。発表時点でユーザーに提供されていた情報を、不変(immutable)に保存する。** 一度保存した`actual`・`previous`は、後日の改定があっても書き換えない。

管理情報: snapshot_id / event_id / snapshot_type / forecast(nullを許容) / actual / previous / unit / source / source_url / captured_at / surprise(forecast・actualのいずれかがnullならnullも許容) / surprise_direction(favorable_directionに基づく方向性)

**snapshot_type**: 1種類固定ではなく、将来的な複数種類を想定した設計とする(HQ方針、2026-09)。**MVPでは`RELEASE`のみ使用する。** 分析(Surprise計算・pips計算・過去比較・統計)には常にRELEASE Snapshotを用いる。後からPrevious等が改定されてもRELEASE Snapshotは書き換えない(改定情報は5.5節の`EventRevision`で管理する)。

### 5.5 EventRevision

後日判明した改定情報を追記するテーブル。`EventSnapshot`の値は書き換えない。

管理情報: revision_id / event_id / field(actual/previousのいずれか) / old_value / new_value / revised_at(改定が判明した日時) / revision_source

**UI表示ルール(HQ回答、2026-09で明確化)**: UI上は「参考情報: この指標は後日◯◯に改定されました」として、Snapshotの値とは別枠で表示する。改定値を表示する箇所には必ず**「改定後」等のラベルを付し、発表時点(Snapshot)の値と視覚的にも文言上も明確に区別する。** 発表時点の分析結果(Surprise・市場反応・統計)は、改定値によって書き換えない(5.1節原則、要件定義書v1.5 5.1節と同じ)。機能一覧のFEAT-045「Revised Previous表示」は、この`EventRevision`に基づく改定履歴の参考表示を指す。`EventSnapshot`に可変の`revised_previous`フィールドを持たせることはしない。

### 5.6 EventExplanation(新設: DB詳細設計でMVP必須Entityとして再確認)

11章の「乖離理由」機能に対応するEntity。MVPではAIによる自由形式の推測・解説ではなく、公式情報・公式ソースに基づく事実情報を保持する。

管理情報: id / event_id / version(新旧の判別用) / explanation_type / summary / source / source_url / published_at / created_at

**上書きせず履歴保持とする(DB詳細設計でHQ確定、2026-09-16)。** 同一イベントについて複数のExplanationが存在しうる構造とし、将来的なAI分析導入時にも過去の生成結果を追跡できるようにする。将来的にAI分析等へ拡張できる構造にする(11.2節の拡張方針を維持。AI向けの追加カラムはMVPでは追加せず、実装時のMigrationで追加する方針。具体的なカラム設計は`db-design.md`参照)。

### 5.7 FxPair

USDJPY / EURUSD / GBPUSD / EURJPY / GBPJPY / AUDJPY / NZDJPY / AUDUSD / NZDUSD / USDCHF / USDCAD / EURGBP

各ペアについて、base_currency / quote_currency / pip_size / decimal_digits を管理する。**pipsの定義はFrontendに持たせずBackendを正とする。**

### 5.8 IngestionLog(新設、M-4)

外部データ取得・取り込みの運用ログ(機能一覧FEAT-150に対応)。一般ユーザー向けAPIからは非公開とし、管理者機能・Ingestion Worker内部でのみ参照する。具体的なカラム定義は`db-design.md` 3.13節を正とする。

---

## 6. 経済指標データ取得

### 6.1 データ取得方式

外部Economic Data APIから取得する。

### 6.2 API選定の必須条件(改訂)

要件定義書6.1節と同じ条件を設計レベルでも遵守する。**「取得したデータをエンドユーザーへ商用配信できる権利」を持たないAPIは採用しない。** 候補ごとの確認状況は要件定義書6.2節の表を正とする(推測で埋めない)。

### 6.3 必須データ

event / country / currency / release datetime(精度フラグ込み) / importance / forecast(null許容) / actual / previous / source

### 6.4 通常時とイベント前後の取得頻度

- **通常時**: Schedulerが定期的(例: 1日1〜数回)にカレンダー取得ジョブをキューに投入する。
- **イベント前後**: イベント発表が近づくと、Schedulerが対象通貨ペアのFX価格取得ジョブの投入頻度を上げる。**具体的な間隔(秒単位)は、採用するFX価格APIのRate Limitとストリーミング対応状況を確認してから詳細設計で決定する。** 本書時点では「高頻度ポーリングまたはストリーミングのいずれかを、Ingestion Workerが対応できる形で抽象化する」という方針のみ確定する。

---

## 7. FX価格データ取得

### 7.1 必要データ

MVP: 1分足・5分足・15分足・30分足・60分足。将来: 4時間足・日足。

### 7.2 保存データ

timestamp(open time基準) / open / high / low / close / volume(取得可能な場合のみ) / symbol

---

## 8. イベントとFX価格の関連付け(改訂: 同期ルールを明記)

本システムの主要処理。

### 8.1 時刻の基準

- **DB内部の時刻はUTCで統一する。** UI表示時にユーザーのtimezoneへ変換する。
- **1分足はopen timestamp基準**(足の開始時刻をその足の時刻とみなす)で統一する。データソースが異なるtimestamp規約(close time基準等)を採用している場合は、取り込み時に正規化する。
- 基準時刻 T = release_datetime(要件定義書9.2節の通り、実発表時刻の自動推定は行わず、スケジュール時刻を用いる)。
- **(M-5で追加、2026-09-16)** 日付境界の判定が必要なAPI(例: Home画面の「今日」の範囲判定)では、Profileにtimezoneを永続化するのではなく、**Requestパラメータとしてtimezoneを明示的に受け取る**方式とする(API詳細設計でHQ確定)。例: `GET /api/v1/home?date=2026-09-12&timezone=Asia/Tokyo`。

### 8.2 発表時刻の精度管理

`release_datetime`の精度を`release_datetime_precision`として保持する(値: EXACT/DATE_ONLY/APPROXIMATE/UNKNOWN、DB詳細設計でHQ確定、2026-09-16)。正確な発表時刻が保証されないイベントを、1分足などの高精度な市場反応分析対象として誤って扱わないことを目的とする。実発表時刻がスケジュールと乖離したことが外部情報で確認できた場合のみ、`release_datetime`を更新し、その旨をdata_statusに記録する(自動推定はしない)。

### 8.3 基準価格・各時点の定義

- **発表直前価格**: Tを含む1分足の直前に確定した1分足のClose。
- **T+1m / T+5m / T+15m / T+30m / T+60m**: Tからその分数が経過した時点までに確定している1分足のClose。

### 8.4 変動計算

各時点について price / absolute change / pips / percentage change を計算する(Backend、9章の値を用いる)。

例:
```
USD/JPY: Before 147.20 → +1m 147.48(+28pips) → +5m 147.76(+56pips) → +15m 148.05(+85pips)
```

### 8.5 データ欠損・不確実性

以下の場合はdata_statusで管理し、推測値は生成しない。

- 価格データ欠損 / イベント時刻不明・低精度 / API障害・取得遅延 / 時刻ずれの疑い / 市場休場 / データ取得遅延

`data_status = PARTIAL`/`UNAVAILABLE`(DB詳細設計でHQが確定した値)で管理し、Read APIはこれをそのまま(null等で)返し、クライアントは必ずN/A表示する契約とする。

---

## 9. サプライズ分析

### 9.1 基本計算

原則: `Surprise = Actual - Forecast`

### 9.2 指標ごとの方向性

Indicator.favorable_directionにより、上振れ/下振れの意味を指標単位で定義する(HIGHER_IS_POSITIVE / LOWER_IS_POSITIVE / NEUTRAL、DB詳細設計でHQ確定、2026-09-16)。MVPはこの符号ベース判定までを対象とする。

### 9.3 Forecastが存在しない場合(新設)

Forecastがnull、またはActualが未確定のイベントは、**Surpriseもnullとして保存する(0にしない)。** Read APIはnullをそのまま返し、クライアントは「Surprise分析対象外」と表示する。**「欠損 = 0」とは絶対に扱わない**(HQ方針、2026-09-16)。

Surpriseは、`Actual - Forecast`の生の差分(raw surprise)に加え、`favorable_direction`に基づく方向性(surprise_direction)を区別できる設計とする(DB詳細設計、`db-design.md`参照)。Surpriseは算出時点でDBに保存する方式を採用する(12章のキャッシュ方針と整合)。

### 9.4 将来拡張

Absolute Surprise / Percentage Surprise / Standardized Surprise / Magnitude Bucket(段階分類)は将来拡張とする。閾値定義は詳細設計で確定する。

---

## 10. 過去イベント分析

### 10.1 基本データ

Date / Forecast / Actual / Previous / Surprise / 5m/15m/30m/60m movement

### 10.2 統計(改訂: 不完全データの除外)

Indicator単位・FX Pair単位で、平均変動・平均絶対変動・最大変動・最小変動・上昇回数・下落回数・変化なし回数を、時間別(1/5/15/30/60分)に算出する。

**`data_status = AVAILABLE`(DB詳細設計でHQが確定した値)のイベントのみを統計計算の対象とする。** 欠損・不完全なイベントは統計から除外する。Read APIは、算出に使ったイベント数(母数)を統計結果とあわせて返却し、クライアントは「過去20回中18回のデータで算出」のように母数を明示する。

### 10.3 対象件数の考え方

固定件数(例: 常に20件)に依存せず、**「data_status=AVAILABLEの直近N件」**を対象とする設計を基本とする。目安件数(20件相当)に満たない場合は、確保できた件数で計算し、母数を明示する(10.2節)。

### 10.4 類似イベント(将来拡張)

今回のSurprise + 過去のSurprise + イベント条件から類似イベントを検索する機能は将来拡張とする。

---

## 11. 「なぜ予想から離れたのか」の分析(改訂: MVPスコープを縮小)

### 11.1 MVPの役割

**MVPでは、AIによる自由生成の解説は行わない。** 公式発表・公式資料・信頼できる情報源から、**出典URL付きの事実要約**を`EventExplanation`として保存・表示する。

`EventExplanation`(MVP版)の管理情報: explanation_id / event_id / summary_text(事実ベース、推測を含まない) / source_url[] / source_type(official/news等) / created_at

**出典が取得できない場合、summary_textを生成・表示しない**(空表示または「情報なし」)。

### 11.2 将来拡張: AIによる乖離理由分析

将来、AIによる要因分析・市場反応の整理・類似イベントとの比較説明を追加する。そのために`EventExplanation`には以下のフィールドを**MVP時点から設計上確保しておく**(値の投入は将来でよい):

- generated_by(human_curated / ai_generated)
- generation_type(fact_summary / ai_analysis / ai_speculation)
- source_references[](根拠となった情報源のURL・抜粋)
- generated_at
- confidence_note(AIによる推測が含まれる場合、その旨を明示するフラグ)

将来のAI生成でも、**事実(公式発表由来)・ニュースによる説明・市場関係者の見解・AIによる要約・AIによる推測、を`generation_type`等で区別して表示する構造**を維持する。出典が確保できない場合はAIが推測で説明文を生成しない方針を継続する。

### 11.3 生成タイミングとキャッシュ(新設)

AI分析(将来分含む)は、**都度生成せず、イベント単位で1回生成した結果をDBに保存し、以後は保存済みの結果を返す。** これにより生成コストの増大とレイテンシを抑える。再生成が必要な場合(情報源の更新等)は、明示的なジョブとして扱う。

---

## 12. キャッシュ方針(新設)

現時点ではRedis等の外部キャッシュ層を必須としない。基本方針:

- 計算済みのEventPriceReaction・統計値は、算出した時点でDBに保存する。
- Read APIは保存済みの値をそのまま返す(リクエストごとに再計算しない)。
- 外部キャッシュ層(Redis等)が必要かどうかは、β版でのアクセス集中状況・負荷試験の結果を見て判断する。MVP設計では前提としない。

---

## 13. データ品質管理・運営機能(新設)

データ品質がプロダクト価値そのものであるため、将来的に運営者が以下を確認・修正できる管理機能が必要になる。

- data_statusの確認・手動修正
- イベント情報・データソースの確認
- 異常データの検知結果の確認

**この管理機能は、一般ユーザー向けのアプリ画面・APIとは明確に分離する**(別の管理者向けAPI・画面とする)。具体的な権限設計・UIは詳細設計に持ち越す。MVPの初期段階では、DBを直接確認する運用でも許容されるが、その場合も「どのデータが不確実か」をクエリ一発で抽出できるようdata_statusを一貫して付与しておくことを設計原則とする。

---

## 14. 要人発言

MVPでは基本機能を優先し、拡張機能として設計する(要件定義書と同様)。SpeechEvent / SpeechPriceReactionのデータモデルはEconomicEvent/EventPriceReactionと同様の考え方(Snapshot性・時刻同期ルール)を踏襲する。

---

## 15〜24. 画面構成・検索・通知・認証

### 15.1 App起動フロー(SCR-000 Splash / Launch Screen)(新設、v1.7)

アプリ起動時のフローとして、SCR-000 Splash / Launch Screenを画面設計(ui-screens.md 5.0節)に正式追加した。本節では概要設計レベルでの責務分離と遷移ロジックのみを記す。UIレイアウト・色・レスポンシブ仕様等の詳細はui-screens.md 5.0節を参照。

**責務分離**: iOSがアプリプロセス起動前に表示するシステムレベルのLaunch Screen(白画面回避のためのOS機能、Xcode Launch Screen Storyboard/Asset)と、アプリ内画面であるSCR-000(SwiftUIで実装される、ブランド表示・初期化・認証判定・遷移先決定を担う画面)を、同一画面・同一責務として扱わない。

**起動フロー**:

```
App起動 → iOS Launch Screen → SCR-000 Splash → アプリ初期化
  → Supabase Authセッション確認
    ├─ セッションあり → SCR-001 Home
    └─ セッションなし → SCR-010 Login
```

**Session Expired**: SCR-000でのセッション確認時にセッション期限切れを検出した場合、SCR-010 Loginへ遷移する(「セッションの有効期限が切れています」「再度ログインしてください」を表示)。

**初期化エラー/API接続エラー**: 無限ローディング状態を作らず、常に再試行手段を提示する。可能な範囲で認証エラーとAPI接続エラーを区別し、エラー詳細をユーザーへ過度に露出しない。

**設計原則**: SCR-000は経済指標データ・FXチャート等のデータ取得を待ち受けない、最小限の初期化(Auth/初期設定/API疎通確認)に留める画面とする。Splashは「データ分析画面」ではない。

**API/DB設計への影響**: 本追加のために新規APIエンドポイントは設けない。既存のAuth/Account/Backend疎通確認用のAPIを利用する(api-design.mdへの変更は不要、43章参照)。DB設計への変更も不要(db-design.mdへの変更は不要)。

### 15.2 App Icon / Brand Asset方針(新設、v1.7)

App Iconをブランドアセットとして正式に設計対象へ加えた。詳細な配色方向性・Asset管理方針・「フルロゴ版」「シンボル版」の2候補はui-screens.md 9章を参照。

**概要**: FX/マーケットチャート・上昇トレンドを抽象化したグラフィックを、ブルー〜シアン系グラデーションで濃紺〜黒背景上に配置する方向性とする。正確なRGB値は実装時のDesign Tokensで確定し、本書・ui-screens.mdでは方向性のみを定める。iOS App IconはXcodeのAsset Catalog(AppIcon)で管理し、元画像をUIコードへ直接埋め込む設計は採らない。

**その他(検索・要人発言・通知・認証)**: v1.0の内容を維持する。本節(15.1/15.2)以外に、本レビューによる変更はない。

---

## 25. サブスクリプション(改訂: MVPスコープをHQが明確化)

### 25.1 MVPスコープの区分(新設、HQ回答2026-09)

機能一覧レビューでFEAT-224(Subscription)の優先度がP2→**P1**に変更された。ただし、これは「MVPで決済まで完成させる」という意味ではなく、以下のように**設計対象と実装タイミングを分離する**方針である。

**MVP設計対象(P1、Free/Proへ拡張可能な設計をMVPから作り込む)**:

- Free / Proのプラン概念
- ユーザーの現在プランの管理
- 機能アクセス判定(Entitlement)ロジック
- Backend側のEntitlementデータ構造(将来のApp Store Subscription導入を前提とした設計)
- UI上のプラン表示

**実装タイミングを別途判断するもの(β版前後で決定)**:

- App Store決済(StoreKit)の実装
- 購入処理・更新・解約
- レシート/トランザクション検証

**まとめ**: 「課金を後から追加する設計」ではなく、「最初からFree/Proへ拡張可能な設計にしておき、決済機構の実装タイミングだけ後で判断する」という方針。MVPリリース時点でEntitlementの仕組み自体は動いているが、実際の決済が有効になっているかどうかは、Beta前後の判断次第で変わりうる(例: 当面は全ユーザーをPro相当のEntitlementとして扱い、決済導入時に実際の判定へ切り替える、といった移行パスも取りうる設計にしておく)。

### 25.2 Free / Pro

v1.0の内容を維持する。ただし、Proプランの「AI分析」の実体は、要件定義書12.3節・本書11.2節の将来拡張スコープに従う。**MVP時点のProプランでは、AI分析は出典付き事実要約(11.1節)であり、自由生成のAI解説は含まれない。**

### 25.3 価格

**Subscriptionの価格は現時点では確定せず、β版での利用状況・継続率・機能利用率を見て決定する方針を維持する。** 月額980円/年額9,800円は初期候補であり、実装時の固定値としない。

---

## 26. 継続利用設計

v1.1(要件定義書)の継続利用ループ・3フェーズ設計をそのまま踏襲する。本レビューによる変更はない。

## 27. Web拡張

v1.0の内容を維持する。Backend(Read API)/DB/Account/Subscriptionを共通化する方針に変更はない。

---

## 28. MVP範囲(再定義)

### MVP必須

- FX Pair表示 / 経済指標一覧 / 指標詳細
- Forecast / Actual / Previous(**発表時点Snapshot**として)
- 基本Surprise(符号ベース、Forecastなしはnull)
- イベント前後チャート(1m/5m/15m/30m/60m、8章の同期ルールに基づく)
- 過去イベント / 過去イベント詳細 / 過去イベント比較(データ品質の揃った件数のみ、母数表示)
- 基本統計(不完全データ除外)
- 指標詳細への遷移
- **データ品質管理**(data_statusの一貫した付与、13章)
- Backend側pips計算
- 経済指標データ取得・FX価格データ取得(Scheduler/Queue/Worker構成、2章)
- Event × FX Reaction処理(Snapshotベース、改定に影響されない)
- 乖離理由: **出典付き事実要約のみ**(11.1節)
- **Subscriptionの設計**(Free/Proプラン概念・Entitlement判定ロジック・プラン表示。決済実装そのものは含まない、25.1節)
- **Indicator↔FxPairの多対多関連**(5.2節)

### MVPでは縮小

- 乖離理由の高度なAI分析(自由生成解説)は実装しない。事実要約+出典URL表示に留める。
- Subscriptionの決済実装(StoreKit・購入/更新/解約・レシート検証)はβ版前後で実装タイミングを別途判断する(25.1節)。MVP必須なのはEntitlement設計まで。

### 将来拡張(設計だけ考慮、実装は後回し)

- AIによる乖離理由分析・AI市場反応分析(11.2節の構造を先に確保)
- Surprise Magnitude Bucket / Standardized Surprise / 類似Surprise分析
- 要人発言の高度AI分析
- 高度な通知・パーソナライズ
- Web版
- コミュニティ(**機能一覧v1.2で具体化**: 一般的な掲示板ではなく、特定の経済イベントを中心とした共有機能として検討する。汎用SNS・掲示板は下記MVP対象外の通り恒久的に対象外)

### MVP対象外

- 自動売買 / Broker APIによる注文 / FX価格予測 / 高度テクニカル分析
- 一般コミュニティ・SNS(=汎用掲示板。上記の「イベント中心の共有機能」とは別物)
- マイクロサービス化
- 過度な管理者RBAC

---

## 29. 概要設計上の重要原則(改訂)

1. 経済イベントをシステムの中心エンティティとする。
2. Forecast / Actual / Previous / Surprise / Price Reactionを関連付ける。
3. イベント発生時刻とFX価格の時間同期を最重要データ品質項目とする(8章の同期ルールを厳守)。
4. FrontendではなくBackendを計算結果のSource of Truthとする。
5. 外部APIを直接Frontendから呼び出さない。
6. MVPでは過剰な複雑化を避ける(ただしRead API/Worker分離は複雑化ではなく責務分離であり、この原則と矛盾しない)。
7. Web・AI・通知・コミュニティを将来追加できる構造にする。
8. AIは分析・説明を担当し、価格予測を担当しない。
9. 過去データ単体ではなく、新しいイベントの分析に過去データを利用する。
10. データソースのライセンス・保存・再配布条件を本番採用前に確認する。
11. **(新設)発表時点の値(Snapshot)と後日の改定(Revision)を区別し、分析には常にSnapshotを用いる。**
12. **(新設)不完全なデータは推測で埋めず、統計・比較の対象からは明示的に除外し、母数をユーザーに提示する。**

## 30. 詳細設計へ引き継ぐ項目

1. DBテーブル定義・カラム型・PK/FK・Index・RLS/アクセス制御
2. API Endpoint・Request/Response・Error Code
3. Economic API仕様・FX API仕様(6.2節の確認結果を反映して確定)
4. Data ingestion Jobの具体的な間隔・Retry・Rate Limit戦略
5. Event/Price timestamp alignmentの実装レベルの詳細
6. Pip計算・Surprise計算・統計計算の実装
7. AI processing flow(将来分の実装)
8. Notification処理・Subscription validation
9. App画面仕様・State管理・Loading/Error/Empty state
10. Test cases・Monitoring・Deployment・CI/CD
11. データ品質管理機能(運営者向け)の権限設計・UI

## 31. 概要設計の未確定事項

- Economic API / FX Price APIの最終選定(要件定義書6.2節の確認結果次第)
- Backend framework / Cloud infrastructure(DBホスティング・Auth基盤はSupabaseに確定、5章参照)
- AI provider(将来分)
- Subscription provider / Notification infrastructure
- Web framework
- Ingestion Workerの具体的なポーリング間隔・ストリーミング利用の要否(採用APIの仕様次第)
- Data retention period / Historical data acquisition period
- API障害時のFallback(複数データソース併用の要否)
- Free/Proの最終機能境界
- 料金
- β版の利用制限

これらは現段階で無理に固定せず、コスト・データ品質・ライセンス・技術的実現性を比較した上で詳細設計時に決定する。
