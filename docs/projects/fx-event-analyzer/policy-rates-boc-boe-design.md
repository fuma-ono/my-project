# BoC・BoE 政策金利 取り込み設計書(第2版 2026-11-13)

HQ指示 2026-11-13「BoC・BoE政策金利の設計着手」と、Cの独立レビュー(P1×2・P2×6・P3×6)への対応。対象は **Bank of Canada の Target for the overnight rate(Valet API)** と **Bank of England の Bank Rate(IADB CSV)** の2つだけ。
**設計のみ。コード実装・DB変更・migration の作成と実行・workflow 変更・settings や main への統合・DEV/PROD 反映・定期実行の追加は、していない。** SQL は「案」で、どこにも実行していない。CA_CPI の設計・レビューとは混在させない。

事実は 2026-11-13 に公式のページ・API に実際にアクセスして確認したものだけを「確認済み」とし、確認できなかったことは「未確認」と書く。

## 0. 第2版の変更点(一覧)

### 0.1 変更箇所と理由

| # | 変更 | 理由(Cの指摘) | 節 |
|---|---|---|---|
| 1 | **BoC は 09:45 ET を採用し、EXACT で登録**。公式の根拠は BoC の Upcoming events ページ(「December 9, 2026 Interest Rate Announcement 09:45 (ET)」)。第1版の「時刻は未確認」を訂正 | P1-1 | §1.3 |
| 2 | **BoE は時刻の確認ができるまで、価格反応・通知の対象にしない**。第1版の「DATE_ONLY は価格反応の対象外」は**誤り**(現行コードは DATE_ONLY でも 15m・30m・60m を計算する)ことが分かったので、必要なコード変更を具体化 | P1-1 | §1.3・§3.2 |
| 3 | **書き込み前の安定確認を必須化**: 「決定の有効日の観測」と「その次の営業日の観測」の**両方が同じ値**で存在するまで、スナップショットを書かない(据え置きも同じ) | P1-2 | §2.1 |
| 4 | 書き込み前の人による確認に **`ingestion_staged_values`**(RELEASE)を使う設計 | P1-2 | §2.2 |
| 5 | 書き込み後の誤りは **`event_revisions`(ACTUAL / PREVIOUS)**で訂正し、停止・訂正・再取得の手順を定義 | P1-2 | §2.4 |
| 6 | 取得元の1〜2営業日の遅延を踏まえ、**保存の目標(BoC: 発表の2営業日後、BoE: 翌営業日)と、アプリの「結果待ち」の扱い**を再設計 | P2-1 | §2.5 |
| 7 | `VERIFIED` と `SINGLE_SOURCE` を既存の定義に合わせて使い分け | P2-2 | §2.3 |
| 8 | `domain/valueDecimals.ts` の変更を、必要なバックエンド実装項目に追加(iOS の表示は A への確認事項) | P2-3 | §3.3・§5.2 |
| 9 | 手動 target の concurrency・workflow lint・`inputs.target` の説明・品質レポートの集計・スナップショット誤登録時の対応を追加 | P2-4 | §5.3 |
| 10 | **予定外の緊急決定**の検知と、手動でのイベント登録の運用を追加(系列で確認できる緊急の変更の候補: BoC 2020-03-16・03-27、BoE 2020-03-19。当時の日程表との照合は未確認) | P2-5 | §2.6 |
| 11 | BoC 規約 1.3 の購入前の告知文と、BoE の OGL v3.0 の出典・リンクを具体化 | P2-6 | §3.4 |
| 12 | BoC の 2021年以前の有効日ルールを注記 | P3 | §1.4 |
| 13 | BoE の日程に **2027年12月16日**を追加(2027年は8回) | P3 | §1.2 |
| 14 | `UNUSUAL_CHANGE`(変更幅による停止)を**廃止**。BoE の 0.15 の変更(2020-03-19)などの正当な変更を止めるため。幅は「確認のヒント」に降格 | P3 | §1.5 |
| 15 | `indicator-display-names.md` に `BOC政策金利` が**既にある**ことを反映(表の変更は不要) | P3 | §3.1 |
| 16 | 「将来、ECB も単一金利として足せる」を訂正(ECB は主要金利が3つあり、単一金利ではない) | P3 | §2.7 |
| 17 | Valet の `seriesDetail`(observations の応答)と `seriesDetails`(series の応答)の違いを実装の注意点に追加 | P3 | §1.1 |

### 0.2 対応状況

| 区分 | 指摘 | 状況 |
|---|---|---|
| P1 | P1-1 DATE_ONLY と価格反応 | 設計に反映(BoC は EXACT、BoE は時刻確認まで対象外。コード変更箇所・除外条件・テストを具体化) |
| P1 | P1-2 不変スナップショットと訂正 | 設計に反映(安定確認の必須化、staged の利用、`event_revisions` による訂正、停止・訂正・再取得の手順) |
| P2 | 1〜6 | すべて設計に反映 |
| P3 | 6件 | すべて反映 |

### 0.3 未解決事項と、実装前に必要な確認の分離
- **未解決事項(この設計だけでは決められないこと)**: §6.1。
- **実装前に必要な確認(事実の確認・実測・承認)**: §6.2。

---

## 1. データ取得

### 1.1 Bank of Canada(確認済みの事実)

| 項目 | 内容 |
|---|---|
| 系列 | `V39079`「Target for the overnight rate (business daily)」。頻度 Business daily、単位 Percent |
| 最新・期間指定 | `GET https://www.bankofcanada.ca/valet/observations/V39079/json?recent=N`、`?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` |
| 系列の詳細 | `GET https://www.bankofcanada.ca/valet/series/V39079/json`(label・description・frequency・unit) |
| **応答の形(実装の注意)** | **observations の応答のキーは `seriesDetail`(単数。系列名をキーにした入れ子: `seriesDetail.V39079.label`)**。**series の応答のキーは `seriesDetails`(複数。`seriesDetails.name` / `.label` / `.metadata`)**。両者は別の形なので、系列の同一性の確認は、エンドポイントごとに別のパスで行う。値は**文字列**(`{"d":"2026-11-10","V39079":{"v":"2.50"}}`)。どちらにも `terms.url`(https://www.bankofcanada.ca/terms/) |
| 過去データ | `start_date=1990-01-01` で **2009-04-21 から 4,568 件**(2026-11-11 まで)。値の欠けも日付の重複も 0 件 |
| 認証・費用 | 鍵なし・無料 |
| 公表日程(公式ページ。確認済み) | 2026: 1/28・3/18・4/29・6/10・7/15・9/2・10/28・12/9。2027: 1/27・3/3・4/28・6/2・7/21・9/8・10/27・12/8 |
| **公表時刻(確認済み)** | **09:45 ET**。BoC の Upcoming events ページ(https://www.bankofcanada.ca/press/upcoming-events/)に「December 9, 2026 Interest Rate Announcement 09:45 (ET) — On eight scheduled dates each year, the Bank of Canada announces the setting for the overnight rate target in a press release…」。2026-11-13 に取得。**実装時に再確認する** |
| 変更の有効日(公式の注記。確認済み) | 「**As of 2021, a change takes effect the day after its announcement.**」。**2021年より前は、発表の当日に有効**(系列で確認: 2020-03-04 の変更は発表日と同じ日付、2020-03-16・03-27 も発表日の当日の日付)。過去データを使う場合(バックフィル・検証)は、この境界を区別する |
| 照合 | 公式ページの決定履歴(Date / Target / Change)と Valet: 2025-09-17(−0.25 → 2.50)、2025-10-29(−0.25 → 2.25)、2026-10-28(+0.25 → 2.50)で、Valet の変更日は**翌日**(2025-09-18、10-30、2026-10-29)。それ以前の2021年以後の変更は公式の表と未照合 |
| 規約 | https://www.bankofcanada.ca/terms/。**1.1 出典の明記と変更の明記**、**1.3 有料サービスで提供する場合は、購入者に事前に「同サイトで無料で入手できる」と伝える**(§3.4) |
| 更新の遅れ | 2026-11-13 09:15Z の取得で、最新の観測は **2026-11-11**(11/12 の観測は未反映)。1〜2営業日の遅れ。**更新される時刻(営業日のいつ)は未確認** |

### 1.2 Bank of England(確認済みの事実)

| 項目 | 内容 |
|---|---|
| 系列 | `IUDBEDR`(Official Bank Rate)。日次(営業日)の CSV |
| 取得 | `GET https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2024&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`(`User-Agent` が要る場合あり。**古い `fromshowcolumns.asp` は HTML が返る**ので `_iadb-` 付きを使う) |
| 応答の形 | 先頭行 `DATE,IUDBEDR`、以降 `02 Jan 2024,5.25`(日付は `DD Mon YYYY`、値は小数) |
| 過去データ | `Datefrom=01/Jan/1975` で **1975-01-02 から 13,111 件**。日付の重複 0 件 |
| 認証・費用 | 鍵なし・無料 |
| 公表日程(公式ページ。確認済み) | 2026: 2/5・3/19・4/30・6/18・7/30・9/17・11/5・12/17。**2027(8回): 2/4・3/18・4/29・6/17・7/29・9/16・11/4・12/16**(木曜) |
| 実績との照合 | 変更日は、すべて MPC の発表日(木曜): 2024-08-01、2024-11-07、2025-02-06、2025-05-08、2025-08-07、2025-12-18、**2026-11-05(3.75 → 4.00、公式の声明「Bank rate increased to 4%」)**。IADB の値は**発表日当日**から変わる |
| 規約 | データベースは英国の OGL の下(https://www.bankofengland.co.uk/legal:「Reproduction of data in the Database is subject to the terms of the UK Open Government Licence」。為替の一部の系列は除外)。**サイトの文章は非商用のみ**なので、CSV の数値だけを使い、文章は使わない。**Bank Rate 用の指定の出典文言は、このページには無い**(指定があるのは SONIA のみ) |
| 公表時刻 | **公式のページで未確認**(日程ページ・決定の声明のページに記載なし)。BoE は確認できるまで、時刻が必要な機能(通知・価格反応)の対象にしない(§1.3) |
| 更新の遅れ | 11/5 の変更が 11/11 の取得で反映済み。**当日のいつ反映されるかは未確認** |

### 1.3 公表時刻と、`DATE_ONLY`・価格反応の扱い(P1-1)

**確認済み**
- **BoC: 09:45 ET**(§1.1)。→ `release_datetime_precision = EXACT`、`time = '09:45'`、`timeZone = 'America/Toronto'` で登録する。
- **BoE: 未確認**。→ 時刻が確認できるまで、BoE のイベントは**価格反応と通知の対象にしない**。

**現行コードの事実(第1版の誤りの訂正)**
- `domain/dataQuality.ts` の `EXCLUDED_BY_PRECISION` は、`EXACT: []`、`APPROXIMATE: ['1m']`、**`DATE_ONLY: ['1m','5m']`**、`UNKNOWN: ['1m','5m']`。つまり **`DATE_ONLY` でも 15m・30m・60m の反応は計算・返却される**(発表時刻 `release_datetime` を起点に)。
- `pipelines/eventReactions.ts` の `NO_ANALYZABLE_TIMEFRAME` の除外は、`availableTimeframes(precision).length === 0` のときだけ働くが、現状は**どの precision でも空にならないので、一度も働かない**(コード内のコメントも「Never happens today」)。
- したがって、**日付しか分からない BoE のイベントを DATE_ONLY で登録すると、任意の時刻(例: その日の 00:00)を起点にした、意味のない 15m・30m・60m の値が作られる**。第1版の記述(DATE_ONLY は価格反応の対象外)は誤り。
- 通知(`domain/notifications.ts`)は `EXACT` のときだけ事前通知(確認済み)。戦略分析(`eventStrategyAnalysis.ts`)は、EXACT でない発表を判定しない(v1.49 の既存の仕様)。
- Eurostat の指標は `APPROXIMATE`(11:00 Luxembourg)で登録され、15m・30m・60m の反応が計算されている(既存の運用。今回は変えない)。

**必要なコード変更(BoE を DATE_ONLY で登録する場合。BoE の時刻を確認できなければ必要)**

| # | 変更箇所 | 内容 | 除外条件 |
|---|---|---|---|
| C1 | `src/domain/dataQuality.ts` | `EXCLUDED_BY_PRECISION` の `DATE_ONLY` と `UNKNOWN` を、**5つのタイムフレームすべて**(`1m`〜`60m`)に変更。`APPROXIMATE` は変えない(Eurostat の既存の挙動を保つ) | precision が `DATE_ONLY` / `UNKNOWN` |
| C2 | `src/ingestion/pipelines/eventReactions.ts` | C1 により `availableTimeframes` が空になり、既存の `NO_ANALYZABLE_TIMEFRAME` の除外が**初めて働く**。コメント(Never happens today)を更新。**防御として**、precision が `EXACT` / `APPROXIMATE` 以外なら先に `NON_ANALYZABLE_PRECISION` として飛ばす条件を明示 | 同上。反応の行を作らない・書かない |
| C3 | 読み取り側(`resolveTimeframeAnalysisStatus`、`routes/events.ts`、`routes/historical.ts`、`majorFxReactions.ts`) | C1 の `availableTimeframes` を共通で使っているため、**修正は不要**(`NOT_ANALYZABLE` が全タイムフレームで返る)。ただし**結果が変わる**: 既存の `DATE_ONLY` / `UNKNOWN` のイベントの 15m・30m・60m が `NOT_ANALYZABLE` になる | — |
| C4 | `src/ingestion/pipelines/officialScheduleTable.ts`、`mappings/gbAuCaSchedule.ts` | 現行は `OfficialScheduleEntry.time`(`'HH:MM'`)が**必須**で、`officialScheduleUtc()` は時刻の形が不正なら null を返し、`insertEvent` は `release_datetime_precision: 'EXACT'` を固定で書く。DATE_ONLY を扱うには、エントリに**任意の `precision`**(`'EXACT'` / `'DATE_ONLY'`)を足し、**`time` は `precision = EXACT` のときだけ必須**にする。`precision = DATE_ONLY` のときの `release_datetime` は、**各銀行のタイムゾーンの、その日の 00:00**(固定の慣例。起点としては使わない)。`insertEvent` と更新(UPDATE)の `precision` を、エントリの値にする(現行の `precision !== 'EXACT'` なら `EXACT` に直すパッチは、エントリの precision に合わせる) | — |
| C5 | テスト | 下の T-P1 | — |

**変更範囲のまとめ**: BoC だけ(EXACT)なら **C1〜C4 は不要**(BoC を先に実装できる)。BoE を日付だけで登録する場合に、C1〜C4 が必要で、**既存の DATE_ONLY / UNKNOWN のイベントの反応の返却も変わる**(実装前に、DEV の `economic_events` の `release_datetime_precision` の分布を読み取りで確認する。§6.2)。

**推奨(v2)**: **BoC を先に実装する(EXACT、C1〜C4 なし)**。**BoE は、時刻を公式で確認できてから**(確認できれば EXACT で C1〜C4 なし。確認できなければ C1〜C4 を伴う DATE_ONLY)。

**テスト(P1-1)**
| # | 状況 | 期待 |
|---|---|---|
| T-P1-1 | BoC の予定表: `09:45` / `America/Toronto` / 夏時間(EDT)と冬時間(EST) | `release_datetime` が 13:45Z(EDT)/ 14:45Z(EST)。`precision = EXACT`。全公表日(2026・2027 の16件)で UTC が正しい |
| T-P1-2 | `availableTimeframes('DATE_ONLY')` と `('UNKNOWN')` | 空(C1 の後)。`('APPROXIMATE')` は `['5m','15m','30m','60m']`、`('EXACT')` は 5つ |
| T-P1-3 | `event-reactions` に DATE_ONLY のイベント(RELEASED) | 反応の行を**書かない**。`NO_ANALYZABLE_TIMEFRAME`(または `NON_ANALYZABLE_PRECISION`)の skip |
| T-P1-4 | `event-reactions` に APPROXIMATE のイベント(Eurostat 型) | 従来どおり 5m〜60m が計算される(回帰) |
| T-P1-5 | `GET /events/{id}` で DATE_ONLY のイベント | 全タイムフレームが `NOT_ANALYZABLE`。`available_timeframes` が空 |
| T-P1-6 | 通知の候補 | DATE_ONLY は事前通知の対象外(既存の仕様の固定) |
| T-P1-7 | 予定表に `precision = DATE_ONLY` で `time` なし | 登録できる(C4)。`precision = EXACT` で `time` なし → エラー |
| T-P1-8 | DATE_ONLY のエントリに、後から `time` と `EXACT` を足す | 同じ `provider_event_id` の行が UPDATE される(重複しない)。`release_datetime` と `precision` が更新される |
| T-P1-9 | 戦略分析 | EXACT でない発表は判定しない(既存の仕様の固定) |
| T-P1-10 | 既存の `DATE_ONLY` / `UNKNOWN` のイベントがある DB で C1 を適用 | 反応の返却が `NOT_ANALYZABLE` になる(影響の確認。件数は事前に読み取りで確認) |

### 1.4 タイムゾーンと適用開始日の扱い
| | BoC | BoE |
|---|---|---|
| 公表日・時刻のタイムゾーン | `America/Toronto`、**09:45 ET(確認済み)** | `Europe/London`、時刻は未確認 |
| 変更の有効日 | **2021年以後: 発表の翌営業日**(公式)。**2021年より前は発表の当日** | **発表日当日**(IADB の実績) |
| 「決定後の金利」を読む日(有効日) | 発表日の翌営業日の観測 | 発表日の観測 |
| 「決定前の金利」を読む日 | 発表日の観測(その日はまだ変わっていない) | 発表日の前営業日の観測 |
| 「安定の確認」に使う、次の観測(§2.1) | 有効日の次の営業日の観測 | 発表日の次の営業日の観測 |
- 日付の比較は、発表日を各銀行のタイムゾーンの暦日にして行う(夏時間の影響を受けない)。
- 翌営業日の判定: Valet の観測が存在する次の日付(営業日系列なので、祝日は観測が無い)。「発表日 + 1日」の観測が無ければ、発表日より後の最初の観測。
- **2021年より前のルール**: 取り込み(今後の決定)には関係しないが、過去データの検証・バックフィルで有効日を計算するときは、**発表日が 2021年より前なら当日**を使う。境界の日付(公式が「2021年から」とだけ書いており、**どの日から**かは未確認)は、実装時に、公式の決定履歴の表で確認する。

### 1.5 エラー・欠損・重複・訂正の処理(すべて「書かない・推測しない・記録して再実行」)
| 状況 | 扱い |
|---|---|
| HTTP エラー・タイムアウト(5xx・429・通信失敗) | 既存の HttpClient の再試行(最大2回、バックオフ)。それでも失敗なら何も書かず `FETCH_FAILED`(次の実行で取り直す) |
| 応答が想定の形でない(BoC: `seriesDetail` / `observations` 無し。BoE: 先頭行が `DATE,IUDBEDR` でない・HTML) | 何も書かない。`RESPONSE_UNPARSABLE`(エラー、終了コード 1) |
| 系列の取り違え(BoC: `seriesDetail` のキーが `V39079` でない・label が想定と違う。BoE: 列名が違う) | 何も書かない。`SERIES_MISMATCH` |
| 決定の有効日の観測、または**安定確認の次の観測**がまだ無い | 何も書かない。`AWAITING_OBSERVATION`(SCHEDULED・PENDING のまま。次の実行で再確認) |
| 値が数でない・欠けている・範囲外(0 未満・25 超) | 何も書かない。`INVALID_VALUE` |
| 同じ日付が2回ある | 何も書かない。`DUPLICATE_OBSERVATION`(エラー) |
| 決定前の観測が無い | 何も書かない。`NO_PREVIOUS_OBSERVATION` |
| **変化の幅(第2版で変更)** | **幅で書き込みを止めない**。第1版の `UNUSUAL_CHANGE`(0.25 の倍数でない・1.0 超で停止)は**廃止**。理由: 正当な変更が止まる。実績: BoE 2020-03-19 の **0.25 → 0.1(−0.15)**、BoC 2022-07-14 の **+1.00**・2022-09-08 の **+0.75**、BoE の1975年以降は259回の変更のうち94回が 0.25 の倍数でない・0.5 超。**幅は「確認のヒント」**として出力(`review_hints`: 0.25 の倍数でない・|幅| > 0.5)するだけで、書き込みを止めない。止めるかどうかは、**安定確認と、予定表との照合**で決める |
| **予定外の変化**(系列の変化日が、予定表のどの決定日の有効日とも合わない) | 書かない。`UNSCHEDULED_CHANGE` を出力。手動の登録運用(§2.6) |
| 記録済みの決定と、取得元の今の値が食い違う(後日の訂正) | 記録は変えない(スナップショットは不変)。`conflicts` としてログに出し、人が確認する(FOMC の `details.conflicts` と同じ方式)。訂正の手順は §2.4 |
| 公式の決定履歴(BoC のページの表、BoE の声明の見出し)との食い違い | `PENDING_REVIEW`(人の確認。§2.2) |

### 1.6 取得値の検証方法
1. **系列の同一性**: BoC は observations の `seriesDetail` の系列名と label、BoE は CSV の列名。
2. **値の形**: 数として読める、0 以上 25 以下、有限。
3. **決定の整合**: `previous` と `actual` が両方取れること。変更幅 = `actual − previous`。
4. **日付の整合**: 決定後の観測日が、各銀行の有効日の規則(§1.4)に合うこと。
5. **安定確認**(§2.1): 有効日の観測と、その次の営業日の観測が、同じ値であること。
6. **公式の決定履歴との照合**(§2.3): 一致すれば `VERIFIED`。

---

## 2. DB設計

### 2.1 書き込み前の安定確認(P1-2。必須)

**問題**: スナップショットは DB のトリガーで更新・削除できない(不変)。取得元(Valet・IADB)の更新に遅れがあるため、取得直後の値で確定すると、**遅れ・暫定値による誤り**が不変のまま残る。特に**据え置き**は、「変化がない」ことが、更新が遅れている状態と区別できない。

**必須の条件(すべて満たすまで書かない)**
1. **有効日の観測が存在する**(BoC: 発表日の翌営業日、BoE: 発表日)。
2. **その次の営業日の観測も存在し、有効日と同じ値**(取得元の更新が、有効日より1営業日先まで進んだ後も、値が変わらない)。
3. 決定前の観測が存在する。
4. 1〜3 が**1回の取得の応答の中で**確認できる(2回の取得の時間差には頼らない。系列が1営業日先まで進んだことが証拠)。
5. 値の検証(§1.6 の 1〜4)が通る。
- **据え置きも同じ**: 有効日の観測と次の観測が両方あり、決定前と同じ値のときだけ「据え置き」と確定する。有効日の観測が無い(更新が遅れている)場合は、据え置きと推測せず `AWAITING_OBSERVATION`。

**保存の目標時期**: BoC は発表日の**2営業日後**(有効日 = 翌営業日、確認 = その次)。BoE は発表日の**翌営業日**(有効日 = 当日、確認 = 翌営業日)。

### 2.2 書き込み前の段階保存: `ingestion_staged_values`(P1-2)

既存の `ingestion_staged_values`(`20261015000003`)は、検証前の値を、Read API に見せずに置く表。`kind = 'RELEASE'`、`event_id`(必須)、`actual` / `previous`、`reference_period`、`verification_status`(`AWAITING_OFFICIAL` / `PENDING_REVIEW` / `VERIFIED` / `SINGLE_SOURCE` / `REJECTED`)、`reasons[]`、`detail` jsonb、`resolved_at` / `resolved_by`。未解決の行は `(event, kind, field)` ごとに1行(一意索引)で、取り込みを何度流しても増えない。

**使い方(BoC・BoE の決定)**
| 段階 | 条件 | 動き |
|---|---|---|
| 1. 初回の観測 | 有効日の観測が出たが、次の観測がまだ無い | `AWAITING_OFFICIAL` の行を作る(`actual` = 決定後、`previous` = 決定前、`reference_period` = 発表日、`detail` に観測日・取得元)。**スナップショットは書かない。イベントは SCHEDULED・PENDING のまま** |
| 2. 安定確認の成立 | §2.1 の条件 1〜5 を満たす | **昇格**: `event_snapshots`(RELEASE)を書き、イベントを RELEASED・AVAILABLE にし、staged の行を `VERIFIED` または `SINGLE_SOURCE`(§2.3)に更新 |
| 3. 異常 | 次の観測が有効日と違う値、公式の決定履歴と食い違う、予定外の変化など | `PENDING_REVIEW`(理由コードを `reasons` に)。**書かない**。人の確認を待つ |
| 4. 人の判断 | HQ 承認の手順(SQL Editor)で `REJECTED`(その値は使わない)にする、または原因を直して再実行 | `resolved_at` / `resolved_by` を記録 |
- **人による確認の位置づけ**: 自動で確定できない場合(段階3)に、書き込み前に止めて人が見る。確認の対象は `PENDING_REVIEW` の行の一覧(取り込みの出力 `open_reviews` に毎回出す)。
- **今回の設計では、段階3の値を人が「承認して書く」経路は作らない**(承認の経路は別の設計・承認が要る)。段階3は、原因が取得元の訂正で解消されて次の実行で段階2に進むか、`REJECTED` にして手動のイベント登録(§2.6)で扱う。
- staged の行は更新できる(`updated_at` のトリガー)ため、**証拠の不変性は持たない**。不変の記録は `event_snapshots`(昇格後)。段階1・3の観測値は、staged の `detail` と取り込みのログに残す。
- この仕組みは、有料の経済カレンダーの取り込み(`economicCalendar.ts`)が使っているものと同じ表・同じ流れ(`findOpenStagedValue` / `insertStagedValue` / `updateStagedValue`)。新しい表は作らない。

### 2.3 `VERIFIED` と `SINGLE_SOURCE` の使い分け(P2-2。既存の定義に合わせる)

既存の定義(`event_snapshots` / `ingestion_staged_values` のコメント): `VERIFIED` = 公式統計の値と丸めを合わせて一致した、または人が確認した。`SINGLE_SOURCE` = 照合できる公式統計がなく、取得元1つの値。公式機関の値そのもの(GB・AU・CA の `official-values`)は `VERIFIED`。

| 状況 | `verification_status` | `verification_source` |
|---|---|---|
| 安定確認(§2.1)を満たし、**かつ公式の決定履歴(BoC の Key interest rate ページの決定履歴、BoE の MPC の声明)と一致**(自動の照合、または人が確認して `resolved_by` に記録) | **`VERIFIED`** | `valet:V39079@<有効日>,<確認日>;history:<照合元>` |
| 安定確認は満たすが、**決定履歴との照合ができていない**(自動の照合が未実装、または人の確認が未了) | **`SINGLE_SOURCE`** | `valet:V39079@<有効日>,<確認日>` |
- 第1段階の実装(照合を自動化しない場合): **最初の複数回の決定は `SINGLE_SOURCE` で保存し、人が公式の履歴と突き合わせた結果を運用の記録に残す**。自動の照合(HTML の解析)は、壊れやすいため、実装の承認の後に別途判断する。
- `SINGLE_SOURCE` も API で通常どおり表示される(既存の定義)。区別は、品質レポートの集計と、後日の確認に使う。

### 2.4 書き込み後の誤りの訂正: `event_revisions`(P1-2)

**既存の不変性・監査との整合**
- `event_snapshots` の RELEASE は、DB のトリガーで更新・削除ができない(誤っていても残る)。誤りの訂正は、**`event_revisions` の1行**として積む(`field_name` = `ACTUAL` または `PREVIOUS`、`old_value`、`new_value`、`effective_at`、`source`)。誤った値と訂正が、時刻つきで両方残る(CA_CPI の設計と同じ原則)。
- API の既存の挙動: スナップショットの値(誤った値)は `snapshot.actual` のまま返り、`revision_status = REVISED` と、`GET /events/{id}/revisions` で訂正が返る。**スナップショット自体は直らない**(不変)。画面で訂正後の値を見せるかは、既存の改定の表示(A)に従う。**この限界を明記する**: 訂正は「履歴として残る」が、スナップショットの値は残り続ける。

**誤りを検出したときの手順(停止・訂正・再取得)**
| 手順 | 内容 |
|---|---|
| 1. 検出 | `conflicts`(記録済みの値と取得元の今の値の食い違い)の出力、人の確認(決定履歴との突き合わせ)、利用者の指摘 |
| 2. 停止 | 手動実行のみなので、**該当の target を実行しない**。原因が取得元の誤りか自分の誤りかの判断が付くまで、同じ銀行の次の決定の保存を止める(もう一方の銀行は独立) |
| 3. 原因の確認 | B が証拠(取得元の応答、公式の履歴、staged の `detail`、ログ)を集め、C が独立に確認。HQ が判定 |
| 4. 訂正 | HQ の承認のもとで、`event_revisions` に ACTUAL(または PREVIOUS)の訂正を1行追加。同じ訂正を二度足さない(直近の値と比べる) |
| 5. 再取得 | 取得元が訂正されたなら、次の実行で `conflicts` が解消(同じ値)か確認。コードの誤りなら、修正してテストを足し、再度の dry-run |
| 6. 確認 | 読み取り専用で、該当イベントのスナップショットが不変、訂正が1行だけ増えたこと、他のイベントの fingerprint が不変 |
- 予防が主: §2.1 の安定確認(次の観測まで待つ)が、この手順を使う頻度を下げる。

### 2.5 取得元の遅れと、アプリ上の「結果待ち」(P2-1)

| 時点 | イベントの状態 | アプリの表示(既存の仕組み) |
|---|---|---|
| 発表の前 | SCHEDULED・PENDING | 公表日時のみ |
| 発表の後、保存の前(BoC: 最大2営業日、BoE: 最大1営業日) | SCHEDULED・PENDING のまま(`data_status = DATA_PENDING`) | **「結果待ち」**(既存の `DATA_PENDING` の表示。**文言・見え方は A に確認**) |
| 保存の後 | RELEASED・AVAILABLE | 結果(`actual`)と前回(`previous`) |
- **発表の直後に結果が出ない**のは、取得元の更新を待つため(設計上の限界)。他社の経済カレンダーとの差として、HQ が許容するかの判断が要る。
- 速く出す選択肢(**今回の設計の既定にしない**): 人が公式の声明(BoC のプレスリリース、BoE の MPC の声明)で金利を確認し、staged の行(`PENDING_REVIEW` → 人の確認)から当日に保存する経路。**人の確認の経路を別の設計で作る必要がある**ため、今回は範囲外。
- 運用の目標: BoC は発表日の2営業日後までに、BoE は翌営業日までに、手動の実行で保存。担当・週末・祝日の対応は、CA_CPI と同じ課題(未確定)。取得元の更新が遅れて期限を過ぎそうなら、HQ に報告(エスカレーション)。
- 価格反応: `event-reactions` の対象は、**RELEASED になった後**(直近の窓の内)。BoC の保存は2営業日後なので、反応の計算(手動)は保存の後。反応は発表時刻(09:45 ET)を起点にするので、保存が遅れても値は変わらない。

### 2.6 予定外の緊急決定(P2-5)

**過去の例(系列で確認できる変更日)**: BoC **2020-03-16**(1.25 → 0.75)と **2020-03-27**(0.75 → 0.25)、BoE **2020-03-19**(0.25 → 0.1。同月 03-11 の変更の8日後)。これらが予定外の決定だったかは、**当時の公式の日程表との照合が未確認**(緊急の決定として一般に知られているが、この設計では確認済みとしない)。2020年の BoC は有効日が発表の当日(§1.1)。

**検知**: 取り込みのたびに、系列の**変化日**を、予定表の有効日(§1.4)と照合し、**どの予定とも合わない変化**を `UNSCHEDULED_CHANGE` として出力する(日付・変更前後・幅)。書かない。`open_reviews` に毎回出る(人が対応するまで)。

**手動のイベント登録の運用(HQ 承認のもとで)**
| 手順 | 内容 |
|---|---|
| 1. 確認 | B が、公式の声明(BoC のプレスリリース、BoE の声明)で、決定の事実・日時・金利を確認。C が独立確認 |
| 2. 承認 | HQ が、イベントの登録を承認 |
| 3. 登録 | HQ 承認の手順(DEV の SQL Editor)で `economic_events` に1行追加(`provider = '<銀行>_unscheduled'`、`provider_event_id = '<銀行>:<指標>:<発表日>'`、`indicator_id`、`release_datetime` = 公式の声明の時刻(確認できれば `EXACT`、できなければ `DATE_ONLY`。§1.3 の扱い)、`importance` = HIGH、`status` = SCHEDULED、`data_status` = PENDING)。SQL の雛形は実装時に提示し、実行前に HQ が確認(今回は作らない) |
| 4. 保存 | 通常の取り込みが、そのイベントに対して §2.1 の安定確認を行って保存する |
| 5. 確認 | 読み取り専用で、イベント・スナップショット・変更前後の値が公式と一致 |
- 予定表(コードの表)にも後日、実績として足すかは、別の判断(重複登録を避けるため、`provider_event_id` を一致させる)。

### 2.7 保存先の比較と結論(第1版から維持。P3 の訂正を反映)

| 観点 | 案A: `economic_events` + `event_snapshots`(**推奨**) | 案B: FOMC と同じ専用テーブル |
|---|---|---|
| 表現 | `actual` = 決定後の金利、`previous` = 決定前の金利、`forecast` = null、`unit` = `%` | 専用の列 |
| 既存の機能との接続 | 過去の発表のロック・過去比較・価格反応・通知・検索・戦略分析が、RELEASED のイベントとして**自動で働く** | 各機能に特別扱いが必要 |
| API / iOS | **変更なし** | `event.policy_rate`(v1.47)は iOS で `target_range_lower` / `target_range_upper` が必須で範囲表示。単一の金利には合わず、API・アプリの変更が要る |
| マイグレーション | 指標行のみ | 新規テーブル + 指標行 |
- **推奨: 案A**。FOMC が専用表なのは、誘導目標が範囲(下限・上限の2値)で、単一にまとめないというHQ決定があったため。BoC・BoE には当てはまらない。FOMC は変えない。
- **将来の拡張(P3 の訂正)**: 第1版の「RBA・ECB・日銀も案Aで足せる」を訂正する。**ECB は主要政策金利が3つ(預金ファシリティ・主要リファイナンス・限界貸出)で、単一の金利ではない**ため、案Aの「1イベント = 1つの `actual`」では表せない。ECB は別の設計が要る。RBA(キャッシュレート誘導目標)は単一金利だが、取得経路が未確認(CSV が 403)。日銀は許諾待ち。
- 履歴: 1決定 = 1イベント(`provider_event_id` = `<provider>:<指標コード>:<発表日>`)。`event_snapshots`(RELEASE、不変)に `actual`・`previous`・`forecast`(null)・`surprise`(null)・`unit`・`verification_status`・`verification_source`・`captured_at`・`source`・`source_url`。変更幅 = `actual − previous`(API に新しい項目は足さない)。据え置きもイベント(幅 0)。バックフィルは既定でしない。
- 意味の混同の防止: 指標名・説明・単位・`value_decimals = 2` で区別。`previous` は「この決定の直前の水準」。`forecast` は null(無料・公式の予想の取得元が無い)。改定は `event_revisions` の訂正にだけ使う(§2.4)。
- 通貨ペア: `BOC_RATE` → CADJPY(1)、`BOE_RATE` → GBPUSD(1)・GBPJPY(2)(既存のペア)。

---

## 3. アプリへの影響・出典

### 3.1 表示(§3.1)
| 項目 | 内容 | 状態 |
|---|---|---|
| カレンダー | 「BOC政策金利」「BOE政策金利」が、重要度 HIGH で、公表日に表示される。**`indicator-display-names.md` には `BOE政策金利`(92行)と `BOC政策金利`(102行)が既にある(確認済み)ので、表の変更は不要**。指標の `display_name` をこの表記に合わせる | A の確認 |
| 決定前・結果待ち | §2.5 | A に文言を確認 |
| 決定後 | 結果(`actual`)と前回(`previous`)。予想・サプライズは null | A の確認(null の表示) |
| 過去イベント比較・ロック | FREE は直近3回の決定だけ値が見える(年8回で約5か月分) | 既存の仕組み |
| 変更幅 | 既存の項目では「結果 / 前回」まで。差の表示は A と相談 | 要判断 |
| 戦略分析 | `surprise` が null の発表は、サプライズに基づく項目が null(既存の仕様)。EXACT でない発表は判定しない | 既存の仕様 |
| 通知 | HIGH なので FREE も対象。**EXACT のときだけ事前通知**(BoC は対象。BoE は時刻確認まで対象外) | §1.3 |

### 3.2 価格反応・通知との接続
§1.3 のとおり。BoC は EXACT で、`event-reactions`(手動)が 1m〜60m を、発表の 09:45 ET を起点に計算する(RELEASED になった後)。BoE は時刻が確認できるまで、対象にしない(C1・C2 の変更、または BoE のイベントを登録しない)。

### 3.3 `value_decimals`(P2-3)
- **バックエンドの実装項目(必須)**: `src/domain/valueDecimals.ts` は、現在 **BLS の % の指標だけ 1** を返し、それ以外は null(`findMappingByCode` に頼る)。`BOC_RATE`・`BOE_RATE` は `findMappingByCode` に**登録しない**(英国・豪州・カナダ・日本の指標と同じ。他の取り込みの経路に混ざるため)ので、**公式統計の指標のコードの一覧を持つ形に変えて、`BOC_RATE`・`BOE_RATE` → 2** を返す(CA_CPI の設計の §14.2 と同じ変更。**同じファイルを触るため、実装の順序と衝突に注意**)。
- **A への確認事項(iOS)**: `value_decimals` が null でなく 2 のときの表示(`4.00%`)、予想・サプライズが null のときの表示、変更幅の表示、「結果待ち」の文言。

### 3.4 出典と告知(P2-6。具体化)

**BoC(規約 https://www.bankofcanada.ca/terms/)**
- **1.1 出典**: `attribution.notice` を「Source: Bank of Canada. Target for the overnight rate (V39079), <対象の決定日>.」(変更・加工は無いので「変更なし」)。`source_url` = https://www.bankofcanada.ca。ロゴは使わない。
- **1.3 購入前の告知**: 「購入者に、**購入・配布の前に**、この内容が同サイトから無料で入手できることを伝える」。アプリには有料プラン(PRO)があるため、**政策金利のデータ(BoC のコンテンツ)を含む有料サービス**として適用されるとみなす(確認していない場合は、安全側)。
  - 告知の文案(案): 「政策金利の一部のデータは、Bank of Canada のウェブサイト(https://www.bankofcanada.ca)から無料で入手できます。」
  - **置き場所(購入の前に見える場所)**: PRO の購入画面(ペイウォール)と、サブスクリプションの説明。イベント詳細の出典欄にも同じ要旨を入れる。**画面の変更を伴うため、HQ・A の判断**(今回の範囲外)。
  - FREE のみで購入が無い場合は 1.3 の対象外だが、PRO が存在する限り、告知を置く。

**BoE(データベースは OGL。https://www.bankofengland.co.uk/legal)**
- データの転載は「UK Open Government Licence」の条件の下(確認済み)。**Bank Rate 用の指定の出典文言は、公式のページに無い**(指定があるのは SONIA のみ)ため、OGL v3.0 の標準の要件(出典の明記、ライセンスへのリンク)に沿った文言を案にする。
- `attribution.notice`(案): 「Source: Bank of England, Official Bank Rate (IUDBEDR). Contains public sector information licensed under the Open Government Licence v3.0. © Governor and Company of the Bank of England.」
- **ライセンスへのリンク**: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ を、出典欄から開けるようにする(`source_url` は https://www.bankofengland.co.uk、ライセンスのリンクは `notice` の中、または別の項目 — A に確認)。
- サイトの文章(声明の本文など)は非商用のみなので、**使わない**(数値と、指標の名前だけ)。
- 「Bank of England」の商標・ロゴは使わない。承認を暗示しない。
- 最終の文言は HQ が確認する。

---

## 4. テスト(実装時に作る)

### 4.1 取り込み・保存
| # | 区分 | 状況 | 期待 |
|---|---|---|---|
| P1 | 正常 | BoC: 発表日の観測 2.25、翌営業日 2.50、その次の営業日 2.50 | 引き上げ(+0.25)。段階保存 → 昇格。`previous` 2.25 / `actual` 2.50。RELEASED |
| P2 | 正常 | BoE: 発表日の前営業日 3.75、発表日 4.00、翌営業日 4.00 | 同様(+0.25) |
| P3 | 引き下げ | BoC 2025-10-29 型(2.50 → 2.25) | `previous` 2.50 / `actual` 2.25(−0.25) |
| P4 | 大きな・小さな変更 | BoC 2022-07-14(+1.00)・2022-09-08(+0.75)、BoE 2020-03-19(−0.15) | **止まらず**保存される(幅では止めない)。`review_hints` に出る |
| P5 | 据え置き | 有効日・次の観測とも決定前と同じ | イベントは RELEASED。`previous` = `actual`。変更幅 0 |
| P5b | 据え置きの誤判定の防止 | 有効日の観測が**まだ無い**(更新の遅れ) | 据え置きと推測しない。`AWAITING_OBSERVATION` |
| P5c | 安定確認の不成立 | 有効日の観測だけがあり、次の営業日の観測がまだ無い | staged(`AWAITING_OFFICIAL`)のみ。スナップショットは書かない |
| P5d | 安定確認の不成立(値の変化) | 次の観測が有効日と違う値 | `PENDING_REVIEW`(`VALUE_CHANGED_BEFORE_CONFIRM`)。書かない |
| P6 | 冪等 | 記録済みの決定を、同じ入力でもう一度 | 何も増えない。スナップショット不変。staged も増えない |
| P7 | 取得失敗 | HTTP 500 / タイムアウト | 何も書かない。`FETCH_FAILED` |
| P8 | 欠損 | 決定後の観測がまだ無い | `AWAITING_OBSERVATION` |
| P9 | 応答の異常 | BoC: `seriesDetail` なし / label が違う、BoE: 先頭行が違う・HTML | `RESPONSE_UNPARSABLE` / `SERIES_MISMATCH` |
| P9b | Valet の応答の形 | series の応答の `seriesDetails`(複数)を observations のパスで読もうとした入力 | 想定の形でないとして停止(取り違えない) |
| P10 | 値の異常 | null・非数・負・25 超 | `INVALID_VALUE` |
| P11 | 重複 | 同じ日付が2行 | `DUPLICATE_OBSERVATION` |
| P12 | 過去データ | 固定データ: BoC 2024-06 以降の10回の変更、BoE 2024-08 以降の7回の変更(確認済みの実データ) | 各決定の `previous` / `actual` / 有効日が実データと一致 |
| P13 | 公式の履歴 | BoC: 2026-10-28 +0.25 で 2.50 | 保存値と一致 → `VERIFIED` |
| P13b | 履歴の照合なし | 安定確認のみ | `SINGLE_SOURCE` |
| P14 | 有効日の規則 | BoC: 発表日の観測は旧金利、翌営業日から新金利。BoE: 発表日から新金利。**BoC 2020 年以前(当日有効)の過去データ** | 規則どおり。2021年より前は当日(検証のみ) |
| P15 | 営業日 | BoC の翌営業日が祝日をまたぐ | 発表日より後の最初の観測を使う |
| P16 | 予定外の変化 | BoC 2020-03-16・2020-03-27、BoE 2020-03-19 型の変化(固定データ) | `UNSCHEDULED_CHANGE`。書かない |
| P16b | 手動登録後 | 手動で登録されたイベントに、同じ変化 | §2.1 の安定確認で保存 |
| P17 | 食い違い | 記録済みの決定と、取得元の今の値が違う | 記録は変えない。`conflicts` に出る |
| P18 | 独立 | BoC が失敗しても BoE は処理される(逆も) | 銀行ごとに独立 |
| P19 | 時刻の精度 | BoC は EXACT。BoE の時刻未確認の設定は DATE_ONLY | T-P1 のとおり |
| P20 | dry-run | dry-run | 何も書かない。staged も書かない。計画だけ |
| P21 | 予定表の整合 | 予定表の日付が公式の日程と一致 | BoC 16件(2026: 8、2027: 8)、BoE 16件(2026: 8、**2027: 8(12/16 を含む)**) |
| P22 | API 応答 | 決定後の `GET /events/{id}` | `snapshot.actual` / `previous` / `unit` / `attribution` / `value_decimals = 2` |
| P23 | ロック | FREE が4回目以前の決定を見る | 値が隠れる。`attribution` は残る |

### 4.2 訂正・価格反応・workflow
| # | 状況 | 期待 |
|---|---|---|
| R1 | 誤って保存した値に対する `event_revisions` の ACTUAL 訂正 | 1行増える。スナップショット不変。`revision_status = REVISED` |
| R2 | 同じ訂正を再度 | 増えない(直近値と比べる) |
| R3 | 訂正後の再実行 | `conflicts` が解消(同じ値)。重複しない |
| R4 | 価格反応(BoC、EXACT) | 1m〜60m が 09:45 ET 起点で計算される |
| R5 | 価格反応(BoE、時刻未確認) | 反応の行が作られない(T-P1-3) |
| W1 | workflow の新しい target | 手動のみ・DEV の確認つき・許可されたコマンドだけ(§5.3) |
| W2 | 品質レポート | `ingest:official:policy-rates` の実行が、official のジョブ(接頭辞 `ingest:official`)として集計される |

---

## 5. migration・運用

### 5.1 必要な指標行と通貨ペアの案(SQL 案。**どこにも実行していない**)
```sql
-- BoC・BoE 政策金利(HQ指示 2026-11-13。案。実行しない)。何度流しても同じ結果(on conflict do nothing)。
insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('BOC_RATE', 'BOC政策金利', 'Bank of Canada Policy Interest Rate', 'BOC政策金利', 'CA', 'CAD', 'HIGH',
    'カナダ銀行(Bank of Canada)が、年8回の決定日に決める政策金利(翌日物金利の誘導目標)です。決定後の水準を「結果」、直前の水準を「前回」に表示します。',
    array['カナダの金融政策の方向性がわかる', 'カナダドルの金利水準を直接左右する', '決定の翌日から新しい水準が有効になる'],
    'IRREGULAR', '%', 'Bank of Canada', 'https://www.bankofcanada.ca', 'NEUTRAL',
    '<予想がないため、サプライズの文言は一般論にとどめる(実装時に確定)>',
    '<同上>'),
  ('BOE_RATE', 'BOE政策金利', 'Bank of England Bank Rate', 'BOE政策金利', 'GB', 'GBP', 'HIGH',
    'イングランド銀行(Bank of England)の金融政策委員会(MPC)が、年8回の決定日に決める政策金利(Bank Rate)です。決定後の水準を「結果」、直前の水準を「前回」に表示します。',
    array['英国の金融政策の方向性がわかる', 'ポンドの金利水準を直接左右する', '決定の当日から新しい水準が有効になる'],
    'IRREGULAR', '%', 'Bank of England', 'https://www.bankofengland.co.uk', 'NEUTRAL',
    '<同上>', '<同上>')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('BOC_RATE', 'CADJPY', 1),
  ('BOE_RATE', 'GBPUSD', 1),
  ('BOE_RATE', 'GBPJPY', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
```
- 変更するテーブル: `economic_indicators` 2行、`indicator_fx_pairs` 3行。`fx_pairs` は既存。`event_snapshots`・`economic_events`・`ingestion_staged_values` の列の追加は不要。
- 重複の確認: `code` は `unique`、`(indicator_id, fx_pair_id)` は `unique`。`BOC_RATE`・`BOE_RATE` は DEV の22指標に存在しない(確認済み)。
- **BoC を先に実装する場合**、BoE の行は別の migration に分けられる(BoE の時刻の確認を待たずに BoC を進められる)。
- `seed.sql` と、指標の件数・ペアの期待を持つ結合テストの更新が、同じ変更で要る。
- 戻す手順(案。イベントが無いうちだけ): `delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code in ('BOC_RATE','BOE_RATE')); delete from economic_indicators where code in ('BOC_RATE','BOE_RATE');`

### 5.2 必要なバックエンド実装項目(一覧)
| # | 項目 | 節 |
|---|---|---|
| B1 | 新しい取り込み処理 `ingest:official:policy-rates`(dry-run つき)。決定ごとに有効日・次の観測の取得、staged → 昇格、`conflicts`、`UNSCHEDULED_CHANGE`、`open_reviews`、`review_hints` | §1・§2 |
| B2 | 公表予定の表(BoC 16件・BoE 16件。時刻は BoC のみ確認済み)と、予定の取り込み | §1.2・§1.3 |
| B3 | `src/domain/valueDecimals.ts`: 公式統計の指標の一覧に `BOC_RATE`・`BOE_RATE` → 2 | §3.3 |
| B4 | `src/domain/attribution.ts`: BoC・BoE の出典(§3.4) | §3.4 |
| B5 | (BoE を DATE_ONLY で登録する場合のみ)C1〜C4 | §1.3 |
| B6 | テスト(§4)、`seed.sql`、結合テストの更新 | §4 |

### 5.3 workflow・運用(P2-4)
- **既存の target では足りない**: `official-values` は `previous` を保存せず、決定前後の観測を使う安定確認の流れも持たない。**新しい手動 target(`policy-rates-dry-run` / `policy-rates`)が要る**(workflow の変更。別の承認)。
- **concurrency**: 手動の target は、既定のグループ `fx-ingestion` に入れる(BLS・official-values・FOMC などと同じ。直列で動く)。要人発言の専用グループ(`fx-ingestion-speeches`)・Eurostat の専用グループには入れない(式の条件を変えない)。BoC と BoE を同じ target で処理するので、グループは1つ。
- **workflow lint**: workflow の変更は `fx-event-analyzer-workflow-lint.yml`(actionlint 1.7.7 の固定版 + `check_speech_schedule_steps.py`)の対象。新しい step の `if` の式(手動のみ・DEV の確認つき)が actionlint を通ること。`check_speech_schedule_steps.py` は要人発言の定期の step の検査なので、新しい step はその対象外(既存の検査が変わらないことを確認)。
- **`inputs.target` の説明**: 現在の `description` は target の一覧を文字列で列挙している(`official-values`・`jp-cpi-values` など)。新しい target を**この文字列に足す**(足し忘れても動くが、手動実行の画面で選べる候補の説明に出ない)。
- **workflow のテスト**: `tests/ingestion/gbAuCaWorkflow.test.ts` と同じ型で、新しい target の step が「手動のみ・許可されたコマンドだけ・DEV の確認つき・定期実行なし」であることを固定する。
- **品質レポートのログ集計**: ジョブ名は **`ingest:official:policy-rates`**(既存の `ingest:official:bls-calendar`・`ingest:official:jp-cpi-values` と同じ命名)にする。品質レポートの `OFFICIAL_JOB_PREFIX = 'ingest:official'` に合うので、official のジョブとして集計される。dry-run は `ingestion_logs` に書かない(既存の方式)。
- **スナップショット誤登録時の対応**: §2.4。
- **定期取得の頻度と再試行**: 今回の範囲では定期実行を足さない。公表日の運用は手動(dry-run → 承認 → 実行)。`AWAITING_OBSERVATION` / `FETCH_FAILED` は書かないだけなので、何度再実行しても安全。保存の目標: BoC は発表日の2営業日後、BoE は翌営業日。担当(実行・副・週末)は未確定(CA_CPI と共通)。将来、定期実行に入れる場合は、GitHub の定期の到達率が低い(約36%)ことを前提にした別の設計が要る(別の承認)。

### 5.4 DEV 適用前に必要な確認事項
§6.2 を参照。

---

## 6. 未解決事項と、実装前に必要な確認

### 6.1 未解決事項(この設計だけでは決められないこと)
| # | 事項 | 内容 |
|---|---|---|
| U1 | **BoE の発表時刻** | 公式のページで確認できていない。確認できなければ、BoE は DATE_ONLY(C1〜C4 を伴う)で登録するか、BoE の実装を保留するか、HQ の判断 |
| U2 | 取得元の遅延を許容するか | 発表の直後に結果が出ない(BoC は最大2営業日、BoE は最大1営業日)。HQ が許容するか。速い経路(人が公式の声明で確認して当日に保存)を別の設計として作るか |
| U3 | `VERIFIED` にするための**公式の決定履歴の自動照合**を作るか | HTML の解析は壊れやすい。作らなければ、当面 `SINGLE_SOURCE` + 人の確認 |
| U4 | 段階3(`PENDING_REVIEW`)の値を人が承認して書く経路 | 今回は作らない。必要なら別の設計・承認 |
| U5 | BoC 規約 1.3 の告知の置き場所(ペイウォール等) | HQ・A の判断 |
| U6 | 変更幅(+0.25)の表示 | A と相談 |
| U7 | RBA・ECB | RBA は取得経路が未確認(CSV が 403)。ECB は主要金利が3つで、別の設計が要る。今回の範囲外 |
| U8 | 担当(実行・副担当・週末の当番) | 未確定(CA_CPI と共通) |
| U9 | 予想値(`forecast`) | 無料・公式の取得元が無いため載せない(サプライズなし) |
| U10 | 戦略分析で「引き上げ / 据え置き / 引き下げ」を扱うか | 今回の範囲外 |

### 6.2 実装前に必要な確認(事実の確認・実測・承認)
| # | 確認 | 方法・担当 |
|---|---|---|
| V1 | **BoE の発表時刻**(U1 の入力) | 公式のページ(Bank Rate / MPC のページ)で確認し、出典と確認日を記録 |
| V2 | **BoC の 09:45 ET を実装時に再確認**(出典ページ) | 実装時に、Upcoming events の最新の表記で再確認 |
| V3 | **Valet・IADB の更新のタイミング**(営業日のいつ新しい観測が出るか) | 公表日の前後で、読み取りの実測(複数回) |
| V4 | **DEV の `economic_events` の `release_datetime_precision` の分布**(C1 の影響を見るため) | 読み取り専用の確認(件数だけ) |
| V5 | BoC の 2021年の有効日の規則の境界日 | 公式の決定履歴の表で確認 |
| V6 | IADB の `IUDBEDR` が OGL の範囲(為替の除外に当たらない)ことの原文の再確認 | BoE の legal ページと Database の説明 |
| V7 | BoE の 2027 年の日程が公式の最新と一致(特に12月16日) | 実装時に再確認(確認済みだが、日程の変更に備える) |
| V8 | A の確認: ① `value_decimals = 2` の表示、② 予想・サプライズ null の表示、③ 「結果待ち」の文言(2営業日続くことへの違和感)、④ `BOC政策金利`・`BOE政策金利` の収まり、⑤ 変更幅の表示 | A のコードレベルの確認 |
| V9 | 実装順序: BoC を先に(EXACT。C1〜C4 不要)。BoE は V1 の後 | HQ の判断 |
| V10 | CA_CPI の設計と `valueDecimals.ts`・`attribution.ts` が衝突しないこと | 実装の順序・ブランチの分離 |
| V11 | 新しい手動 target・workflow の変更の承認 | HQ の承認(別) |
| V12 | DEV 適用の順序: migration(指標行)→ 予定の登録(dry-run → 承認 → 実行)→ 最初の公表日の運用(dry-run → 承認 → 実行) | CA_CPI・GB/AU/CA と同じ |
| V13 | 最初の複数回の決定の、公式の履歴との目視の突き合わせ(`SINGLE_SOURCE` → 必要なら `VERIFIED`) | 運用(B・C) |

## 7. 次の工程
1. HQ が第2版を確認 → C が独立再レビュー → HQ が実装範囲(BoC のみで開始するか、BoE も含めるか)と開始を判断。
2. 実装の承認があれば、ブランチ上の実装・テスト・CI まで。DEV 反映(migration の適用、予定の登録、最初の公表日の運用)は別の承認。
3. V1(BoE の時刻)は、設計のレビューと並行して、公式のページで進められる。
