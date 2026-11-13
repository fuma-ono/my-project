# カナダ CPI(ヘッドライン CA_CPI と コア CA_CPI_TRIM / CA_CPI_MEDIAN)詳細設計書

HQ指示 2026-11-13「CA_CPIについて、上記方針に沿った詳細設計書を完成させてください」。
**この文書は設計書。コード変更・マイグレーション・CI・DEV反映・DB書き込みは、していない(HQが設計書を確認した後に別途判断)。**
下の SQL・コードは「案」であり、どこにも実行していない。

調査の記録(根拠の数字)は `ca-cpi-and-au-reference-period-2026-11-13.md` にある(以下「調査メモ」)。この設計書はそれを前提にする。

## 0. 決定事項(HQ指示の反映)と、確認の度合い

| 項目 | 決定 | 根拠 |
|---|---|---|
| ヘッドライン | 既存 `CA_CPI` を維持。表18-10-0004-01 の指数から前年同月比を計算し、小数第1位に丸める。重要度 HIGH・CADJPY を維持 | 直近24か月(2024-10〜2026-09)の The Daily の公表値と **24/24 一致**(調査メモ §A) |
| コア指標 | `CA_CPI_TRIM`・`CA_CPI_MEDIAN` の独立した2指標。重要度 MEDIUM・CADJPY・取得元 Statistics Canada。初回値は不変保存、改定値は `event_revisions` | HQ決定 |
| CPI-common | 初期対象外。理由は**公式の重要度順位ではなく**、改定頻度・全履歴再推定・運用負荷・説明コスト | 216個の比較で改定 common 19 / median 7 / trim 4(調査メモ §F.2) |
| trim と median | **公式な優先順位は設定しない**。Bank of Canada は3つとも "preferred" と書いており、順位はない | BoC の公式ページ(2026-11-13 取得) |
| 取得元 | Statistics Canada の表。Bank of Canada のデータは取得元にしない(定義説明の出典としてだけ扱う) | HQ決定 |
| 利用条件 | StatCan Open Licence。出典を明記。有料機能でも守る。推奨・提携を示唆しない | 下の §10 |
| 初回値 | 不変のスナップショット。同日中の再取得で値が違っても自動で上書きしない | DB のトリガーで更新・削除ができない(既存) |
| 改定 | 後日の取得で値が違えば改定候補として検知し `event_revisions` に記録。コア指標は直近6か月を確認 | §6 |

「ヘッドライン CPI」と「コア指標」は、**別の指標コード・別のイベント・別の系列**。同じ指標として扱わない(§2・§4・§7 に、混同を防ぐ仕組みを入れる)。

---

## 1. 全体像

```
公表の日(8:30 ET)
  ├─ CA_CPI        : WDS 18-10-0004-01 の指数2点 → 前年同月比(計算)
  ├─ CA_CPI_TRIM   : WDS 18-10-0256-01 (vector 108785715) の前年同月比(公表値そのもの)
  └─ CA_CPI_MEDIAN : WDS 18-10-0256-01 (vector 108785714) の前年同月比(公表値そのもの)
        │  照合(公表日・対象月・単位・数値)がすべて通ったときだけ
        ▼
  event_snapshots(RELEASE、不変)+ economic_events(RELEASED・AVAILABLE)
        │  後日
        ▼
  event_revisions(ACTUAL)  ← 値が違うとき。コア指標は直近6か月を確認
```

- 実行の経路: 既存の `ingest:official-values`(手動の実行のみ。定期の実行には入っていない)に系列を足す形。**定期実行の追加・変更は、このスコープに含めない**(別の承認)。
- 書き込み前に必ず dry-run できる(既存の `--dry-run`)。

---

## 2. 指標マスター定義

### 2.1 既存の `CA_CPI`(変更なし。整合性の確認)
migration `20261110000002` の定義: 名前「カナダ消費者物価指数(CPI、前年比)」/ `Canada Consumer Price Index (CPI), 12-month change` / 表示名「消費者物価指数（CPI）」/ 国 CA / 通貨 CAD / 重要度 HIGH / MONTHLY / 単位 `%` / 出典 Statistics Canada / `HIGHER_IS_POSITIVE` / 通貨ペア CADJPY(priority 1)。
→ 「前年比・単位 %」は、指数から計算する前年同月比と**整合する**。**マスターの変更は要らない。**

### 2.2 新規 `CA_CPI_TRIM` / `CA_CPI_MEDIAN`(案。未実行)

| 列 | CA_CPI_TRIM | CA_CPI_MEDIAN |
|---|---|---|
| code | `CA_CPI_TRIM` | `CA_CPI_MEDIAN` |
| name | カナダ CPI-trim(トリム平均、前年比) | カナダ CPI-median(中央値、前年比) |
| name_en | Canada CPI-trim (trimmed mean), 12-month change | Canada CPI-median (weighted median), 12-month change |
| display_name | コアCPI（CPI-trim） | コアCPI（CPI-median） |
| country_code / currency_code | CA / CAD | CA / CAD |
| importance | MEDIUM | MEDIUM |
| frequency / unit | MONTHLY / `%` | MONTHLY / `%` |
| source / source_url | Statistics Canada / https://www.statcan.gc.ca | 同じ |
| favorable_direction | HIGHER_IS_POSITIVE(`CA_CPI` と同じ) | 同じ |
| 通貨ペア | CADJPY(priority 1) | CADJPY(priority 1) |

- `display_name` は `indicator-display-names.md` のルール(略称は併記、カッコは全角、国名は入れない、1行)に従う。ヘッドラインの「消費者物価指数（CPI）」と**一覧で見分けられる**よう、コア2つは「コアCPI（CPI-trim）」「コアCPI（CPI-median）」とし、trim / median を必ず明記する(HQ指示)。名前は案で、最終の文言はHQ判断。
- description(案): trim =「カナダ銀行(Bank of Canada)が定義するコア CPI の一つ。月ごとの価格変動の分布の上下それぞれ加重20%、合計40%を除いた平均です」。median =「同じくコア CPI の一つ。月ごとの価格変動を加重した分布の50パーセンタイルの値です」。末尾に「定義の出典: Bank of Canada」。**2つの優劣・どちらが主かは書かない。**
- key_points / market_view_above・below: `CA_CPI` と同じ型で書く。例: 「コアCPIが予想を上回ると、基調的な物価の強さから利下げが遠のくとの見方が強まり、カナダドルが買われやすいとされる」。**予想値はこの取得元に無い**ので、文言は一般論の形にとどめる(既存の GB/AU/CA と同じ)。
- 既存の分類で言う「CPI-common」は作らない。**後から `CA_CPI_COMMON` を別コードで足せる**構造にしておく(コードを CPI-common と共有しない)。

### 2.3 誤って同一視しない仕組み(混同防止)
1. 指標コードも、イベントの `provider_event_id` も別(`<provider>:<指標コード>:<対象月>`)。
2. 取得元の系列(vectorId)は指標コードごとに1対1の表(`OFFICIAL_VALUE_SOURCES` / 系列表)で持ち、**コードの変換や「core ⇔ headline」の流用をしない**。
3. 保存時の `verification_source` に vectorId を入れる(`v41690973@2026-10`、`v108785715@2026-10`、`v108785714@2026-10`)。**テストで、各指標の vectorId がそれぞれの系列であることを固定する**。
4. 前回値・予想値は、どの指標にも入れない(取得元に無い。流用しない)。
5. API の `display_name`・`name_en` に trim / median を含める(§7)。

---

## 3. イベント名と公表日

- イベントは「指標 × 対象月」の1件。provider は既存の `statcan_release_schedule`、`provider_event_id` = `statcan_release_schedule:<指標コード>:<対象月>`。
- 公表日・時刻は、`CA_CPI` と**同じ**(StatCan の schedule JSON の「Consumer Price Index」の回。8:30 ET、`America/Toronto`、夏時間は既存の処理)。DEV に反映済みの `CA_CPI` 5件(2026-10〜2027-02 分: 2026-11-16・12-14、2027-01-18・02-16・03-15)と同じ日付で、コア2指標の予定を `statcan_release_schedule` の表に**同じ日付で足す**(別の予定表は作らない)。
- 予定の追加は既存の `ingest:gb-au-ca-schedules` の仕組み(`STATCAN_SCHEDULE` の表)に、コア2指標の行を足す形。dry-run で INSERT 件数を確認してから反映する(5件×2 = 10件の INSERT の見込み)。**実施は別の承認。**
- イベント名(API では指標の `display_name` / `name`)に trim / median が出る(§2.2)。

---

## 4. 実績値の取得・計算方法

### 4.1 ヘッドライン CA_CPI(計算)
- 取得: `POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods`、本文 `[{"vectorId":41690973,"latestN":13}]`(1回の呼び出しで、対象月と12か月前を同時に取る。鍵・登録なし)。
- 計算: `yoy = round((index_t / index_{t-12} − 1) × 100, 1)`。
  - index は小数第1位までの公表値(`decimals = 1`)。**公表の前年同月比も、この丸めた指数から計算された値と一致する**ことを24か月で確認済み。
  - 浮動小数点の誤差を避けるため、指数を ×10 の整数にして計算し、丸めは「0.05 の境界は繰り上げ(四捨五入)」を整数演算で行う。比較・保存は小数第1位の値(×10 の整数)で行う。
- 根拠の記録: 24か月の一致結果は調査メモ §A。**実装時に、同じ24か月の指数と公表値(The Daily の本文)を固定データにしてテストにする**(公表値の読み取りは人が確認したものを貼る。実行時には The Daily を読まない)。

### 4.2 コア CA_CPI_TRIM / CA_CPI_MEDIAN(公表値をそのまま読む)
- 取得: 同じ WDS の `getDataFromVectorsAndLatestNPeriods`、`[{"vectorId":108785715,"latestN":7},{"vectorId":108785714,"latestN":7}]`(trim・median)。前年同月比(%)の系列で、**計算は不要**。
  - vector は表 18-10-0256-01 の Alternative measures の member 3(trim)・2(median)。取得時に `getSeriesInfoFromVector` で題名を確かめる検査は、実装時に入れる(vector の取り違え防止)。
- 値の単位: `%`。小数第1位。

### 4.3 共通の照合(いずれか1つでも欠ければ何も書かない)
1. **公表日**: 対象月の点の `releaseTime` の日付 = 公表予定の表の `releaseDate`。
2. **対象月**: 点の `refPer`(`YYYY-MM-01`)を `YYYY-MM` にして、表の `referencePeriod` と一致。**最新の点が対象月でなければ保存しない**。
3. **単位・数値**: 数として読める有限の値。`statusCode`・`symbolCode` が 0。
4. **ヘッドラインだけ**: 12か月前の点は `refPer` が対象月のちょうど12か月前であること。位置(13番目)で取らない。
5. **系列の同一性**: 応答の `vectorId` が、その指標コードの系列と一致(混同防止)。
6. 取得元・出典がある(source・source_url)。

---

## 5. 初回値と改定値の保存設計

### 5.1 保存先と内容(既存の仕組みに乗せる。列の追加なし)
| 保存先 | 条件 | 内容 |
|---|---|---|
| `event_snapshots`(RELEASE。**DB のトリガーで更新・削除不可**、`unique(event_id, snapshot_type)`) | §4.3 の照合がすべて通り、そのイベントに RELEASE のスナップショットがまだない | `actual` = 前年同月比(`numeric(18,4)`)、`unit = '%'`、`source`・`source_url`、`captured_at` = 取得時刻、`forecast`・`previous`・`surprise` = null。`verification_status = VERIFIED`、`verification_source = '<vector>@<対象月>'` |
| `economic_events` | 同上 | `status = RELEASED`、`data_status = AVAILABLE` |
| `event_revisions`(`field_name = 'ACTUAL'`、`old_value`・`new_value`、`effective_at`、`source`) | §6 の条件 | 改定 |

- 1つでも欠ければ何も書かず、`SCHEDULED`・`PENDING`(API では `DATA_PENDING`)のまま。
- **初回値は自動上書きしない**: スナップショットの更新・削除は DB が拒否する(既存のトリガー `prevent_release_snapshot_mutation`)。コードでも、スナップショットがある回に対して `insert` を試みない。

### 5.2 同日中の再取得で値が違った場合(HQ指示)
- 同日 = スナップショットの `captured_at` と同じ日(`America/Toronto` の暦日)。
- 値が違っても、**スナップショットは変えず、`event_revisions` にも書かない**。実行の結果に `same_day_diff` として記録(件数・指標・from/to)し、報告に出す。
- 理由: 公表当日の値の食い違いは、取得の不具合・暫定値・取得時刻の差の可能性があり、改定とは区別して人が確認する。

### 5.3 後日の取得で値が違った場合
- 同じ対象月の今の値が、直近の値(最後の改定、無ければ初回値)と違い、かつ同日でなければ、`event_revisions`(ACTUAL)に1行足す(old = 直近の値、new = 今の値、`effective_at` = 取得時刻、`source` = Statistics Canada)。

### 5.4 取得失敗・未反映を改定にしない
次はすべて「何も書かない」(改定扱いにしない)。
- WDS の通信エラー・HTTP エラー・`status` が SUCCESS でない。
- 対象月の点が応答に無い(未反映)、値が null / 数でない、`statusCode`・`symbolCode` が 0 以外。
- ヘッドラインで12か月前の点が無い。
- 応答の `vectorId` が期待と違う。
→ 結果に `FETCH_FAILED` / `NOT_UPDATED` / `INVALID_VALUE` の理由で記録するだけ。次の実行で取り直す。

### 5.5 重複登録の防止
- `event_revisions` には一意制約がない(アプリ層の規律。既存の設計どおり)。**アプリ側で「直近の値」と比べて、同じなら足さない**(既存の `latestRevisionValues`)。再実行しても同じ改定を足さない。
- 追加の防御(案、マイグレーション要): `(event_id, field_name, new_value, effective_at の日付)` の一意性は、改定が複数回あり得るため**付けない**。重複防止は「直近値との比較」に一本化する。
- 並行実行の防止: ワークフローの `concurrency: fx-ingestion`(既存)で直列化。
- テスト: 同じ入力で2回実行して、行が増えないこと(§9)。

### 5.6 期限
初回値を受け付ける期間(公表日からの日数)の既定は、実装時に既存の `official-values` の挙動を確認して決める(**未確認**)。JP_CPI は14日以内。CA は「公表日と `releaseTime` が一致すること」を必須にしているので、実質は同日〜`releaseTime` が最新の間。

---

## 6. 直近6か月の改定検知(コア指標)と、ヘッドラインの改定検知

### 6.1 コア指標(trim・median)
- 公表のたびに、各系列の**直近7点**(対象月 + その前の6か月)を取る(`latestN: 7`)。
- 各点の対象月について、そのイベント(`provider_event_id` = `…:<指標>:<対象月>`)を探す。
  - イベントが無い / RELEASED でない / スナップショットが無い → 何もしない(バックフィルしていない過去の月は対象外。エラーにしない)。
  - あれば、その月の「直近の値」(最後の `event_revisions` の `new_value`、無ければスナップショットの `actual`)と、今の値を、**小数第1位の値どうし**で比べる。
  - 違い、かつ「同日」(§5.2)でなければ、その月のイベントに `event_revisions` を1行足す。
- 現行の `officialValues.ts` は**対象月1つ**しか見ない。直近7点を見る処理は**新しい実装**になる(コア指標用の拡張。ヘッドラインには適用しない)。

### 6.2 ヘッドライン(CA_CPI)
- 現行どおり、**対象月の1点**を見る(直近7点にはしない)。理由: ヘッドラインの改定は公式文書で確認できていない(調査メモ §C)。観測したのは「改定が無い」という挙動だけ。
- 計算の元になる12か月前の指数が変わった場合も、同じ対象月の計算結果が変わるので、同じ経路で検知される(原因を記録: 元の2つの指数)。
- 6か月に広げるかは、改定の実績が出てから判断(別の承認)。

### 6.3 誤検知の防止
1. 比較は丸めた値(小数第1位)どうし。浮動小数点の値を比べない。
2. 取得失敗・未反映・null は改定にしない(§5.4)。
3. 同日の差は改定にしない(§5.2)。
4. 同じ改定を二度足さない(直近値との比較)。
5. 系列の取り違え(vectorId)があれば、その実行全体を中止して報告。
6. 6か月より前の月は見ない。観測では trim・median の改定は6か月以内。**6か月より前の改定が起きるかは、12回の比較では未観測**(下の未確認)。
7. 改定の件数が一度に多い場合(例: 1回の実行で 7点すべて)の扱い: コアの改定は、実績で 1〜3点が普通。**1回の実行で改定が一定数(案: 5点超)あれば、書かずに報告して止まる**(WDS の不具合や系列の取り違えを疑う)。閾値は実装時に決めてHQ確認。

---

## 7. API での返却方法

既存の API の形のまま(新しいエンドポイントは作らない)。

| 項目 | 返し方 |
|---|---|
| 指標 | `GET /indicators`・詳細に `CA_CPI_TRIM`・`CA_CPI_MEDIAN` が現れる(`display_name`・`name_en` に trim / median)。ヘッドラインと**別の行** |
| カレンダー | `GET /calendar` に、予定の段階で3つ(`CA_CPI`・`CA_CPI_TRIM`・`CA_CPI_MEDIAN`)が同じ時刻に並ぶ。値は無い(`DATA_PENDING`) |
| イベント詳細 | `GET /events/{id}`: 公表後は `snapshot.actual`(前年同月比)、`unit: '%'`、`forecast`・`previous` は null。`revision_status` は改定の行の有無で NONE / REVISED |
| 改定 | `GET /events/{id}/revisions`: `field_name: ACTUAL`、`old_value`・`new_value`、`effective_at`、`source` |
| 出典 | `attribution`: §10 の文言。**指標コードごとに** `INDICATOR_ATTRIBUTIONS` に足す |
| 表示桁数 | `value_decimals`: **1**(コード変更が必要。下記) |

### 7.1 コード変更が必要な点(実装時。いずれも未着手)
- `src/domain/attribution.ts`: `INDICATOR_ATTRIBUTIONS` に `CA_CPI_TRIM`・`CA_CPI_MEDIAN` を足し、`CA_CPI` の文言を「Adapted from …」の形にする(§10)。出典はコードで持つので、**これはマイグレーション不要**。
- `src/domain/valueDecimals.ts`: 現行は BLS の%の指標だけ 1 を返し、それ以外は `null`(`CA_CPI` も `null`)。`CA_CPI`・`CA_CPI_TRIM`・`CA_CPI_MEDIAN` を 1 にするには条件の変更が必要。**ただし `CA_CPI` の `value_decimals` を `null` から 1 に変えると、すでに公開されている応答が変わる**ため、iOS への影響をAと確認する(**未確認・要確認**)。
- `src/ingestion/mappings/indicators.ts`(`findMappingByCode` の登録): 新しい2コードの扱いの確認が必要(未確認)。

---

## 8. FREE/PRO の閲覧権限との整合性

既存の権限の仕組み(`entitlements`・`default_entitlements`、過去の発表の制限)にそのまま乗る。**新しい権限コードは作らない。**
- 指標・カレンダー・イベント詳細の閲覧は、既存の `VIEW_BASIC_EVENT` 等(FREE にも既定で付く)の範囲。`CA_CPI_TRIM`・`CA_CPI_MEDIAN` も同じ。
- FREE の「過去の発表」の制限(指標ごとに RELEASED の直近 N 回だけ値を見られる)は、**指標ごと**に数えるので、コア2指標・ヘッドラインのそれぞれで独立に適用される(DB 関数 `visible_released_event_ids`)。コア指標の過去分は、新しい指標のため、最初は RELEASED が少なく、制限にかかりにくい。
- ロックされた発表は、値(`actual`・`previous` 等)と改定が隠れる。`attribution`・単位・日時は隠さない(既存の挙動)。**ロック中でも出典は出る** — StatCan の出典表示の要件(§10)を満たす。
- PRO 専用の項目(`VIEW_ADVANCED_STATS`)は、この指標では新しく作らない。
- 検証: FREE / PRO のテストアカウントでの確認(別途、保留中の手順書)で、コア2指標の表示差を確認する。**未実施**。

---

## 9. テストケースと異常系

実装時に追加するテスト(今は書かない)。

### 9.1 計算(ヘッドライン)
- 24か月の指数(固定データ)から、各月の計算結果が公表値(固定)と一致する。
- 丸めの境界(x.x5 付近)を整数演算で正しく丸める。
- 12か月前の点が欠けた月 → 計算せず `INVALID_VALUE`(位置ずれを起こさない: 欠けた月がある並びで、13番目を使わない)。
- 指数が null / 文字列 / `statusCode`・`symbolCode` ≠ 0 → 保存しない。

### 9.2 照合
- `releaseTime` の日付が表と違う → 保存しない。
- 最新の点が対象月でない(次の月が先に出た等)→ 保存しない。
- 応答の `vectorId` が期待と違う → 実行全体を中止。
- trim と median の vectorId を取り違えた入力 → 検知して中止(混同防止のテスト)。
- 3指標が別イベント・別 `provider_event_id` に保存され、互いに上書きしない。

### 9.3 保存
- 条件が揃えば、スナップショット(`forecast`・`previous` = null)と RELEASED。
- スナップショットがある回に再実行 → 何も増えない(冪等)。
- スナップショットの更新を試みるとDBが拒否する(既存の結合テスト)。
- dry-run は何も書かない。

### 9.4 改定
- 後日、同じ対象月の値が違う → `event_revisions` に1行(old = 直近値)。
- 同じ入力で再実行 → 行が増えない。
- **同日**に値が違う → 書かず、`same_day_diff` を報告。
- 取得失敗・null・未反映 → 改定にならない。
- コア: 直近7点のうち 3点が改定 → 3行、変わらない点は UNCHANGED。
- コア: スナップショットの無い月は対象外(エラーにしない)。
- 改定が閾値超 → 書かずに報告して停止。
- 浮動小数点の誤差(`2.0000000001` と `2.0`)を改定にしない。

### 9.5 API・権限・出典
- `/indicators`・`/calendar`・`/events/{id}` に3指標が別々に現れ、`display_name` に trim / median。
- `attribution` が3指標で正しい文言(CA_CPI は「Adapted from …」)。
- FREE のロック: 値は隠れ、`attribution` は残る。
- `value_decimals` の期待値。

### 9.6 異常系の一覧(まとめ)
WDS 通信失敗 / HTTP エラー / `status` ≠ SUCCESS / 対象月未反映 / 値が null / 12か月前の欠落 / 系列の取り違え / 公表日の不一致 / 日付の逆転(未来日の `releaseTime`)/ 同日の差 / 改定の閾値超 / DEV 以外への接続(既存の保護)。すべて「書かない・理由を記録・報告」。

---

## 10. 利用条件・出典(StatCan Open Licence、2026-11-13 に原文を確認)

- 許諾: 世界的・無償・非独占で、利用・複製・公表・配布・**販売**が可。**有料機能でも利用できる**。
- 守ること(原文の要旨): 正確に複製する / StatCan が推奨していると示唆しない / 出典を偽らない / 法令を守る / **広告・宣伝に、StatCan の名称・紋章・ロゴ・ドメイン名を、推奨を示唆する形で入れない**。
- 出典の表示:
  - 原データをそのまま出す場合(コア2指標。StatCan の公表値): 「**Source: Statistics Canada, name of product, reference date. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.**」
  - 加工した場合(**ヘッドラインの前年同月比は、指数から計算した値なので "Value-added Product" に当たる**): 「**Adapted from Statistics Canada, name of product, reference date. This does not constitute an endorsement by Statistics Canada of this product.**」(原文に記載があることを確認済み)
- 実装案(文言は実装時に確定):
  - `CA_CPI`: Adapted from Statistics Canada, Table 18-10-0004-01 Consumer Price Index, monthly, not seasonally adjusted, <対象月>. This does not constitute an endorsement by Statistics Canada of this product.
  - `CA_CPI_TRIM` / `CA_CPI_MEDIAN`: Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, <対象月>. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.
  - **注意**: 現行の `CA_CPI` の出典は「Source: …as is」の形。ヘッドラインを計算値にするなら、「Adapted from …」に変える必要がある(既存の応答の文言が変わる → iOS とHQに確認)。
- Bank of Canada: データは使わない。定義の説明(trim / median の説明文)に BoC の定義を使うので、**「定義の出典: Bank of Canada」を指標の説明に明記**する(BoC の利用条件 1.1: 出典の明記、推奨の非示唆)。BoC の利用条件 1.3(有料サービスでは、内容が当該サイトで無料で入手できることを購入者に事前に伝える)は、**アプリの有料機能が BoC の「コンテンツ」を含むと見なされるかで要否が変わる** — 数字は StatCan から取るので、定義の説明文だけが対象になりうる。**HQの判断が必要**(未確認)。
- 各指標の値は `Source` の表の名前・対象月とともに出す。StatCan の名称は出典の表記にだけ使い、アプリの宣伝・ロゴに使わない。

---

## 11. 必要なマイグレーション

承認後に作るもの(案。**今は作らない**):
1. `economic_indicators` に `CA_CPI_TRIM`・`CA_CPI_MEDIAN` の2行(`on conflict (code) do nothing`)。
2. `indicator_fx_pairs` に CADJPY(priority 1)を2行。
3. (必要なら)`seed.sql` にも同じ行(CI・ローカルは migration が seed の前に流れるため。既存の GB/AU/CA と同じ事情)。

不要なもの: `CA_CPI` の変更、`event_snapshots`・`event_revisions` の列の追加、一意制約の追加、出典(コードで持つ)。
戻す手順(案): `delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code in ('CA_CPI_TRIM','CA_CPI_MEDIAN')); delete from economic_indicators where code in ('CA_CPI_TRIM','CA_CPI_MEDIAN');`(イベントが無いうちだけ)。
**イベントの追加は migration ではなく、既存の `ingest:gb-au-ca-schedules`(dry-run → 承認 → 実行)で行う。**

---

## 12. 過去データの取り扱い

| 項目 | 方針(案) |
|---|---|
| 既存の `CA_CPI` | DEV には、予定の5件(2026-10〜2027-02 分)だけがある。過去の RELEASED は無い |
| 新しいコア2指標 | 過去のイベントは無い。**最初の公表(2026-10 分、2026-11-16 8:30 ET)から**、通常の経路で RELEASED になる |
| バックフィル(過去の月を RELEASED で入れる) | **しない**を既定とする。する場合は別の承認で、範囲(例: 直近12か月)を決める |
| バックフィルする場合の取得元 | 初回値は表 18-10-0259-01(Release ごとの履歴)。**確認済み**: 2025-11〜2026-04 の6回について、各回の初回値を取って The Daily 表4の最終列と比べ **18/18 一致**。**制約**: この表は 2026-03 分(Release 2026-04-20)までで、2026-05〜10 の6回は 2026-11-13 時点でまだ載っていない → その分は The Daily の表4(`t004a-eng.htm`)から取る必要がある(人の確認つき)。ヘッドラインの過去分は、指数から計算(調査メモ §A の24か月は公表値と一致) |
| バックフィルした月の扱い | RELEASED・スナップショットあり・`verification_source` に取得元を記録(例 `v108785715@2026-03(18100259)`)。`captured_at` は取得時刻だが**実際の公表日ではない**ので、イベントの `release_datetime` は当時の公表日にする。初回値の「取得日」が公表日と違うことを、記録に明記 |
| 改定検知への影響 | バックフィルしない場合、公開開始から最初の6か月間は、直近7点のうち過去の月のイベントが無いため検知の対象が少ない(エラーにはしない)。バックフィルすると、すぐに6か月分が検知の対象になる |
| 過去の改定履歴 | 表 18-10-0259-01 から、過去の改定(初回値と今の値の差)を `event_revisions` として入れることもできるが、**「いつ改定されたか(`effective_at`)」が Release ごとの差から分かる**範囲に限る。やる場合は別の承認 |

---

## 13. 未確認・未解決(正直な一覧)

確認済み: 24か月の計算の一致(24/24)、コア指標の初回値(18-10-0259-01 と The Daily、18/18)、改定の実績(216個中30個)、BoC が3指標を "preferred" としていて順位がないこと、StatCan Open Licence の出典文言、`event_snapshots` の不変性(DBトリガー)、既存の `CA_CPI` マスターの整合。

未確認:
1. ヘッドライン CPI が**改定されないという公式の文言**。
2. 6か月より前の改定が trim・median で起きるか(12回の比較では未観測)。
3. 表 18-10-0259-01 が更新される時期(2026-05〜10 の6回が未掲載の理由・遅れの見込み)。
4. 既存の `official-values` の初回値の受付期間(公表からの日数)の挙動。
5. `value_decimals` を `CA_CPI` で 1 にした場合の iOS への影響、`CA_CPI` の出典文言を「Adapted from …」に変えた場合の影響。
6. `findMappingByCode`(`mappings/indicators.ts`)への新コードの登録の要否。
7. BoC の利用条件 1.3 が、定義の説明文に及ぶか(HQ判断)。
8. 重要度 MEDIUM / 表示名「コアCPI（CPI-trim）」「コアCPI（CPI-median）」の最終の文言(HQ判断)。
9. 改定が多すぎる場合の停止の閾値(案: 5点超)。
10. 公表の初日(2026-11-16)に、WDS の値が公表と同時に更新されるタイミング(StatCan は 8:30 ET に公表。WDS の反映の遅れの有無は、公表日に観測して初めて分かる)。

承認が必要な次のステップ(いずれも**未着手**): ①設計書の確認 → ②コード・テスト・マイグレーション(ブランチ上)・CI → ③dry-run → ④DEV 反映(予定10件の INSERT と、公表後の値)。
