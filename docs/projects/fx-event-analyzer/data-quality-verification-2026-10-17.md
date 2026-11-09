# 0円データ検証の実施記録(HQ指示「0円の実データ検証を実行し、Twelve Data問い合わせを完成させる」2026-10-17)

作成: 2026-10-17。本番DBへの接続、新規APIキー・契約・課金プラン変更は一切行っていない。
外部の有料API(Twelve Data・BLS等)への新たな呼び出しも行っていない(既存のテスト・CIの
記録を調査したのみ)。

## 0. 実行環境の制約(最初に明記)

本セッションの実行環境(クラウドのLinuxサンドボックス)には **Xcode・Swiftツールチェインが
存在しない**(`swift`・`xcodebuild`コマンドが無い)。そのため、**iOSアプリ側(Simulator・
実機)のテストは、この環境では一切実行できない**。この制約は今回新たに判明したものであり、
iOS側の項目(3の一部、4のUI部分)は「未検証」として扱う(実行不可能という事実を正直に
報告し、成功したと装わない)。

Backend側(Node.js/TypeScriptのテスト・CI)は実行可能で、以下の通り実施した。

## 1. 1分足・5分足・15分足の表示値と集計結果の整合性 — **検証済み(既存テストで確認)**

`aggregateMinuteRows`(`fx-event-analyzer-backend/src/ingestion/pipelines/fxPrices.ts:498`)の
ロジックをコードで確認し、既存テストを実行した。

* 5/15分足などの集計足は、対応する1分足が**全て揃っていて、かつ全てUNVERIFIEDでない場合のみ**
  作られる(1本でも欠けている・UNVERIFIEDな区切りは作らない)。
* open=区切り内の最初の1分足のopen、close=最後の1分足のclose、high/low=区切り内の最大/最小。
* 実行結果: `tests/ingestion/fxGapRepair.test.ts`(97件中含む)を実行し、全件成功。
  特に「repairs a past hole and rebuilds the aggregates that mix stored and repaired minutes」
  (保存済みと補填した1分足が混在する場合の集計の再構築)を含めて成功を確認。
* 実行コマンド: `npm test`(既存のvitestスイート、外部APIは呼ばない)。結果: **696 passed /
  175 skipped**(skippedは全てDocker必須のintegrationテスト、下記4節参照)。

## 2. 時刻・タイムゾーン・足の開始/終了時刻の整合性 — **検証済み(既存テストで確認)**

* 足の時刻は**足の始まり**(バケットの開始、UTC基準)で統一されていることをコードで確認
  (`aggregateMinuteRows`の`timestamp: new Date(start).toISOString()`)。
* Twelve Data呼び出し時に`timezone=UTC`を明示する既存の実装(data-sources.md 150行目に
  記載済み)により、取得元の取引所時刻帯との混同を防いでいることを確認。
* 表示側(カレンダー等の「今日」判定)のタイムゾーン変換は`tests/domain/timezone.test.ts`
  (11件、DST境界を含む: America/New_York・Europe/London・America/Santiagoの夏時間境界日を
  個別にテスト)で全件成功を確認。
* 実行結果: 上記`npm test`に含まれ、全件成功。

## 3. データなし、通信失敗、更新遅延時の画面表示 — **一部検証済み・一部未検証**

| 範囲 | 結果 |
|---|---|
| Backend: データ無しの扱い(品質レポート) | **検証済み**。`tests/ingestion/dataQuality.test.ts`の「pairs without data > reports データなし(取り込み未開始) instead of 100% missing」が成功。実データが無いペア・期間を「0%」や「欠損100%」ではなく明確に「データなし」と区別して表示することを確認 |
| Backend: 通信失敗・レート制限時の扱い(取り込みジョブ) | **検証済み**。`tests/ingestion/fxGapRepair.test.ts`の「429 that survives the retries」「a timeout or API error for one pair does not stop the others」等が成功。1ペアの失敗が他ペアを止めないこと、レート制限時に以降のリクエストを止めることを確認 |
| iOS: データなし/通信失敗/更新遅延の**画面表示**そのもの | **未検証(環境制約)**。`FXEventAnalyzerTests`にエラー状態を扱う単体テスト(`HomeViewModelTests.testLoadOtherFailureShowsGenericError`・`Phase3ViewModelTests.testLoadGenericErrorShowsErrorState`等)がソースコード上に存在することを確認したが、本セッションにはSwift/Xcodeツールチェインが無いため**実行できなかった**。実行していないものを実行済みとは報告しない |

## 4. 複数ユーザーのデータ分離に関する既存RLSテスト — **検証済み(直前のCI実行結果を確認)**

本セッションのサンドボックスにはDocker daemonが動いておらずSupabase CLIも入っていないため、
**このセッション自身でRLS統合テストを新たに実行することはできなかった**。そのため、代わりに
GitHub Actions上で既に実行されている結果を確認した(新しい実行はしていない。閲覧のみ)。

* 対象: `FX Event Analyzer Backend — CI` ワークフロー、run #39005441068(現在のbackendコードの
  最新コミット `1fbc360a`、前回ラウンドのpushで自動的に実行されたもの。今回新たに実行させた
  ものではない)。
* `db-and-integration`ジョブが**実際のローカルSupabaseスタック(Docker、CI専用の一時的な
  コンテナ。本番DBではなく、ジョブ終了後に破棄される)**に対して統合テストを実行し、成功
  (conclusion: success)。
* 実行されたRLS関連テスト(ログで確認):
  - `tests/integration/auth.test.ts`(14件): 「RLS — user isolation (db-design.md §6, defense
    in depth)」— 他ユーザーのprofile/subscriptions/entitlementsを直接SELECTできないこと、
    匿名リクエストが誰のprofileも読めないことを確認。全件成功。
  - `tests/integration/notification-inbox.test.ts`の「RLS」: 「an app user can read only their
    own rows directly」成功。
  - `tests/integration/rate-alerts-calendar-updates.test.ts`の「RLS」: 「an app user can read
    only their own rate alerts」成功。
  - `tests/integration/support.test.ts`のRLSテスト(app usersがsupport_requestsを直接
    読み書きできないこと)も成功。
  - 全体: 13ファイル・183件、全て成功(`Test Files 13 passed (13)` / `Tests 183 passed (183)`)。
* **結論**: 複数ユーザーのデータ分離(RLS)は、現在のbackendコードに対して直前のCI実行で
  実際に検証されており、成功している。本ラウンドではこの既存結果を確認しただけで、新たな
  テスト実行・DB接続は行っていない。

## 5. /api/v1/quality-report の自己一致・独立照合・未照合件数の表示 — **ロジックは検証済み、実データでの表示は未検証**

* 本セッションには開発DBの認証情報(`SUPABASE_SERVICE_ROLE_KEY`)が無く、実際のDBに対して
  レポートを生成することはできなかった(本番DBはもちろん、開発DBにも接続していない)。
* 代わりに、分類ロジック自体の単体テスト(`tests/ingestion/dataQuality.test.ts`の
  「economic values」「zero-denominator labels」グループ、合成データ・フィクスチャ使用)を
  実行し、全件成功を確認:
  - 自己一致(BLSスケジュールの値を同じ取得値と比較)を独立照合に数えないこと
  - 独立(paid-calendar vs BLS)の一致・不一致をそれぞれ正しく分類すること
  - 照合元が存在しない場合(SINGLE_SOURCE)・未発表(AWAITING_OFFICIAL)を別バケットに
    分けること
  - 既存データ(provider/verification_sourceが無い古い形式)との後方互換
* 前回ラウンド(commit `1fbc360a`)で、開発DBに対する実際のレポート生成が既に確認されており
  (「自己一致: 20、独立照合済み: 0」)、本ラウンドではその値を再現する新たな実行はしていない
  (認証情報が無いため不可能)。ロジックは変更していないため、値も変わっていないはずだが、
  **今回これを直接再確認したわけではない**。

## 6. APIクレジット上限800/日・自動処理700/日の維持 — **検証済み(既存テストで確認・変更なし)**

* `tests/ingestion/fxGapRepair.test.ts`の「ingestFxWithGapRepair — credit ledger」グループ
  (5件、全て成功)で以下を確認:
  - 「automatic runs stop at 700 (leaving 100); manual runs may use 701–800」
  - 「daily cap already reached: no request, SUCCESS with a clear note, missing minutes BUDGET」
  - 「two concurrent runs cannot exceed the cap together」
* 上限値そのもの(800/700)は本ラウンドで一切変更していない(関連ファイルの編集なし)。
* **本ラウンドの検証作業自体によるクレジット消費: 0**。Twelve Data・BLS等、クレジットを
  消費する外部APIへの新たな呼び出しは行っていない(実行したのは既存のvitestスイートのみで、
  いずれもモック・フェイクのテストダブルを使い、実際のネットワーク呼び出しは発生しない)。

## 7. 発見した不具合

**無し。** 上記の実行の中で、既存の処理に新たな不具合は見つからなかった(全テスト成功、
CI実行結果も成功)。

## 8. 今回のBackend側テスト実行の要約

```
npm test(fx-event-analyzer-backend): 696 passed / 175 skipped(skippedはDocker必須のintegration系、
  うち183件は直前のCI実行(GitHub Actions)で成功済みと別途確認)
対象を絞った再実行(fxGapRepair.test.ts・timezone.test.ts・dataQuality.test.ts): 97 passed / 97
```

外部ネットワーク呼び出しは、Twelve Data公式サイトの問い合わせフォーム/コンタクトページを
WebFetchで2回読んだのみ(§B参照、データAPIではなく通常のWebページ。無料・無認証)。

## 9. 2026-10-18追記: 発表時刻と価格変動の計測基準の一致(HQ指示「実機テスト保留中の検証を進める」優先順位1への回答)

既存コードを確認した(新規テスト実行は、コード調査から導かれた具体的な項目のみ`npm test`で
再確認。全テストの再実行は1回のみで697件中696passed/175skipped、前回と同一)。

### 9.1 要人発言(speech_events)の値動き — **一致を確認済み(テスト済み)**

`src/domain/speechReactions.ts`のコード冒頭コメントが明記: 「fx_pricesのtimestampは**足の
開始時刻**であり、ある時刻Xの価格は、X-1分に開始してXに終わる1分足の**close**である」という
規則を、`closeTimeMs()`(`timestamp + 1分`)で一貫して実装している。発表時刻
(`statement_datetime`)もfx_pricesのtimestampも両方UTCの`timestamptz`であり、同じ時計(`Date.parse`)
で比較している。

テストで確認されている内容(`tests/domain/speechReactions.test.ts`、既存):
* 「発表直前の価格 = 発表時刻以前に終わる最後の足のclose(その足はT-1分に開始)」
* 「T+N分の価格 = T+Nに終わる足のclose、その足が無ければnull」
* 候補の足が無ければ`DATA_UNAVAILABLE`、未来の時間枠は`DATA_PENDING`、キャンセルは`NOT_ANALYZABLE`
  (いずれも「無いものを無いと示す」設計で、推測で埋めていない)

### 9.2 経済指標(economic_events)の値動き — **計測基準の一致を確認できない。実装が無いため**

`event_price_reactions`テーブル(`supabase/migrations/20260917000007_...sql`)のコメントは
「Ingestion Workerが計算して書き込む」と明記しているが、リポジトリ全体を検索した結果、
**このテーブルに実際に書き込むジョブ・関数・トリガーが存在しない**(`src/jobs/`配下のいずれにも
該当する処理がない。`supabase/`配下でも、このテーブルへの書き込みは`seed.sql`(開発用の固定
テスト値)のみで、本番相当の自動計算は無い)。

読み取り側(`src/repositories/reactionsRepository.ts`、`src/routes/events.ts`)は、行が存在しない
場合に`null`を返す設計になっており、クラッシュや誤った値の表示にはならない。**しかしこれは
「未検証」ではなく「未実装」である**: 経済指標発表回の1分/5分/15分の価格反応は、現在の
コードベースには計算経路そのものが存在しない。開発DBにこの種のデータが入っているとしても、
それは手動またはseedによる固定値であり、本番の自動計算結果ではない。

**この区別を明確にして報告する**: SCR-008相場反応詳細は経済指標・要人発言の両方から開かれる
共通画面だが、要人発言側は実装・テストされた計算経路がある一方、経済指標側は計算経路が
無い(今回新たに判明)。

### 9.3 更新遅延(staleness)の検出 — **既存テストに穴があることを確認**

品質レポートの`latestCandleAgeMinutes`(`src/ingestion/quality/metrics.ts:1195`以降、「いま
(レポート作成時点) − 最新1分足の終了時刻」)には、**専用のテストが存在しない**ことを確認した
(`latestCandleOpen`自体のテストは1件あるが、そこから「いま」を使って経過時間を計算する
ロジックは未テスト)。これは今回のコード調査で新たに見つかった、既存の穴である。バグがある
という意味ではない(ロジック自体は単純な引き算)が、HQ指示「検証していない項目を成功扱いに
しない」に従い、明示する。

### 9.4 外部の独立した情報源と照合できていない項目(再確認、変更なし)

* **FX価格(Twelve Data)の独立照合は未実装のまま**(前回までの報告通り。別の独立データ源との
  比較は無い)。
* **BLS経由の経済指標(CPI・NFP)は「自己一致」**(取得元と照合元が同一)であり、独立照合済みの
  実績には数えていない(品質レポートの分類どおり、変更なし)。
* 自己照合を独立検証済みとして報告していない(維持)。
