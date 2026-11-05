# 指標マスター全量の現状調査

- 調査日: 2026-11-05
- 調査対象: `claude/fx-indicator-master-repro` の edefa981(読み取りのみ。コード・設定・DB・マイグレーションは変更していない)
- 比較対象: 統合先 `claude/fx-settings-screens`(87983280)。取り込みの workflow(`main` の `fx-event-analyzer-ingestion.yml`)は **settings を checkout して動く**
- DEV DB の根拠: 2026-11-02 07:00Z 時点の読み取り専用 SQL の結果(大野さんが DEV で実行。監査 AUDIT_1102.sql の A-1・A-2・A-3・A-5・B-1)。それより後の状態は未確認

## 記号

| 記号 | 意味 |
|---|---|
| ○ | 実装・確認済み(DEV の実データまたは CI で確認) |
| △ | 一部実装、またはコード上のみ確認 |
| × | 未実装を確認 |
| ？ | 確認できていない |
| － | 対象外(仕様として値を持たない) |

## 一覧(全15指標)

| 指標コード | 指標名 | DB登録 | 実績取得 | 実績保存 | スケジュール | API | iOS表示 | テスト | 根拠・課題 |
|---|---|---|---|---|---|---|---|---|---|
| US_CPI | 米国 消費者物価指数(前年比) | ○ | ○ | ○ | ○ | △ | △ | ○ | BLS v1(`CUUR0000SA0`)、bls_schedule。DEV: RELEASED 10件(2026-01〜10)・予定14件、計24件 EXACT。source_url が null。前月比(副指標)は 11/2 に系列を `CUSR0000SA0` へ修正済みだが、保存済みの行には前月比が無い。マスターは seed.sql 由来(migration 20261104000001 は A のブランチのみ) |
| US_CORE_CPI | 米国 コアCPI(前年比) | ○ | ○ | ○ | ○ | △ | △ | ○ | migration 20261026000001。DEV: RELEASED 10・予定14。前月比は `CUSR0000SA0L1E` |
| US_NFP | 米国 非農業部門雇用者数 | ○ | ○ | ○ | ○ | △ | △ | ○ | BLS `CES0000000001`(差分)。DEV: RELEASED 10・予定14。source_url が null。マスターは seed.sql 由来 |
| US_UNEMPLOYMENT_RATE | 米国 失業率 | ○ | ○ | ○ | ○ | △ | △ | ○ | BLS `LNS14000000`。DEV: RELEASED 10・予定14 |
| US_AVG_HOURLY_EARNINGS | 米国 平均時給(前月比) | ○ | ○ | ○ | ○ | △ | △ | ○ | BLS `CES0500000003`。DEV: RELEASED 10・予定14。前の月の値は、後から取り込んだ改定後の値(発表のときの値ではない) |
| US_PPI | 米国 生産者物価指数(前月比) | ○ | ○ | ○ | ○ | △ | △ | ○ | BLS `WPSFD4`/`WPUFD4`。DEV: RELEASED 10・予定14。前の月の値は改定後(11/4 に BLS の表で確認) |
| US_CORE_PPI | 米国 コアPPI(前月比) | ○ | ○ | ○ | ○ | △ | △ | ○ | BLS `WPSFD49104`/`WPUFD49104`。DEV: RELEASED 10・予定14 |
| US_JOLTS | 米国 JOLTS求人件数 | ○ | ○ | ○ | △ | △ | △ | ○ | BLS `JTS000000000000000JOL`。DEV: RELEASED 9・予定2。**予定の定義は 2026-12-01 まで(11件)で、2027年が無い**。11/3 の発表を取り込んだかは未確認 |
| US_RETAIL_SALES | 米国 小売売上高(前月比) | × | × | × | × | × | × | △ | マッピングだけある(有料カレンダーの対応のみ。`official: []`)。DEV: `in_db=false`。公式値の取得元(Census)は未承認、FRED は規約で不可 |
| US_FOMC | FOMC政策金利 | ○ | × | × | ○ | △ | △ | ○ | 会合日程は FRB のページから人が書き写した表(FOMC_SCHEDULE 10件、2026-10-28〜2027-12-08)。DEV: 10件 EXACT。**金利の値を取り込む処理は無い**(結果の種類は VALUE のため「結果待ち」のまま)。マスターは seed.sql 由来 |
| US_FOMC_MINUTES | FOMC議事要旨 | ○ | － | － | △ | ○ | △ | ○ | migration 20261027000004。結果の値を持たない予定(`result_type: NONE`、発表後は「公表済み」)。予定は2件(2026-11-18・12-30)だけで、2027年が無い。A のブランチで iOS の表示テストを修正中 |
| EU_HICP | ユーロ圏 HICP速報(前年比) | ○ | ○ | ○ | ○ | ○ | △ | ○ | Eurostat(速報)、eurostat_schedule。DEV: RELEASED 9・予定9、計18件 APPROXIMATE(11:00 Luxembourg)。v1.43 の API を 10/30 に DEV で確認済み。11/4 の手動の取り込みは未承認のため、11/4 の発表は取り込まれていない見込み(未確認) |
| EU_UNEMPLOYMENT_RATE | ユーロ圏 失業率 | ○ | ○ | ○ | ○ | ○ | △ | ○ | Eurostat。DEV: RELEASED 1(2026-09)・予定8、計9件 APPROXIMATE |
| JP_CPI | 日本 消費者物価指数 | ？ | × | × | × | △ | △ | △ | seed.sql(と A のブランチの migration 20261104000001)にマスターがあるだけ。取り込み・予定の定義は無い。DEV の登録は未確認(11/2 の B-1 にイベントが無い) |
| BOJ_RATE | 日銀政策金利 | ？ | × | × | × | △ | △ | △ | JP_CPI と同じ。BOJ は「連絡しない・実装しない」の方針。DEV の登録は未確認 |

各列の判断の根拠:

- **DB登録**: DEV の `economic_indicators`(11/2 の A-1)と、イベントのある指標(B-1)。JP_CPI・BOJ_RATE は A-1 の対象に入れておらず、B-1 にもイベントが無いため？。
- **実績取得・実績保存**: マッピング(`src/ingestion/mappings/indicators.ts`)と取り込みのジョブ(`ingest:official:bls-calendar`・`ingest:official:eurostat-calendar`)のコード、DEV の RELEASED の行と RELEASE の snapshot の件数(A-2・A-5。snapshot の欠けは0件)。
- **スケジュール**: 予定の定義(`blsSchedule.ts`・`eurostatSchedule.ts`・`fomcSchedule.ts`)の件数(ローカルで読み込んで数えた)と、DEV の予定の行(A-2・A-3)。
- **API**: `/indicators`・`/indicators/{id}`・`/events/{id}`・`/calendar`・`/home` は、DB の行をそのまま返す共通の作り。指標ごとの特別な処理は、`resultType.ts`(FOMC議事要旨)と `attribution.ts`(Eurostat)だけ。DEV の API で指標ごとに確かめたのは EU の2指標(10/30)だけなので、他は△。
- **iOS表示**: 一覧・カレンダー・詳細は API の値をそのまま出す共通の作り。指標コードを直接使うのは、検索の同義語(`IndicatorsViewModel.swift` の雇用統計の3指標)だけ。スクリーンショット(モック)で画面を確かめているのは CPI・NFP・FOMC の例だけで、実データの画面は TestFlight 1.0.0 (24) で一部を見ただけなので△。
- **テスト**: テストの中で指標コードが出てくるファイルの数(下の表)。settings の CI(c09335dd: Backend CI・iOS Build & Test・UI Screenshots)は成功。A のブランチの最新(edefa981)の Backend CI は**失敗**(下の課題1)。

| 指標コード | Backend 単体 | Backend 結合 | iOS | モック |
|---|---|---|---|---|
| US_CPI | 15 | 4 | 8 | 1 |
| US_CORE_CPI | 5 | 0 | 1 | 0 |
| US_NFP | 10 | 1 | 1 | 1 |
| US_UNEMPLOYMENT_RATE | 5 | 0 | 1 | 0 |
| US_AVG_HOURLY_EARNINGS | 2 | 0 | 1 | 0 |
| US_PPI | 2 | 0 | 0 | 0 |
| US_CORE_PPI | 2 | 0 | 0 | 0 |
| US_JOLTS | 2 | 0 | 0 | 0 |
| US_RETAIL_SALES | 3 | 0 | 0 | 3 |
| US_FOMC | 5 | 2 | 0 | 1 |
| US_FOMC_MINUTES | 4 | 1 | 1 | 4 |
| EU_HICP | 2 | 1 | 1 | 0 |
| EU_UNEMPLOYMENT_RATE | 2 | 1 | 1 | 0 |
| JP_CPI | 2 | 2 | 0 | 1 |
| BOJ_RATE | 1 | 2 | 1 | 3 |

(数はファイルの数。テストが通ったことはファイルごとには確かめていない。CI で確かめられるのは、外部の取得元を偽のデータに替えた処理の正しさで、実際に BLS・Eurostat から取れることではない。)

## 集計

- **指標の総数: 15**(migration・seed に14、マッピングだけに1(US_RETAIL_SALES))
- **国・地域別**: 米国 11(CPI・コアCPI・NFP・失業率・平均時給・PPI・コアPPI・JOLTS・小売売上高・FOMC政策金利・FOMC議事要旨)、ユーロ圏 2(HICP・失業率)、日本 2(CPI・日銀政策金利)

## 全工程(登録・実績・保存・予定)を DEV で確認できた指標: 10

US_CPI・US_CORE_CPI・US_NFP・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGS・US_PPI・US_CORE_PPI・US_JOLTS(予定は2026年まで)・EU_HICP・EU_UNEMPLOYMENT_RATE。どれも API と iOS は、共通の作りでの表示(△)。

## 途中までの指標: 5

| 指標 | ある工程 | 無い工程 |
|---|---|---|
| US_FOMC | 登録・予定 | 金利の値の取り込み・保存 |
| US_FOMC_MINUTES | 登録・予定(値は仕様として無い) | 2027年の予定 |
| JP_CPI | マスター(seed・A の migration) | 取り込み・予定。DEV の登録は未確認 |
| BOJ_RATE | マスター(seed・A の migration) | 取り込み・予定(方針として実装しない)。DEV の登録は未確認 |
| US_RETAIL_SALES | マッピングだけ | DB の登録・公式値の取得元・予定 |

## 未実装を確認した工程

- US_RETAIL_SALES: DB の登録、公式値の取得元、予定の定義
- US_FOMC: 政策金利の値の取り込み
- JP_CPI・BOJ_RATE: 取り込み・予定の定義
- 予定の定義が無い期間: US_JOLTS の 2027年、US_FOMC_MINUTES の 2027年(US_FOMC は 2027-12 まである)
- 指標の取り込みの定時実行: 指標(BLS・Eurostat・FOMC)の取り込みは**すべて手動のみ**(workflow の cron は為替・要人発言・品質レポートだけ)

## 今回確認できなかった範囲

- **DEV DB の 2026-11-02 07:00Z より後の状態**: 11/3 の JOLTS、11/4 の HICP 速報の取り込みの有無、今日時点の件数。DEV DB には接続していない(認証情報を持たず、求めていない)。確かめるには、下の SQL を DEV で流していただく必要がある
- JP_CPI・BOJ_RATE の DEV の `economic_indicators` の行の有無
- migration 20261104000001(A のブランチのみ)が DEV に適用されているか
- workflow の各実行の target(どの取り込みを、いつ実行したか)。GitHub の公開 API では、手動の実行の入力は見えない
- 指標ごとの DEV の API の応答(EU の2指標以外)、実データでの iOS の画面(TestFlight で一部だけ)

確認用の SQL(DEV、SELECT だけ):

```sql
-- 指標ごとの登録とイベントの件数(全指標)
select i.code, i.is_active, count(e.id) as events,
       count(*) filter (where e.status = 'RELEASED') as released,
       count(*) filter (where e.status = 'SCHEDULED') as scheduled,
       max(e.release_datetime) filter (where e.status = 'RELEASED') as latest_released,
       min(e.release_datetime) filter (where e.status = 'SCHEDULED' and e.release_datetime > now()) as next_scheduled
from economic_indicators i left join economic_events e on e.indicator_id = i.id
group by i.code, i.is_active order by i.code;

-- 適用済みの migration(20261104000001 があるか)
select version from supabase_migrations.schema_migrations where version >= '20261026' order by version;
```

## 優先して対応すべき課題

1. **A のブランチ(edefa981)の Backend CI の失敗**: 結合テストで、テスト用イベントの insert が外部キーの違反になり、seed の固定の ID の指標が見つからない(`indicator_id` が別の UUID になっている)。migration 20261104000001 が seed より先に、別の ID で同じ code の行を作るためと考えられる(推測。A の作業中のため、触れていない)。settings に入れる前に、解消が必要。
2. **指標の取り込みが手動のみ**: 11/2 より後の発表(11/3 JOLTS、11/4 HICP 速報、11/6 雇用統計、11/10 CPI、11/13 PPI)は、承認された手動の実行が無ければ DEV に入らない。定時実行にするかどうかの判断が必要。
3. **予定の定義の期限**: US_JOLTS と US_FOMC_MINUTES は 2027年の予定が無い。2026-12 以降に予定が空になる。
4. **US_FOMC の政策金利の値**: 取り込む処理が無く、会合の後も「結果待ち」のまま。
5. **US_RETAIL_SALES**: 公式値の取得元が無い(Census の利用条件の確認が先)。マッピングだけ残っている。
6. **JP_CPI・BOJ_RATE**: マスターだけがある。DEV の登録の確認と、扱い(表示するか、無効にするか)の判断が必要。
7. **データの質**: US_CPI・US_NFP の source_url が null。BLS の前の月の値は改定後の値(発表のときの値ではない)。US_CPI の前月比は、次の取り込みから入る。
