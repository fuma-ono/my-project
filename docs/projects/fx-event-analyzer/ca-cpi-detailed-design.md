# カナダ CPI(ヘッドライン CA_CPI と コア CA_CPI_TRIM / CA_CPI_MEDIAN)詳細設計書(最終版 2026-11-13)

**版の扱い**: §0〜§13 が基本設計、§14 が実装前の最終確認への回答、**§15 が最終版で確定した事項(§14 の「期限」の定義を含め、§15 が優先)**。§14 と §15 に食い違いがあれば §15 が正。

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
- description(案・**2026-11-13 改訂**): Statistics Canada の公表の表4の注記(Table note 7 / 6)の意味だけで書く。trim =「CPI の構成品目のうち、その月の価格変動の分布の両端に当たる品目を除いて求める、コア CPI(基調的な物価の動き)の指標の一つです」。median =「その月の価格変動を、CPI の構成品目のウェイトで並べたときの、ちょうど真ん中(50パーセンタイル)にあたる価格変動を使う、コア CPI の指標の一つです」。
  **カナダ銀行(Bank of Canada)のページにしか書かれていない具体的な数字(例: trim の「上下それぞれ加重20%・計40%」)は書かない**(§14.4 の判断。BoC の文言に依存しないため)。「定義: Statistics Canada の公表の表4の注記」を出典にする。**2つの優劣・どちらが主かは書かない。**
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
**確認済み(§14.1)**。現行の挙動と、CA_CPI・コア2指標に設定する値(`maxDaysAfterRelease = 7`、期限後は書かず PENDING のまま)は §14.1。

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
7. 改定の件数が一度に多い場合の扱い(**2026-11-13 HQ確認事項を反映**): 1回の実行・1系列で、直近7点のうち**改定と判定された点が5点以下なら、すべて処理(その件数だけ書く)。6点以上なら、その系列は全件書き込み停止(1件も書かない)**し、報告して止まる。WDS の不具合や系列の取り違えを疑う。コアの改定は、実績(216個の比較)で 1〜3点が普通。テストケースは §14.5。

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
- `src/ingestion/mappings/indicators.ts`(`findMappingByCode` の登録): **登録しない**(§14.2 で確認済み)。ただし `value_decimals` を 1 にするには、`valueDecimals.ts` が mapping に頼らない形(コードの一覧)に変わる必要がある(§14.2)。

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
- 実装案(文言は実装時に確定。**正確な区別は §14.7**):
  - `CA_CPI`: Adapted from Statistics Canada, Table 18-10-0004-01 Consumer Price Index, monthly, not seasonally adjusted, <対象月>. This does not constitute an endorsement by Statistics Canada of this product.
  - `CA_CPI_TRIM` / `CA_CPI_MEDIAN`: Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, <対象月>. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.
  - **注意**: 現行の `CA_CPI` の出典は「Source: …as is」の形。ヘッドラインを計算値にするなら、「Adapted from …」に変える必要がある(既存の応答の文言が変わる → iOS とHQに確認)。
- Bank of Canada: データは使わない。定義の説明(trim / median の説明文)に BoC の定義を使うので、**「定義の出典: Bank of Canada」を指標の説明に明記**する(BoC の利用条件 1.1: 出典の明記、推奨の非示唆)。BoC の利用条件 1.3(有料サービスでは、内容が当該サイトで無料で入手できることを購入者に事前に伝える)は、**アプリの有料機能が BoC の「コンテンツ」を含むと見なされるかで要否が変わる** — 数字は StatCan から取るので、定義の説明文だけが対象になりうる。**HQの判断が必要**(未確認)。
- 各指標の値は `Source` の表の名前・対象月とともに出す。StatCan の名称は出典の表記にだけ使い、アプリの宣伝・ロゴに使わない。

---

## 11. 必要なマイグレーション

承認後に作るもの(案。**今は作らない**)。**テーブル・レコード・理由・重複の確認は §14.3。**
1. `economic_indicators` に `CA_CPI_TRIM`・`CA_CPI_MEDIAN` の2行(`on conflict (code) do nothing`)。
2. `indicator_fx_pairs` に CADJPY(priority 1)を2行。
3. `seed.sql` にも同じ行(CI・ローカルは migration が seed の前に流れるため。既存の GB/AU/CA と同じ事情)。

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
4. (解決: §14.1)
5. `value_decimals` を `CA_CPI` で 1 にした場合の iOS への影響、`CA_CPI` の出典文言を「Adapted from …」に変えた場合の影響。
6. (解決: §14.2。登録しない)
7. BoC の利用条件 1.3 が独自の説明文に及ぶか(§14.4。**法的な最終判断は未確定**。BoC の文言に依存しない書き方で回避する案を提示)。
8. 重要度 MEDIUM / 表示名「コアCPI（CPI-trim）」「コアCPI（CPI-median）」の最終の文言(HQ判断)。
9. 改定が多すぎる場合の停止の閾値(案: 5点超)。
10. 公表の初日(2026-11-16)に、WDS の値が公表と同時に更新されるタイミング(StatCan は 8:30 ET に公表。WDS の反映の遅れの有無は、公表日に観測して初めて分かる)。

承認が必要な次のステップ(いずれも**未着手**): ①設計書の確認 → ②コード・テスト・マイグレーション(ブランチ上)・CI → ③dry-run → ④DEV 反映(予定10件の INSERT と、公表後の値)。


---

## 14. 実装前の最終確認(HQ指示 2026-11-13「CA_CPI実装前の最終確認」)

確認方法: リポジトリのコードとマイグレーションの読み取り、StatCan・BoC の公式ページの取得。**コード変更・マイグレーション・DB書き込みはしていない。**

### 14.1 現行 `official-values` の初回値受付期間と、期間を過ぎた場合の挙動(確認済み。`src/ingestion/pipelines/officialValues.ts`)

受付に関わる条件は、次の3段階。

| 段階 | 条件(コードの該当) | 期間を過ぎたとき |
|---|---|---|
| ① 対象のイベントの選別 | `release_datetime` が「今から過去 `lookbackDays` 日(既定 **45日**)」から「今」までのイベントだけを見る(`deps.lookbackDays ?? 45`) | **そのイベントは処理の対象外**(取得も改定確認もしない。ログにも出ない)。値は入らず、SCHEDULED・PENDING のまま |
| ② 系列ごとの上限日数 | `source.maxDaysAfterRelease`(任意)。**設定されているのは ABS の2系列(7日)だけ**。ONS・StatCan(`CA_UNEMPLOYMENT_RATE`)には設定なし | 期限を過ぎると `TOO_LATE_FOR_FIRST_RELEASE` で**保存しない**(`counters.skip`、plan に `PENDING` / 理由つき)。「改定後の値を初回値として保存しない」ための仕組み |
| ③ 公表日の照合 | `parseForRelease` が、最新の点の公表日 = その回の `releaseDate` のときだけ値を返す。StatCan の既存系列(`parseStatcanValueForRelease`)は**応答の最新の1点**(`at(-1)`)の `releaseTime` を見る | 次の月の点が最新になった後は日付が合わず、`NOT_RELEASED_OR_DATE_MISMATCH` で保存しない(PENDING のまま) |

- 期限を過ぎた回は**エラーにならず、PENDING のまま残る**。自動では取り戻さない。取り戻すには、別の承認によるバックフィル(§12)が要る。
- 期限後に「次の月の値」を前の回の初回値として取り違えることはない(③と、対象月の照合 `PERIOD_MISMATCH`)。
- **重要な違い(CA_CPI の設計に影響)**: 既存の StatCan 系列は「最新の1点」だけを見るため、③によって実質の受付期間が「次の公表の前日まで」(約4週間)になる。ヘッドラインの CA_CPI は**特定の2点(対象月と12か月前)を `refPer` で選ぶ**ため、③の「最新の点が次の月に変わる」では自然に止まらない。→ 受付期間を**明示的に設定する必要がある**。
- **CA_CPI・CA_CPI_TRIM・CA_CPI_MEDIAN に設定する値(案。判定の単位は §15.2 で「Toronto の暦日」に確定)**: `maxDaysAfterRelease = 7`(ABS と同じ。StatCan の CPI の公表間隔は4週間以上で、次の公表による改定の前に初回値を確定できる。コア指標は翌月の公表で過去の値が改定されるため、翌月の公表より前でなければならない)。期限を過ぎたら `TOO_LATE_FOR_FIRST_RELEASE`、書かずに PENDING のまま。
- **改定検知の窓との関係**: ①の45日のうち「対象のイベントの選別」は、RELEASED の回の改定確認にも使われる(現行は `lookbackDays` 以内のイベントだけ改定を確認する)。**コア指標の「直近6か月」(約180日)は45日の窓に収まらない**。したがって、コア指標の改定検知は、現行の `lookbackDays` に頼らず、**専用の窓(対象月 + 前の6か月 = 約200日)を別に持つ**必要がある(新しい実装。§6.1 のとおり)。ヘッドラインの改定確認は現行どおり(45日以内の1点)。
- 未確認だったことの解決: §5.6 の「初回値の受付期間」は、上の表のとおり。

### 14.2 `findMappingByCode` への `CA_CPI_TRIM` / `CA_CPI_MEDIAN` の登録要否(確認済み: **登録しない**)

- `findMappingByCode`(`src/ingestion/mappings/indicators.ts`)が引く `INDICATOR_MAPPINGS` は、**米国(BLS・FRB・Census)とユーロ圏(Eurostat)の指標**だけ(`US_CPI` … `EU_UNEMPLOYMENT_RATE`)。有料のプロバイダー(Finnhub 等)の行・BLS・Eurostat の系列と突き合わせる設定。
- **英国・豪州・カナダ・日本の指標(`GB_*`・`AU_*`・`CA_CPI`・`CA_UNEMPLOYMENT_RATE`・`JP_CPI`)は、1つも登録されていない**(コードで確認)。これらの値は `OFFICIAL_VALUE_SOURCES`(`officialValues.ts`)と公表予定の表(`gbAuCaSchedule.ts`)で扱う。
- `findMappingByCode` の利用箇所は、BLS・Eurostat・経済カレンダーの取り込み(`blsCalendar.ts`・`eurostatCalendar.ts`・`economicCalendar.ts`)と `valueDecimals.ts`。CA 系の取り込みは、どれも通らない。
- 登録すると、**意図しない副作用**が出うる: `economicCalendar.ts` などは mapping を元に取り込み対象を決める。カナダのコア指標を mapping に入れると、他の経路に混ざる。→ **登録しない**。既存の `CA_CPI` と同じ扱い。
- **登録しない場合に必要な対応**: `valueDecimalsForIndicator`(`src/domain/valueDecimals.ts`)は `findMappingByCode` に頼っており、**mapping が無い CA 系の指標は常に `null`**。ヘッドライン・コアの `value_decimals` を 1 にするには、この関数を「mapping 由来(BLS)」に加えて「公式統計の指標のコードの一覧(例 `CA_CPI`・`CA_CPI_TRIM`・`CA_CPI_MEDIAN` → 1)」を持つ形に変える。**コード変更が必要(実装時)。** 影響はAの確認待ち(`CA_CPI` は null → 1 に変わる)。

### 14.3 マイグレーション対象の具体(確認済み。既存 CADJPY との重複なし)

**テーブル 1: `economic_indicators`**(PK `id` uuid、`code text not null unique`)
- 追加するレコード: **2行**。
  - `code = 'CA_CPI_TRIM'`、`code = 'CA_CPI_MEDIAN'`。
  - 入れる列(既存の `20261110000002` と同じ16列): `code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below`。値は §2.2。
- 必要な理由: 指標のマスターで、`economic_events.indicator_id` が `economic_indicators(id)` を参照する(`on delete restrict`)ため、**指標の行が無いとイベントを作れない**。API の指標一覧・表示名・出典・通貨ペアの元でもある。コアの2指標は新しい指標なので、行が必要。
- 重複の確認: `code` は `unique`、`insert … on conflict (code) do nothing` で、何度流しても同じ。既存の22指標(`CA_CPI` を含む)には触れない。`CA_CPI_TRIM`・`CA_CPI_MEDIAN` は既存の `economic_indicators` に**存在しない**(DEV の読み取り専用確認で22指標、`missing_gb_au_ca = []`、コアの2コードは無い)。
- `display_name` の制約: `char_length ≤ 40` かつ空でない。「コアCPI（CPI-median）」は14文字で収まる。

**テーブル 2: `indicator_fx_pairs`**(`indicator_id`・`fx_pair_id`・`priority`・`is_active`、**`unique (indicator_id, fx_pair_id)`**)
- 追加するレコード: **2行** = (`CA_CPI_TRIM`, `CADJPY`, priority 1)、(`CA_CPI_MEDIAN`, `CADJPY`, priority 1)。
- 必要な理由: 指標と関連する通貨ペアの紐付け。API の `related_fx_pairs`・影響を受ける通貨ペアの表示に使う。無いと、コアの2指標は通貨ペアなしで表示される。
- **既存の CADJPY との重複がないことの確認**:
  1. `fx_pairs`(`symbol text not null unique`)の CADJPY は**既に1行ある**(seed.sql の `20000000-…-009`)。マイグレーションは `fx_pairs` に**行を足さない**(紐付けだけ)。
  2. 既存の紐付けは `(CA_CPI, CADJPY, 1)`・`(CA_UNEMPLOYMENT_RATE, CADJPY, 1)` の2行。新しい2行は `indicator_id` が別なので、`unique (indicator_id, fx_pair_id)` に**当たらない**。
  3. `insert … select … join economic_indicators … join fx_pairs … on conflict (indicator_id, fx_pair_id) do nothing`(既存の書き方)で、2回流しても増えない。
- 追加で更新が必要なファイル(マイグレーションと同じ変更で): `supabase/seed.sql`(同じ2行)、`tests/integration/gb-au-ca-indicators.test.ts`(指標の件数・通貨ペアの期待)。

**変更しないもの**: `fx_pairs`、`economic_events`、`event_snapshots`、`event_revisions`、`CA_CPI` の既存行。

### 14.4 BoC 利用条件 1.3 は、BoC の定義を参考にした独自の説明文にも適用されるか

**公式の条件文**(https://www.bankofcanada.ca/terms/ 、2026-11-13 に取得):
- 前提(1): 「the Bank permits you to freely use, copy, distribute and transmit its website content under the following terms」。
- 1.1 Attribution: 「You must attribute the Bank of Canada as the source of the content, and indicate if changes were made. … not in any way that suggests that the Bank endorses you or your use of the content.」
- 1.3 Use of Content: Notice Requirement: 「If You provide content from this website through paid services or incorporate any content in documents for sale (regardless of the medium), You must inform any prospective purchaser, prior to its distribution or sale, that said content was obtained from this website and that such information is available on this website free of charge.」

**判断の根拠と結論**
1. 1.3 の対象は「**content from this website**」(このサイトのコンテンツ)を有償のサービスで提供する場合。条件文には、「BoC の文章を参考にして**自分の言葉で書いた説明**」が含まれるかを明示した記述は**ない**。したがって、「独自の説明文なら適用されない」とも「適用される」とも、**公式の条件文だけからは断定できない**(未確定)。
2. 保守的な読み方: BoC のページの文章を**翻訳・要約して**説明文にした場合、それは BoC のコンテンツに基づく(`indicate if changes were made` が前提にしている「変更を加えた利用」にあたる)。アプリには有料プランがあり、説明文は無料・有料とも表示される → 1.1(出典の明記)は**適用される**とみなし、1.3(購入者への事前の通知)も**適用される可能性が高い**。
3. 事実(定義)そのものは、StatCan の表4の注記(Table note 6・7)に、StatCan 自身の言葉で書かれている(2026-11-13 に取得): CPI-median =「a measure of core inflation corresponding to the price change located at the 50th percentile (in terms of CPI basket weights) of the distribution of price changes in a given month」/ CPI-trim =「a measure of core inflation that excludes CPI components whose rates of change in a given month are located in the tails of the distribution of price changes」。これは StatCan Open Licence の対象で、BoC のコンテンツではない。
4. **提案(BoC の条件に依存しない書き方)**: 指標の説明文は、**StatCan の表4の注記の意味だけ**で書く(§2.2 を改訂)。BoC のページにしか書かれていない情報(trim の「上下20%・計40%」など)は入れない。出典は StatCan。この場合、BoC のコンテンツは使わないので、BoC の 1.1・1.3 は**原則として適用の余地がない**。指標名に "Bank of Canada definitions"(StatCan の表の題名にある語)を使うのは、事実の名前であり、BoC の文章の転載ではない。
5. それでも BoC の定義の詳細を入れたい場合: 1.1 の出典表記(「定義の出典: Bank of Canada」)と、1.3 の通知(「この内容は Bank of Canada のサイトで無料で入手できます」)を、**説明文の近くに表示**する。通知は「購入前」に伝える必要があるため、有料プランの案内の画面に置く設計になる(デザイン変更を伴う → Aの確認)。
6. **未確定として残ること**: 上の 2.・5. の法的な読み(独自の説明文が「content」にあたるか)は、BoC への確認か法務の判断が要る。この設計書は **4. の方針(StatCan の注記だけで書く)を既定**とし、HQがこの方針でよいか判断する。

### 14.5 直近7点の改定検知: 5点以下は処理、6点以上は全件書き込み停止(テストケース)

**規則(確定案)**
- 対象: コア指標1系列・1回の実行。直近7点(対象月と、その前の6か月)のうち、**比較できる点**(その月のイベントが RELEASED でスナップショットがある)について、「直近の値」と今の値(小数第1位)を比べる。違った点を「改定候補」と数える(N)。
- **N ≤ 5**: N件の `event_revisions` を、点ごとに書く(§5.2 の同日の除外後の件数)。
- **N ≥ 6**: **その系列は1件も書かない**(部分的に書かない = 全件停止)。結果に `REVISION_BURST_STOP`、N、指標、各点の from/to を記録して報告。もう一方のコア指標・ヘッドラインの処理には影響しない(系列ごとの判定)。
- N の数え方: **同日の差(§14.6)は N に含めない**(改定として扱わないため)。取得失敗・null の点は N に含めない。比較できない点(イベントなし)も含めない。

**テストケース(実装時に書く。入力は固定データ。いずれも `event_revisions` の書き込み件数を検査)**

| # | 状況 | 期待 |
|---|---|---|
| T1 | 7点すべて同じ(N=0) | 書き込み 0。全点 UNCHANGED |
| T2 | 1点が違う(N=1) | 1件書く |
| T3 | 3点が違う(N=3。実績に近い) | 3件書く |
| T4 | **5点が違う(N=5。境界)** | **5件すべて書く** |
| T5 | **6点が違う(N=6。境界)** | **0件。`REVISION_BURST_STOP`。報告に6点の from/to** |
| T6 | **7点すべてが違う(N=7)** | **0件。`REVISION_BURST_STOP`** |
| T7 | 7点中、スナップショットのある月が4つ(残り3つはイベントなし)で、4つとも違う(N=4) | 4件書く(イベントなしの3つは N に含めない) |
| T8 | 7点中、スナップショットのある月が7つ、うち **3点が同日の差**、4点が翌日以降の差 | 同日の3点は書かない(N=4)、4件書く |
| T9 | 7点中 5点が違い、さらに2点が取得失敗(null) | N=5、5件書く。null の2点は改定にしない |
| T10 | 7点中 6点が違うが、うち 2点は同日の差 | N=4(同日は含めない)、4件書く |
| T11 | T5 と同じ入力で、もう一度実行 | 0件のまま(停止が毎回再現)。ログも同じ |
| T12 | T4(N=5)を実行した直後に、同じ入力でもう一度実行 | 0件(直近値が更新済みなので UNCHANGED。重複なし) |
| T13 | trim が N=6(停止)、median が N=2 | trim は0件、median は2件(系列ごとに独立) |
| T14 | dry-run で N=6 | plan に停止が出る。書き込みなし |
| T15 | 浮動小数点の誤差だけ(`2.0000000001` と `2.0`) | 差と数えない(N=0) |

- 閾値(5 / 6)は定数として一箇所に置き、テストは境界の両側(5 と 6)を必ず含める。

### 14.6 同日中に値が変化した場合と、翌日以降に同じ差が確認された場合の改定登録フロー

**用語**: 「同日」= スナップショットの `captured_at` と、今回の実行時刻が、**`America/Toronto` の暦日で同じ**。改定の登録に必要な状態は DB の値だけ(スナップショット・直近の `event_revisions`)。**「同日の差を見た」という記録は DB に持たない**(ログに出すだけ)。そのため、実行は何度でも再開でき、日をまたいでも矛盾しない。

**フロー**(1つの対象月について)

```
[実行時] 今の値 cur を取得(照合に失敗・null なら何もしない)
  last = 直近の値(最後の event_revisions の new_value、無ければスナップショットの actual)
  if スナップショットが無い → 初回値の経路(§5.1)
  elif cur == last           → UNCHANGED(何もしない)
  elif 今日(Toronto) == スナップショットの captured_at の日(Toronto)
       → same_day_diff を記録して報告のみ。スナップショット・event_revisions は変えない
  else → event_revisions に1行(old=last, new=cur, effective_at=今)
```

**時系列の例**(公表日 D = 11/16)

| 時点 | 取得値 | 判定 | DB |
|---|---|---|---|
| D 08:31(初回) | 3.2 | 初回値 | スナップショット actual=3.2 |
| D 15:00(同日・再取得) | 3.3 | `same_day_diff`(報告のみ) | 変化なし(スナップショット 3.2) |
| D+1 | 3.3 | 同日ではない・last=3.2 と違う → **改定を登録** | revision(old 3.2 → new 3.3) |
| D+1(同じ日の再実行) | 3.3 | last=3.3 と同じ → UNCHANGED | 変化なし(**重複なし**) |
| D+2 | 3.3 | UNCHANGED | 変化なし |
| D+20 | 3.4 | 改定を登録 | revision(old 3.3 → new 3.4) |

- **同日の差が、翌日以降に「同じ差」として確認された場合**(上の D+1): そこで初めて改定として1回だけ登録する(old = 直近の値、new = 今の値)。2回目以降の実行は、直近の値と同じなので登録しない。
- **同日の差が翌日には消えている場合**(D 15:00 に 3.3、D+1 に 3.2): 改定は登録しない(last=3.2 と同じ)。同日の差は、ログと報告にだけ残る。
- **同日の差が翌日以降さらに別の値になった場合**(D+1 に 3.4): last=3.2 と違うので、old 3.2 → new 3.4 の1行。
- 「同日」の判定は、初回値を保存した日だけが対象。D+1 以降は、その日のうちの再取得でも通常の改定判定(同日の例外は初回値の日だけ)。
- **テスト**:
  - T-D1: 同日に値が変わる → `event_revisions` 0行、`same_day_diff` が結果に出る。
  - T-D2: その翌日に同じ値 → 1行(old=初回、new=今)。
  - T-D3: T-D2 の直後の再実行 → 増えない。
  - T-D4: 同日の差、翌日に元の値へ戻る → 0行。
  - T-D5: 同日の差、翌日に別の値 → 1行(old=初回値、new=翌日の値)。
  - T-D6: 暦日の境界(Toronto の 23:59 → 00:01)で、日をまたいだ判定が `America/Toronto` で行われる(UTC の日付ではない)。
  - T-D7: 夏時間の切り替え日をまたいでも、暦日の判定が崩れない。
- 注意: コア指標は、公表の**翌月の公表で過去6か月が改定される**ため、D の翌日の差は、まず「同日の例外が切れた」ことによる登録で、翌月の改定は通常の改定として登録される。2つの経路は同じ判定(上のフロー)で扱う。

### 14.7 StatCan の出典表記: ヘッドライン `Adapted from` とコア `Source:` の区別(確認済み。原文は https://www.statcan.gc.ca/en/terms-conditions/open-licence)

**原文の2つの表記**(Open Licence 本文):

| 場面 | 原文の表記 | 該当 |
|---|---|---|
| 情報(Information)そのものを出す | 「**Source: Statistics Canada, name of product, reference date. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.**」 | **コア2指標**(`CA_CPI_TRIM`・`CA_CPI_MEDIAN`): StatCan が公表した前年同月比(%)の値を、そのまま出す |
| 加工した製品(Value-added Product) | 「**Adapted from Statistics Canada, name of product, reference date. This does not constitute an endorsement by Statistics Canada of this product.**」 | **ヘッドライン `CA_CPI`**: 指数から**自分で計算**した前年同月比 |

- 注意: 原文では `Source:` にはコロンがあるが、`Adapted from` は**コロンなし**(「Adapted from Statistics Canada, …」)。HQ指示の `Adapted from:` と書式が違うので、原文どおり**コロンなし**で実装する(原文の確認が根拠)。
- **ヘッドライン `CA_CPI`**(実装案の文言):
  `Adapted from Statistics Canada, Table 18-10-0004-01 Consumer Price Index, monthly, not seasonally adjusted, <対象月>. This does not constitute an endorsement by Statistics Canada of this product.`
  - 「as is」の文言は**付けない**(計算したので、StatCan の原データを「そのまま」再配布していない)。
  - 末尾の "does not constitute an endorsement" を必ず付ける。
- **コア `CA_CPI_TRIM` / `CA_CPI_MEDIAN`**(実装案の文言):
  `Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, <対象月>. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.`
  - "Adapted from" は使わない。
  - 小数第1位の値は StatCan の公表値そのもの(計算・丸めなし)なので `Source:` の形が正しい。
- **混同を防ぐテスト(実装時)**:
  - `CA_CPI` の attribution の `notice` が `Adapted from Statistics Canada, Table 18-10-0004-01` で始まり、`Source:` で始まらず、`as is` を含まない。
  - `CA_CPI_TRIM`・`CA_CPI_MEDIAN` の `notice` が `Source: Statistics Canada, Table 18-10-0256-01` で始まり、`Adapted from` を含まず、`as is` を含む。
  - `CA_UNEMPLOYMENT_RATE` は既存どおり(`Source:` 形)で変わらない。
  - 3指標の `source_url` が、それぞれの表(18-10-0004-01 / 18-10-0256-01)のページ。
- **未解決(要確認)**:
  1. 原文は「name of product, **reference date**」を求める。現行の `attribution` は指標ごとに固定の文字列で、対象月は入らない(既存の `CA_UNEMPLOYMENT_RATE` も同じ)。対象月は、値と一緒に API が返す(`reference_period` 等)ので、アプリ側で並べて表示できるか — Aの確認事項。
  2. `CA_CPI` の既存の文言(`Source: Statistics Canada. …as is…`)を `Adapted from …` に変えると、**既存の応答の文言が変わる**(Aの確認事項)。
  3. 「Adapted from」が必要かは、**自分で計算した値**が "Value-added Product" にあたるかの解釈に基づく。StatCan に確認していない(原文の定義: 「any products you have produced by adapting or incorporating the Information」)。保守的に `Adapted from` を採用する。

### 14.8 §13 の未確認事項の更新(2026-11-13 時点)

| # | 事項 | 状態 |
|---|---|---|
| 1 | ヘッドライン CPI が改定されないという公式の文言 | 未確認のまま |
| 2 | 6か月より前の改定が trim・median で起きるか | 未観測のまま |
| 3 | 表 18-10-0259-01 の更新の遅れ | 未確認のまま(バックフィル時に再確認) |
| 4 | 初回値の受付期間 | **解決**(§14.1) |
| 5 | `value_decimals`・出典文言変更の iOS への影響 | Aの確認待ち |
| 6 | `findMappingByCode` への登録 | **解決**(登録しない。§14.2) |
| 7 | BoC 1.3 | 方針を提示(§14.4)。法的な最終判断は未確定 |
| 8 | 表示名・重要度の最終の文言 | HQ判断 |
| 9 | 改定の停止の閾値 | **確定案**(5点以下は処理、6点以上は全件停止。§14.5) |
| 10 | 公表の初日の WDS の反映タイミング | 公表日に観測して初めて分かる |


---

## 15. 最終版で確定した事項(HQ指示 2026-11-13「最終設計書の提出」)

**提出する範囲は設計書まで。実装・マイグレーション・CI・DEV反映・DB書き込み・main統合・PROD変更は、していない。**
下のコード・SQL・JSON は「案(実装時に作る形)」で、どこにも実行・反映していない。

### 15.0 A(iOS影響確認)の結果の扱い
- 指示文には「AのiOS影響確認が完了」とあるが、**Aの確認結果の本文は、B(私)には届いていない**。したがって、この設計書は A の指摘内容を**反映できていない**。
- 反映の置き場所: 下の §15.9「Aの確認結果との突き合わせ」の表(空欄)。Aの結果を受け取ったら、そこに追記する。それまで、A に確認が必要な項目(`value_decimals` の null→1、`attribution` 文言の変更、`display_name`、ロック中の出典、別行の表示)は、**未確認として扱う**。
- 本文に A の結果に依存する箇所は、「(A確認待ち)」と明記した。

### 15.1 45日窓と約200日の改定検知窓の分離(確定)

現行の `officialValues.ts` は、1つの窓(`lookbackDays`、既定 **45日**)で「どのイベントを見るか」を決め、**初回値の保存と、RELEASED の回の改定確認の両方**に使っている。コア指標の「直近6か月」の改定検知は、この窓に収まらない(約180日)。両者を**別の窓**にする。

| 窓 | 用途 | 長さ | 適用先 | 設定の持ち方(案) |
|---|---|---|---|---|
| **初回値の窓** | まだ RELEASED になっていない回を探す | **45日**(現行のまま) | 3指標 | 既存の `lookbackDays`(変更しない) |
| **ヘッドラインの改定確認の窓** | RELEASED の回の改定確認(対象月の1点) | **45日**(現行のまま) | `CA_CPI` | 既存の `lookbackDays` |
| **コアの改定検知の窓** | 直近7点(対象月 + 前の6か月)の改定検知 | **約200日**(`revisionLookbackDays = 200`) | `CA_CPI_TRIM`・`CA_CPI_MEDIAN` のみ | 新しい定数 `CORE_REVISION_LOOKBACK_DAYS`。`lookbackDays` とは独立 |

- **分離の要点**: コアの改定検知は `lookbackDays` を**参照しない**。45日窓を200日に延ばすと、初回値の保存とヘッドラインの改定確認の挙動まで変わってしまう(既存の `GB_*`・`AU_*`・`CA_UNEMPLOYMENT_RATE` も同じ窓を使う)ため、**共通の窓は変更しない**。
- 200日の根拠: 直近7点 = 対象月 + 6か月前まで = 最大 約 6か月 + 公表の間隔(約1か月)= 約 7か月(≒ 210日)。公表日の時刻のずれを見込み、**RELEASED の回の `release_datetime` が「今から過去200日」以内**のイベントを、コアの改定検知の対象にする。窓から外れた月は、点が直近7点に入っていても、改定の確認をしない(エラーにしない。ログに `OUT_OF_REVISION_WINDOW`)。
- 実装の形(案): コア指標用の別関数(例 `detectCoreRevisions`)にして、既存のループ(`officialValues.ts` の `for (const event of events)`)に混ぜない。ヘッドライン・既存系列のコードパスは、挙動を変えない。
- **テスト**:
  - W1: 公表日が46日前の RELEASED の `CA_CPI` は、改定確認の対象にならない(現行の挙動の固定)。
  - W2: 公表日が46日前のコアの RELEASED の回は、**改定検知の対象になる**(200日以内)。
  - W3: 公表日が200日前のコアの回は対象、201日前は対象外(`OUT_OF_REVISION_WINDOW`)。境界の両側。
  - W4: `lookbackDays` を変えても、コアの改定検知の対象は変わらない(独立性)。逆に `CORE_REVISION_LOOKBACK_DAYS` を変えても、初回値の保存の対象は変わらない。
  - W5: コアの窓を使っても、既存の系列(`GB_*`・`AU_*`・`CA_UNEMPLOYMENT_RATE`)の plan が変わらない(回帰)。

### 15.2 初回値の公表後7日制限(Toronto の現地日付で確定)

§14.1 の `maxDaysAfterRelease = 7`(現行は「経過ミリ秒 > 7×86,400,000」)を、**`America/Toronto` の暦日の差**に確定する。

**規則**
- `releaseLocal` = イベントの `release_datetime` を `America/Toronto` の暦日(`YYYY-MM-DD`)にしたもの。
- `todayLocal` = 実行時刻(`now`)を `America/Toronto` の暦日にしたもの。
- `daysAfter = todayLocal − releaseLocal`(**暦日の差**。時刻・夏時間の影響を受けない)。
- 初回値を保存できる: `0 ≤ daysAfter ≤ 7`。
  - 公表日の当日(0日)から、**公表日の7日後の Toronto の 23:59:59 まで**受け付ける。7日後の翌日の 00:00(Toronto)から、受け付けない。
- 超過(`daysAfter ≥ 8`): `TOO_LATE_FOR_FIRST_RELEASE`。書かず、PENDING のまま(plan に `PENDING` / 理由つき)。
- `daysAfter < 0`(まだ公表前): 既存の「`release_datetime ≤ now`」の選別で、そもそも対象外。

**現行の方式との違い(なぜ暦日にするか)**
- 現行 ABS の方式は、経過時間(ミリ秒)で 7日を測る。夏時間の切り替え日をまたぐと、**±1時間**ずれて、境界の判定が曖昧になる。
- `CA_CPI` の公表は 8:30 ET(Toronto)。「公表日 + 7日」の翌朝の再実行が 7日を過ぎるかどうかを、**人が読んで同じに判定できる**ようにするため、暦日で測る。
- 判定に使う時刻は、すべて `America/Toronto`。UTC の日付は使わない(UTC の日付では、Toronto の夕方〜夜の実行が翌日扱いになるため)。

**実装の形(案)**: `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' })` で暦日の文字列を作り、`Date.UTC(y, m-1, d)` どうしの差を `86_400_000` で割る(暦日の差なので割り切れる)。`maxDaysAfterRelease` は、既存の ABS(7日)の挙動を**変えない**ため、新しい任意項目 `maxLocalDaysAfterRelease`(+ `localTimeZone`)として足す案。

**テスト**(公表日 D = 2026-11-16 08:30 ET = 13:30Z の想定)
| # | 実行時刻(Toronto) | 期待 |
|---|---|---|
| L1 | D 08:31 | 受け付ける(daysAfter 0) |
| L2 | D+7 23:59:59(11/23) | **受け付ける**(daysAfter 7) |
| L3 | D+8 00:00:00(11/24) | **受け付けない**(daysAfter 8)。`TOO_LATE_FOR_FIRST_RELEASE` |
| L4 | UTC では D+8 だが Toronto では D+7(例: 11/23 20:00 Toronto = 11/24 01:00Z) | **受け付ける**(Toronto の暦日が基準) |
| L5 | Toronto 11/24 00:30(= 11/24 05:30Z) | 受け付けない(Toronto で D+8。UTC でも D+8 で一致) |
| L6 | 夏時間をまたぐ(例: 公表日 2027-03-10、夏時間開始 2027-03-14 をまたぎ、D+7 = 3/17 の 23:59) | 受け付ける。**ミリ秒で測る方式なら 1 時間ずれて判定が変わる入力**で、暦日方式は変わらないことを示す |
| L7 | 夏時間の終了(2026-11-01)をまたぐ入力 | 暦日の差が崩れない |
| L8 | 期限後の再実行 | 何も書かない。PENDING のまま。plan の理由が `TOO_LATE_FOR_FIRST_RELEASE` |
| L9 | 期限後でも、すでに RELEASED の回の**改定検知**は別(§15.1 の窓。初回値の期限の対象ではない) | 改定検知は動く |

### 15.3 same_day_diff のログ仕様(確定)

§14.6 の判定(`captured_at` と同じ Toronto の暦日で値が違えば、書かずに報告)で出す記録の仕様。

- 記録先: 取り込みジョブの結果の `counters.note('same_day_diff', {...})`(= `ingestion_logs` の details、および dry-run / 実行の出力 JSON)。**新しいテーブル・列は作らない。**
- 1件 = 1つの対象月のイベント。**値の差があったときだけ**出す(差がなければ出さない)。
- フィールド(案):

| フィールド | 内容 | 例 |
|---|---|---|
| `event` | 固定文字列 `same_day_diff` | |
| `indicator` | 指標コード | `CA_CPI_TRIM` |
| `provider_event_id` | イベントの識別子 | `statcan_release_schedule:CA_CPI_TRIM:2026-10` |
| `event_id` | イベントの ID(内部) | uuid |
| `period` | 対象月 | `2026-10` |
| `series` | 系列(vectorId。取り違え確認用) | `v108785715` |
| `snapshot_actual` | 保存済みの初回値 | `1.8` |
| `observed` | 今回取得した値 | `1.9` |
| `snapshot_captured_at` | 初回値を保存した時刻(UTC、ISO) | `2026-11-16T13:31:12.000Z` |
| `observed_at` | 今回の取得時刻(UTC、ISO) | `2026-11-16T20:00:03.000Z` |
| `local_date` | 判定に使った Toronto の暦日 | `2026-11-16` |
| `action` | 常に `NONE`(DB は変えていない) | `NONE` |

- 集計: `counters` に `same_day_diff` の件数を足す。実行の要約に `same_day_diff: N` を出す。**エラー・失敗にはしない**(終了コード 0)。ただし、N ≥ 1 のとき、実行の注記(`::notice`)で目立たせて報告に載せる。
- 守ること: **メールアドレス・トークン・接続情報は出力しない**(値と識別子だけ)。
- 翌日以降の扱い: この記録は DB に残さない(§14.6)。翌日以降は、DB の値(スナップショット・直近の revision)との比較だけで改定が決まる。したがって、ログが消えても判定は変わらない。
- **テスト**:
  - S1: 同日に値が違う → `same_day_diff` が1件出て、全フィールドが入る。`event_revisions` は0行、スナップショットは不変。
  - S2: 同日に値が同じ → 出ない。
  - S3: 出力に、接続情報・キー・メールアドレスの文字列が含まれない。
  - S4: dry-run でも同じ記録が出る(plan に `SAME_DAY_DIFF` / 書き込みなし)。
  - S5: `observed` が null(取得失敗)→ `same_day_diff` を出さず、`FETCH_FAILED` / `NOT_UPDATED` として別に記録する(取得失敗を差として扱わない)。

### 15.4 改定検知の5件・6件の境界処理(確定)

§14.5 を確定。**N ≤ 5: すべて処理、N ≥ 6: その系列は1件も書かない。**
- N の定義: 直近7点のうち、**比較できる点**(その月のイベントが RELEASED でスナップショットがある)で、「直近の値」と今の値が(小数第1位で)違い、かつ**同日の差ではない**点の数。
- 判定の順序(実装): ① 7点を取得し、系列・公表日・対象月・単位・数値を照合(失敗した点は除外) → ② 各点を分類(`UNCHANGED` / `SAME_DAY_DIFF` / `REVISION_CANDIDATE` / `NO_EVENT` / `INVALID`) → ③ `REVISION_CANDIDATE` の数 N を数える → ④ N ≤ 5 なら N件を書く / N ≥ 6 なら書かず `REVISION_BURST_STOP`。**書き込みは③の後にまとめて**行う(途中まで書いて停止、にならない)。
- 定数: `REVISION_BURST_LIMIT = 5`(5以下は処理)。境界の両側(5 と 6)のテストを必須にする。
- `REVISION_BURST_STOP` の出力(案): `{ event: 'REVISION_BURST_STOP', indicator, n, limit: 5, points: [{period, from, to}...] }`。終了コードは**失敗(非0)ではなく、警告として報告**(次の実行でも再現されるため、人が確認するまで繰り返し報告される)。HQ判断: 非0にするか。
- テストケース T1〜T15 は §14.5 のとおり(N=0,1,3,**5(処理)**,**6(停止)**,**7(停止)**、同日の差を除いた N、取得失敗の混在、再実行の冪等、系列ごとの独立、dry-run、浮動小数点の誤差)。

### 15.5 StatCan 出典表記(確定。原文の区別)

§14.7 のとおり。確定する文言(**実装時に、定数としてコードに置く案**):

| 指標 | 形 | 文言 |
|---|---|---|
| `CA_CPI`(指数から計算) | **Adapted from**(コロンなし) | `Adapted from Statistics Canada, Table 18-10-0004-01 Consumer Price Index, monthly, not seasonally adjusted, <対象月>. This does not constitute an endorsement by Statistics Canada of this product.` |
| `CA_CPI_TRIM`・`CA_CPI_MEDIAN`(公表値そのまま) | **Source:**(コロンあり) | `Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, <対象月>. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.` |
| `CA_UNEMPLOYMENT_RATE`(既存) | Source: | 変更しない |

- `<対象月>` は、現行の `attribution` が指標ごとの固定文字列で、対象月を持たない。**対象月の扱いは A の確認待ち**(§15.0)。案: `notice` は対象月を含めず、アプリが値と一緒に対象月(`reference_period`)を表示する。原文の "reference date" の要件を満たすかは、StatCan に確認していない(未確認)。
- テスト: §14.7 の4種(`CA_CPI` は `Adapted from` で始まり `Source:` を含まない・`as is` を含まない / コアは `Source:` で始まり `Adapted from` を含まず `as is` を含む / `CA_UNEMPLOYMENT_RATE` は不変 / `source_url` が各表)。
- 追加: StatCan の名称・ロゴ・ドメイン名を、宣伝・推奨を示唆する形で使わない(出典の表記にだけ使う)。アプリのストア説明・広告に StatCan を載せない。
- BoC: 説明文は StatCan の表4の注記(Table note 6・7)の意味だけで書く(§14.4)。BoC のページにしかない情報は入れない。

### 15.6 マイグレーション: 指標2行・通貨ペア2行(確定。案の SQL)

**どこにも実行していない。** ファイル名(案): `supabase/migrations/<日付>_ca_core_cpi_indicators.sql`。

```sql
-- カナダのコア CPI(CPI-trim・CPI-median)。HQ指示 2026-11-13。何度流しても同じ結果(on conflict do nothing)。
-- 取得元: Statistics Canada の表 18-10-0256-01。定義の説明は StatCan の表4の注記(Table note 6・7)の意味だけで書く。
-- 既存の指標・イベント・通貨ペアには触れない。
insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('CA_CPI_TRIM', 'カナダ CPI-trim(トリム平均、前年比)', 'Canada CPI-trim (trimmed mean), 12-month change', 'コアCPI（CPI-trim）', 'CA', 'CAD', 'MEDIUM',
    '<StatCan の表4の注記に基づく説明(§2.2)>',
    array['<…>', '<…>', '毎月 Statistics Canada が公表する'],
    'MONTHLY', '%', 'Statistics Canada', 'https://www.statcan.gc.ca', 'HIGHER_IS_POSITIVE',
    '<…>', '<…>'),
  ('CA_CPI_MEDIAN', 'カナダ CPI-median(中央値、前年比)', 'Canada CPI-median (weighted median), 12-month change', 'コアCPI（CPI-median）', 'CA', 'CAD', 'MEDIUM',
    '<…>', array['<…>', '<…>', '毎月 Statistics Canada が公表する'],
    'MONTHLY', '%', 'Statistics Canada', 'https://www.statcan.gc.ca', 'HIGHER_IS_POSITIVE',
    '<…>', '<…>')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('CA_CPI_TRIM', 'CADJPY', 1),
  ('CA_CPI_MEDIAN', 'CADJPY', 1)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
```
- 日本語の説明・key_points・market_view の文言(`<…>`)は、実装時に §2.2 の方針(StatCan の注記の意味だけ)で書き、HQ確認を受ける。
- 検証(実装後、読み取り専用): `economic_indicators` が **22 → 24**、`indicator_fx_pairs` の CADJPY の紐付けが **2 → 4**(`CA_CPI`・`CA_UNEMPLOYMENT_RATE` + 新しい2行)、`fx_pairs` の件数は不変、既存22行の内容は不変。
- 戻す手順(案。イベントが無いうちだけ): `delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code in ('CA_CPI_TRIM','CA_CPI_MEDIAN')); delete from economic_indicators where code in ('CA_CPI_TRIM','CA_CPI_MEDIAN');`
- 同じ変更で更新するもの: `supabase/seed.sql`(同じ2行)、`tests/integration/gb-au-ca-indicators.test.ts`(指標の件数・通貨ペアの期待)。
- イベントの追加はマイグレーションでなく `ingest:gb-au-ca-schedules`(StatCan の表に5×2 = 10件を足す。dry-run → 承認 → 実行)。

### 15.7 API レスポンスと FREE/PRO の整合性(確定)

新しいエンドポイント・新しい権限コードは作らない(§7・§8)。レスポンスの形(**例。値は仮**)。

**`GET /events/{id}`(FREE、見られる範囲の発表。`CA_CPI_TRIM`)**
```json
{
  "event": {
    "indicator_name": "カナダ CPI-trim(トリム平均、前年比)",
    "display_name": "コアCPI（CPI-trim）",
    "country_code": "CA", "currency_code": "CAD",
    "importance": "MEDIUM", "status": "RELEASED", "data_status": "AVAILABLE",
    "revision_status": "NONE",
    "attribution": { "source": "カナダ統計局（Statistics Canada）", "source_url": "...", "notice": "Source: Statistics Canada, Table 18-10-0256-01 ... as is ..." },
    "value_decimals": 1,
    "locked": false, "required_plan": null
  },
  "snapshot": { "actual": 1.8, "forecast": null, "previous": null, "surprise": null, "unit": "%", "source": "Statistics Canada" }
}
```
**ロック中(FREE が見られない過去の発表)**: `snapshot.actual` / `previous` / `surprise` 等は null、`locked: true`・`required_plan: "PRO"`。`revision_status` は固定値(`LOCKED_REVISION_STATUS`)。**`attribution` と `value_decimals` と `display_name` は隠さない**(既存の仕様どおり。出典はロック中も出る)。
**予定のみ(値なし)**: `status: SCHEDULED`、`data_status: DATA_PENDING`、`snapshot` の値は null。`attribution` は出る。
**改定あり**: `revision_status: REVISED`。`GET /events/{id}/revisions` が `ACTUAL` の `old_value`・`new_value`・`effective_at`・`source` を返す(FREE のロック中は 403 `PLAN_LIMIT_EXCEEDED`、既存の挙動)。
**ヘッドライン `CA_CPI`**: 同じ形。`attribution.notice` が `Adapted from …`。`value_decimals` は 1(null から変わる — A確認待ち)。

**FREE/PRO**
- 3指標とも既存の `VIEW_BASIC_EVENT`・`VIEW_HISTORICAL`(FREE にも既定で付く)の範囲。PRO 専用の項目は作らない。
- 過去の発表の制限(FREE は指標ごとに RELEASED の直近 N 回だけ値を見られる)は、**指標ごとに独立**に数える。3指標は別々に数える(コアの2つは新しい指標なので、最初は RELEASED が少なく、ロックにかかりにくい)。
- `/calendar`・`/indicators` に3指標が別の行として現れる(コアは `display_name` に trim / median)。
- **テスト**: ① 3指標が別行で現れる ② コアの `display_name` に trim / median ③ ロック中も `attribution`・`value_decimals` が残る ④ ロック中は値・前回・改定が null / 403 ⑤ FREE の過去発表の数え方が指標ごと(コア2つとヘッドラインで混ざらない) ⑥ 予定のみの応答 ⑦ 改定ありの応答 ⑧ PRO はロックされない。
- 実機の表示(1行表示の文字数、「コアCPI（CPI-median）」が収まるか、ロック表示中の出典)は **A確認待ち**。

### 15.8 テストケースと異常系(最終の一覧)

| 区分 | 項目 | 該当 |
|---|---|---|
| 窓 | W1〜W5(45日と約200日の分離、境界、独立性、回帰) | §15.1 |
| 受付期間 | L1〜L9(Toronto 暦日で7日、夏時間、期限後、改定検知は別) | §15.2 |
| 同日差 | S1〜S5 + T-D1〜T-D7(ログのフィールド、翌日の登録フロー、暦日の境界) | §15.3・§14.6 |
| 改定の境界 | T1〜T15(N=5 処理、N=6・7 停止、同日差・取得失敗の除外、冪等、系列独立、dry-run、誤差) | §14.5・§15.4 |
| 計算 | 24か月の指数から公表値と一致、丸め境界(整数演算)、12か月前の欠落、null、statusCode ≠ 0 | §9.1 |
| 照合 | `releaseTime` 不一致、最新の点が対象月でない、vectorId 取り違え(trim⇔median、コア⇔ヘッドライン)、3指標が別イベントに保存 | §9.2 |
| 保存 | スナップショット(`forecast`・`previous` = null)、冪等、DB のトリガーによる更新拒否、dry-run | §9.3 |
| 出典 | `Adapted from` / `Source:` の区別、`as is` の有無、`CA_UNEMPLOYMENT_RATE` 不変、`source_url` | §15.5 |
| API/権限 | 別行、display_name、ロック中の出典、FREE/PRO、予定のみ、改定あり | §15.7 |
| マイグレーション | 22→24、CADJPY の紐付け 2→4、再実行で増えない、既存の行が不変 | §15.6 |

**異常系(すべて「書かない・理由を記録・報告」)**: WDS の通信失敗 / HTTP エラー / `status` ≠ SUCCESS / 対象月の未反映 / 値が null・非数 / `statusCode`・`symbolCode` ≠ 0 / 12か月前の欠落 / vectorId の取り違え / `releaseTime` の不一致 / 未来日の `releaseTime` / 7日(Toronto 暦日)超過 / 同日の差 / 改定が6点以上 / 約200日の窓の外 / DEV 以外への接続(既存の保護) / 同時実行(`concurrency: fx-ingestion` で直列化)。

### 15.9 Aの確認結果との突き合わせ(**空欄。Aの結果を受け取ったら追記**)

| 確認項目(HQ指示) | Aの結果 | Bの対応 |
|---|---|---|
| `value_decimals` が null から 1 になった場合の既存画面への影響 | 未受領 | `CA_CPI` のみ現行維持(null)にして、コア2指標だけ 1 にする案も用意(影響が出る場合) |
| `attribution` の文言変更・追加で既存UIが崩れないか | 未受領 | `CA_CPI` を `Adapted from` に変える場合の長さ・折り返し |
| `display_name` による既存イベント表示・過去イベント比較への影響 | 未受領 | 表示名の文字数(40字制約、1行表示) |
| ロック表示中にも出典が表示される仕様 | 未受領 | 既存の仕様のまま |
| 新しいコア2指標が別行として表示できるか | 未受領 | 別コード・別 `display_name` で別行になる(API は確認済み。画面は A) |

### 15.10 実装時の変更一覧(最終)

1. `src/ingestion/pipelines/officialValues.ts`: 3系列の追加、`maxLocalDaysAfterRelease`(Toronto 暦日7日)、コア専用の改定検知(約200日の窓、直近7点、`REVISION_BURST_LIMIT`)、`same_day_diff` の記録。
2. `src/ingestion/adapters/gbCaOfficialValues.ts`: `CA_CPI`(指数→前年同月比、`refPer` で選ぶ、整数演算)と、コア2系列(公表値)のアダプター。
3. `src/ingestion/mappings/gbAuCaSchedule.ts`: `STATCAN_SCHEDULE` にコア2指標の行(5×2 = 10件、`CA_CPI` と同じ日付)。
4. `src/domain/attribution.ts`: 3指標の出典(§15.5)。
5. `src/domain/valueDecimals.ts`: 公式統計の指標の一覧(§14.2)。
6. マイグレーション(§15.6)、`seed.sql`、`tests/integration/gb-au-ca-indicators.test.ts`。
7. テスト(§15.8)。
8. **しないこと**: `findMappingByCode` への登録、`event_snapshots`・`event_revisions` の列や制約の追加、定期実行の追加・変更、`lookbackDays` の変更。

### 15.11 未確認・未解決(最終)
1. **Aの確認結果(本文が未受領)**: §15.9 の全項目。
2. ヘッドライン CPI が改定されないという公式の文言(未確認のまま)。
3. 6か月より前の改定が trim・median で起きるか(12回の比較では未観測)。
4. 表 18-10-0259-01 の更新遅れ(バックフィル時に再確認)。
5. 公表の初日(2026-11-16 8:30 ET)に、WDS の値が公表と同時に更新されるタイミング(観測して初めて分かる)。
6. BoC 条件の法的な最終判断(説明文を StatCan の注記だけで書く方針で回避する案を既定)。
7. 原文の "reference date" の要件と、対象月を `attribution` に含めるか(Aの確認と StatCan への確認が必要)。
8. 計算値が Value-added Product にあたるかの StatCan への確認(保守的に `Adapted from` を採用)。
9. HQ判断: 表示名「コアCPI（CPI-trim）」「コアCPI（CPI-median）」と重要度 MEDIUM、`REVISION_BURST_STOP` の終了コード(警告 or 非0)、バックフィルの有無。

### 15.12 提出
- この設計書をもって、B担当の設計は完了。**次の判断はHQ**: 実装範囲と開始(コード・マイグレーション・CI・DEV反映は、別途の承認が出るまで一切行わない)。
