# ユーロ圏 GDP 前期比(速報)`EU_GDP_QOQ` 実装設計書(2026-11-18)

担当 D。設計のみ(コード・migration・DB・DEV・settings の変更なし)。独立ブランチ `claude/fx-indicator-next-d`(settings `7fa2df26` から)。選定の根拠は `00-prioritization.md`。

**確認した事実**(2026-11-18、実 API・公式ページ)と、**確認できていない事項**(§11)を分けて書く。推測で埋めていない。

## 1. 概要
| 項目 | 内容 |
|---|---|
| 指標 | ユーロ圏(EA21)の実質 GDP の前期比(季節・暦調整済み、%) |
| コード・表示名 | `EU_GDP_QOQ`・「GDP（前期比）」(国名は名前に入れない、表示名ルール) |
| 通貨・重要度 | EUR・HIGH |
| 頻度 | QUARTERLY(スキーマで許可済み) |
| 関連の通貨ペア | EURUSD(1)・EURJPY(2)(既存の EU_HICP・EU_UNEMPLOYMENT_RATE と同じ) |
| 取得元 | Eurostat dissemination API(JSON-stat 2.0、鍵なし)。既存の `adapters/eurostat.ts` |
| 公表の種類 | **速報(preliminary flash estimate、T+30 日)**を初回値とする。T+45(GDP and employment flash)・以降の改定は `event_revisions` |
| 予想値・前回値 | 予想値は登録しない(公式に無い)。前回値は、**前の四半期の最新の値**(§6.4) |

## 2. 公式データソースの確認結果(実測)
### 2.1 系列
| 系列 | 内容 | 2026-Q3 の値 |
|---|---|---|
| **`teina011?freq=Q&na_item=B1GQ&unit=PCH_Q1_SCA&geo=EA21`**(本命) | Euro indicators の GDP の表。q/q-1、季節・暦調整済み | **0.4**(Q2 = 0.6、Q1 = 0.0) |
| `teina011` の `PCH_Q4_SCA` | 前年同期比(SCA) | 1.3 |
| `namq_10_gdp?freq=Q&unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ&geo=EA21`(照合用) | 四半期国民経済計算の表。連鎖量、前期比 | 0.4(Q2 = 0.6、Q1 = 0.0) — **teina011 と一致** |
- 公式の公表文との照合: Eurostat の速報(2026-10-30)「seasonally adjusted GDP increased by 0.4% in the euro area」「compared with the same quarter of the previous year … 1.3%」、2026-11-13 の速報「GDP up by 0.4% and employment stable in the euro area」と、系列の値が**一致**。
- **geo の指定**: 既存の Eurostat 指標と同じ **`EA21`**(ブルガリアの加入後、2026 年から)。確認: `EA21`・`EA20`・`EA` は、いずれも直近 3 四半期で同じ値を返した(構成国の違いによる差は出ていない)。ラベルは `EA21` = 「Euro area – 21 countries (from 2026)」。
- 応答の形は既存と同じ JSON-stat 2.0。次元は `freq,na_item,unit,geo,time`(`teina011`)で、`time` 以外は 1 値。`status` は付かない(2026-11-18 の応答)。

### 2.2 公表日程(Eurostat の euro indicators のページで確認)
| 公表 | 日付(Europe/Luxembourg) | 出典 |
|---|---|---|
| GDP **preliminary flash**(2026 Q3) | 2026-10-30 | https://ec.europa.eu/eurostat/product?code=2-30102026-ap(「GDP up by 0.4% in the euro area and by 0.5% in the EU」) |
| GDP and employment **flash**(2026 Q3) | 2026-11-13 | https://ec.europa.eu/eurostat/product?code=2-13112026-ap |
| 次の preliminary flash(2026 Q4) | **2027-01-29**(上のページの「Next release: 29 January 2027」) | 同上 |
| 次の flash(2026 Q4) | **2027-02-15**(「Next release: 15 February 2027」) | 同上 |
- 公表時刻は、既存の Eurostat 指標と同じ **11:00 Europe/Luxembourg を APPROXIMATE**(`EUROSTAT_RELEASE_1100`、HQ 判断 2026-10-30)。**GDP の公表時刻は、今回は公式ページで確認していない**。
- Eurostat の日程表(release calendar)は、JavaScript で描画され、静的な取得では日付を読めない。**日程表の更新は、既存と同じく、人が公式の calendar を読んで書く**運用(`eurostatSchedule.ts` の方針)。2027 年 4 月以降(2027 Q1 の速報)の日付は、**まだ確認していない**(§11)。

### 2.3 更新時刻の観察(重要)
各データセットの `updated`(最後の更新)と、公表日の関係:
| データセット | `updated` | 公表日との関係 |
|---|---|---|
| `prc_hicp_fpd`(HICP 速報) | 2026-11-04 11:00 CET | **公表日の 11:00 に更新**(速報は 11/04 公表) |
| `une_rt_m`(失業率) | 2026-11-05 23:00 CET | 公表(10/30)の 6 日後 |
| `teina011`・`namq_10_gdp`(GDP) | **2026-11-17 23:00 CET** | 速報(10/30)・flash(11/13)の**後**。4 日後 |
- `updated` は**最後の更新**の時刻で、**初回の取り込みの時刻ではない**。したがって、これだけでは「10/30・11/13 の公表の当日に Q3 の値が入っていたか」は**判定できない**。
- GDP の表は、公表の当日ではなく、数日遅れで更新される**可能性**がある。**これが、本設計で最大の不確実性**(§9 のゲート V1)。

## 3. 設計の前提と選定の条件
- **初回値の原則**: 公表の直後に取れた値だけを、初回値として保存する。Eurostat の GDP の表は**最新の値だけ**(過去の版なし)なので、既存の失業率と同じ **`LATEST_ONLY`**(公表から 72 時間の窓)で扱う。窓の外では、イベントも値も作らない。
- **ゲート V1(実装の最終判断の前提)**: 2027-01-29 の速報の日に、`teina011` に 2026-Q4 の値が**公表から 72 時間以内に現れる**ことを、観察で確認する(§9)。現れない場合は、本指標を**初回値として保存しない**(窓で保証できないため)。そのときの次の候補は、日本のコア CPI(`00-prioritization.md` §5)。
- 実装自体は、V1 の前に進めてよい(最初のイベントが 2027-01-29 のため。実装・テストは、それまでに完了できる)。

## 4. データの取得方式
### 4.1 取得
- `EUROSTAT_SERIES.GDP_QOQ = 'teina011?freq=Q&na_item=B1GQ&unit=PCH_Q1_SCA&geo=EA21'`、照合用に `GDP_QOQ_CHECK = 'namq_10_gdp?freq=Q&unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ&geo=EA21'`。
- 1 回の実行で、各系列を**1 回**だけ取る(既存の `createEurostatSeriesCache`)。範囲は、日程表の対象四半期の**前の四半期**から最新まで。
- **照合(必須)**: `teina011` の値と `namq_10_gdp` の値が、**小数 1 桁で一致**するときだけ保存する。食い違えば保存せず、エラーとして記録(人の確認)。両方とも取れない・片方だけのときは、**何も書かない**(PENDING のまま、次の実行で再試行)。
- 次元の検証: `time` 以外の次元がすべて 1 値(既存の検証。`geo` の構成が変わって複数値になれば、例外で止まる)。**`geo=EA21` を、将来の構成国の変更(EA22 など)のときに見直す**(設定の 1 か所)。

### 4.2 四半期の期間の扱い(既存コードの月次前提の拡張)
| 場所 | 現状 | 変更 |
|---|---|---|
| `adapters/eurostat.ts` `parseEurostatResponse` | 時間コードが `YYYY-MM` だけ | **`YYYY-Qn`** も読む。`periodStart` = 四半期の初日(Q1 = `YYYY-01-01`、Q2 = `-04-01`、Q3 = `-07-01`、Q4 = `-10-01`)。月次の系列は従来どおり(四半期のコードは、月次の系列では無視) |
| `adapters/eurostat.ts` `eurostatUrl` | `sinceTimePeriod`・`untilTimePeriod` を `YYYY-MM` で渡す | 系列に `freq=Q` があれば、**`YYYY-Qn`** で渡す |
| `time.ts` | `previousReferencePeriod` は `YYYY-Qn` に対応済み。`monthStart` は月次のみ | **`periodStartOf(period)`** を追加(`YYYY-MM` → 月初、`YYYY-Qn` → 四半期の初日) |
| `verification/official.ts` `computeOfficialValue` | `at(p)` が `monthStart` | `periodStartOf` を使う(`LEVEL` だけを使う。`DIFF`・`MOM_PCT`・`YOY_PCT` は月次のまま) |
| `pipelines/eurostatCalendar.ts` `valueOf`・`createEurostatNativeResolver`・`eurostatObservationRange` | `monthStart`・`shiftMonth` | 四半期を扱う(`periodStartOf`、範囲の開始 = 前の四半期の初日) |
- 既存の月次の動作は変えない(HICP・失業率の回帰テストで保証)。

## 5. 公表スケジュール
### 5.1 日程表(`eurostatSchedule.ts`)
- `EUROSTAT_SCHEDULE_INDICATORS` に `EU_GDP_QOQ` を追加。`EurostatScheduleEntry.referencePeriod` は、`'YYYY-MM'` または **`'YYYY-Qn'`**(型を拡張)。
- 初期の行(**確認済みのものだけ**):
  | referencePeriod | releaseDate | 備考 |
  |---|---|---|
  | `2026-Q4` | `2027-01-29` | 速報(preliminary flash)。Eurostat のページの「Next release: 29 January 2027」 |
- **過去の回(2026-Q3、2026-10-30)は入れない**(`LATEST_ONLY` は、窓の外の回を作らない。失業率と同じ「表は最新の回から始める」方針)。
- 2027-Q1 以降の速報の日(2027 年 4 月末の見込み)は、**人が公式の calendar で確認して追加**する(日付を計算で作らない)。確認できるまで入れない。
- `EUROSTAT_INDICATOR_SCHEDULES.EU_GDP_QOQ = { valueVintage: 'LATEST_ONLY' }`(`previousSeriesId` は省略 = 自分の系列)。

### 5.2 事象の単位
- **1 四半期 = 1 イベント**(速報の日)。イベントの `provider_event_id` = `eurostat_schedule:EU_GDP_QOQ:2026-Q4`(既存の形式 `eurostatScheduleEventId`)。
- T+45 の flash(2027-02-15)・その後の改定は、**別のイベントを作らず**、同じイベントの改定(`event_revisions`)として扱う(§7)。

## 6. 初回値・欠損の処理
### 6.1 初回値
- 対象の回の公表から **72 時間以内**(`FIRST_RELEASE_WINDOW_HOURS`)に取れた値だけを初回値にする(`LATEST_ONLY`)。窓の外は、イベント・値を作らない(`outsideFirstReleaseWindow` として報告)。
- 保存: 既存の `ingestCalendarReleases` の経路(`publishRelease`)。`actual` = `teina011` の値、`forecast` = null、`previous` = 前の四半期の値、`verification_status` = VERIFIED(Eurostat 自身との SELF_MATCH、`namq_10_gdp` との照合を含む)、`source` = Eurostat、`unit` = %。
- `verification_source` = `EUROSTAT:teina011?…@<asOf>`(既存の形式)。

### 6.2 欠損
- 値が無い(応答に対象の四半期が無い・`null`)→ `notYetAvailable`。**補完・前回値の流用はしない**。`OVERDUE_AFTER_DAYS`(45 日)を過ぎても無ければ `overdue` として報告し、日程表が古い可能性を人が確認する。
- `status` が `p`・`e` の値は `PRELIMINARY`(既存の扱い)。他の `status`(`b`・`i` など)の扱いは、既存のまま(未知の記号は UNKNOWN)。
- 日程にない日の更新や、公表の延期: 日程表は人が更新する運用(既存)。表より遅れて値が現れた場合も、窓の外なら作らない。

### 6.3 `expectedRange`・変化の上限(データ品質の検証)
- `expectedRange: { min: -5, max: 5 }`(四半期の前期比。COVID の最大の落ち込み −11.5 のような極端な値は、**人の確認に回す**ため範囲外とする)。`maxAbsChangeFromPrevious: 2`(前期からの変化)。範囲外・変化が大きい値は、既存の検証で保留(PENDING_REVIEW)になる。

### 6.4 前回値(`previous`)
- 前の四半期の値を、**同じ系列の最新の値**から取る(例: 2026-Q4 の速報の `previous` = 2026-Q3 の最新の値)。市場の「前回値」も、改定後の前回の値(revised previous)で見られるため。
- `revisedPrevious` も同じ値(既存の形)。

## 7. 改定の扱い
### 7.1 Eurostat の改定の実際
- 速報(T+30)→ flash(T+45、雇用を含む)→ GDP and employment(約 T+65、内訳)→ 以降、毎四半期の改定。**同じ四半期の値が、少なくとも 3 回の公表で動きうる**(今回は 0.4 → 0.4 → 0.4 で動いていない)。
- **過去の版は API で取れない**(最新の値だけ)。したがって、初回値は自分で保存し、後の値は**値の比較**で検出する。

### 7.2 改定の記録(必要な変更)
- 既存の仕組み: `ingestCalendarReleases` → `processRevisions` が、保存済みの初回値と今の値が違えば `event_revisions` に ACTUAL を足す(初回値は不変)。
- **既存の制約**: `LATEST_ONLY` の回は、窓(72 時間)を過ぎると `buildEurostatScheduleReleases` が**その行を作らない**(`outsideFirstReleaseWindow`)。そのため、**窓の後の改定は、記録されない**(失業率も同じ。改定の追跡が無い)。
- **変更案**: 窓の外でも、**スナップショットが既に有るイベントの改定の確認だけ**を行う。
  - `NormalizedCalendarRelease` に、`revisionOnly?: boolean` を足す。窓の外の `LATEST_ONLY` の行は、`revisionOnly: true` で出す。
  - `processActual` は、**スナップショットが無いとき `revisionOnly` の行を公開しない**(初回値にしない)。スナップショットが有るときだけ、`processRevisions` に進む。
  - 追跡範囲: **直近 12 四半期**(英国 GDP 四半期の暫定方針に合わせる。`revisionWindow: { latestEvents: 12 }` の考え方)。それより古いイベントは行を出さない。
- この変更は、**共通の経済カレンダーの経路に触れる**(§10 のリスク)。EU_UNEMPLOYMENT_RATE にも同じ改定の追跡が効く(利点だが、既存の動作の変更になるため、HQ の承認を別に求める)。
- 改定の `source` は、既存どおり Eurostat。**四半期の改定の日(T+45・T+65)や、年次の改定(毎年のベンチマーク)は区別しない**(値の変化だけを記録する)。

### 7.3 修復との関係
- QA-1 の状態修復(`repairLookbackDays`、既定 90 日)は、独立。**本指標の追跡範囲(12 件)は、修復の範囲に影響しない**(改定管理の設計 第 3 版の方針)。

## 8. 実装仕様(ファイル別)
| ファイル | 変更 |
|---|---|
| `src/ingestion/time.ts` | `periodStartOf(period)`(月次・四半期)を追加。`quarterOfMonth` などの補助が要れば同様 |
| `src/ingestion/adapters/eurostat.ts` | `YYYY-Qn` の読み取り、`eurostatUrl` の四半期の `sinceTimePeriod`、`seriesId` の `freq=Q` の判定 |
| `src/ingestion/verification/official.ts` | `computeOfficialValue` の `at()` を `periodStartOf` に |
| `src/ingestion/mappings/indicators.ts` | `EUROSTAT_SERIES.GDP_QOQ`・`GDP_QOQ_CHECK`、`EU_GDP_QOQ` の `IndicatorMapping`(`valueKind: 'MOM_PCT'`(「前の期間からの変化率」。型に QOQ は無く、`ValueKind` を増やさない=DB の `secondary_value_kind` に影響させない)、`unit: 'PERCENT'`、`decimals: 1`、`expectedRange`、`release: EUROSTAT_RELEASE_1100`、`providers: { eurostat_schedule: { country: 'EU', event: 'EU_GDP_QOQ' } }`、`official: [{ source: 'EUROSTAT', seriesId: GDP_QOQ, transform: 'LEVEL' }]`、`requireOfficialMatch: true`、`referencePeriodLagMonths` は日程表を使うので使わない) |
| `src/ingestion/mappings/eurostatSchedule.ts` | `EU_GDP_QOQ` を指標に追加、`referencePeriod` の型を `YYYY-MM \| YYYY-Qn`、日程(`2026-Q4` → `2027-01-29`)、`valueVintage: 'LATEST_ONLY'` |
| `src/ingestion/pipelines/eurostatCalendar.ts` | 四半期の `valueOf`・範囲・リゾルバー、`previousReferencePeriod`(対応済み)、**照合系列**(`namq_10_gdp`)との一致の確認、`revisionOnly` の行(§7.2) |
| `src/ingestion/types.ts`・`pipelines/economicCalendar.ts` | `revisionOnly` の追加(共通。§7.2) |
| `src/domain/attribution.ts` | `EUROSTAT_INDICATOR_CODES` に `EU_GDP_QOQ` を追加(出典は既存の `EUROSTAT_ATTRIBUTION`) |
| `src/jobs/ingestEurostatCalendar.ts` | 四半期の指標を含めて回す。**手動の実行(`official-eurostat`)の窓(72 時間)を、実行の手順書に明記** |
| `supabase/migrations/<日付>_eu_gdp_qoq_indicator.sql` | §8.1(新規。適用は HQ の承認後) |
| `supabase/seed.sql` | 通貨ペアの行(§8.1) |
| `docs/`(`api-design.md` の指標一覧、`indicator-display-names.md`) | 指標の追加・表示名「GDP（前期比）」 |

### 8.1 DB の影響(migration 案、適用は承認後)
- スキーマの変更なし(列・制約の追加なし)。**行の追加だけ**: `economic_indicators` 1 行、`indicator_fx_pairs` 2 行。何度流しても同じ結果(`on conflict do nothing`)。
```sql
insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance,
  description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('EU_GDP_QOQ', 'ユーロ圏GDP(前期比、速報)', 'Euro area GDP, quarter-on-quarter growth (flash estimate)', 'GDP（前期比）',
   'EU', 'EUR', 'HIGH',
   'ユーロ圏(21 か国)の実質 GDP の前期比(季節・暦調整済み)です。欧州連合統計局(Eurostat)が四半期ごとに、まず速報で公表し、その後改定されます。欧州中央銀行の金融政策の判断材料として注目されます。',
   array['ユーロ圏の景気の勢いを把握できる','欧州中央銀行の金融政策判断に影響する','速報の後に改定されることがある'],
   'QUARTERLY', '%', 'Eurostat', 'https://ec.europa.eu/eurostat', 'HIGHER_IS_POSITIVE',
   'ユーロ圏のGDPが予想を上回ると、景気の強さが意識され、ユーロが買われやすいとされる。',
   'ユーロ圏のGDPが予想を下回ると、景気の減速が意識され、ユーロが売られやすいとされる。')
on conflict (code) do nothing;
-- indicator_fx_pairs: EURUSD(1)・EURJPY(2)。20261030000001_eurostat_indicators.sql と同じ形
```
- 既存の行・イベントに触れない。戻す手順: 該当の `indicator_fx_pairs`・`economic_indicators` の行を、イベントが無いうちに削除。
- **API**: 既存の `/calendar`・`/events` などは、指標が増えるだけで**互換**。iOS は、指標の追加で表示される(国旗・通貨は EU・EUR が既に有る)。
- `marketEventGrouping`: Eurostat 由来の APPROXIMATE の行は、時刻判定なしで他の行と同一視しない(既存の方針)。**四半期の GDP の日が HICP・失業率の日と重なっても、別イベントのまま**であることを、テストで確認する。

## 9. テスト仕様
### 9.1 単体テスト(既存の `eurostatIndicators.test.ts` の形式、実 API の応答の写しを使う)
| # | 内容 |
|---|---|
| 1 | `parseEurostatResponse`: `teina011` の応答(`2026-Q1..Q3`、値 `0, 0.6, 0.4`)を `periodStart` = `2026-01-01`・`04-01`・`07-01` で読む。月次の系列の応答は従来どおり |
| 2 | 月次の系列で、四半期のコードが来ても無視する(逆も) |
| 3 | `eurostatUrl`: `freq=Q` の系列は `sinceTimePeriod=2026-Q1` 形式。月次は `YYYY-MM` のまま |
| 4 | `periodStartOf`: `2026-09` → `2026-09-01`、`2026-Q3` → `2026-07-01`、不正な形は例外 |
| 5 | `computeOfficialValue`(LEVEL)が四半期の期間で値を返す。月次の変換(DIFF・MOM_PCT・YOY_PCT)は従来どおり |
| 6 | 日程表: `EU_GDP_QOQ` は `2026-Q4`・`2027-01-29`。参照期間は `YYYY-Qn`。重複なし。過去の回(2026-Q3)が無い |
| 7 | `buildEurostatScheduleReleases`: 公表の窓内で値が有れば `actual` と `previous`(前の四半期)が入る。値が無ければ `notYetAvailable`。窓の外は `outsideFirstReleaseWindow` |
| 8 | **照合**: `teina011` と `namq_10_gdp` の値が違うと保存しない(エラー)。片方だけ・両方なしは何も書かない |
| 9 | `expectedRange`・変化の上限: −8 や +6 のような値は保留(PENDING_REVIEW) |
| 10 | `geo` の次元が複数値になる応答は例外(構成国の変更の検出) |
| 11 | 出典: `attributionForIndicator('EU_GDP_QOQ')` = `EUROSTAT_ATTRIBUTION` |
| 12 | 時刻: 11:00 Europe/Luxembourg、APPROXIMATE(夏時間の変換を含む)。1 分足の反応は計算されない(`availableTimeframes`) |
| 13 | **回帰**: `EU_HICP`・`EU_UNEMPLOYMENT_RATE` の既存のテストがすべて変わらず成功。BLS の経路に影響しない |

### 9.2 改定のテスト(§7.2)
| # | 内容 |
|---|---|
| 14 | 初回値を保存した後、窓(72 時間)の外で、値が 0.4 → 0.5 に変わった: `event_revisions` に ACTUAL(old 0.4、new 0.5)。初回値は 0.4 のまま |
| 15 | スナップショットが**無い**イベントの `revisionOnly` の行は、**公開されない**(窓の外の値を初回値にしない) |
| 16 | 同じ改定を二度足さない(再実行)。値が戻った場合も、履歴が連なる |
| 17 | 追跡範囲(直近 12 件)より古いイベントの改定は記録されない |
| 18 | 失業率(`EU_UNEMPLOYMENT_RATE`)に同じ仕組みを適用した場合の動作(適用するかは HQ の判断。適用しない場合は、失業率だけ従来のまま) |

### 9.3 統合テスト(CI の実 Postgres)
- migration の適用で、指標 1 行・通貨ペア 2 行(EURUSD・EURJPY)が入る。再実行で重複しない。日程表の取り込みで SCHEDULED のイベントが 1 件。表示名「GDP（前期比）」・`country_code = EU`・`currency_code = EUR`・`frequency = QUARTERLY`。
- 注意: 統合テストの `CODES` の一覧に `EU_GDP_QOQ` を足す(既存の `eurostat` の統合テストが、指標の件数を固定している場合は更新)。

### 9.4 検証ゲートと観察(実装の外)
| # | 内容 | いつ |
|---|---|---|
| **V1** | **2027-01-29 の速報の日に、`teina011` に 2026-Q4 の値が、公表から 72 時間以内に現れるか**を、1 時間ごとの読み取りで観察する(書き込みなし)。現れた時刻を記録。これが成立しなければ、本指標は初回値を保存しない | 2027-01-29 11:00 CET から 72 時間 |
| V2 | 同じ日に、`namq_10_gdp` の値が `teina011` と一致するか | 同上 |
| V3 | 2027-02-15 の flash の後、2026-Q4 の値が変わったか、改定の追跡が働くか | 2027-02-15〜 |
| V4 | 2027 年 4 月末の速報の日付を、Eurostat の calendar で確認し、日程表に追加 | 2027-03 まで |

## 10. リスクとライセンス
### 10.1 リスク
| # | リスク | 対策 |
|---|---|---|
| 1 | **GDP の表が、公表の当日に更新されない可能性**(§2.3。`updated` は公表の 4 日後)。72 時間の窓で初回値を保証できない | ゲート V1。成立しなければ保存しない(誤った初回値を出さない)。観察で、速報の当日に現れるかが分かる |
| 2 | **実行が手動のみ**: Eurostat の取り込みは、今は手動の実行(`official-eurostat`)だけ。窓(72 時間)の中に、人が実行する必要がある | 公表日に実行する手順書を明記。**定期実行の追加は、既存のワークフローの変更で、HQ の別承認**(本設計では行わない) |
| 3 | **共通の経済カレンダーの経路への変更**(`revisionOnly`)が、EU_HICP・EU_UNEMPLOYMENT_RATE・BLS に影響する | `revisionOnly` は、LATEST_ONLY の窓外の行だけに付ける。既存の全テストを回帰で通す。**失業率に適用するかは別承認** |
| 4 | **構成国の変更**(EA21 → EA22 など)で、値が変わる・次元が増える | `geo` の次元の検証(例外)。設定の 1 か所を見直す |
| 5 | **公表時刻が APPROXIMATE**: 1 分足の反応を計算しない(既存の方針と同じ)。GDP の正確な時刻は未確認 | 時刻を公式で確認できれば、EXACT に切り替える(設定の変更) |
| 6 | **日程の入手が手作業**: calendar が JS 描画で自動で読めない。2027 年 4 月以降の日付は未確認 | 人が確認して表に追加。確認前の回は作らない |
| 7 | **速報(T+30)と flash(T+45)の混同**: ユーザーが、どの公表の値かを区別できない | 初回値は速報(T+30)。改定の履歴に、後の公表の値が並ぶ。画面での表示は、既存の「初回値・改定」の表示に従う |
| 8 | **前年同期比を載せない**: 市場は前期比と前年同期比の両方を見る | 前年同期比(`PCH_Q4_SCA`)は、既存の `secondary_*`(副指標)に載せる拡張を別途検討(本設計の範囲外) |
| 9 | 予想値が無い | 公式に無いので登録しない。画面は「予想なし」の既存の表示 |

### 10.2 ライセンス・利用条件
- Eurostat の著作権・再利用の条件(`adapters/eurostat.ts` の冒頭に、2026-10-30 に読んだ記録): **商用の再利用が許可**(出典の明示が条件)・**改変は明示**・**Eurostat の無責任の免責を含める**。EU・EFTA 以外の国のデータは例外(本件では使わない)。
- **今回(2026-11-18)は、利用条件のページを再確認できなかった**(ページが JavaScript の描画で、静的に読めない)。既存の記録に依拠する。実装の前に、HQ が原文を確認するか、既存の確認(2026-10-30)で足りるかを判断する。
- 出典の表示: 既存の `EUROSTAT_ATTRIBUTION`(「Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。」)をそのまま使う。
- API: 鍵なし。利用の頻度は、1 回の実行で 2 系列(各 1 回)。負荷は小さい。

## 11. 未解決事項
1. **ゲート V1**(速報の当日に値が現れるか)。2027-01-29 の観察で確定。
2. GDP の公式な公表時刻(11:00 CET の確認)。
3. 2027-Q1 以降の速報の日付(2027 年 4 月末)。人が calendar で確認。
4. Eurostat の利用条件の原文の再確認。
5. `revisionOnly`(共通の経路への変更)と、失業率への適用の承認。
6. 定期実行の追加(別承認)。
7. 前年同期比を副指標として載せるか(別途)。
8. migration の適用・公表予定の取り込み(別承認)。

## 12. 実装の見積りと順序(承認後)
1. `time.ts` の `periodStartOf`、アダプターの四半期、`computeOfficialValue`(小。テスト 1〜5)
2. 日程表・マッピング・出典・migration 案・seed(小。テスト 6・11・12・13)
3. 四半期の取り込みと照合(中。テスト 7〜10)
4. `revisionOnly`(中。共通の経路。テスト 14〜18。**別承認**)
5. 統合テストの更新
- 全体で、WPI(小)より大きく、英国 GDP 四半期(中)と同程度。実装は、2027-01-29 の前に完了できる。
