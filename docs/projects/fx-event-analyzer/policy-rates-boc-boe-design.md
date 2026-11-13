# BoC・BoE 政策金利 取り込み設計書(第1版 2026-11-13)

HQ指示 2026-11-13「BoC・BoE政策金利の設計着手」。対象は **Bank of Canada の Target for the overnight rate(Valet API)** と **Bank of England の Bank Rate(IADB CSV)** の2つだけ。
**設計のみ。コード実装・DB変更・migration の実行・workflow 変更・push・main 統合・DEV/PROD 反映はしていない。** SQL は「案」で、どこにも実行していない。CA_CPI の設計・レビューとは混在させない。

事実は 2026-11-13 に公式のページ・API に実際にアクセスして確認したものだけを「確認済み」とし、確認できなかったことは「未確認」と書く。

## 0. 決定事項の案(まとめ)

| 項目 | 設計案 |
|---|---|
| 指標コード | `BOC_RATE`(カナダ・CAD)・`BOE_RATE`(英国・GBP)。重要度 HIGH、頻度 IRREGULAR、単位 `%`、好ましい方向 NEUTRAL(FOMC・BOJ_RATE と同じ) |
| 保存先 | **`economic_events` + `event_snapshots`**(`actual` = 決定後の金利、`previous` = 決定前の金利、`forecast` = null)。FOMC 専用表のような専用テーブルは作らない(§2) |
| 決定の判定 | 決定日の前後の金利を取得元の系列から読み、**差で「引き上げ / 据え置き / 引き下げ」を表す**。金利の変更が無い決定(据え置き)も、イベントとして記録する |
| 公表予定 | 各銀行の公式ページの日程(2026・2027)を、コードの表にする(GB・AU・CA の予定と同じ、人が確認する設定) |
| 取得 | BoC は Valet の `V39079`、BoE は IADB の `IUDBEDR`。鍵なし・無料 |
| 反映のタイミング | BoC は**決定の翌営業日**(公式: 変更は発表の翌日に有効)、BoE は**決定日当日**に系列が更新されたのを確認してから保存(それまでは SCHEDULED・PENDING) |
| 実行 | 手動(既存の方針どおり)。定期実行の追加は今回の範囲外 |
| ブロッカー | 発表の**時刻が公式ページで確認できていない**(§1.3)。実装前に確認が必要 |

---

## 1. データ取得

### 1.1 Bank of Canada(確認済みの事実)

| 項目 | 内容 |
|---|---|
| 系列 | `V39079`「Target for the overnight rate (business daily)」。説明: 「Also called the policy interest rate, the average rate that the Bank of Canada wants to see in the market for overnight money market financing.」頻度 Business daily、単位 Percent |
| 最新・期間指定 | `GET https://www.bankofcanada.ca/valet/observations/V39079/json?recent=N`、`?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` |
| 系列の詳細 | `GET https://www.bankofcanada.ca/valet/series/V39079/json`(`terms.url` = https://www.bankofcanada.ca/terms/、label・description・frequency・unit) |
| 応答の形 | `{"terms":{"url":...},"seriesDetail":{"V39079":{"label":...}},"observations":[{"d":"2026-11-10","V39079":{"v":"2.50"}}, ...]}`。値は**文字列** |
| 過去データ | `start_date=1990-01-01` で **2009-04-21 から 4,568 件**(2026-11-11 まで)。値の欠けも日付の重複も 0 件 |
| 認証・費用 | 鍵なし・無料 |
| 公表日程(公式ページ。確認済み) | 2026: 1/28・3/18・4/29・6/10・7/15・9/2・10/28・12/9。2027: 1/27・3/3・4/28・6/2・7/21・9/8・10/27・12/8(「eight fixed dates each year」) |
| 変更の有効日(公式の注記。確認済み) | 「**As of 2021, a change takes effect the day after its announcement.**」(発表の翌日) |
| 実績との照合 | Valet の系列は、公式ページの決定履歴(Date / Target / Change)と一致: 2026-10-28 に +0.25 で 2.50%(Valet は 10-29 から 2.50)、2025-10-29 に −0.25 で 2.25%(Valet は 10-30 から)。**Valet の値は、発表日の翌営業日から変わる**(公式ページの表に載る直近の3回 — 2025-09-17、2025-10-29、2026-10-28 — で、Valet の変更日が翌日であることを確認。それ以前の変更は公式の表と未照合) |
| 規約(https://www.bankofcanada.ca/terms/) | 自由に利用・複製・配布可。**1.1 出典の明記と変更の明記**、**1.3 有料サービスで提供する場合は、購入者に事前に「この内容は同サイトで無料で入手できる」と伝える**。ロゴ・紙幣画像は不可 |
| 更新の遅れ | 2026-11-13 09:15Z の取得で、最新の観測は **2026-11-11**(11/12 の観測は未反映)。**Valet が営業日のいつ更新されるかは未確認** |

### 1.2 Bank of England(確認済みの事実)

| 項目 | 内容 |
|---|---|
| 系列 | `IUDBEDR`(Official Bank Rate)。日次(営業日)の CSV |
| 取得 | `GET https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2024&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`(`User-Agent` が要る場合あり。**古い `fromshowcolumns.asp` は HTML が返った**ので、`_iadb-` 付きを使う) |
| 応答の形 | 先頭行 `DATE,IUDBEDR`、以降 `02 Jan 2024,5.25`(日付は `DD Mon YYYY`、値は小数) |
| 過去データ | `Datefrom=01/Jan/1975` で **1975-01-02 から 13,111 件**(2026-11-11 まで)。日付の重複 0 件 |
| 認証・費用 | 鍵なし・無料 |
| 公表日程(公式ページ。確認済み) | 2026: 2/5・3/19・4/30・6/18・7/30・9/17・11/5・12/17。2027: 2/4・3/18・4/29・6/17・7/29・9/16・11/4(取得したページの範囲。2027年12月分は取得できた範囲に含まれず、**未確認**)。ページに「Current Bank Rate 4%」「Next due: 17 December 2026」 |
| 実績との照合 | 変更日は、すべて MPC の発表日(木曜): 2024-08-01、2024-11-07、2025-02-06、2025-05-08、2025-08-07、2025-12-18、**2026-11-05(3.75 → 4.00、公式の声明「Bank rate increased to 4%」)**。IADB の値は**発表日当日**から変わる |
| 規約 | データベースは OGL(調査済み。為替の一部系列は除く)。**サイトの文章は非商用のみ**なので、CSV の数値だけを使い、文章は使わない |
| 更新の遅れ | 11/5 の変更は 11/11 の取得で反映されている。**当日のいつ反映されるかは未確認** |

### 1.3 公表時刻(未確認 — ブロッカー)
- BoC・BoE とも、**発表の時刻は、取得した公式ページ(日程ページ、決定の声明のページ)には書かれていなかった**。BoC のページには総裁会見 `10:30 (ET) approx.` の記載のみ。
- よく知られた時刻(BoC 9:45 ET、BoE 12:00 ロンドン)は、**公式のページで確認できていない**ため、設計に使わない(推測で埋めない)。
- 影響: 公表予定の表(`officialScheduleTable`)は `time: 'HH:MM'` と `EXACT` の精度を前提にする。通知(EXACT のみ)、価格反応(`event-reactions` は発表時刻を起点に15分・60分の動きを見る)は、時刻が正確でないと意味が変わる。
- **対応案**: 実装前に、公式のページ(BoC: Interest rate announcements、BoE: Bank Rate / MPC のページ)で時刻を確認し、出典と確認日を設定に記録する。確認できなければ、`release_datetime_precision = DATE_ONLY` で登録し、通知と価格反応の対象外にする(§3)。

### 1.4 タイムゾーンと適用開始日の扱い
| | BoC | BoE |
|---|---|---|
| 公表日・時刻のタイムゾーン | `America/Toronto`(時刻は未確認) | `Europe/London`(時刻は未確認) |
| 変更の有効日 | **発表の翌営業日**(公式) | **発表日当日**(IADB の実績) |
| 「決定後の金利」を読む日 | 発表日の翌営業日の観測 | 発表日の観測 |
| 「決定前の金利」を読む日 | 発表日の観測(その日はまだ変わっていない) | 発表日の前の営業日の観測 |
- 日付の比較は、発表日を各銀行のタイムゾーンの暦日にして行う(夏時間の影響を受けない)。
- 翌営業日の判定: Valet の観測が存在する次の日付(営業日系列なので、祝日は観測が無い)。「発表日 + 1日」の観測が無ければ、発表日より後の最初の観測。

### 1.5 エラー・欠損・重複・訂正の処理(すべて「書かない・推測しない・記録して再実行」)
| 状況 | 扱い |
|---|---|
| HTTP エラー・タイムアウト(5xx・429・通信失敗) | 既存の HttpClient の再試行(最大2回、バックオフ)。それでも失敗なら何も書かず `FETCH_FAILED`(次の実行で取り直す) |
| 応答が想定の形でない(BoC: `seriesDetail` 無し・`observations` 無し。BoE: 先頭行が `DATE,IUDBEDR` でない・HTML) | 何も書かない。`RESPONSE_UNPARSABLE` をエラー(終了コード 1)として記録 |
| 系列の取り違え(BoC: `seriesDetail` のキーが `V39079` でない・label が想定と違う) | 何も書かない。`SERIES_MISMATCH` |
| 決定後の観測がまだ無い(BoC: 翌営業日の観測が未反映、BoE: 当日の観測が未反映) | 何も書かない。`AWAITING_OBSERVATION`(SCHEDULED・PENDING のまま。次の実行で再確認) |
| 値が数でない・欠けている・範囲外(0 未満・25 超) | 何も書かない。`INVALID_VALUE` |
| 同じ日付が2回ある | 何も書かない。`DUPLICATE_OBSERVATION`(エラー) |
| 決定前の観測が無い | 何も書かない。`NO_PREVIOUS_OBSERVATION` |
| 変化の幅が不自然(変更幅が 0.25 の倍数でない、または |幅| > 1.0) | **書かずに人の確認**(`UNUSUAL_CHANGE`)。**取得した系列の実績**: BoC(2009年〜)の33回の変更のうち、0.25 刻みでない・0.5 超は 2022-07-14(+1.00、1.5 → 2.5)と 2022-09-08(+0.75、2.5 → 3.25)の2回(どちらも 0.25 の倍数で |幅| ≤ 1.0 なので、この規則では確認の対象にならない)。BoE(1975年〜)は259回の変更のうち94回が古い時代の大きな変更。**拒否ではなく確認**とし、閾値は暫定(実データで調整) |
| 記録済みの決定と、取得元の今の値が食い違う(後日の訂正) | 記録は変えない(スナップショットは不変)。`conflicts` としてログに出し、人が確認する(FOMC の `details.conflicts` と同じ方式) |
| 公式の決定履歴(BoC のページの表)との食い違い | 取得元の値を採用しつつ、人の確認用の照合(実装後の初回の公表で、ページの Date / Target / Change と一致することを手で確認) |

### 1.6 取得値の検証方法
1. **系列の同一性**: BoC は `seriesDetail` の label、BoE は CSV の列名。
2. **値の形**: 数として読める、0 以上 25 以下、有限。
3. **決定の整合**: `previous` と `actual` が両方取れること。変更幅 = `actual − previous`(小数第2位で丸めず、取得した小数のまま比較)。
4. **日付の整合**: 決定後の観測日が、各銀行の有効日の規則(§1.4)に合うこと。
5. **公式の声明との照合(人の確認)**: 初回の実装後の数回は、BoC の「Key interest rate」ページの決定履歴、BoE の Monetary Policy Summary の見出し(「Bank rate increased to 4%」)と、保存値を目視で突き合わせる。
6. **second source(自動)**: 今回は設けない(公式の表のHTML解析は壊れやすい)。第2の取得元が必要なら別途検討(未決)。

---

## 2. DB設計

### 2.1 比較: 保存先の案

| 観点 | 案A: `economic_events` + `event_snapshots`(**推奨**) | 案B: FOMC と同じ専用テーブル(例 `central_bank_rate_decisions`) |
|---|---|---|
| 表現 | `actual` = 決定後の金利、`previous` = 決定前の金利、`forecast` = null、`unit` = `%` | 決定ごとに `rate_after`・`rate_before`・`announced_at`・`effective_date`(FOMC は `target_range_lower/upper`) |
| 変更前後の金利 | `previous` → `actual`(そのまま) | 専用の列 |
| イベントの状態 | RELEASED・AVAILABLE(決定後の値が確認できたとき) | FOMC と同様、イベントは SCHEDULED・PENDING のまま(専用表を API が読む) |
| 履歴の保持 | 決定(年8回)ごとのスナップショットの連なり。スナップショットは DB のトリガーで不変 | 専用表の行(不変にするトリガーを足す) |
| 既存の機能との接続 | **自動で働く**: 過去の発表のロック、過去比較、価格反応(`event-reactions` は RELEASED を対象)、通知、検索、戦略分析 | 各機能に特別扱い(FOMC 用の分岐)が必要。`event-reactions`・ロック・履歴に分岐を足す |
| API / iOS | **変更なし**(`snapshot.actual` / `previous` は既存の項目) | `event.policy_rate`(v1.47)は iOS で `target_range_lower` / `target_range_upper` が**必須**(`PolicyRate`)で、「3.75%〜4.00%」と範囲で表示する。単一の金利に使うと「4.00%〜4.00%」になり、**API とアプリの両方の変更が必要** |
| マイグレーション | 指標行のみ | 新規テーブル(トリガー・権限・RLS・冪等な migration)+ 指標行 |
| 意味の混同 | 「actual = データの結果」の意味に「actual = 決定後の水準」が加わる。**指標の名前(政策金利)・単位・説明で区別**(§2.3) | 区別しやすい |
| 変更幅 | `actual − previous` で算出可能 | 専用の列で持てる |

**推奨: 案A**。理由:
1. BoC・BoE は**単一の金利**で、決定前の金利(`previous`)が取れる。スナップショットの形に自然に収まる。
2. **iOS・API の変更が不要**(案Bは `policy_rate` の必須項目と範囲表示のため、単一金利には合わず、A の作業が要る)。
3. 過去の発表のロック・過去比較・価格反応・通知など、**既存の機能が RELEASED のイベントとしてそのまま動く**。
4. FOMC が専用表になったのは、**誘導目標が範囲(下限・上限の2値)で、単一の値にまとめない**というHQ決定(案A、2026-11-05)があったため。BoC・BoE にはその理由が当てはまらない。
5. 将来の RBA・ECB・日銀も、同じ案Aで足せる(単一の金利)。

**FOMC との整合性**: FOMC は専用表のまま変えない。「範囲の政策金利 = 専用表、単一の政策金利 = スナップショット」という使い分けを、`db-design` と指標の説明に明記する。両者は `favorable_direction = NEUTRAL`・`frequency = IRREGULAR`・`unit = %` が共通。

### 2.2 金利の履歴と、変更前後の表現
- **1決定 = 1イベント**。`provider_event_id` = `<provider>:<指標コード>:<発表日>`(例 `boc_rate_schedule:BOC_RATE:2026-10-28`)。
- `event_snapshots`(RELEASE、不変): `actual` = 決定後の金利(例 2.50)、`previous` = 決定前の金利(2.25)、`forecast` = null、`surprise` = null(予想が無い)、`unit` = `%`、`verification_status` = VERIFIED(公式の系列から読んだ値)、`verification_source` = `valet:V39079@2026-10-29`(取得に使った観測日)、`captured_at` = 取得時刻、`source` / `source_url`(取得元)。
- **変更幅** = `actual − previous`(+0.25 など)。API の新しい項目は足さない(クライアントは差を計算できる)。専用の項目が要る場合は A と相談(別の設計)。
- **据え置き**: `actual == previous`。イベントは作る(据え置きも決定)。変更幅 0。
- 金利が**会合の間に変わる**ことは通常ない(BoC・BoE とも決定日に限る)。会合のない日の変更(緊急)は、予定表に無いため検知できない — 系列の変化日が予定表のどの決定日とも合わない場合は `UNSCHEDULED_CHANGE` としてログに出し、人が確認する(§1.5 の確認項目に追加)。
- 過去の決定のバックフィルは**既定でしない**(HQ決定の方針と同じ)。したくなった場合は、取得した系列(BoC 2009年〜、BoE 1975年〜)から再現できるが、別の承認が要る。

### 2.3 actual と「政策金利」の意味が混同されないための決め
1. 指標名と説明で明示: 「BOC政策金利」「BOE政策金利」。説明に「**決定後の政策金利(水準)**。前回は決定前の水準」と書く。
2. 単位 `%`、`value_decimals = 2`(表示は小数第2位)。
3. `previous` は「**ひとつ前の決定後の水準**」ではなく**この決定の直前の水準**(通常は一致するが、定義を直前の観測に固定する)。
4. `forecast` は null。予想値の取得元は無料・公式では無い(**予想値は載せない**)ため、サプライズは計算しない。
5. 改定(`event_revisions`)は使わない。政策金利の決定は後から改定されない。食い違いは `conflicts` ログ。

### 2.4 通貨ペアとの紐付け(`indicator_fx_pairs`)
| 指標 | ペア(優先順) | 根拠 |
|---|---|---|
| `BOC_RATE` | CADJPY(1) | 既存の `CA_CPI`・`CA_UNEMPLOYMENT_RATE` と同じ(CAD を含む既存のペアは CADJPY のみ) |
| `BOE_RATE` | GBPUSD(1)・GBPJPY(2) | 既存の `GB_CPI` などと同じ |
- ペアの新規追加は無い。`fx_pairs` の行は既存。
- `event-reactions` は、**通貨(CAD / GBP)を含むアクティブなペア**で反応を計算する(指標の紐付けではなく通貨で選ぶ)。

---

## 3. アプリへの影響

| 項目 | 内容 | 状態 |
|---|---|---|
| イベントカレンダー | 「BOC政策金利」「BOE政策金利」が、重要度 HIGH で、公表日に表示される。国旗・国名は既存(CA / GB)。表示名は `indicator-display-names.md` のルール(政策金利は機関名を残す: 例 `BOE政策金利` は既に表にある。`BOC政策金利` を足す) | API・iOS の変更不要(見込み)。A の確認 |
| 決定前 | SCHEDULED・PENDING(`DATA_PENDING`)。公表日時のみ。**時刻が未確認の間は `DATE_ONLY`**(通知と価格反応の対象外) | §1.3 |
| 決定後 | RELEASED・AVAILABLE。結果(`actual`)と前回(`previous`)が既存のカードに出る。**変更幅は新しい項目を足さず、差で表せる**。「予想」「サプライズ」は null で空 | A の確認(null の表示) |
| 過去イベント比較 | 同じ指標の過去の決定が、`actual` / `previous` の連なりで出る。FREE は**直近3回の決定だけ値が見える**(過去の発表のロック。年8回なので約5か月分)。PRO は全部 | 既存の仕組みのまま |
| 変更幅の表示 | 既存の項目では「結果 4.00% / 前回 3.75%」まで。「+0.25」を出すには、クライアントが差を計算する、または専用の項目を足す(A と相談。今回の設計の範囲外) | 要判断 |
| 通貨への影響分析 | `event-reactions`(手動)で、決定の発表時刻を起点に CAD / GBP を含むペアの反応を計算。**RELEASED になってから**計算されるので、BoC は翌営業日以降(§1.4)。計算は発表時刻(`release_datetime`)を起点にするため、**時刻が正確であることが前提**(§1.3) | 時刻の確認が先 |
| 戦略分析(v1.48) | `surprise` が null の発表は、サプライズに基づく項目(`sell_the_fact` など)が null になる(既存の仕様)。**「引き上げ / 据え置き / 引き下げ」で分類する分析は今回の範囲外**(必要なら別の設計) | 既存の仕様のまま |
| 通知 | HIGH なので FREE も通知の対象。発表時刻が EXACT のときだけ事前通知。**時刻が未確認の間は DATE_ONLY のため通知しない** | §1.3 |
| 出典の表示 | BoC: 「Source: Bank of Canada」+ 規約 1.1。BoE: OGL の出典(「Source: Bank of England licensed under the Open Government Licence」)。**BoC 規約 1.3**(有料提供時の無料入手の告知)は、BoC のデータそのものを提供するため**適用される可能性が高い** — 画面のどこに告知を置くか(購入前)は HQ・A の判断 | `attribution.ts` の追加(コードのみ)+ 告知の置き場所 |

---

## 4. テスト(実装時に作る)

| # | 区分 | 状況 | 期待 |
|---|---|---|---|
| P1 | 正常取得 | BoC: 発表日の観測(2.25)と翌営業日の観測(2.50) | 決定が引き上げ(+0.25)。スナップショット `previous` 2.25 / `actual` 2.50。RELEASED |
| P2 | 正常取得 | BoE: 発表日の前営業日 3.75、発表日 4.00 | 同様(+0.25、`previous` 3.75 / `actual` 4.00) |
| P3 | 金利変更(引き下げ) | BoC 2025-10-29(2.50 → 2.25) | `previous` 2.50 / `actual` 2.25(−0.25) |
| P4 | 大きな変更 | 実在する BoC 2022-07-14(+1.00)と 2022-09-08(+0.75) | 規則(0.25 の倍数かつ |幅| ≤ 1.0)の範囲内なので通常どおり保存される。0.25 の倍数でない変更(合成データ)は `UNUSUAL_CHANGE` で書かれない |
| P5 | 据え置き | BoC 2026-09-02(2.25 のまま)、BoE 2026-09-17 | イベントは RELEASED。`previous` = `actual`。変更幅 0 |
| P6 | 同じデータの再取得 | 記録済みの決定を、同じ入力でもう一度実行 | 何も増えない(冪等)。スナップショット不変 |
| P7 | 取得失敗 | HTTP 500 / タイムアウト | 何も書かない。`FETCH_FAILED`。SCHEDULED・PENDING のまま。次の実行で取り直す |
| P8 | 欠損 | BoC: 翌営業日の観測がまだ無い / BoE: 発表日の観測がまだ無い | 何も書かない。`AWAITING_OBSERVATION` |
| P9 | 応答の異常 | BoC: `observations` が無い、label が違う / BoE: 先頭行が違う、HTML | 何も書かない。`RESPONSE_UNPARSABLE` / `SERIES_MISMATCH` |
| P10 | 値の異常 | 値が null・非数・負・25 超 | 何も書かない。`INVALID_VALUE` |
| P11 | 重複 | 同じ日付が2行 | `DUPLICATE_OBSERVATION`。何も書かない |
| P12 | 過去データとの整合 | 固定データ: BoC 2024-06 以降の10回の変更、BoE 2024-08 以降の7回の変更(確認済みの実データ) | 各決定の `previous` / `actual` / 有効日が、実データと一致する |
| P13 | 過去データとの整合 | 公式のページの決定履歴(BoC: 2026-10-28 +0.25 で 2.50) | 保存値と一致 |
| P14 | 有効日の規則 | BoC: 発表日の観測は旧金利、翌営業日から新金利 / BoE: 発表日から新金利 | 規則どおりに `previous` / `actual` が選ばれる |
| P15 | 営業日 | BoC の翌営業日が祝日をまたぐ(観測が無い日がある) | 発表日より後の最初の観測を使う。見つからなければ待つ |
| P16 | 予定にない変更 | 系列の変化日が予定表のどの決定日とも合わない | `UNSCHEDULED_CHANGE` をログに出す。何も書かない |
| P17 | 食い違い | 記録済みの決定と、取得元の今の値が違う | 記録は変えない。`conflicts` に出る |
| P18 | 2つの銀行の独立 | BoC が失敗しても BoE は処理される(逆も同じ) | 銀行ごとに独立 |
| P19 | 時刻の精度 | 時刻未確認の設定 | `release_datetime_precision = DATE_ONLY`。通知・反応の対象外 |
| P20 | dry-run | dry-run | 何も書かない。計画(INSERT / UNCHANGED / AWAITING)だけ出る |
| P21 | 予定表の整合 | 予定表の日付が公式の日程と一致(2026・2027) | BoC 16件(2026: 8、2027: 8)。BoE 2026: 8件、2027: 7件(取得したページの範囲。2027-12 分は未取得で、**確認してから**固定する) |
| P22 | API 応答 | 決定後のイベントの `GET /events/{id}` | `snapshot.actual` / `previous` / `unit` / `attribution` / `value_decimals = 2` |
| P23 | ロック | FREE が4回目以前の決定を見る | 値が隠れる。`attribution` は残る(既存の仕様) |

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
- 変更するテーブル: `economic_indicators` 2行、`indicator_fx_pairs` 3行(`fx_pairs` は既存の CADJPY・GBPUSD・GBPJPY を使い、行を足さない)。
- 重複の確認: `code` は `unique`、`(indicator_id, fx_pair_id)` は `unique`。`BOC_RATE`・`BOE_RATE` は DEV の22指標に存在しない(確認済み)。
- `description`・`market_view_*` の最終の文言は、実装時に、予想が無い前提(サプライズの記述をしない)で書き、HQ が確認する。
- `seed.sql` と、指標の件数・ペアの期待を持つ結合テスト(`gb-au-ca-indicators` と同じ型)の更新が、同じ変更で要る。
- 戻す手順(案。イベントが無いうちだけ): `delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code in ('BOC_RATE','BOE_RATE')); delete from economic_indicators where code in ('BOC_RATE','BOE_RATE');`
- **`event_snapshots`・`economic_events` の列の追加は不要**。専用テーブルも不要(案A)。

### 5.2 既存の target・workflow で対応できるか
| 必要な処理 | 既存の仕組み | 判断 |
|---|---|---|
| 公表予定の登録(各8回/年 × 2銀行) | `ingest:gb-au-ca-schedules`(`officialScheduleTable`)。予定表(`GB_AU_CA_SCHEDULES`)に表を足す | **コードの追加で足りる**(workflow の変更不要。ただし target 名が「GB/AU/CA」のまま。名称の整理は別) |
| 決定後の金利の取得・保存 | `ingest:official-values`(`OFFICIAL_VALUE_SOURCES`)は、公表値を `actual` に入れ、`previous` は入れない(前回値を保存しない設計)。**政策金利は `previous` を入れ、決定前後の2観測を使う**ので、同じ関数の拡張では意味が変わる | **新しい取り込み処理が必要**(例 `ingest:policy-rates`、dry-run つき) |
| 手動の実行 | `workflow_dispatch` の target(`official-values-dry-run` など) | **新しい target の追加(workflow の変更)が必要**(例 `policy-rates-dry-run` / `policy-rates`)。別の承認 |
| 読み取り専用の確認 | `verify/fx-dev-readonly` の既存の仕組み | 指標のレポートに BoC・BoE の確認を足す(読み取り) |

### 5.3 定期取得の頻度と失敗時の再試行
- **今回の範囲では定期実行を足さない**(HQ の制約)。公表日の運用は、CA_CPI の運用(§16.6)と同じ型の**手動実行**。
- 運用の案(手動):
  - BoC: 発表日の翌営業日(Valet の更新の後)に dry-run → 承認 → 実行。
  - BoE: 発表日の当日、IADB の更新の後(更新時刻は未確認)に dry-run → 承認 → 実行。
  - 取得できなければ書かず、翌日以降に再実行(冪等)。
  - 目標: 発表の翌営業日までに保存。
- 失敗時: `AWAITING_OBSERVATION` / `FETCH_FAILED` は書かないだけなので、何度再実行しても安全。
- 将来、定期実行に入れる場合: 発表日のみ短い間隔で再試行する設計が必要(GitHub の定期の到達率が低い — 約36% — ことを前提にする)。**定期実行の追加は別の承認**。
- 担当(実行担当・副担当・週末の当番)は未確定(CA_CPI と共通の課題)。

### 5.4 DEV 適用前に必要な確認事項
1. **発表の時刻の確認(BoC・BoE)**: 公式のページで確認し、設定に出典と確認日を記録(§1.3)。確認できなければ `DATE_ONLY` で運用。
2. Valet・IADB の**更新のタイミング**(発表の何時間後・翌営業日のいつ反映されるか)の実測。
3. BoE の IADB の**規約**(OGL の範囲と、IUDBEDR が対象であること)の原文での再確認。
4. **BoC 規約 1.3** の告知の置き場所(HQ・A)。
5. 予定表の2027年の後半(BoE の12月など)の日付の確認。
6. 時刻・日程の変更への対応(公式の日程の変更時の手順)。
7. `description` / `market_view_*` の最終の文言(予想が無い前提)。
8. A の確認: ① 予想・サプライズが null のときの表示、② `value_decimals = 2` の表示、③ 変更幅の表示を足すか、④ `BOC政策金利` の表示名の収まり。
9. 実装の2段階分離(CA_CPI と同様に、取り込みと表示を分けるか)の要否。
10. 最初の DEV 反映は、dry-run → 承認 → 実行の順(CA_CPI・GB/AU/CA と同じ)。

---

## 6. 未確認・未解決事項

| # | 事項 | 状態 |
|---|---|---|
| 1 | **BoC・BoE の発表時刻** | 公式のページで未確認(§1.3)。ブロッカー |
| 2 | Valet・IADB の更新のタイミング(営業日のいつ新しい観測が出るか) | 未確認。実測が要る |
| 3 | RBA・ECB の同様の設計 | 今回の範囲外(RBA は CSV が 403、ECB は API が 503 で未確認) |
| 4 | BoC 規約 1.3 の告知(有料機能) | HQ・A の判断 |
| 5 | IADB の規約(IUDBEDR が OGL の範囲か) | 原文の再確認が要る |
| 6 | 予想値(`forecast`)の取得元 | 無料・公式の取得元が無いため載せない(サプライズなし) |
| 7 | 変更幅(+0.25)の API / 画面での表示 | 要判断(A) |
| 8 | 戦略分析で「引き上げ / 据え置き / 引き下げ」を扱うか | 今回の範囲外 |
| 9 | 会合の間の緊急の変更(予定表に無い) | `UNSCHEDULED_CHANGE` を検知するだけ。扱いは確認後 |
| 10 | 新しい取り込み処理(`ingest:policy-rates`)と workflow の target | 実装の承認の後 |
| 11 | 担当(実行・副・週末)の確定 | 未確定 |
| 12 | 変更幅が 0.25 の倍数でないときの閾値(`UNUSUAL_CHANGE`) | 暫定。過去の実データで調整 |

## 7. 次の工程
1. HQ が本設計を確認 → C が独立レビュー → HQ が実装範囲と開始を判断。
2. 実装の承認があれば、ブランチ上の実装・テスト・CI まで。DEV 反映(migration の適用、予定の登録)は別の承認。
3. 時刻の確認(§1.3)は、設計のレビューと並行して、公式のページで進められる。
