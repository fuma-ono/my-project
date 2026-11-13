# カナダ CPI(ヘッドライン CA_CPI と コア CA_CPI_TRIM / CA_CPI_MEDIAN)詳細設計書(第5版 2026-11-13)

**版の扱い(第5版)**: 第5版は、Cの第4回独立レビュー(P1ゼロ・P2が6件)への対応。**実装を2段階に分離**(§16.15。第1段階 = 通常月の初回値の取り込み、固定記録のマイグレーションなしで動く / 第2段階 = 改定検知・承認・書き込み)し、未解決候補の引き継ぎ(§16.14.8)、固定記録の不変性(§16.14.5.2)、承認の取り消し(§16.14.7)、固定記録がないときの N 判定の停止(§16.14.4 の #0・#5b)、承認者の監査(§16.14.6)、既存DB機構との比較(§16.14.5.1)を反映した。第4版: 第4版は、Cの第3回独立レビューへの対応。年次改定の候補を**公表日ごとに固定する記録**(§16.14.5)、取得点数 `latestN: 49`(§16.14.2)、比較元の状態の区別、承認情報の受け渡し、部分承認・途中失敗の再開、却下・保留の解除、通常月の N の数え方の統一、`--allow-revision-burst` の廃止、旧6か月記述の修正、運用担当と週末・祝日の再設計(§16.6)を、本文・処理フロー・テストに反映した。第3版: 第3版では、Cの第2回独立レビューで「本文に反映されていない」と指摘された P1-1・P1-2 を、**該当する本文・処理フロー・テスト仕様を直接書き換えて**反映した(§4.3、§5.4、§5.6、§6.3、§9.2、§9.4、§9.5、§14.1、§14.5、§14.7、§15.2、§15.4、§15.5、§15.7、§15.9)。新規の仕様は **§16** にまとめ、どの指摘をどこで直したかの対応表は **§16.0** と **§16.13**。§0〜§15 と §16 に食い違いがあれば **§16 が正**。

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
| 改定 | 後日の取得で値が違えば改定候補として検知し `event_revisions` に記録。コア指標は、**通常月は直近7点(年齢 0〜6)、年次改定は過去36か月(年齢 1〜36)**を確認(別のルール。§16.14) | §6・§16.14 |

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
  event_revisions(ACTUAL)  ← 値が違うとき。コアは通常月が直近7点、年次改定は36か月(承認後。§16.14)
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
- 取得: 同じ WDS の `getDataFromVectorsAndLatestNPeriods`、`{"vectorId":108785715,"latestN":49}` と `{"vectorId":108785714,"latestN":49}`(系列ごとに1回のリクエスト。trim・median。**49点 = 対象月1 + 前の6か月(6)+ 7〜36か月前(30)+ 37〜48か月前(12)。§16.14.2**)。前年同月比(%)の系列で、**計算は不要**。
  - vector は表 18-10-0256-01 の Alternative measures の member 3(trim)・2(median)。取得時に `getSeriesInfoFromVector` で題名を確かめる検査は、実装時に入れる(vector の取り違え防止)。
- 値の単位: `%`。小数第1位。

### 4.3 照合の条件(第3版で書き換え。**初回値の保存**と**過去点の改定検知**で、照合する項目を分ける)

照合の対象を、次の2つの経路に**明確に分離**する(§16.1)。`releaseTime` と公表予定日 `releaseDate` の照合は、**経路 A の「初回値を保存する対象月の最新点」だけ**で行う。

#### 経路 A: 初回値の保存(対象月の最新点1つだけが対象)
いずれか1つでも欠ければ何も書かない。
1. **公表日**: 対象月の最新点の `releaseTime` の日付(StatCan が返す公表時刻の日付部分)= 公表予定の表の `releaseDate`。**この照合は経路 A だけ**。
2. **対象月**: 最新点の `refPer`(`YYYY-MM-01`)を `YYYY-MM` にして、表の `referencePeriod` と一致。最新の点が対象月でなければ保存しない。
3. **単位・数値**: 数として読める有限の値。`statusCode`・`symbolCode` が 0。
4. **ヘッドラインだけ**: 12か月前の点は `refPer` が対象月のちょうど12か月前であること。位置(13番目)で取らない。12か月前の点の `releaseTime` は**見ない**(過去点なので経路 B と同じ扱い)。
5. **系列の同一性**: 応答の `vectorId` が、その指標コードの系列と一致(混同防止)。
6. 取得元・出典がある(source・source_url)。
7. 受付期間内(§15.2・§16.7: 公表日から Toronto の暦日で7日以内)。

#### 経路 B: 過去点の改定検知(直近7点。初回値の保存済みの月が対象)
1. **系列の同一性**: 応答の `vectorId` が期待と一致。
2. **対象月**: 点の `refPer` が、その月のイベントの対象月(`provider_event_id` の key)と一致。
3. **数値**: 有限の数。
4. **`statusCode`・`symbolCode`**: 0。
5. **`releaseTime` は公表日の判定に使わない**(経路 A だけ)。
   - 理由(2026-11-13 に本物の応答で確認): コア2系列(vector 108785715・108785714)は、`latestN: 8` で取った**8点すべての `releaseTime` が `2026-10-19T08:30`(直近の公表の時刻)で同一**。過去の月の点にも、その月の元の公表日ではなく、**直近の公表の日付**が入る。過去点の `releaseTime` を、その月の公表予定日と照合すると、改定検知が**常に全件不一致**になり、改定を1件も検知できない。
   - 一方、ヘッドライン(vector 41690973)は点ごとに `releaseTime` が違う(13点で13通り)。系列によって性質が違うため、**どの系列でも `releaseTime` を過去点の判定に使わない**ことで、挙動を揃える。
6. 比較: 直近の値(最後の `event_revisions` の `new_value`、無ければスナップショットの `actual`)と、今の値(小数第1位)。

- 経路 A と経路 B は**別の関数・別のテスト**で実装する(§16.1)。経路 B の失敗・停止は、経路 A(初回値の保存)に影響しない(§16.2)。

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
- 応答の `vectorId` が期待と違う(**その系列だけ**止める。他の系列の処理は続ける。応答全体が解析不能な場合の扱いは §16.3)。
→ 結果に `FETCH_FAILED` / `NOT_UPDATED` / `INVALID_VALUE` の理由で記録するだけ。次の実行で取り直す。

### 5.5 重複登録の防止
- `event_revisions` には一意制約がない(アプリ層の規律。既存の設計どおり)。**アプリ側で「直近の値」と比べて、同じなら足さない**(既存の `latestRevisionValues`)。再実行しても同じ改定を足さない。
- 追加の防御(案、マイグレーション要): `(event_id, field_name, new_value, effective_at の日付)` の一意性は、改定が複数回あり得るため**付けない**。重複防止は「直近値との比較」に一本化する。
- 並行実行の防止: ワークフローの `concurrency: fx-ingestion`(既存)で直列化。
- テスト: 同じ入力で2回実行して、行が増えないこと(§9)。

### 5.6 期限
**確認済み(§14.1)**。現行の挙動は §14.1。CA_CPI・コア2指標に設定する値は、**1つの設定 `firstValueWindow`(7日・Toronto の暦日)に一元化**する(§16.7。旧称 `maxDaysAfterRelease`・`maxLocalDaysAfterRelease` の二重定義は解消)。期限後は書かず PENDING のまま、自動では救済せず、別途HQの承認が要る(§16.2・§16.6)。

---

## 6. 改定検知(コア指標: 通常月は直近7点・年次改定は36か月。ヘッドライン: 対象月1点)

### 6.1 コア指標(trim・median)
- 公表のたびに、各系列を `latestN: 49`(年齢 0〜48。対象月を含む)で取り、**通常月の比較窓は年齢 0〜6 の7点**(暫定維持)とする。残りの点(年齢 7〜36 = 年次の範囲、37〜48 = 方針と矛盾する変更の検知)は §16.14 のルールで使う。
- 各点の対象月について、そのイベント(`provider_event_id` = `…:<指標>:<対象月>`)を探す。
  - イベントが無い / RELEASED でない / スナップショットが無い → 何もしない(バックフィルしていない過去の月は対象外。エラーにしない)。
  - あれば、その月の「直近の値」(最後の `event_revisions` の `new_value`、無ければスナップショットの `actual`)と、今の値を、**小数第1位の値どうし**で比べる。
  - 違い、かつ「同日」(§5.2)でなければ、その月のイベントに `event_revisions` を1行足す。
- 現行の `officialValues.ts` は**対象月1つ**しか見ない。直近7点を見る処理は**新しい実装**になる(コア指標用の拡張。ヘッドラインには適用しない)。

### 6.2 ヘッドライン(CA_CPI)
- 現行どおり、**対象月の1点**を見る(直近7点にはしない)。理由: ヘッドラインの改定は公式文書で確認できていない(調査メモ §C)。観測したのは「改定が無い」という挙動だけ。
- 計算の元になる12か月前の指数が変わった場合も、同じ対象月の計算結果が変わるので、同じ経路で検知される(原因を記録: 元の2つの指数)。
- ヘッドラインの窓を7点や36か月に広げるかは、改定の実績・公式情報が出てから判断(別の承認)。

### 6.3 誤検知の防止
1. 比較は丸めた値(小数第1位)どうし。浮動小数点の値を比べない。
2. 取得失敗・未反映・null は改定にしない(§5.4)。
3. 同日の差は改定にしない(§5.2)。
4. 同じ改定を二度足さない(直近値との比較)。
5. 系列の取り違え(vectorId)・対象月の不一致は、**その系列だけ**を止めて報告する(他の系列は継続。応答全体が解析不能、または系列を識別できない場合だけ、CA_CPI 系の3系列を止める。§16.3)。
6. 通常月は年齢 0〜6 の7点を見る。年齢 7〜48 は、年次改定・方針矛盾の検知として別のルールで見る(§16.14)。公式の方針は「通常月は履歴1か月分、1月分の公表で3年前まで」(§16.4)。
7. 改定の件数が一度に多い場合の扱い(§14.5・§15.4・**§16.2**): 1回の実行・1系列で、直近7点のうち**改定と判定された点が5点以下なら、すべて処理。6点以上なら、その系列の「改定の書き込み」だけを止める**(1件も書かない)。**初回値の保存・他の系列・ヘッドラインの処理は止めない**。停止の理由・対象期間・候補件数は記録する。**通常月のルールである**。年次の再計算(過去36か月)は**別のルール**で、自動では書かず人の承認を挟む(§16.14)。年次改定の根拠と実績は §16.4。

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

### 9.2 照合(第3版で書き換え。経路 A / 経路 B と、系列単位の停止)

**経路 A(初回値の保存)**
- 最新点の `releaseTime` の日付が表の `releaseDate` と違う → その系列の初回値を保存しない。
- 最新の点が対象月でない(次の月が先に出た等)→ 保存しない。
- 応答の `vectorId` が期待と違う → **その系列だけ**止める(実行全体は止めない)。

**経路 B(過去点の改定検知)**
- 過去点の `releaseTime` が、コア2系列で**全点同一(直近の公表の時刻)**でも、改定検知が動く(過去点の `releaseTime` で公表日の判定をしない)。テストは §16.1(R1〜R8)。
- 過去点の `vectorId`・`refPer`・数値・`statusCode` が不正な点は、その点だけ除外(`INVALID`)。他の点の検知は続ける。

**系列単位の停止(§16.3 の表が正)**
- trim と median の vectorId を取り違えた入力 → **取り違えた系列だけ**止める(混同防止のテスト)。もう一方の系列とヘッドラインは続ける。
- 特定のvectorの取得失敗・`status` 異常・ID不一致・対象月不一致 → 該当系列のみ停止。
- 応答全体が解析不能、または系列を識別できない → CA_CPI 系の3系列を停止(§16.3)。
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
- 改定が6点以上 → その系列の**改定の書き込みだけ**を止めて報告する。初回値の保存・他系列は続ける(§16.2。テスト D1〜D10)。
- 浮動小数点の誤差(`2.0000000001` と `2.0`)を改定にしない。

### 9.5 API・権限・出典
- `/indicators`・`/calendar`・`/events/{id}` に3指標が別々に現れ、`display_name` に trim / median。
- `attribution.notice` が3指標で正しい文言(CA_CPI は「Adapted from …」、コアは「Source: …」)で、**対象月(例 `October 2026`)を含む**(A案・§16.5。テスト N1〜N12)。
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
| 改定検知への影響 | バックフィルしない場合、公開開始から最初の1年は、年齢 1〜36 の多くの月にイベントが無いため、**書き込み対象**が少ない(検知は固定記録の比較元で行い、書けない月は `NOT_WRITABLE` として一覧にだけ出る。§16.14)(エラーにはしない)。バックフィルすると、すぐに6か月分が検知の対象になる |
| 過去の改定履歴 | 表 18-10-0259-01 から、過去の改定(初回値と今の値の差)を `event_revisions` として入れることもできるが、**「いつ改定されたか(`effective_at`)」が Release ごとの差から分かる**範囲に限る。やる場合は別の承認 |

---

## 13. 未確認・未解決(正直な一覧。第1版の一覧。**最新は §16.12**)

確認済み: 24か月の計算の一致(24/24)、コア指標の初回値(18-10-0259-01 と The Daily、18/18)、改定の実績(216個中30個)、BoC が3指標を "preferred" としていて順位がないこと、StatCan Open Licence の出典文言、`event_snapshots` の不変性(DBトリガー)、既存の `CA_CPI` マスターの整合。

未確認:
1. ヘッドライン CPI が**改定されないという公式の文言**。
2. (解消: 公式の方針で、1月分の公表で3年前まで改定される。§16.4。年次改定は別ルール §16.14)
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
- **CA_CPI・CA_CPI_TRIM・CA_CPI_MEDIAN に設定する値(第3版: §16.7 で一元化。`firstValueWindow = { days: 7, basis: 'LOCAL_CALENDAR', timeZone: 'America/Toronto' }`。旧称 `maxDaysAfterRelease`)**: 7日(ABS と同じ。StatCan の CPI の公表間隔は4週間以上で、次の公表による改定の前に初回値を確定できる。コア指標は翌月の公表で過去の値が改定されるため、翌月の公表より前でなければならない)。期限を過ぎたら `TOO_LATE_FOR_FIRST_RELEASE`、書かずに PENDING のまま。
- **改定検知の窓との関係**: ①の45日のうち「対象のイベントの選別」は、RELEASED の回の改定確認にも使われる(現行は `lookbackDays` 以内のイベントだけ改定を確認する)。**コア指標の「直近6か月」(約180日)は45日の窓に収まらない**。したがって、コア指標の改定検知は、現行の `lookbackDays` に頼らず、**専用の窓(対象月 + 前の6か月 = 約200日)を別に持つ**必要がある(新しい実装。§6.1 のとおり)。ヘッドラインの改定確認は現行どおり(45日以内の1点)。
- 未確認だったことの解決: §5.6 の「初回値の受付期間」は、上の表のとおり。

### 14.2 `findMappingByCode` への `CA_CPI_TRIM` / `CA_CPI_MEDIAN` の登録要否(確認済み: **登録しない**)

- `findMappingByCode`(`src/ingestion/mappings/indicators.ts`)が引く `INDICATOR_MAPPINGS` は、**米国(BLS・FRB・Census)とユーロ圏(Eurostat)の指標**だけ(`US_CPI` … `EU_UNEMPLOYMENT_RATE`)。有料のプロバイダー(Finnhub 等)の行・BLS・Eurostat の系列と突き合わせる設定。
- **英国・豪州・カナダ・日本の指標(`GB_*`・`AU_*`・`CA_CPI`・`CA_UNEMPLOYMENT_RATE`・`JP_CPI`)は、1つも登録されていない**(コードで確認)。これらの値は `OFFICIAL_VALUE_SOURCES`(`officialValues.ts`)と公表予定の表(`gbAuCaSchedule.ts`)で扱う。
- `findMappingByCode` の利用箇所は、BLS・Eurostat・経済カレンダーの取り込み(`blsCalendar.ts`・`eurostatCalendar.ts`・`economicCalendar.ts`)と `valueDecimals.ts`。CA 系の取り込みは、どれも通らない。
- 登録すると、**意図しない副作用**が出うる: `economicCalendar.ts` などは mapping を元に取り込み対象を決める。カナダのコア指標を mapping に入れると、他の経路に混ざる。→ **登録しない**。既存の `CA_CPI` と同じ扱い。
- **登録しない場合に必要な対応**: `valueDecimalsForIndicator`(`src/domain/valueDecimals.ts`)は `findMappingByCode` に頼っており、**mapping が無い CA 系の指標は常に `null`**。ヘッドライン・コアの `value_decimals` を 1 にするには、この関数を「mapping 由来(BLS)」に加えて「公式統計の指標のコードの一覧(例 `CA_CPI`・`CA_CPI_TRIM`・`CA_CPI_MEDIAN` → 1)」を持つ形に変える。**コード変更が必要(実装時)。** A確認済み(`CA_CPI` は null → 1 に変わる既存 API 応答の変更。3 は 3.0 と表示。§15.9)。実機確認は未実施。

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

### 14.5 直近7点の改定検知: 5点以下は処理、6点以上は「改定の書き込み」だけ停止(第3版で書き換え。テストケース)

**規則(確定)**
- 対象: コア指標1系列・1回の実行。**経路 B(§4.3)**で、**年齢 0〜6 の7点**(対象月と、その前の6か月)のうち、**比較元がある点**(§16.14.3。イベントの有無を問わない。比較元 = イベントの直近値、無ければ直前の固定記録の観測値)について、比較元と今の値(小数第1位)を比べる。違った点を「改定候補」と数える(N)。**同日の差・既知の値は数えない**。書き込み対象は、そのうち**イベントのある月だけ**。**N の数え方は §16.14.4 で統一**。
  - 公表日の当日の最初の実行では、対象月の最新点は**初回値の保存(経路 A)**で、改定候補ではない。その実行の N は、その前の6点だけで数える(最大6)。後日の実行では、対象月も含む7点が候補になる(最大7)。
- **N ≤ 5**: N件の `event_revisions` を、点ごとに書く(§5.2 の同日の除外後の件数)。
- **N ≥ 6**: **その系列の「改定の書き込み」を1件も行わない**(部分的に書かない)。結果に `REVISION_BURST_STOP`、N、指標、対象期間、各点の from/to を記録して報告する。
- **停止する範囲(P1-2)**:
  - 止めるのは、**N ≥ 6 になった系列の改定の書き込みだけ**。
  - **初回値の保存(経路 A)は停止の対象外**。同じ実行で、新しい対象月の初回値は保存される。
  - もう一方のコア系列・ヘッドラインの処理は、独立して続く。
  - 初回値が先、改定検知が後(§16.2)。改定検知の停止・失敗が、初回値の保存を妨げない。
- N の数え方: **同日の差(§14.6)は N に含めない**(改定として扱わないため)。取得失敗・null の点は N に含めない。比較できない点(イベントなし)も含めない。

**テストケース(実装時に書く。入力は固定データ。いずれも `event_revisions` の書き込み件数を検査)**

| # | 状況 | 期待 |
|---|---|---|
| T1 | 7点すべて同じ(N=0) | 書き込み 0。全点 UNCHANGED |
| T2 | 1点が違う(N=1) | 1件書く |
| T3 | 3点が違う(N=3。実績に近い) | 3件書く |
| T4 | **5点が違う(N=5。境界)** | **5件すべて書く** |
| T5 | **6点が違う(N=6。境界)** | **改定は0件。`REVISION_BURST_STOP`。報告に6点の from/to。同じ実行の初回値の保存は行われる(D1)** |
| T6 | **7点すべてが違う(N=7。後日の実行。対象月も保存済み)** | **改定は0件。`REVISION_BURST_STOP`** |
| T7 | 年齢 0〜6 の7点のうち、イベントのある月が4つ、イベントのない月が3つ(固定記録に比較元あり)で、7つとも違う(N=7) | N=7 → **停止**(イベントのない月も N に数える)。書き込みなし |
| T7b | 同じ入力で、イベントのない3つの月に比較元が無い(初回の公表など) | **N が不完全** → `STOP_BASELINE_INCOMPLETE`。自動で書かない(第5版で変更) |
| T8 | 7点中、スナップショットのある月が7つ、うち **3点が同日の差**、4点が翌日以降の差 | 同日の3点は書かない(N=4)、4件書く |
| T9 | 7点中 5点が違い、さらに2点が取得失敗(null) | N=5、5件書く。null の2点は改定にしない |
| T10 | 7点中 6点が違うが、うち 2点は同日の差 | N=4(同日は含めない)、4件書く |
| T11 | T5 と同じ入力で、もう一度実行 | 改定は0件のまま(停止が毎回再現)。ログも同じ。初回値は保存済みなので UNCHANGED |
| T12 | T4(N=5)を実行した直後に、同じ入力でもう一度実行 | 0件(直近値が更新済みなので UNCHANGED。重複なし) |
| T13 | trim が N=6(**改定の書き込みだけ**停止)、median が N=2 | **trim の改定は0件、median の改定は2件**。**両系列とも初回値の保存は行われる**。ヘッドラインも独立(系列ごとに独立。§9.2・§16.3 と矛盾しない) |
| T14 | dry-run で N=6 | plan に停止が出る。書き込みなし |
| T15 | 浮動小数点の誤差だけ(`2.0000000001` と `2.0`) | 差と数えない(N=0) |
| T16 | 全7点の `releaseTime` が同一(`2026-10-19T08:30`)で、3点が違う | N=3、3件書く(`releaseTime` を判定に使わない。R1) |

- 閾値(5 / 6)は定数として一箇所に置き、テストは境界の両側(5 と 6)を必ず含める。
- 分離のテスト(D1〜D10)は §16.2。
- **この節の N ≥ 6 の停止は「通常月」のルール**。年次改定(過去36か月)は別のルールで、通常月の6件停止を適用しない(§16.14)。

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
- 注意: コア指標は、公式の方針で**通常月は履歴の1か月分、1月分の公表で3年前まで**改定される(§16.4)。D の翌日の差は、まず「同日の例外が切れた」ことによる登録で、翌月の改定は通常の改定として登録される。2つの経路は同じ判定(上のフロー)で扱う。

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
- **第3版で確定(HQ判断 2026-11-13)**: 原文の `reference date` を満たすため、**`attribution.notice` に対象月を含める(A案)**。対象月は英語の月名で `October 2026` の形。詳細・最終の文言・対象月の取得元・欠落時の扱い・テストは **§16.5**。
- 「Adapted from」が必要かは、**自分で計算した値**が "Value-added Product" にあたるかの解釈に基づく。StatCan に確認していない(原文の定義: 「any products you have produced by adapting or incorporating the Information」)。保守的に `Adapted from` を採用する(未確認として残す)。
- `CA_CPI` の既存の文言を `Adapted from …` に変えるため、**既存の応答の文言が変わる**(§15.9・§16.11)。

### 14.8 §13 の未確認事項の更新(2026-11-13 時点)

| # | 事項 | 状態 |
|---|---|---|
| 1 | ヘッドライン CPI が改定されないという公式の文言 | 未確認のまま |
| 2 | 6か月より前の改定が trim・median で起きるか | **解消**(公式の方針: 1月分の公表で3年前まで。§16.4・§16.14) |
| 3 | 表 18-10-0259-01 の更新の遅れ | 未確認のまま(バックフィル時に再確認) |
| 4 | 初回値の受付期間 | **解決**(§14.1) |
| 5 | `value_decimals`・出典文言変更の iOS への影響 | A確認済み(コード変更不要。§15.9)。**実機確認は未実施** |
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
- A の確認結果は、HQ経由で受領して §15.9 に反映した(B は A の報告本文を直接は見ておらず、HQの要約に基づく)。
- **A の最初の確認の対象は旧版 SHA `cd1448d8`**(最終版 `6a29209e`・第2版 `d9f468c2` ではない)。第3版で `attribution.notice` に対象月を含める(A案)ことが確定したため、A の追加確認の結果を §15.9 に追記した。
- **実機確認は未実施**。

### 15.1 45日窓と約200日の改定検知窓の分離(確定)

現行の `officialValues.ts` は、1つの窓(`lookbackDays`、既定 **45日**)で「どのイベントを見るか」を決め、**初回値の保存と、RELEASED の回の改定確認の両方**に使っている。コア指標の「直近6か月」の改定検知は、この窓に収まらない(約180日)。両者を**別の窓**にする。

| 窓 | 用途 | 長さ | 適用先 | 設定の持ち方(案) |
|---|---|---|---|---|
| **初回値の窓** | まだ RELEASED になっていない回を探す | **45日**(現行のまま) | 3指標 | 既存の `lookbackDays`(変更しない) |
| **ヘッドラインの改定確認の窓** | RELEASED の回の改定確認(対象月の1点) | **45日**(現行のまま) | `CA_CPI` | 既存の `lookbackDays` |
| **コアの改定検知の窓(通常月)** | 年齢 0〜6 の7点の改定検知 | **約200日**(`CORE_REVISION_LOOKBACK_DAYS = 200`) | `CA_CPI_TRIM`・`CA_CPI_MEDIAN` のみ | 新しい定数。`lookbackDays` とは独立 |
| **コアの改定検知の窓(年次改定)** | 年齢 1〜36 の36点(書き込み対象のイベントを探す範囲) | **約1,200日**(`CORE_ANNUAL_LOOKBACK_DAYS = 1200`。36か月 ≒ 1,100日 + 余裕) | 同上 | 新しい定数。年齢 37 以上のイベントは書き込み対象にしない(§16.14) |

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

**実装の形(案)**: `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' })` で暦日の文字列を作り、`Date.UTC(y, m-1, d)` どうしの差を `86_400_000` で割る(暦日の差なので割り切れる)。受付期間の設定は、**1つの `firstValueWindow` に一元化**する(§16.7)。`maxDaysAfterRelease`(経過ミリ秒)と `maxLocalDaysAfterRelease`(暦日)の二重定義はしない。ABS の既存の7日は `{ days: 7, basis: 'ELAPSED' }` に移して挙動を変えない。

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

### 15.4 改定検知の5件・6件の境界処理(確定。第3版で書き換え)

§14.5 を確定。**N ≤ 5: すべて処理、N ≥ 6: その系列の「改定の書き込み」だけを1件も行わない。初回値の保存は停止の対象外。**
- N の定義(**§16.14.4 で統一**): 経路 B(§4.3)で、**年齢 0〜6 の7点**のうち、**比較元がある点**(イベントの有無を問わない)で、比較元と今の値が(小数第1位で)違い、かつ**同日の差でも既知の値でもない**点の数。書き込み対象は、そのうちイベントのある月。
- **処理の順序(実装。P1-1・P1-2)**:
  1. **経路 A(初回値の保存)**: 対象月の最新点について、§4.3 経路 A の照合を行い、条件が揃えば保存する。**この段階は、改定検知の結果に依存しない**。
  2. **経路 B(改定検知)**: 7点を取得し、系列・対象月・数値・`statusCode` を照合(失敗した点は除外。**`releaseTime` は使わない**) → 各点を分類(`UNCHANGED` / `SAME_DAY_DIFF` / `REVISION_CANDIDATE` / `NO_EVENT` / `INVALID`) → `REVISION_CANDIDATE` の数 N を数える → N ≤ 5 なら N件を書く / N ≥ 6 なら書かず `REVISION_BURST_STOP`。**書き込みは件数の確定の後にまとめて**行う(途中まで書いて停止、にならない)。
  3. 経路 B の結果(停止・失敗)は、手順 1 で保存した初回値を取り消さない・妨げない。
- 定数: `REVISION_BURST_LIMIT = 5`(5以下は処理)。境界の両側(5 と 6)のテストを必須にする。
- `REVISION_BURST_STOP` の記録(必須項目): `event`(固定)、`indicator`、`n`(候補件数)、`limit`(5)、`periods`(対象期間: 候補の対象月の一覧)、`points`(各点の `period`・`from`・`to`)、`reason`(固定文言: 「改定候補が上限を超えたため、この系列の改定の書き込みを停止」)、`observed_at`、`first_value_saved`(同じ実行で初回値を保存したか)。
- **HQ決定(案A)**: 終了コード 0 のまま、stdout JSON の `safe_stops`、専用の黄色 warning、`$GITHUB_STEP_SUMMARY`。警告ステップはジョブの成否を変えない。通信失敗・内部エラーと区別する(§15.13・**§16.10**)。
- 停止の解除・再実行の手順は **§16.2**。
- テストケースは §14.5(T1〜T16)と §16.2(D1〜D10)。

### 15.5 StatCan 出典表記(確定。第3版で書き換え。**A案: `attribution.notice` に対象月を含める**)

詳細は **§16.5**。要点だけ:

| 指標 | 形 | notice の最終案(`October 2026` は対象月が2026年10月の場合の例) |
|---|---|---|
| `CA_CPI`(指数から計算) | **Adapted from**(コロンなし) | `Adapted from Statistics Canada, Table 18-10-0004-01 Consumer Price Index, monthly, not seasonally adjusted, October 2026. This does not constitute an endorsement by Statistics Canada of this product.` |
| `CA_CPI_TRIM`・`CA_CPI_MEDIAN`(公表値そのまま) | **Source:**(コロンあり) | `Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, October 2026. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.` |
| `CA_UNEMPLOYMENT_RATE`(既存) | Source: | **今回は変更しない**(同じ `reference date` の要件が当てはまるが、今回の範囲外。§16.12) |

- 対象月は**バックエンド内部の対象月**から取り、`notice` の文字列に埋め込む。**公開 API に新しい `reference_period` の項目は足さない**(HQ決定)。iOS のモデル・表示・ロック制御の変更は不要(既存の attribution の表示経路を使う)。
- 対象月と公表日(`release_datetime`)は別のもの。notice に入れるのは**対象月だけ**(公表日は入れない)。
- 対象月が欠落・不正のときは、推測した月を入れない(§16.5)。
- StatCan の名称・ロゴ・ドメイン名を、宣伝・推奨を示唆する形で使わない(出典の表記にだけ使う)。アプリのストア説明・広告に StatCan を載せない。
- BoC: 説明文は StatCan の表4の注記(Table note 6・7)の意味だけで書く(§14.4)。

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
    "attribution": { "source": "カナダ統計局（Statistics Canada）", "source_url": "...", "notice": "Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, October 2026. Reproduced and distributed on an \"as is\" basis with the permission of Statistics Canada." },
    "value_decimals": 1,
    "locked": false, "required_plan": null
  },
  "snapshot": { "actual": 1.8, "forecast": null, "previous": null, "surprise": null, "unit": "%", "source": "Statistics Canada" }
}
```
**ロック中(FREE が見られない過去の発表)**: `snapshot.actual` / `previous` / `surprise` 等は null、`locked: true`・`required_plan: "PRO"`。`revision_status` は固定値(`LOCKED_REVISION_STATUS`)。**`attribution` と `value_decimals` と `display_name` は隠さない**(既存の仕様どおり。出典はロック中も出る)。
**予定のみ(値なし)**: `status: SCHEDULED`、`data_status: DATA_PENDING`、`snapshot` の値は null。`attribution` は出る。
**改定あり**: `revision_status: REVISED`。`GET /events/{id}/revisions` が `ACTUAL` の `old_value`・`new_value`・`effective_at`・`source` を返す(FREE のロック中は 403 `PLAN_LIMIT_EXCEEDED`、既存の挙動)。
**ヘッドライン `CA_CPI`**: 同じ形。`attribution.notice` が `Adapted from … October 2026. This does not constitute an endorsement …`。**`value_decimals` は null から 1 に変わる(既存の API 応答の変更。A確認済み: 3 は 3.0 と表示。§15.9)**。新しい `reference_period` のフィールドは**足さない**(対象月は notice の中だけ)。

**FREE/PRO**
- 3指標とも既存の `VIEW_BASIC_EVENT`・`VIEW_HISTORICAL`(FREE にも既定で付く)の範囲。PRO 専用の項目は作らない。
- 過去の発表の制限(FREE は指標ごとに RELEASED の直近 N 回だけ値を見られる)は、**指標ごとに独立**に数える。3指標は別々に数える(コアの2つは新しい指標なので、最初は RELEASED が少なく、ロックにかかりにくい)。
- `/calendar`・`/indicators` に3指標が別の行として現れる(コアは `display_name` に trim / median)。
- **テスト**: ① 3指標が別行で現れる ② コアの `display_name` に trim / median ③ ロック中も `attribution`・`value_decimals` が残る ④ ロック中は値・前回・改定が null / 403 ⑤ FREE の過去発表の数え方が指標ごと(コア2つとヘッドラインで混ざらない) ⑥ 予定のみの応答 ⑦ 改定ありの応答 ⑧ PRO はロックされない。
- 実機の表示(1行表示の文字数、「コアCPI（CPI-median）」が収まるか、ロック表示中の出典、対象月を含む長い notice)は、A のコードレベルの確認では問題なし。**実機確認は未実施**。

### 15.8 テストケースと異常系(最終の一覧)

| 区分 | 項目 | 該当 |
|---|---|---|
| 窓 | WN1〜WN5(45日と通常月・年次の窓の分離、境界、独立性、回帰) | §15.1 |
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

### 15.9 AのiOS影響確認結果の反映(HQ経由で受領。第3版で書き換え)

**確認の経緯(混同しない)**
| 回 | A の確認対象 | 内容 |
|---|---|---|
| 1回目 | **旧版 SHA `cd1448d8`**(最終版 `6a29209e`・第2版 `d9f468c2` ではない) | コードレベルの影響確認(コード変更なし) |
| 2回目(HQ判断 2026-11-13) | `attribution.notice` に対象月を含める最終仕様(A案) | 追加確認。HQ経由で受領 |

**1回目の結果(旧版 `cd1448d8` に対する確認)**

| 確認項目 | Aの結果 | Bの対応(第3版) |
|---|---|---|
| `value_decimals` が null から 1 になった場合の既存画面への影響 | 既存の汎用フォーマット処理で対応可能。**3 → 3.0 と表示される** | **`CA_CPI` の `value_decimals` は null から 1 に変わる。これは既存の API 応答の変更**(コア2指標は新規なので変更ではなく追加)。表示が「3」から「3.0」に変わることを、実装時の確認項目・リリースノートに明記する |
| `attribution` の文言変更・追加で既存UIが崩れないか | 可変長表示で、スクロール領域内で表示できる | `CA_CPI` は `Adapted from …` に変わり(既存の `Source: …` からの変更)、コアは `Source: …` が新規。**対象月を含めると文字列がさらに長くなる**(2回目で確認) |
| `display_name` による既存イベント表示・過去イベント比較への影響 | 表示ラベルだけの変更。内部IDや比較処理に影響なし | 表示名は確定(§15.14)。比較は ID 基準 |
| ロック表示中にも出典が表示される仕様 | 既存仕様で、出典情報は表示される | 変更なし。**対象月つきの出典文も、FREE / PRO のロック状態にかかわらず表示する**(§16.5) |
| 新しいコア2指標が既存イベント一覧・詳細画面で別行として表示できるか | UUID 基準の API 駆動の表示で対応可能 | 別コード・別 `display_name` のため別行になる |
| iOS コード変更 | 不要 | 変更なし |
| 実機確認 | **未実施** | 実装後の DEV で、A が実機確認(FREE / PRO)。未実施のまま「確認済み」と書かない |

**2回目の結果(HQ判断 2026-11-13: A案で確定)**
- `attribution.notice` に StatCan の reference date(統計対象月)を埋め込む(**A案が最終仕様**)。
- 対象月はバックエンド内部の `reference_period` から取る。**公開 API に新しい `reference_period` のフィールドは足さない**。
- **iOS のモデル・表示・ロック制御の変更は不要**。既存の attribution の表示経路を使う。
- FREE / PRO のロック状態にかかわらず、対象月を含む出典文を表示する(既存の「ロック中も出典を出す」仕様のまま)。
- (B は A の報告本文を直接は見ていない。上は HQ の指示文の要約に基づく。)

**A への再確認が必要な仕様(§16.11)**: 対象月を含む長い notice の表示(折り返し・スクロール)、`value_decimals` 3.0 表示(特に `CA_CPI` の既存画面)、FREE / PRO ロック時の出典表示、長い attribution、`/indicators`(値を出さない一覧)では対象月なしの notice を返すこと、**実機確認は未実施**。

#### 15.9.2 最終版と、A の確認対象(旧版 `cd1448d8`)との差(B が突き合わせた結果)
`git diff cd1448d8 6a29209e` の範囲で、API の仕様(§7 の表、§8、`value_decimals`、出典の形)に変更は無かった。その後、**第3版で次の2点が API の応答の中身に影響する**。

| 変更 | API の形への影響 | 状態 |
|---|---|---|
| `attribution.notice` に対象月(`October 2026`)を含める(A案) | 項目は増えない(`notice` の文字列が変わるだけ)。文字列が長くなる | A の2回目の確認で「iOS 変更不要」(HQ経由) |
| `/indicators` は値を出さないため、対象月なしの notice | 同じ項目で、イベント系の応答と文言が違う | **A に再確認が必要**(§16.11) |
| 指標の説明文(`description`)を StatCan の注記の意味に変更 | 文章の中身だけ | 影響なし |

### 15.10 実装時の変更一覧(最終)

1. `src/ingestion/pipelines/officialValues.ts`: 3系列の追加、`firstValueWindow`(Toronto 暦日7日。旧 `maxDaysAfterRelease` を置き換えて一元化、§16.7)、経路 A / B の分離(§16.1)、コア専用の改定検知(約200日の窓、直近7点、`REVISION_BURST_LIMIT`)、`same_day_diff` の記録。
2. `src/ingestion/adapters/gbCaOfficialValues.ts`: `CA_CPI`(指数→前年同月比、`refPer` で選ぶ、整数演算)と、コア2系列(公表値)のアダプター。
3. `src/ingestion/mappings/gbAuCaSchedule.ts`: `STATCAN_SCHEDULE` にコア2指標の行(5×2 = 10件、`CA_CPI` と同じ日付)。
4. `src/domain/attribution.ts`: 3指標の出典(§15.5・§16.5)。**対象月つきの notice を作る関数**(例 `attributionForEvent(code, referencePeriod)`)を足し、呼び出し箇所(`routes/events.ts` の2か所、`domain/calendar.ts`)を対象月つきに変える。`/indicators` は値を出さない一覧のため、対象月なしの形を維持する(§16.5)。イベントの取得に `provider_event_id` と `verification_source` を含める。
5. `src/domain/valueDecimals.ts`: 公式統計の指標の一覧(§14.2)。`CA_CPI` は null から 1 に変わり、iOS では「3」が「3.0」と表示される(A の確認済み。iOS コード変更は不要)。
6. マイグレーション(§15.6)、`seed.sql`、`tests/integration/gb-au-ca-indicators.test.ts`。
7. テスト(§15.8)。
8. **しないこと**: `findMappingByCode` への登録、`event_snapshots`・`event_revisions` の列や制約の追加、定期実行の追加・変更、`lookbackDays` の変更。

### 15.11 未確認・未解決(第3版。**最新の一覧は §16.12**)
§16.12 を参照。第2版までの項目のうち、解消したもの: A の確認結果(§15.9)、受付期間の二重定義(§16.7)、`REVISION_BURST_STOP` の報告方法(HQ決定 案A、§16.10)、対象月の持たせ方(HQ決定 A案、§16.5)。

### 15.12 提出
- この設計書をもって、B担当の設計は完了。**次の判断はHQ**: 実装範囲と開始(コード・マイグレーション・CI・DEV反映は、別途の承認が出るまで一切行わない)。


### 15.13 `REVISION_BURST_STOP` の終了コードと報告方法(調査と提案。**終了コード仕様は変更していない**)

#### 15.13.1 既存の終了コードと警告通知の仕様(コードとワークフローで確認済み)

| 層 | 現行の仕様(根拠) |
|---|---|
| ジョブの結果 | `runIngestionJob`(`runner.ts`): `counters.errors > 0` かつ `success > 0` → `PARTIAL`、`errors > 0` で `success = 0` → `FAILURE`、`errors = 0` → `SUCCESS`。クラッシュも同様。結果は `ingestion_logs` に毎回1行(status・件数・`details`)で残る |
| 終了コード | 本番の形: `process.exitCode = result.status === 'SUCCESS' ? 0 : 1`(`jobs/ingestOfficialValues.ts`)。**SUCCESS 以外(PARTIAL・FAILURE)は 1**。dry-run: `counters.errors > 0 ? 1 : 0` |
| `counters.skip(...)` | 件数と理由を記録するだけで、**終了コードに影響しない**(0 のまま)。`FETCH_FAILED`・`NOT_RELEASED_OR_DATE_MISMATCH`・`TOO_LATE_FOR_FIRST_RELEASE` などはこれ |
| `counters.note(...)` | `details` に残るだけ。終了コードに影響しない |
| `counters.review` | `ingestion_logs.review_count` に記録されるが、終了コードに影響しない。品質レポートでは集計していない(確認した範囲) |
| ワークフロー | ステップの終了コード 1 → ジョブ失敗 → GitHub の失敗として扱われる(通知の対象)。`continue-on-error` は、定期実行の要人発言のステップでは**意図的に使わない**(`check_speech_schedule_steps.py` が検査) |
| 注記 | 既存は `::notice`(`annotate_dryrun.py`、`read_wf.py` で読む)と、FX 価格の失敗時の `::warning::`(成功のまま警告を出す前例: `fx-event-analyzer-ingestion.yml`)。`$GITHUB_STEP_SUMMARY` への追記の前例あり |
| 品質レポート | 日次(`0 0 * * *`)。ジョブごとの実行数・SUCCESS / PARTIAL / FAILURE の数・スキップ理由を集計。「1. 取得の失敗(異常)」は「最新の実行が FAILURE / PARTIAL、error_count > 0、または取得件数 0」 |

**現状の見落としやすい点(確認済み)**: 通信失敗(`FETCH_FAILED`)は **`counters.skip`(終了コード 0・status SUCCESS)** で記録される。つまり現行では、**通信障害は「通常成功」に紛れる**(ログの `details` と plan の `PENDING / FETCH_FAILED` に出るだけ)。一方、`counters.error` は終了コード 1 で、品質レポートの「取得の失敗(異常)」に入る。

#### 15.13.2 分類(混同しないための3種類)

| 種類 | 意味 | 現行の扱い | 今回の提案 |
|---|---|---|---|
| **通信障害** | WDS に届かない・HTTP エラー・`status` ≠ SUCCESS | skip の `FETCH_FAILED`(終了コード 0、紛れる) | **変更しない**(仕様は触らない)。ただし、`REVISION_BURST_STOP` と区別して報告できるよう、タイトルを分ける(下) |
| **安全停止(`REVISION_BURST_STOP`)** | 取得は成功。改定が6点以上で、データの異常(系列の取り違え・WDS の不具合)を疑って**自分で止めた** | 該当なし(新規) | **専用の警告**。通信障害ではなく、「書き込みを意図的に止めた」ことを明示 |
| **データ・内部エラー** | スナップショット書き込みの失敗、系列の不一致(vectorId)、指標の行が無い等 | `counters.error`(終了コード 1) | 変更しない |

#### 15.13.3 提案(案 A を推奨。いずれも**未実装・未変更**)

**案 A(推奨): 終了コード 0 のまま、専用の警告として「目立たせる」**
- ジョブ内: `REVISION_BURST_STOP` を `counters.note('revision_burst_stop', {...})` と専用の `skip('REVISION_BURST_STOP')` で記録する(終了コード・status は変えない)。`counters.error` は使わない(失敗と混ざらないため)。
- 出力: 実行の標準出力の JSON に、最上位の項目 `safe_stops: [{ code: 'REVISION_BURST_STOP', indicator, n, limit: 5, points: [...] }]` を出す(通常成功の `published`・`revisions` と並べず、独立の項目にする)。
- ワークフロー: 実行の後の別ステップが、`safe_stops` が空でなければ
  `::warning title=SAFE STOP: REVISION_BURST_STOP (not a communication failure)::<指標>: 改定候補 N 点(上限 5)。書き込みなし。` を出し、`$GITHUB_STEP_SUMMARY` に表(指標・N・各点の from / to)を追記する。
  - 警告は、成功した実行の画面に黄色で出る。失敗(赤)ではない。
  - ステップは `if: ${{ !cancelled() }}` で、ジョブの結果に影響しない(`continue-on-error` は使わない、既存の規則と同じ)。
- 品質レポート: 「安全停止」を、取得の失敗(異常)とは別の見出しで、直近の実行の `details` から1行出す(**品質レポートの変更は実装時に要検討。この時点では変更しない**)。
- 繰り返し: 同じ入力なら次の実行でも再現して、同じ警告が毎回出る(人が確認するまで消えない — これは意図した動き)。
- 長所: 通信障害(skip・終了コード 0)・データ・内部エラー(終了コード 1・赤)とは、**タイトルと色(黄)で区別**でき、通常成功に埋もれない。終了コードの仕様を変えない。
- 短所: GitHub の「失敗の通知」(メール等)の対象にならない(警告は成功扱い)。通知が必要なら、案 B。

**案 B: 専用の終了コード(例 3)を使い、ワークフローが警告に変換する**
- ジョブが `REVISION_BURST_STOP` のとき `process.exitCode = 3`。ワークフローのステップで `rc=$?; if [ $rc -eq 3 ]; then echo "::warning …"; exit 0; fi; exit $rc` のように、3 だけを警告に変換して成功にし、1 はそのまま失敗にする。
- 長所: 「失敗(1)」「安全停止(3)」「成功(0)」が終了コードで区別できる。
- 短所: **終了コード仕様の変更**(HQの指示で、この時点では不可)。既存の呼び出し(`check_speech_schedule_steps.py` などの検査)との整合の確認が要る。

**案 C: 終了コード 1(失敗)にする**
- 長所: 失敗の通知が来る。
- 短所: 通信障害・内部エラーと**混同される**(HQの要件に反する)。再現するたびに失敗通知が繰り返される。**非推奨。**

**推奨と理由**: 案 A。「通常成功に埋没させない」(黄色の専用警告 + ステップの要約)と「通信障害と混同しない」(タイトル・色・項目が別)を、**終了コード仕様を変えずに**満たす。将来、失敗の通知のように扱いたければ、案 B に進める(その時点でHQの承認)。

#### 15.13.4 追加の注意(今回の調査で分かった既存の課題。**変更はしない**)
- 通信障害が現行では終了コード 0 で、通常成功に紛れる。`REVISION_BURST_STOP` の警告と区別するため、通信障害にも**別のタイトルの警告**(例 `FETCH_FAILED (communication)`)を出す案がある。これは既存の挙動の変更に当たるため、**別の判断**とする。
- dry-run の経路(`annotate_dryrun.py`)は `::notice` のみ。dry-run でも `safe_stops` を `::warning` にするかは、実装時に決める。

#### 15.13.5 テスト(案 A を採った場合)
- B1: N = 6 → 終了コード 0、status SUCCESS、`safe_stops` に1件、`event_revisions` 0行。
- B2: N = 5 → `safe_stops` は空、警告なし、5件を書く。
- B3: 通信失敗(`FETCH_FAILED`) → `safe_stops` は空(混同しない)。通信失敗の記録は従来のまま。
- B4: `counters.error` を伴う異常 → 終了コード 1(従来のまま)。`safe_stops` と同時に起きても、失敗が優先して残る。
- B5: 警告ステップが、ジョブの結果(成功・失敗)を変えない。
- B6: 警告の出力に、接続情報・キー・メールが含まれない。

### 15.14 HQ判断の反映(2026-11-13)

| 項目 | 判断 | 反映先 |
|---|---|---|
| 表示名 | `CA_CPI_TRIM`: **コアCPI（CPI-trim）** / `CA_CPI_MEDIAN`: **コアCPI（CPI-median）**(全角カッコ。14文字で 40字制約に収まる) | §2.2・§15.6(確定) |
| 重要度 | 両方 **MEDIUM**(`CA_CPI` は HIGH のまま) | §2.2・§15.6(確定) |
| `REVISION_BURST_STOP` | 安全停止として警告を明示する | §15.13(報告方法の案 A/B/C をHQが選ぶ) |
| バックフィル | **既定では実施しない**(§12 の既定のとおり。実施は別の承認) | §12 |
| StatCan 出典の書式 | `Adapted from`(コロンなし)/ `Source:`(コロンあり)。原文どおり | §15.5(確定) |

- §2.2 の表示名と重要度は「案」ではなく確定。最終の説明文(`description` / `key_points` / `market_view_*`)は、実装時に §2.2 の方針で書いてHQが確認する。
- バックフィルをしない場合の影響(§12): 公開開始から最初の6か月は、コアの改定検知の対象になる過去の月のイベントが無い(エラーにしない)。

### 15.15 提出(今回の更新)
- 変更は設計書だけ。実装・DB書き込み・マイグレーション実行・CI・DEV反映・main統合・PROD変更はしていない。終了コード仕様も変更していない。
- 次の判断(HQ): ① `REVISION_BURST_STOP` の報告方法(案 A 推奨)、② 実装範囲と開始、③ A への追加確認(`notice` の対象月、実機確認)。


---

## 16. 第3版で追加・確定した仕様(Cの第2回独立レビュー・HQ判断 2026-11-13 への対応)

**この節の位置づけ**: 設計書の修正と静的な確認だけ。実装・DB書き込み・SQL実行・マイグレーション実行・CI・DEV反映・main統合・PROD操作・workflow の有効化やスケジュール変更・バックフィルは、していない。§0〜§15 と食い違えば、この節が正。

### 16.0 指摘と、本文の修正箇所の対応

| 指摘 | 直した本文(節) | 新規仕様(節) | テスト |
|---|---|---|---|
| P1-1 `releaseTime` の照合 | §4.3(経路 A / B に書き換え)、§9.2、§14.5(T16 追加)、§15.4 | §16.1 | R1〜R10 |
| P1-2 初回値保存と `REVISION_BURST_STOP` の分離 | §6.3 の 7、§14.5、§15.4、§9.4 | §16.2 | D1〜D10、T5・T13 |
| P2-1 年次再計算と6件の根拠 | §6.3 の 7 | §16.4 | A1〜A5 |
| P2-2 vector 単位の部分失敗 | §5.4、§6.3 の 5、§9.2、T13 | §16.3 | F1〜F12 |
| P2-3 11/16 以降の初回値の運用 | §5.6 | §16.6 | O1〜O8 |
| P2-4 7日期限の設定漏れ検出 | §5.6、§14.1、§15.2 | §16.7 | V1〜V8 |
| P3 副作用・原子性・監査 | — | §16.8・§16.9 | E1〜E6、W1〜W8 |
| StatCan の年次改定方針(通常月と年次改定の分離、36か月検知) | §6.3 の 7、§14.5 | §16.4・**§16.14** | Y1〜Y20 |
| **第4版 P1-1** 年次改定候補の固定化(固定記録・承認・書き込みの記録) | §14.5 | **§16.14.5・§16.14.6** | Z20〜Z24 |
| **第4版 P2-1** 取得点数 `latestN: 49` | §4.2・§6.1 | **§16.14.2** | Z1〜Z11 |
| **第4版 P2-2〜P2-5** 比較元の区別・承認の受け渡し・部分承認・途中失敗の再開・却下保留の解除・N の統一・フラグの整理 | §14.5・§15.4・§16.2 | **§16.14.3〜§16.14.8** | Z12〜Z19、Z25〜Z44 |
| **第4版 残指摘** 旧6か月の記述・運用担当と週末祝日・11/16 の未解決 | §6.3・§13・§14.8 | **§16.6・§16.12** | O9・O10 |
| **第5版** 2段階分離(第1段階 = 初回値の取り込み、第2段階 = 改定検知・承認・書き込み) | — | **§16.15** | G1〜G12 |
| **第5版 P2-1〜P2-6・P3** | §14.5・§15.4 | **§16.14.3〜§16.14.8・§16.16** | H・I・R・A・D |
| 出典の reference date(A案) | §9.5、§14.7、§15.5、§15.7、§15.10 | §16.5 | N1〜N14 |
| A の確認結果 | §15.0、§15.9、§15.7 | §16.11 | — |
| `REVISION_BURST_STOP` 案A | §15.4、§15.13 | §16.10 | B1〜B6、S1〜S4 |

### 16.1 P1-1: `releaseTime` の照合は「初回値の最新点」だけ。過去点の改定検知では使わない

**実データでの確認(2026-11-13、WDS `getDataFromVectorsAndLatestNPeriods`、`latestN: 8`)**
- vector 108785715(trim)・108785714(median): 8点(`refPer` 2026-02〜2026-09)の `releaseTime` が**すべて `2026-10-19T08:30`**(直近の公表の時刻。過去の月の点にも、その月の元の公表日ではなく、直近の公表の日付が入る)。`statusCode`・`symbolCode` はすべて 0、`decimals` は 1。
- vector 41690973(ヘッドライン、`latestN: 13`): 点ごとに `releaseTime` が違う(13点で13通り。各月の元の公表日)。
- したがって、**過去点の `releaseTime` を、その月の公表予定日と照合する実装は、コア2系列で全点が不一致になり、改定を1件も検知できない**。

**分離の設計**
| | 経路 A: 初回値の保存 | 経路 B: 過去点の改定検知 |
|---|---|---|
| 対象 | 対象月の最新点1つ | 直近7点のうち、初回値が保存済みの月 |
| `releaseTime` ↔ `releaseDate` の照合 | **する**(最新点の日付 = 公表予定日) | **しない** |
| 照合する項目 | 公表日・対象月・単位・数値・`statusCode`・`vectorId`・期限 | `vectorId`・`refPer`(= イベントの対象月)・数値・`statusCode`・`symbolCode` |
| 関数 | `evaluateFirstValue`(案) | `detectRevisions`(案) |
| 失敗の影響 | その系列のその回の初回値を保存しない(PENDING) | その点を `INVALID` として除外。他の点は続ける |
- 2つは**別の関数・別のモジュール**にし、共通にするのは「応答の読み取り(`vectorId`・`refPer`・値・`statusCode` の取り出し)」だけ。経路 B のモジュールは `releaseTime` の項目を**参照しない**(テスト R10 で、ソースに `releaseTime` の文字列が無いことを検査)。
- 経路 A が `releaseTime` を使う理由: 「次の公表で改定された後の値を初回値として保存しない」ための歯止め。コア2系列は、次の公表の後は**全点の `releaseTime` が次の公表の日付になる**ので、前の月の `releaseTime` が前の公表日と合わなくなり、自然に保存されない(R4)。

**固定テストデータ(実データに近い形)**: `tests/fixtures/wds-core-real-shape-2026-11-13.json`(案)。上の実応答の形をそのまま使う。

| series | refPer → value(8点、すべて `releaseTime` = `2026-10-19T08:30`、`statusCode` = 0) |
|---|---|
| trim (108785715) | 2026-02: 2.3 / 03: 2.2 / 04: 2.0 / 05: 2.0 / 06: 1.9 / 07: 1.9 / 08: 1.9 / 09: 1.8 |
| median (108785714) | 2026-02: 2.3 / 03: 2.3 / 04: 2.1 / 05: 2.1 / 06: 1.9 / 07: 2.0 / 08: 2.0 / 09: 1.9 |

**テスト(実装時)**
| # | 状況 | 期待 |
|---|---|---|
| R1 | 上の trim の8点(全点 `releaseTime` 同一)。DB に保存済みの値が、3か月分だけ違う | 経路 B が **N=3**、3件の改定を書く(`releaseTime` を判定に使わない) |
| R2 | R1 と同じ。各月のイベントの公表予定日は、それぞれの月の元の公表日(`releaseTime` と一致しない) | 経路 B は公表日の不一致で除外**しない**(`NOT_RELEASED_OR_DATE_MISMATCH` が出ない) |
| R3 | 経路 A: 対象月 2026-09、`releaseDate` = 2026-10-19、最新点の `releaseTime` = 2026-10-19 | 保存する(PUBLISH) |
| R4 | 経路 A: 全8点の `releaseTime` が次の公表の日(`2026-11-16T08:30`)で、2026-09 のイベント(公表日 2026-10-19)にまだスナップショットがない | 保存しない(`NOT_RELEASED_OR_DATE_MISMATCH` または期限)。改定後の値を初回値にしない |
| R5 | ヘッドライン型(点ごとに `releaseTime` が違う)の13点 | 経路 A・B とも動く |
| R6 | 経路 B: ある1点だけ `statusCode` = 1 | その点だけ `INVALID`。他の点の検知は続く |
| R7 | 経路 B: `vectorId` が期待と違う | その系列の経路 B 全体を止める(他系列は続く。§16.3) |
| R8 | 経路 B: ある点の `refPer` が、どのイベントの対象月とも合わない | その点だけ `NO_EVENT` / `INVALID`。他は続く |
| R9 | 経路 B: 過去点に `releaseTime` が無い(null / 欠落) | 動く(経路 B は `releaseTime` を必要としない)。経路 A は最新点に `releaseTime` が無いと保存しない |
| R10 | 静的検査: 経路 B のモジュールのソースに `releaseTime` が現れない | 現れたらテスト失敗(構造で分離を担保) |

### 16.2 P1-2: 初回値の保存は `REVISION_BURST_STOP` の停止対象外。停止するのは該当系列の改定の書き込みだけ

**処理の流れ(1回の実行、1系列)**
```
[取得・検証フェーズ] 3系列(CA_CPI・TRIM・MEDIAN)を取得して構造を検証。書き込みなし(§16.3)
        ▼
[系列ごと。互いに独立]
  1. 経路 A: 初回値の保存(対象月の最新点、受付期間内、§4.3 の照合が通れば)
        │   ← 改定検知の結果に依存しない。先に実行する
        ▼
  2. 経路 B: 改定検知(直近7点)
        ├─ N ≤ 5 → 件数ぶん event_revisions を書く
        └─ N ≥ 6 → 書かない。REVISION_BURST_STOP を記録(safe_stops)
        ▼
[報告] 初回値の保存結果 / 改定の結果 / safe_stops / 期限の警告
```
- **止まるもの**: 該当系列(N ≥ 6 になった系列)の、その実行の**改定の書き込み**だけ。
- **止まらないもの**: ① 同じ実行での、その系列の初回値の保存(手順 1 は手順 2 より先で、依存しない)、② もう一方のコア系列、③ ヘッドライン `CA_CPI`、④ 他の指標(GB・AU・CA 失業率・JP_CPI など)。
- 初回値の保存の失敗(DB エラー等)は、改定検知を止めない(逆も同じ)。どちらも `counters.error` として別に記録。

**停止の記録(必須。stdout JSON の `safe_stops` と `ingestion_logs.details`)**
`code`(`REVISION_BURST_STOP`)/ `indicator` / `n`(候補件数)/ `limit`(5)/ `periods`(候補の対象月の一覧)/ `points`([{period, from, to}])/ `reason`(停止理由の固定文言)/ `first_value_saved`(同じ実行で初回値を保存したか。true / false / not_applicable)/ `observed_at`。

**人による確認・解除・再実行(誰が・何を・どの順で)**
停止は DB に保存される状態ではなく、**実行のたびに評価される**。「解除」は、確認の後の**承認つきの再実行**(または、データが落ち着いて N ≤ 5 になること)を指す。

| 手順 | 担当 | 内容 |
|---|---|---|
| 1 検知 | 実行担当(手動実行をした人)+ B | 実行後に Actions の run ページで黄色 warning と Step Summary を確認。B は注記(`::warning`)をチェック API で読み、`safe_stops` を取り出す |
| 2 証拠の収集 | B(読み取り専用) | ① The Daily 表4(`.../<日付>/t004a-eng.htm`)の直近6か月と、DB の直近値・停止時の from/to を突き合わせる ② `vectorId` が期待どおりか ③ 18-10-0259-01(更新が遅れている場合あり)と比べる ④ 年次再計算の可能性(§16.4)に当たるか ⑤ 変化の幅(これまで観測した改定は ±0.1。±0.2 を超えるなら要注意) |
| 3 判定 | C(独立確認)+ HQ | (a) 正当(年次再計算など、公式の方針で説明できる)/ (b) データ異常(取り違え・WDS の不具合)/ (c) 不明。(c) は書かない。StatCan(Consumer Prices Division)への問い合わせを検討 |
| 4 承認 | HQ | (a) の場合だけ、**その系列・その公表日に限った**再実行を承認する。承認の根拠・日時・承認者を記録 |
| 5 再実行 | 実行担当(**未確定**。§16.6) | 承認つきの書き込み(`apply-approved-revisions`、承認IDだけを渡す。**新しいコード・手動 target が必要で、今は無い**。`--allow-revision-burst` は廃止、承認つき書き込みの1つに統一。§16.14.6)。通常月の `STOP_BURST` も、固定記録 + 承認で扱う |
| 6 確認 | B(読み取り専用) | `event_revisions` が N 件だけ増えたこと、他のイベントの fingerprint が不変、初回値が不変、再実行しても増えないこと |

- 承認つき書き込みの仕組みが実装されるまでは、停止した系列の改定は書かれないまま。初回値の保存は止まらない。
- (b)(c) の場合は上書きしない。データが落ち着くか原因が分かるまで、毎回の実行で同じ警告が出る(意図した動き)。

**7日期限後の初回値の扱い(自動救済しない)**
- 受付期間(公表日から Toronto の暦日で7日。§16.7)を過ぎた回は、`TOO_LATE_FOR_FIRST_RELEASE` で**書かず PENDING のまま**。次の実行でも自動では保存しない。
- 救済するには、**別途HQの承認**が必要。承認の条件:
  1. HQが、対象イベントの ID・指標・対象月を示して、書面(指示)で承認する。
  2. 初回値の根拠を、公式の公表日の記事(The Daily の本文・表4の最終列)から取り、WDS の現在値(改定後かもしれない)を初回値として使わない。ヘッドラインは、改定されない公式文言が未確認のため、同様に The Daily で確かめる。
  3. パイプラインの通常の経路ではなく、**単発の手順**(別の承認・別のスクリプト・dry-run つき)で行う。実装は今は無い。
  4. 記録: `captured_at` は実際の保存時刻、`verification_source` に「期限後・HQ承認」の旨を残す。
  5. 保存後に読み取り専用で確認。
- 11/16 の公表への適用は §16.6。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| D1 | trim が N=6、対象月が新しい(初回値が未保存) | **trim の初回値は保存される**。trim の改定は0件。`safe_stops` に trim |
| D2 | trim が N=6、median は N=2 | median の初回値と改定2件は書かれる。trim の改定だけ停止 |
| D3 | trim が N=6 | ヘッドライン `CA_CPI` の初回値の保存は影響を受けない |
| D4 | 初回値の保存が DB エラーで失敗 | 経路 B は実行される(依存しない)。エラーは別に記録 |
| D5 | dry-run で、初回値あり + N=6 | plan に PUBLISH と停止が両方出る。書き込みなし |
| D6 | 停止の後、承認つきの再実行 | 改定が N 件書かれる。もう一度実行しても増えない |
| D7 | 受付期間を過ぎた対象月 + 同じ実行で N ≥ 6 | 初回値は保存されない(`TOO_LATE_FOR_FIRST_RELEASE`)。改定は停止。2つの理由が**別々に**記録される |
| D8 | 停止の記録の項目 | `code`・`indicator`・`n`・`limit`・`periods`・`points`・`reason`・`first_value_saved`・`observed_at` がそろう |
| D9 | N ≥ 6 だけで他のエラーがない | 終了コード 0、status SUCCESS(通信失敗・内部エラーと混ざらない) |
| D10 | 停止の後のデータが落ち着き、N ≤ 5 になった実行 | 通常どおり N 件書かれる(停止は状態を持たない) |

### 16.3 P2-2: vector 単位の部分失敗(系列ごとの独立と、全体停止の条件)

**系列**: `CA_CPI`(vector 41690973)・`CA_CPI_TRIM`(108785715)・`CA_CPI_MEDIAN`(108785714)。取得は**系列ごとに1回のリクエスト**(既存の `OFFICIAL_VALUE_SOURCES` と同じ。1つの失敗が他の系列の取得を妨げない)。

**フェーズ**: ① 取得・構造の検証(書き込みなし)→ ② 全体停止かどうかの判定 → ③ 系列ごとに経路 A・B(書き込み)→ ④ 報告。

| ケース | 検知 | 止める範囲 | 他の系列 | 記録・終了コード |
|---|---|---|---|---|
| 特定 vector の取得失敗(通信・HTTP・タイムアウト) | リクエストの例外 | **その系列のみ** | 継続 | `FETCH_FAILED`(skip、従来どおり終了コード 0) |
| 特定 vector の `status` ≠ SUCCESS | その項目の `status` | **その系列のみ** | 継続 | `FETCH_FAILED`(skip) |
| `vectorId` の不一致 | 応答の `object.vectorId` ≠ 期待 | **その系列のみ** | 継続 | `SERIES_MISMATCH`(`counters.error`。本来起きない異常。終了コード 1、他系列の書き込みは完了) |
| 対象月の不一致(経路 A: 最新点が対象月でない) | `refPer` ≠ `referencePeriod` | **その系列のその回の初回値のみ**(経路 B は動く) | 継続 | `PERIOD_MISMATCH`(skip) |
| 対象月の不一致(経路 B: 点が既存イベントと合わない) | `refPer` | **その点のみ** | 継続 | `NO_EVENT` / `INVALID` |
| 点の値の不正(null・非数・`statusCode` ≠ 0) | 点ごと | **その点のみ** | 継続 | `INVALID_VALUE`(skip) |
| **応答全体が解析不能**(JSON でない・配列でない・空) | 構造の検証 | **CA_CPI 系の3系列すべて**(全体停止) | 3系列は停止。他の指標(GB・AU・CA 失業率・JP_CPI)は独立で継続 | `RESPONSE_UNPARSABLE`(`counters.error`、終了コード 1) |
| **系列を識別できない**(`SUCCESS` なのに `vectorId` が無い等) | 構造の検証 | **CA_CPI 系の3系列すべて** | 同上 | `SERIES_UNIDENTIFIABLE`(`counters.error`) |
| 指標の行・公表予定の表が無い、DEV 以外への接続 | 既存の検査 | 既存どおり(ジョブ全体) | — | 既存どおり |

- 「全体」= CA_CPI 系の3系列(ヘッドライン + コア2)。構造が壊れた応答は、StatCan 側の不具合を疑うべきなので、残りの2系列も安全側に倒す。他の指標ファミリーは、取得元が別なので止めない。
- 他系列の継続の条件: 自分の取得が成功し、構造の検証を通っていること、DB が使えること。
- **矛盾の解消**: 旧 §9.2「`vectorId` が期待と違う → 実行全体を中止」と、旧 T13「系列ごとに独立」は食い違っていた。第3版で、**`vectorId` 不一致はその系列のみ**(上の表)、**構造の破壊だけが3系列の全体停止**、に統一した(§9.2・T13・§6.3 を書き換え済み)。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| F1 | trim だけ HTTP 失敗 | trim は書かない。median とヘッドラインは通常どおり |
| F2 | median の `status` = FAILED | median のみ停止。他は通常 |
| F3 | trim の応答の `vectorId` が median の値 | trim のみ停止(`SERIES_MISMATCH`)。median は通常。trim の値を median に入れない |
| F4 | 3系列とも `vectorId` が入れ替わっている | 3系列とも停止(各系列が `SERIES_MISMATCH`)。何も書かない |
| F5 | ヘッドラインの応答が JSON でない | CA_CPI 系3系列すべて停止(`RESPONSE_UNPARSABLE`)。他の指標(GB・AU)の処理は続く |
| F6 | median の応答が空配列 | 3系列すべて停止(`RESPONSE_UNPARSABLE`) |
| F7 | trim の応答に `vectorId` が無い(`SUCCESS`) | 3系列すべて停止(`SERIES_UNIDENTIFIABLE`) |
| F8 | trim の最新点が次の月(対象月でない) | trim の初回値のみ保存しない。経路 B は動く。他は通常 |
| F9 | median の1点だけ `statusCode` = 1 | その点だけ除外。median の他の点・初回値は通常 |
| F10 | ヘッドラインの12か月前の点が無い | ヘッドラインの初回値のみ保存しない(`INVALID_VALUE`)。コア2は通常 |
| F11 | trim が N=6(改定停止)、median は `FETCH_FAILED` | trim の初回値は保存、改定は停止。median は何もしない。2つの理由は別々に記録 |
| F12 | `SERIES_MISMATCH` と `REVISION_BURST_STOP` が同時 | 終了コードは 1(エラーが優先して残る)。`safe_stops` と `errors` が別の項目 |

### 16.4 P2-1: StatCan の年次改定方針と、6件閾値の根拠(第3版・追補で書き換え)

**公式に確認できた事実**(Statistics Canada、2026-11-13 に原文を取得)
1. **事前の告知** — The Daily 2026-01-19「Consumer Price Index, December 2025」の Note to readers「Upcoming change to the revision policy for CPI-median and CPI-trim」: 「**With the release of the January 2026 Consumer Price Index on February 17**, Statistics Canada will implement an updated revision policy … **As of the January 2026 release, revisions will extend back three years, on an annual basis, with each January release, while for all other months, CPI-median and CPI-trim will be revised for one historical month.**」
2. **実施の通知** — The Daily 2026-02-17「Consumer Price Index, January 2026」の「Change to the Revision Policy for CPI-Median and CPI-Trim」: 「**With today's release** … implemented an updated revision policy」「Previously … revised over a seven-year historical period with each release. With this release onwards, revisions will extend back three years, on an annual basis, with each January release, while for all other months … revised for one historical month.」
3. CPI-median と CPI-trim は季節調整済みデータから計算される。方針は季節調整済みデータの表 18-10-0006-01 と揃える。**季節調整のモデルのパラメータは変えない**。**CPI-common の改定方針は変わらない**(季節調整データを使わない)。
4. 実時間表 18-10-0259-01 は「3月2日に更新」と書かれており、**公表より更新が遅れる**。
5. **用語の確認**: 公式の文言は、2026-02-17 に公表された **「1月分(January 2026)」の CPI** を「the January 2026 release」と呼んでいる。つまり公式の言う「January release」は、少なくとも 2026 年の例では**対象月が1月の公表**(公表日は2月)を指している。

**公式資料からは確認できていないこと(確認済みとして扱わない)**
1. 「each January release」が、**毎年**「対象月が1月の公表」を指すという**一般則**(公式文言は同じ表現を使うが、実例は2026年の1回だけ)。
2. 年次改定の**日付の規則**(公表日が毎年2月の第何週か等)。公式の改定カレンダーは、今回の調査では見つかっていない。
3. 3年の範囲の厳密な定義(「3年前まで」が、公表月から36か月か、対象月から36か月か)。
4. ヘッドライン CPI(18-10-0004-01)の改定。公式の「改定されない」文言は未確認のまま。

**2026年の実績からの推定(事実と区別する)**
- **推定**: 次の年次改定は、**対象月が2027年1月の公表**。DEV の `CA_CPI` の `2027-01` のイベントは **2027-02-16**(StatCan の公表予定)。これは一般則の推定にすぎない。**日付だけで年次改定と判定しない**(§16.14.2)。

**新方針の下で観測された改定(18-10-0259-01。Cの実測を引用し、B が同じ表で独立に再現した)**

| 公表日 | 区分 | median | trim | common(新方針の対象外) |
|---|---|---|---|---|
| **2026-02-17**(1月分。**年次改定**) | 改定された月数(重なる全期間) | **14か月**(2023-04〜2025-12) | **6か月**(2024-05〜2025-06) | 4か月(2020-06〜2022-09) |
| | 直近6か月(設計の通常月の窓)で改定された月数 | **3** | **0** | 0 |
| 2026-03-16(2月分。通常月) | 改定された月数 | 0 | 0 | 3(参考。取得点数の制限で過小の可能性) |
| 2026-04-20(3月分。通常月) | 改定された月数 | 0 | 0 | 1(参考。同上) |
- 年次改定の median / trim の変更月は、**すべて対象月から36か月以内**に収まっていた(2026-01 の36か月前 = 2023-02 より後)。公式の「3年」と整合する(1回の観測)。
- 年次改定では、変更は**連続した月ではなく、散らばっていた**(median: 14か月が 2023-04 から 2025-12 に散在)。直近7点の窓では、median 3件・trim 0件しか見えない。**窓を広げなければ、年次改定の大半を検知できない**。
- 通常月の2回(3月・4月)は、median / trim とも**0件**(公式の「履歴の1か月分」より少ない観測)。
- **新方針の下の観測は3回(2026-02・03・04)だけ**。5〜10月分は実時間表が更新待ちで、見られていない。

**旧方針(参考。新方針下の正常な改定件数の根拠としては使わない)**: 2024-10〜2026-01 の16回は、各公表で7年分が改定されていた旧方針の実績で、**新方針の通常月・年次改定の件数の根拠にならない**。参考として、直近6か月の改定数は median が最大6、trim が最大5(旧方針下)。

**通常月の6件閾値(N ≥ 6)の位置づけ(暫定評価)**
1. **維持する**(HQ決定: 現行の比較窓を暫定維持)。
2. 根拠は、公式の方針(**通常月は履歴の1か月分だけ改定**)と、新方針下の通常月の観測(0件・0件)。通常月に直近6か月がすべて動くのは、方針からも観測からも想定外で、取り違え・取得異常・方針の変更のいずれかを疑う。
3. **閾値の妥当性は暫定**: 新方針下の観測が3回しかなく、通常月は2回だけ。再評価は、新方針の下の実績が増えた後(例: 12回以上)に、HQの判断で行う。**根拠がない状態で閾値を変えない**。
4. **年次改定の36か月検知とは別のルール**。年次改定で6件を超えても、通常月の安全停止(`REVISION_BURST_STOP`)は適用しない(§16.14)。
5. 通常月のルールは「**想定外の多数改定**」の検知、年次改定のルールは「**想定される大量改定**を人が確認して書く」ための手順。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| A1 | 通常月で、直近6か月がすべて改定された入力 | 通常月の安全停止(`REVISION_BURST_STOP`)。初回値は保存される |
| A2 | 通常月で、5点が改定 | 全件書く(境界) |
| A3 | A1 の後、承認つきの再実行 | 書かれる。再実行しても増えない(§16.14.7) |
| A4 | 閾値の定数 | 1か所。変更時にテストが境界の両側(5・6)で失敗する |
| A5 | 年次改定の入力(§16.14.10 の固定データ) | `REVISION_BURST_STOP` ではなく `ANNUAL_REVISION_REVIEW`(通常月のルールを適用しない) |

### 16.5 StatCan の reference date(A案で確定): `attribution.notice` に対象月を含める

**HQ決定(2026-11-13)**: A案。`attribution.notice` に StatCan の reference date(統計対象月)を埋め込む。
1. 対象月は**バックエンド内部の対象月(`reference_period`)から取る**。
2. **公開 API に新しい `reference_period` のフィールドは足さない**。
3. **iOS のモデル・表示・ロック制御の変更は不要**。既存の attribution の表示経路を使う。
4. FREE / PRO の**ロック状態にかかわらず**、対象月を含む出典文を表示する。
5. **対象月と公表日を明確に区別する**。
6. 対象月が欠落・不正なら、推測値を出典文に埋め込まない。
7. 英文の対象月表記は `October 2026` の形を基本とする。

**ライセンスの原文との対応**(https://www.statcan.gc.ca/en/terms-conditions/open-licence、2026-11-13 に取得)
- 「**Source: Statistics Canada, name of product, reference date. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.**」→ コア2指標。
- 「**Adapted from Statistics Canada, name of product, reference date. This does not constitute an endorsement by Statistics Canada of this product.**」→ ヘッドライン(計算値)。
- どちらも `name of product, reference date` を含む。notice に**製品名(表の番号と題名)と対象月**の両方を入れることで、原文の要件に沿う。**API の別フィールドに対象月があるだけでは、利用者に見える出典表示の要件を満たしたとは判断しない**(HQ指示)。
- 未確認: StatCan が `reference date` として「月」の粒度(`October 2026`)を十分とみなすか。月次統計の通常の引用の粒度だが、StatCan に確認していない。

**notice の最終案**(`October 2026` は例。対象月がその月の場合)
| 指標 | notice |
|---|---|
| `CA_CPI` | `Adapted from Statistics Canada, Table 18-10-0004-01 Consumer Price Index, monthly, not seasonally adjusted, October 2026. This does not constitute an endorsement by Statistics Canada of this product.` |
| `CA_CPI_TRIM`・`CA_CPI_MEDIAN` | `Source: Statistics Canada, Table 18-10-0256-01 Consumer Price Index (CPI) statistics, measures of core inflation and other related statistics - Bank of Canada definitions, October 2026. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.` |
- `Adapted from` はコロンなし、`Source:` はコロンあり(原文どおり)。

**対象月の取得元と検証(内部)**
- 第一の取得元: イベントの `provider_event_id` の最後の部分(`statcan_release_schedule:CA_CPI:2026-10` の `2026-10`。StatCan の公表予定の key は対象月)。
- スナップショットがあるときは、`verification_source`(`v108785715@2026-10` の `@` の後)と**一致**すること。食い違えば不正とみなす。
- 形式: `^\d{4}-(0[1-9]|1[0-2])$`。年は 2000〜2100。対象月は、イベントの `release_datetime` の月**以前**(未来の対象月は不正)。
- 表記: 固定の英語の月名の表(`January`〜`December`)で `<月名> <年>`。ロケール・タイムゾーン・実行環境に依存しない(`Intl` は使わない)。
- **対象月と公表日の区別**: notice に入れるのは対象月だけ。公表日は `release_datetime`(別の項目)のままで、notice には入れない。例: 2026-11-16 に公表される 2026年10月分の CPI の notice は `October 2026`(`November 2026` ではない)。

**対象月が欠落・不正のとき**
- 月の部分を**入れない**(`…, Bank of Canada definitions. Reproduced …` のように、日付なしの基本形)。**推測した月を入れない**。公表日の月・前月・今日の日付・最新の月へのフォールバックはしない。
- 同時に、エラーとして記録(`ATTRIBUTION_REFERENCE_PERIOD_INVALID`、イベント ID・指標。値は出さない)。
- RELEASED の回は、パイプラインが「対象月の照合が通った値だけ」を保存するので、不正な対象月は本来到達しない(データの破損でのみ起きる)。

**適用する場所と、しない場所(コード上の確認、`attributionForIndicator` の呼び出し)**
| 場所 | 対象月つき | 理由 |
|---|---|---|
| `GET /events/{id}`(通常・ロック中の両方) | する | 値(または予定)をイベント単位で出す |
| `GET /calendar`・Home のイベント行 | する | イベントごとに値を出す |
| `GET /indicators`(一覧・詳細) | **しない**(基本形) | 値を出さない指標のマスター。対象月が無い。**A に再確認**(§16.11) |
- 同じ指標の `attribution` が、画面によって「対象月あり / なし」になる。どちらも項目と型は同じ。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| N1 | `CA_CPI`、`…:CA_CPI:2026-10` | notice が上の文字列(`October 2026`)と**完全一致** |
| N2 | `CA_CPI_TRIM` | 同上(`Source:` 形) |
| N3 | `CA_CPI_MEDIAN` | 同上 |
| N4 | `CA_CPI` | `Adapted from` で始まり、`Source:` で始まらず、`as is` を含まない |
| N5 | コア2指標 | `Source:` で始まり、`Adapted from` を含まず、`as is` を含む |
| N6 | 公表日 2026-11-16、対象月 2026-10 | `October 2026` を含み、`November 2026` を含まない |
| N7 | FREE のロック中の発表 | 値は null、notice は対象月つきで出る |
| N8 | PRO / 見られる範囲 | 同じ notice |
| N9 | 予定のみ(値なし) | key の対象月で notice が出る |
| N10 | 不正な対象月(`2026-13`・空・`abc`・null・key とスナップショットの食い違い・未来の月) | 月なしの基本形。**年・月名が一切入らない**。エラー記録が出る |
| N11 | `GET /indicators` | 対象月なしの基本形。応答の形は不変 |
| N12 | 公開 API のスキーマ | `/events`・`/calendar`・`/indicators` に `reference_period` のフィールドが**無い** |
| N13 | 実行環境のロケール・TZ を変える | notice が変わらない |
| N14 | `CA_UNEMPLOYMENT_RATE` | 変更なし |

### 16.6 P2-3: 初回値取得の運用(手動実行。定期実行の追加・変更はしない)(第4版で再設計)

**11/16 の公表に対する現実の整理(第4版でも未解決のまま。今回の修正で解決したと扱わない)**
- ヘッドライン `CA_CPI` の 2026-10 分のイベントは、DEV に**すでにある**(SCHEDULED)。
- **コア2指標のイベントは、まだ DEV に無い**(指標の行もない)。公表予定の取り込み(`ingest:gb-au-ca-schedules`)は、**公表時刻を過ぎた回を作らない**(`past_release`)。したがって、**11/16 08:30 ET(13:30Z)より前に、マイグレーションと予定の取り込みが DEV に入っていなければ、コア2指標の 11/16 分のイベントは作られず、初回値も保存できない**。
- 現状は設計書の確認段階で、実装の承認も出ていない。コア2指標の 11/16 分は、**通常の経路では間に合わない見込み**。後から入れる場合はバックフィル(既定でしない、別の承認)。**コアの最初の対象は、次の公表(2026-12-14)**。
- ヘッドラインの 11/16 分は、実装・テスト・CI・DEV 反映が **2026-11-23(Toronto の D+7)までに**終われば受付期間内に保存できる。間に合わなければ期限切れとなり、HQ承認の別手順(§16.2)になる。
- **この問題は未解決**(上の見込みは変わらない)。

**役割(第4版: 実行担当を決めつけない)**
実行担当を「大野さん」と決めつけない。**実行担当・副担当・週末の当番は、HQ・大野さんと未合意のため「未確定」**とする。役割は氏名でなく、必要な権限で定義する。
| 役割 | 必要な権限・条件 | 担当 |
|---|---|---|
| 実行担当 | GitHub Actions の手動実行(`workflow_dispatch`)ができる(リポジトリの書き込み権限)。B は `gh` を持たず、手動実行ができない | **未確定**(候補は HQ・大野さんと合意して決める) |
| 副担当(週末・祝日の代行) | 実行担当と同じ権限。連絡が取れる | **未確定** |
| 確認担当(一次) | 読み取り専用の確認(dry-run・チェック API の注記の読み取り) | B(現状。ただし B の稼働日・時間帯は常時ではない) |
| 確認担当(独立) | 結果の独立確認 | C |
| 承認 | 書き込みの実行ごとの事前承認 | HQ |
- **担当が決まるまで、書き込みの実行はできない**(手動実行する人がいない)。決まっていない間は、運用を「担当未確定」と報告に明記する。

**手順(公表日 D。例: 2026-11-16 08:30 ET = 13:30Z。夏時間の期間は 12:30Z)**
| # | 時点 | 担当 | 内容 |
|---|---|---|---|
| 1 | D の公表の約15分後 | 確認担当(B)(または実行担当) | `official-values-dry-run`(読み取り専用)。plan に各系列の `PUBLISH`(対象月・値)が出るか |
| 2 | 同日 | B + C | **書き込み前の検証項目**(下)。The Daily の本文・表4と突き合わせ |
| 3 | 同日 | HQ | 検証結果を見て、書き込みの実行を承認(承認がなければ書かない) |
| 4 | 承認後 | 実行担当 | `official-values` を手動実行。実行後に Actions のページで警告(黄色)・Step Summary を確認 |
| 5 | 直後 | B | 読み取り専用で、保存結果を確認(下) |
| 6 | D+1(営業日) | B | もう一度 dry-run。**全件 UNCHANGED**、`same_day_diff` が無いこと(誤った初回値の早期発見。§16.9) |
| 7 | 下の「週末・祝日」の確認日 | B | 期限間近の確認 |

**書き込み前の検証項目(手順 2)**
1. イベントと指標が一致(`provider_event_id` の指標コードと対象月)。
2. 値: ヘッドラインは The Daily 本文の「rose/increased X% year over year in <月>」と一致。コアは表4の最終列と一致。
3. 単位が `%`。小数第1位。
4. 対象月が、公表された月(例: 公表日 11/16 → 2026-10)。公表日の月と取り違えていない。
5. 初回値か(`PUBLISH`、`REVISE` ではない)。前回値・予想値が混ざっていない(`previous`・`forecast` が null)。
6. `vectorId` が期待どおり(41690973・108785715・108785714)。
7. 書き込み予定の件数 = 期待の件数(存在するイベントの数)。
8. エラー・重複が 0。`safe_stops`・`revision_reviews` が空、`same_day_diff` が空。

**保存後の確認(手順 5。読み取り専用)**: 該当イベントが RELEASED・AVAILABLE、スナップショット(`forecast`・`previous` が null、単位 `%`、`verification_source` が `v…@<対象月>`)、`event_revisions` が 0(初回の回)、既存イベントの fingerprint が不変、重複なし。

**期限間近の検出(未取得イベント)**
- 対象: `release_datetime` が過ぎ、RELEASE スナップショットがなく、`status` が SCHEDULED のイベント。
- `daysAfter`(Toronto の暦日の差、§15.2)が **5・6・7** のとき、**期限間近**。ジョブの出力に `deadline_warnings: [{indicator, provider_event_id, daysAfter, deadline_local_date}]` を出し、黄色 warning(`FIRST_VALUE_DEADLINE (n days left)`)と Step Summary に載せる(終了コードは変えない)。`daysAfter` ≥ 8 は期限切れ。
- ジョブは手動実行しかないので、警告は誰かが実行しないと出ない。確認日を、次の表のとおり**営業日で逆算**して置く。

**週末・祝日の対応(第4版で追加)**
- 7日の期限は**暦日**(週末・祝日を含む)。運用側で、営業日に置き換えて逆算する。
- 期限は Toronto の D+7 の 23:59:59。日本時間では**翌日の 13:59(冬時間 EST)/ 12:59(夏時間 EDT)**まで。

| 公表日 D | D の曜日 | D+1 | D+4 | D+5 | D+6 | **D+7(期限日、Toronto)** | 日本の祝日との重なり |
|---|---|---|---|---|---|---|---|
| 2026-11-16 | 月 | 11/17 火 | **11/20 金** | 11/21 **土** | 11/22 **日** | **11/23 月** | **勤労感謝の日(日本の祝日)** |
| 2026-12-14 | 月 | 12/15 火 | **12/18 金** | 12/19 **土** | 12/20 **日** | **12/21 月** | なし |
| 2027-01-18 | 月 | 01/19 火 | **01/22 金** | 01/23 **土** | 01/24 **日** | **01/25 月** | なし |
| 2027-02-16 | 火 | 02/17 水 | 02/20 **土** | 02/21 **日** | 02/22 月 | **02/23 火** | **天皇誕生日(日本の祝日)** |
| 2027-03-15 | 月 | 03/16 火 | **03/19 金** | 03/20 **土** | 03/21 **日** | **03/22 月** | 春分の日の振替休日の可能性(**要確認**) |
- **月曜の公表の回は、D+5・D+6 が必ず土日**になる(5回中4回)。D+5・D+6 に確認日を置いても、誰も動けない可能性がある。
- 確認日のルール(案):
  1. **処理の目標は D+2(営業日)までに書き込み完了**(週末をまたがない)。
  2. 未取得が残る場合の**最後の営業日の確認**: 月曜の公表なら **D+4(金)**、火曜の公表(2027-02-16)なら **D+3(金)**。ここで未取得なら、HQ に「週末に入る前の警告」を出す。
  3. 週末・祝日の確認と実行は、**副担当・週末の当番が決まっている場合だけ**行う。**決まっていなければ「週末の対応なし」を報告に明記**し、金曜までに処理する。
  4. 期限日(D+7)当日の朝(Toronto)の確認は、その日が日本の祝日でも実施できる人がいるかを、事前に合意しておく(未合意なら**未確定**と書く)。
- 日本の祝日の確認: 勤労感謝の日(11/23)・天皇誕生日(2/23)は固定の祝日。2027-03-22 は春分の日(3/21 が日曜)の振替の可能性があり、**暦で未確認**。
- これは運用の手順であり、**定期実行の追加・変更ではない**。

**期限前のエスカレーション(休日対応ができない場合。第5版で追加)**
- 担当(実行担当・副担当・週末の当番)が**未確定のまま**、または**休日に対応できない**場合は、期限切れの前に、次の順でエスカレーションする。担当者は B が勝手に決めない。
  1. **D+2(営業日)**: 初回値が未取得なら、B が HQ に「未取得・担当の状況」を報告する。
  2. **最後の営業日の確認(月曜公表なら D+4 の金曜、火曜公表なら D+3 の金曜)**: 未取得で、週末・祝日の対応が**確定していない**場合、B は HQ に「**この日の営業時間内に実行しないと、期限(D+7)に間に合わない可能性がある**」ことを**文書で**伝え、HQ の判断(実行担当の指名、前倒しの実行、期限切れの受容)を求める。
  3. 期限日(D+7)の前日までに HQ の判断が無い場合、B は **期限切れ(HQ書面の承認が要る別手順、§16.2)になる見込み**を HQ に通知する。
- **11/23(ヘッドライン CA_CPI の 2026-10 分の期限)は引き続き管理する**: 実装・反映が間に合うか、担当が確定するか、を 11/20(金)の最後の営業日の確認で再確認する。**11/16 のコア2指標の初回値は、これとは別の課題**(上の「11/16 の公表に対する現実の整理」。未解決のまま)。

**失敗時の再実行**
- 失敗の例: WDS が未反映(`NOT_UPDATED`)、通信失敗(`FETCH_FAILED`)。書き込みは行われておらず、**そのまま再実行してよい**(冪等)。書き込みの再実行には、**HQの事前承認**がその都度要る。
- D+4(または上のルールの最後の営業日)になっても保存できていなければ、B が原因の証拠を添えて HQ に報告。

**期限切れの場合**: 自動では救済しない。§16.2 の「7日期限後の初回値の扱い」(HQの書面の承認、The Daily を根拠にした単発の手順)。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| O1 | 公表の直後に dry-run、WDS が未反映 | plan が PENDING(`NOT_UPDATED`)。書かない |
| O2 | 反映後の dry-run | plan が PUBLISH |
| O3 | 書き込み後に dry-run | 全件 UNCHANGED |
| O4 | `daysAfter` = 4 の未取得イベント | 警告なし |
| O5 | `daysAfter` = 5・6・7 | `deadline_warnings` に出る。終了コードは 0 |
| O6 | `daysAfter` = 8 | `TOO_LATE_FOR_FIRST_RELEASE`。書かない |
| O7 | 期限切れのイベントを再実行 | 自動では保存されない |
| O8 | 期限警告と `REVISION_BURST_STOP` の同時 | 別々の項目(`deadline_warnings`・`safe_stops`)で出る |
| O9 | 5回の公表日(上の表)の `daysAfter` の計算 | D+7 の暦日が表のとおり(夏時間・曜日に依存しない) |
| O10 | 担当者が未確定の設定 | 運用チェックリストに「担当未確定」と出る(自動の検査ではなく、報告のテンプレートの検査) |
| O11 | 担当未確定のまま D+2 に未取得 | HQ への報告のテンプレートに「未取得・担当の状況」が出る |
| O12 | 休日対応が未確定で、最後の営業日の確認に未取得 | 「この日の営業時間内に実行しないと間に合わない可能性」の通知のテンプレートが出る |

### 16.7 P2-4: 7日期限の設定の一元化と、設定漏れの検出

**二重定義の解消**: 第2版は、既存の `maxDaysAfterRelease`(経過ミリ秒、ABS が使用)と、新規の `maxLocalDaysAfterRelease`(暦日)の**2つ**を設ける案だった。これを**1つの設定 `firstValueWindow` に統一**する。
```ts
firstValueWindow?: {
  days: number;                       // 正の整数
  basis: 'ELAPSED' | 'LOCAL_CALENDAR'; // 経過時間 / 現地の暦日
  timeZone?: string;                  // LOCAL_CALENDAR のとき必須
}
```
| 系列 | 設定 |
|---|---|
| `CA_CPI` | `{ days: 7, basis: 'LOCAL_CALENDAR', timeZone: 'America/Toronto' }` |
| `CA_CPI_TRIM` | 同上 |
| `CA_CPI_MEDIAN` | 同上 |
| ABS の2系列 | `{ days: 7, basis: 'ELAPSED' }`(既存の挙動を変えない) |
| GB・`CA_UNEMPLOYMENT_RATE` | 設定なし(既存の挙動。**明示的な免除リスト**に載せる) |
- `maxDaysAfterRelease`・`maxLocalDaysAfterRelease` は**廃止**(コードに残さない)。

**設定漏れの検出(検出・停止)**
1. 起動時の検証(`validateSources`): 「公表日に拘束される系列」(CA_CPI 系3つ、ABS)に `firstValueWindow` が無ければ、**取得・書き込みの前に例外で止まる**(`FIRST_VALUE_WINDOW_MISSING`)。
2. 免除リストにない系列で設定が無いものも、同様に止まる(新しい系列を足して設定を忘れても検出される)。
3. CI で、設定漏れをテストが検出する。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| V1 | 3指標(CA_CPI・TRIM・MEDIAN)の設定 | すべて `{ days: 7, basis: 'LOCAL_CALENDAR', timeZone: 'America/Toronto' }` |
| V2 | 3指標のうち1つの設定を削除した入力 | `validateSources` が `FIRST_VALUE_WINDOW_MISSING` で例外。取得も書き込みも行われない |
| V3 | 3指標それぞれを順に削除(パラメータ化) | 3通りとも検出される |
| V4 | 免除リストにも設定にもない新しい系列 | 例外で止まる |
| V5 | `LOCAL_CALENDAR` で `timeZone` が無い / `days` が 0・負・小数 | 例外 |
| V6 | 静的検査: `maxDaysAfterRelease`・`maxLocalDaysAfterRelease` の語がコードに残っていない | 残っていたら失敗 |
| V7 | ABS の既存テスト(7日の経過時間) | すべて通る(挙動不変) |
| V8 | 免除リストの内容 | GB の3系列・`CA_UNEMPLOYMENT_RATE` だけ(リストが勝手に増えない) |

### 16.8 P3: 副作用(`event-reactions`・MEDIAN 通知・CADJPY の関連指標)

| 項目 | 確認結果(コード・マイグレーションで確認) | 影響 | 状態 |
|---|---|---|---|
| **`event-reactions`** | 手動実行のみ(`target=event-reactions`、定期実行に入っていない)。対象は `status = RELEASED` で `release_datetime` が直近の窓以内の発表。ペアは**通貨が base / quote に含まれるアクティブなペア**(指標の紐付けではなく通貨で選ぶ)。重要度は使わない | 3指標が RELEASED になった後の次の手動実行で、CAD を含むペア(CADJPY)について、**3イベント分**(ヘッドライン + コア2)の価格反応が計算される(1分足が無い場合は UNAVAILABLE のまま、値を作らない)。コードの変更は不要。同じ公表時刻の行が3組できる。外部 API は呼ばない | E1: 手動実行までは影響なし。実行後の行数が3イベント分になることを確認項目に。**画面での見え方は A** |
| **MEDIUM 通知** | `user_settings.notify_importances` の**既定は `{HIGH,MEDIUM}`**(migration 20261005000002)。FREE プランは通知できる重要度が **HIGH だけ**(`notification_importances: ['HIGH']`)、PRO は全部。通知の条件: 重要度が利用者の設定に含まれ、利用者が通貨ペアを絞っていれば関連ペアと交差(CADJPY) | **PRO の利用者(既定の設定、または CADJPY を選択)は、同じ公表時刻に `CA_CPI`(HIGH)に加えて、`CA_CPI_TRIM`・`CA_CPI_MEDIAN`(MEDIUM)の通知も受ける(最大3件)**。FREE は HIGH のみなので、コア2指標の通知は来ない。既存にも同じ型がある(`GB_CORE_CPI` MEDIUM が `GB_CPI` HIGH と同時) | E2: 異常ではない。通知が3件になることをHQが許容するかは**判断事項**(MEDIUM はHQ決定済み) |
| **CADJPY の関連指標 2 → 4** | `indicator_fx_pairs` は指標ごとの関連ペアの参照(イベント詳細の `related_fx_pairs`、Home の一括取得、通知の絞り込み、戦略分析の既定ペアの候補)。「ペアから関連指標の一覧を出す」画面は、コードの範囲では**見つからなかった**(`fxPairs` のルートはペアの選択用マスターだけ) | 表示件数の上限による影響は**見当たらない**。影響が出るのは、CADJPY で絞ったカレンダーなどで、公表時刻に **CA の CPI 系が1件から3件に増えること** | E3: カレンダー・Home での3件の並びと文字数は **A が実機で確認**。未確認 |
| 通知の本文・ウィジェットなど、値を出す他の面での出典 | 今回の調査では未確認 | StatCan の出典の表示が、通知の本文や他の面にも必要か | E4: 未確認。**HQ判断**(既存の他のプロバイダーと同じ扱いか) |

**テスト(実装時)**
| # | 状況 | 期待 |
|---|---|---|
| E1 | 3指標が RELEASED、`event-reactions` を実行 | CADJPY の反応が3イベント分。無い1分足は UNAVAILABLE |
| E2 | FREE の通知候補 | コア2指標(MEDIUM)は候補に入らない |
| E3 | PRO(既定設定)の通知候補 | 3指標とも候補 |
| E4 | CADJPY を選択した利用者 | 3指標が関連ペアで交差する |
| E5 | 通貨ペアを CADJPY 以外にした利用者 | 候補に入らない |
| E6 | `indicator_fx_pairs` の件数 | CADJPY の紐付けが 2 → 4、他のペアは不変 |

### 16.9 P3: 複数改定の書き込みの原子性・冪等性・監査

**原子性**
- 現行の書き込み(`insertRevision`)は、PostgREST の**1行ずつの INSERT**で、複数行をまたぐトランザクションは無い。**複数行の改定は、既定では原子的ではない**。
- 設計: ① 全件を先に計算して件数を確定(N の判定)→ ② 対象月の古い順に1件ずつ書く → ③ 途中で失敗したら、その時点で止めて `counters.error`(PARTIAL、終了コード 1)。**書き込めた分は有効**(各イベントの改定の列は、イベントごとに独立。イベントをまたぐ整合性は要らない)。
- 再実行すれば、書けた分は「直近の値と同じ」で UNCHANGED になり、残りだけが書かれる。**重複は起きない**。
- 原子性が必要な場合の選択肢(**既定にしない**。マイグレーションが要る): 複数行を1つの DB 関数(1トランザクション)で書き、書く直前に「直近の値が想定と同じ」を検査する。HQが必要と判断したときだけ。

**冪等性・再実行時の挙動**
| 状況 | 結果 |
|---|---|
| 同じ入力で2回実行 | 2回目は全件 UNCHANGED。行は増えない |
| N ≤ 5 を書いた直後の再実行 | UNCHANGED(直近の値が更新済み) |
| 途中失敗の後の再実行 | 残りだけ書かれる |
| 停止(N ≥ 6)の再実行 | 同じ停止が再現(状態を持たない)。承認つきの上書きで解除 |
| 同時実行 | ワークフローの `concurrency: fx-ingestion` で直列化。ワークフローの外(ローカル実行)では直列化されない — 書く直前に直近の値を再読込して比べ、同じなら書かない(楽観的な検査)。DB の一意制約は、改定が往復する正当な場合(A→B→A)を妨げるため既定では付けない |

**同一対象月の初回値が誤っていた場合の監査履歴(上書きして履歴を失う設計にしない)**
- 初回値のスナップショットは DB のトリガーで更新・削除できない。**誤っていても残る**(`actual`・`captured_at`・`verification_source`)。
- 訂正は **`event_revisions` の1行**(`old_value` = 誤った初回値、`new_value` = 正しい値、`effective_at`、`source`)として積む。誤った値と訂正の両方が、時刻つきで残る。
- 同日中の差は `same_day_diff` として `ingestion_logs.details` に残る(`snapshot_actual`・`observed`・両方の時刻・Toronto の日付)。
- 翌日以降に同じ差が確認された時点で、改定として登録される(§14.6 のフロー)。
- 帰結(仕様どおり): 誤った初回値は、訂正の登録まで **API の `snapshot.actual` として見える**。同日中の訂正は改定として登録されない(翌日以降)。この間の誤表示を減らすため、**初回値の書き込みは手動実行で、書き込み前に The Daily と突き合わせる**(§16.6 手順 2)。それでも誤った場合は、D+1 の dry-run(手順 6)で早期に見つける。

**同日中の差異と翌日以降の改定の区別**
| | 同日(スナップショットの `captured_at` と同じ Toronto の暦日) | 翌日以降 |
|---|---|---|
| DB への書き込み | **しない** | する(`event_revisions`) |
| 記録 | `same_day_diff`(ログ) | `event_revisions` の行 + ログ |
| 値の扱い | 初回値は不変 | 初回値は不変。訂正は改定として積む |
| 重複 | 同日に何度来ても行は増えない | 同じ差は1回だけ |

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| W1 | 5件の改定を書く途中で3件目が失敗 | 1・2件目は残る。エラーが記録される。終了コード 1 |
| W2 | W1 の再実行 | 3〜5件目だけ書かれる。1・2件目は増えない |
| W3 | 同じ入力で2回実行 | 2回目は書き込み0 |
| W4 | 初回値が誤り、翌日に正しい値 | 改定 1 行(old = 誤、new = 正)。スナップショットは不変 |
| W5 | W4 の同日(D)に正しい値 | 改定0行。`same_day_diff` が1件 |
| W6 | W5 の翌日 | 改定1行 |
| W7 | スナップショットの更新を試みる | DB が拒否(既存の結合テスト) |
| W8 | 書く直前に別の実行が同じ改定を書いた(直近の値が変わった) | 再読込で同じと分かり、書かない |

### 16.10 `REVISION_BURST_STOP` の警告(HQ決定: 案A。確認担当と解除手順つき)

案A を維持する(§15.13.3)。
1. 終了コードは **0 のまま**変更しない。
2. 標準出力 JSON に、独立した項目 **`safe_stops`** を出す。
3. GitHub Actions に専用の**黄色 warning**(`SAFE STOP: REVISION_BURST_STOP (not a communication failure)`)。
4. **`$GITHUB_STEP_SUMMARY`** に、対象指標・検出件数・各点の from / to。
5. 警告ステップは**ジョブの成功・失敗を変えない**(`!cancelled()`、`continue-on-error` を使わない)。
6. 通信失敗(`FETCH_FAILED`)・内部エラー(`SERIES_MISMATCH`・`RESPONSE_UNPARSABLE`、終了コード 1)と、タイトル・色・項目で区別する。

**手動実行の警告を誰が確認するか**
- 実行担当(手動実行をした人)が、実行後に Actions の run ページで黄色 warning と Step Summary を確認する(§16.6 手順 4 のチェック項目に含める)。
- B が、チェック API で `::warning` の注記を読み(リポジトリは公開で、ログ本文は読めないが注記は読める)、`safe_stops` を確認する。
- 停止の判定と解除の手順は **§16.2**(確認担当 B・C、承認 HQ)。
- 手動実行しか無いため、**誰も実行しなければ警告も出ない**。公表日の運用(§16.6)で実行の確認を担保する。

**テスト**
| # | 状況 | 期待 |
|---|---|---|
| B1 | N=6 | 終了コード 0、status SUCCESS、`safe_stops` に1件、改定0行 |
| B2 | N=5 | `safe_stops` は空、警告なし、5件書く |
| B3 | 通信失敗 | `safe_stops` は空(混同しない) |
| B4 | `counters.error` を伴う異常 | 終了コード 1。`safe_stops` と同時でも失敗が優先して残る |
| B5 | 警告ステップ | ジョブの結果を変えない |
| B6 | 警告の出力 | 接続情報・キー・メールを含まない |
| S1 | `safe_stops` の項目 | §16.2 の必須項目がそろう |
| S2 | 警告のタイトル | 通信失敗の警告と文言が違う |
| S3 | Step Summary | 指標・N・各点の from / to |
| S4 | dry-run | `safe_stops` が出る(書き込みなし) |

### 16.11 A に再確認が必要な仕様(コード変更なしの確認。実機確認は未実施)

1. `attribution.notice` に対象月を含めた**長い文字列**の表示(折り返し・スクロール領域)。特に `CA_CPI` の `Adapted from … This does not constitute an endorsement …`(最も長い)。
2. `/indicators`(値を出さない一覧)では**対象月なしの基本形**を返す。同じ指標の attribution がイベント系の応答と文言が違うことの問題の有無。
3. `value_decimals: null → 1`(`CA_CPI`)は**既存の API 応答の変更**。「3 → 3.0」表示、既存画面(カレンダー・イベント詳細・過去比較)での表示。
4. FREE / PRO のロック時に、対象月を含む出典文が表示される(既存の「ロック中も出典を出す」仕様)。
5. コア2指標のカレンダー・Home での表示(CADJPY で絞ったとき、CA の CPI 系が3件並ぶ)。通知の3件(PRO)。
6. 「コアCPI（CPI-median）」が1行表示に収まるか。
7. **実機確認は未実施**。

### 16.12 未解決事項と理由(第5版)

| # | 事項 | 理由 |
|---|---|---|
| 1 | **11/16 分のコア2指標のイベント(未解決のまま。設計修正とは別の課題)** | 実装・マイグレーション・予定の取り込みが 11/16 08:30 ET までに間に合わない見込みで、公表済みの回は予定の取り込みが作らない。バックフィルは既定でしない。**今回の修正で解決したと扱わない** |
| 2 | **11/23(ヘッドライン CA_CPI の 2026-10 分の期限)** | 実装・反映が間に合うかは未確定。引き続き管理する(§16.6。11/20 に再確認) |
| 3 | **実行担当・副担当・週末の当番が未確定** | HQ・大野さんと未合意。**B が決めない**。決まるまで書き込みの手動実行ができない。休日対応ができない場合の期限前エスカレーションは §16.6 |
| 4 | 週末・祝日(日本の祝日の確認を含む) | 2027-03-22 の祝日は暦で未確認 |
| 5 | 年次改定の日付の規則と一般則 | 公式の「January release」は、2026年は1月分の公表(2月17日)を指す(確認済み)。毎年そうなる一般則・日付の規則・改定カレンダーは未確認。日付に頼らない判定 |
| 6 | 新方針の下での改定の実績が少ない | 3回(通常月は2回)。6件閾値は暫定 |
| 7 | **固定記録・追記専用ログの新規2テーブル(マイグレーション、トリガー・権限の変更)** | 第2段階の別の承認。既存の `ingestion_staged_values`・`official_observations`・`ingestion_logs` の拡張では要件を満たせない(§16.14.5.1) |
| 8 | 固定記録の不変性の限界 | テーブル所有者(`postgres`)・superuser・プラットフォーム管理者による変更は防げない(§16.14.5.2) |
| 9 | 承認者の証跡 | `OPERATOR_ATTESTED` は HQ承認の証明にならない。環境の承認ゲートは利用可否が未確認で、workflow の変更を伴う(§16.14.6) |
| 10 | 承認の取り消しと書き込みの同時刻の競合 | 1行分は排除できない(§16.14.7) |
| 11 | 決定の記録・承認つき書き込みの2つの手動 target と workflow の入力 | 新しいコードが必要で、今回は workflow を変更しない |
| 12 | 第1段階でコア2指標の指標行・通貨ペアの**マイグレーションの作成・適用**、予定10件の DEV 反映 | 別の承認(ヘッドラインのみなら不要) |
| 13 | ヘッドライン CPI が改定されないという公式の文言 | 未確認のまま |
| 14 | 公表初日の WDS の反映タイミング | 公表日に観測して初めて分かる |
| 15 | StatCan が `reference date` として月の粒度で足りるとみなすか、計算値が Value-added Product にあたるか | StatCan に確認していない。保守的な解釈を採用 |
| 16 | 既存の `CA_UNEMPLOYMENT_RATE`(と ONS・ABS 等)の notice に対象月が無い | 同じ要件が当てはまる可能性があるが、今回の範囲外。HQ判断 |
| 17 | 通知の本文など、値を出す他の面での出典表示、PRO の通知3件 | HQ判断 |
| 18 | 期限後の単発救済の手順 | 新しいコードが必要。実装の承認の後 |
| 19 | 複数改定の原子性(DB 関数) | 既定にしない。HQが必要と判断した場合のみ |
| 20 | BoC 条件の法的な最終判断 | 説明文を StatCan の注記だけで書く方針で回避する案(§14.4) |
| 21 | A の再確認(§16.11)と実機確認 | 未実施 |
| 22 | 保留の「2回の公表」の期限、`|delta| > 0.2` の印、6件閾値 | 暫定値。HQ判断・実績の蓄積 |
| 23 | 最初の公表では比較元が無く、通常月の停止が実質的に機能しない期間がある | `STOP_BASELINE_INCOMPLETE` で自動書き込みを止める(安全側)。2回目から N が完全になる |
| 24 | `event-snapshots` のトリガーが TRUNCATE と service_role の権限を対策していない(既存の事実) | 今回の範囲外。同じ限界があることを明記 |

### 16.13 Cが次回のレビューで確認できる差分

- 比較: `git diff b66b76df..HEAD -- docs/projects/fx-event-analyzer/ca-cpi-detailed-design.md`(ブランチ `claude/fx-api-verify-prep`)。
- **対応表は §16.16**(P2-1〜P2-6、P3 の各項目 → 修正箇所とテスト)。2段階分離は **§16.15**。
- 改訂した節: §16.14.3(比較元・フォールバック)、§16.14.4(判定表の #0・#5b、N が完全 / 不完全)、§16.14.5(記録の構造、`carried[]`、追記専用ログ、状態、**既存DB機構との比較 §16.14.5.1**、**不変性 §16.14.5.2**)、§16.14.6(承認者の監査、再試行履歴)、§16.14.7(承認つき書き込み、取り消し、STALE の再承認)、§16.14.8(引き継ぎ、`KNOWN` / `OPEN`、`EXPIRED` の起点、version、同時作成)、§16.14.10(H・R・A・D の追加、T7b・Z36 の変更)、§16.6(期限前のエスカレーション)、§16.12、§16.15、§16.16。
- 実装・DB・SQL・migration・CI・DEV・main・PROD・workflow には触れていない(SQL・migration の作成もしていない)。
### 16.14 通常月と年次改定の分離(StatCan の改定方針の反映)(第4版で全面改訂)

**位置づけ**: 設計のみ。対象は `CA_CPI_TRIM`・`CA_CPI_MEDIAN`。ヘッドライン `CA_CPI` は年次の改定の公式情報が無い(§16.4)ため、従来の「対象月の1点」のまま。実装・DB・SQL・migration・CI・DEV・main・PROD・workflow の変更はしていない。

#### 16.14.1 2つのルールの比較

| | **通常月のルール** | **年次改定のルール** |
|---|---|---|
| 公式の根拠 | 「履歴の1か月分」を改定 | 「3年前まで」を年1回改定 |
| 比較窓 | **年齢 0〜6(7点)**(暫定維持) | **年齢 1〜36(36点)** |
| 閾値 | 候補 **5以下 → 書く / 6以上 → その系列の改定の書き込みだけ停止**(`REVISION_BURST_STOP`) | **件数の閾値で自動書き込みしない**。候補は**すべて人の承認の後**に書く |
| 書き込み | 閾値内なら自動 | **承認前は書かない** |
| 6件を超えた場合 | 安全停止 | 通常月の安全停止を適用しない(`ANNUAL_REVISION_REVIEW`) |
| 初回値の保存・他系列 | 独立して継続 | 独立して継続 |
| 終了コード | 0 | 0 |

#### 16.14.2 取得点数と年齢の算術(第4版: `latestN: 49`)

**年齢** = 対象月から何か月前の点か(暦月の差。位置ではなく `refPer` で計算する)。**年齢 0 は対象月そのもの**(今回公表された月)。

| 年齢 | 意味 | 点数 |
|---|---|---|
| **0** | **対象月**(初回値の保存の対象。後日の実行では比較の対象にもなる) | **1** |
| 1〜6 | 通常月の窓の「前の6か月」(`recent`) | **6** |
| 7〜36 | 年次の範囲の続き(`older`) | **30**(36 − 7 + 1) |
| 37〜48 | 方針の「3年」の外側(`outside`。矛盾の検出用) | **12**(48 − 37 + 1) |
| **合計(年齢 0〜48)** | | **1 + 6 + 30 + 12 = 49** |

- 取得は系列ごとに **`latestN: 49`**(対象月を含む)。以前の「48」は、対象月を数えていなかったため誤り。
- 通常月の窓 = 年齢 0〜6(**7点** = 1 + 6)。年次の窓 = 年齢 1〜36(**36点** = 6 + 30)。年齢 0 を含めて 0〜36 は37点。
- 連続性: 年齢 0〜48 の49か月が**欠けなく**そろっていること。1か月でも欠ける、49点でない(48点・50点)、先頭の月が対象月でない → `STOP_UNKNOWN`。
- 比較範囲と判定表(§16.14.4)・テストデータ(§16.14.10)は、すべてこの年齢の定義に揃える。
- **承認つき書き込みのときだけ**は、承認の後に公表が進んでも承認された月が範囲に残るよう、**61点(49 + 12)**を取る(§16.14.7)。通常の判定は49点。

#### 16.14.3 比較元(baseline)の定義と、状態の区別(第5版で改訂)

**比較元の値(月ごと)** = 次の優先順位で最初に得られたもの。
1. その月のイベントの直近の値(最後の `event_revisions`、無ければスナップショットの `actual`)。
2. その系列の**直前の固定記録**に残る、その月の観測値。
3. **直前の公表日の記録がない場合**: それより前の公表日の記録のうち、**最も新しいもの**(`baseline_gap_releases` = 間に挟まる公表の回数を記録)。間が空いていても比較は有効(「その時点からの変化」)だが、候補に複数の公表の改定が混ざりうるため、候補一覧と報告に `baseline_gap_releases` を明記する。
4. 無し。

**比較元の状態(区別する)**
| 状態 | 意味 | 扱い |
|---|---|---|
| `HAS_BASELINE` | 比較元がある | 比較できる |
| `FIRST_OBSERVATION` | その系列で**初めての実行**(固定記録が1つも無い) | 比較できない。`ANNUAL_NO_CHANGE` に進めない |
| `NO_BASELINE` | 固定記録はあるが、**その月が含まれない**(イベントも無い) | その月は比較できない |
| `BASELINE_EXPIRED` | 固定記録が**保存期間切れ・削除**で読めない | 比較できない(`FIRST_OBSERVATION` と区別して記録) |
| `BASELINE_GAP` | 直前の公表日の記録が無く、古い記録を使った | 比較できる。ただし `baseline_gap_releases` を記録 |
| `RECORD_STORE_UNAVAILABLE` | 固定記録の保存先が使えない(マイグレーション未適用・接続失敗) | **改定検知・改定書き込みを停止**(§16.14.4 の #0) |
| `FETCH_FAILED` | WDS の取得失敗・不完全 | `STOP_UNKNOWN`。「変化なし」とは扱わない |
- **比較元がない場合は `ANNUAL_NO_CHANGE` に進めない**。`ANNUAL_NO_CHANGE` は、「年齢 1〜36 のすべてが `HAS_BASELINE`(または `BASELINE_GAP`)で、候補が0」のときだけ。

**既知の値と未解決候補の区別(第5版)**: 却下・保留の値は「既知の値」(`KNOWN`)として通常月の N から外す。**承認待ち・未決定・期限切れの候補は `KNOWN` にしない**(`OPEN` として毎回の出力に出し続ける)。詳細は §16.14.8。

#### 16.14.4 どちらのルールで処理するか(日付だけで判定しない)(第5版で改訂)

公式の「each January release」の**日付の規則は未確定**(§16.4)。固定の日付だけで判定せず、**対象月・公表内容・データの完全性・比較元の状態**を照合する。

**月ごとの分類**: `UNCHANGED` / `CANDIDATE`(比較元があり、同日の差でなく、`KNOWN` でもなく、値が違う)/ `KNOWN`(却下・保留中の既知の乖離)/ `OPEN`(承認待ち・未決定・期限切れの既知の候補。§16.14.8)/ `SAME_DAY` / `NO_BASELINE` / `INVALID`。`recent` = 年齢 0〜6 の `CANDIDATE`、`older` = 年齢 7〜36、`outside` = 年齢 37〜48。年齢 0 は、対象月の初回値がすでに保存済み(後日の実行)のときだけ `CANDIDATE` になりうる。`targetIsJanuary` は期待の信号であって唯一の根拠ではない。

**判定表(上から順に評価。最初に当てはまったものを採用)**
| # | 条件 | モード | 書き込み |
|---|---|---|---|
| 0 | **固定記録の保存先が使えない**(マイグレーション未適用・接続失敗) | `STOP_NO_RECORD_STORE` | **改定検知・改定書き込みを停止**。**初回値の保存は続行**。N を計算しない(イベントだけで N を出す縮退動作は採用しない) |
| 1 | 取得が不完全(49点そろわない・**月の重複**・欠け・対象月不一致・`vectorId` 不一致・不正な値) | `STOP_UNKNOWN` | 改定を書かない |
| 2 | `outside` がある(年齢 37〜48 が変わった) | `STOP_POLICY_MISMATCH` | 書かない |
| 3 | `targetIsJanuary` かつ (`older` または `recent` に候補) | `ANNUAL_REVIEW` | 承認前は書かない |
| 4 | `targetIsJanuary` かつ、年齢 1〜36 の**すべて**が比較元ありで、候補が0 | `ANNUAL_NO_CHANGE` | 書くものなし(記録のみ) |
| 4b | `targetIsJanuary` かつ、候補が0だが、**比較元がない月がある** | `ANNUAL_NO_BASELINE` | 書くものなし。「変化なし」と結論しない。確認依頼 |
| 5 | `targetIsJanuary` でなく、`older` がある | `STOP_UNEXPECTED_EXTENDED` | 書かない |
| 5b | 通常月で、年齢 0〜6 の**比較元がない月がある**(N が**不完全**) | `STOP_BASELINE_INCOMPLETE` | **自動で書かない**(確認依頼)。N を「不完全な値」として扱わない |
| 6 | 通常月の N ≥ 6(N が**完全**) | `STOP_BURST` | 改定の書き込みだけ停止 |
| 7 | 通常月の N ≤ 5(N が**完全**) | `NORMAL` | N件を自動で書く(書き込み対象はイベントのある月) |
- **#0 の位置づけ**: 固定記録がなければ、比較元(直前の記録)も、記録の固定も、承認もできない。**イベントのある月だけで N を数える縮退動作は採用しない**(イベントのない月の変化を見落とし、N を過小に出すため)。
- **#5b**: 初回の公表(固定記録が1件目)は、イベントのない月の比較元がないため N が不完全。この回の改定は自動で書かない。2回目以降は、直前の記録が比較元になり、N が完全になる。
- **N が完全** = 年齢 0〜6 のすべての点が `HAS_BASELINE` / `BASELINE_GAP`(年齢 0 は初回値の保存の回は除く)。
- **N の数え方(統一)**: N = 年齢 0〜6 の点のうち、比較元があり、同日の差でも `KNOWN` でもなく、値が違う点の数。イベントの有無は問わない。書き込み対象はそのうち**イベントのある月だけ**。`OPEN` は N に数えないが、毎回の出力(`open_reviews`)に出す。
- 日付(公表日)だけでは分岐しない。

#### 16.14.5 固定記録(公表日ごとの記録)と、保存方法の比較(第5版で改訂)

**目的**: 年次改定(と通常月の停止)の候補を、**公表日ごとに固定**し、承認と書き込みを**同じ内容**に対して行う。

**固定記録(1公表日・1系列につき、内容が変わるたびに1つ作る。作った後は更新しない)**
| 項目 | 内容 |
|---|---|
| `record_id` / `version` | 識別子。**同じ公表日で取得内容(49点)が変わったら `version` を上げた新しい記録**を作る。古い記録は書き換えない |
| `indicator` / `series` / `release_date` / `target_period` / `observed_at` / `fetch_state` | 指標・系列・公表日・対象月・取得時刻・取得状態 |
| `points[49]` | 年齢 0〜48 の `{age, period, value, statusCode}`(**全証拠**。イベントのない月を含む) |
| `baseline` | 各月の比較元の値と由来(`EVENT` / `RECORD:<record_id>` / `NONE`)と状態(§16.14.3)、`baseline_gap_releases` |
| `candidates[]` | この記録で新たに見つかった候補 `{ period, age, from, to, delta, has_event, event_id, baseline_source }`。**イベントのない月も含む全候補** |
| `carried[]` | **前の記録から引き継いだ未解決の候補**(`OPEN`・`KNOWN`)`{ origin_record_id, period, from, to, state, releases_open }`(§16.14.8) |
| `mode` | 判定表のモード |
| `writable[]` | **書き込み対象**(イベントのある月だけ)。候補一覧とは別に管理 |
| `candidates_digest` / `carried_digest` | **固定記録から**生成するダイジェスト2つ(新規の候補 / 引き継ぎ)。最新の WDS からは作らない |
| `prev_record_digest`(任意) | 同じ系列の直前の記録のダイジェスト(連鎖。§16.14.5.2) |
- 固定記録は、通常月・年次の別なく、**実行した公表日ごとに作る**(候補が無くても作る。次の公表の比較元になる)。dry-run は作らない。
- 同じ公表日の2回目以降の実行で、**49点が変わっていなければ新しい記録は作らない**(既存の記録のまま)。変わっていれば**新しい `version`**(A→B→A の扱いは §16.14.8)。

**追記専用の記録(固定記録とは別。更新・削除しない)** — 決定と書き込みを**1つの追記専用の記録(ログ)**にまとめる。
- 項目: 通番(全体で単調に増える)、`record_id`、`period`(月単位の決定・書き込みでは月、記録全体の操作では空)、`entry_type`(`DECISION` / `APPLICATION` / `INVALIDATION` / `CARRY` / `RESOLUTION`)、`decision`(`APPROVED` / `REJECTED` / `ON_HOLD`)、`approval_id`(= `DECISION` の行の識別子)、承認の証跡(§16.14.6)、書き込みの結果(`APPLIED` / `ALREADY_APPLIED` / `CONFLICT` / `SKIPPED_NO_EVENT` / `STALE` / `FAILED`)、`attempt_no`、`revision_id`、実行の識別子、時刻。
- **同じ月に対する最新の決定 = 通番が最大の `DECISION` / `INVALIDATION` の行**。

**状態(区別する)**
| 対象 | 状態 |
|---|---|
| 記録(最新の決定と書き込みから導出) | `RECORDED` / `PENDING_REVIEW` / `APPROVED` / `PARTIALLY_APPROVED` / `REJECTED` / `ON_HOLD` / `PARTIALLY_APPLIED` / `APPLIED` / `SUPERSEDED` |
| 候補(月ごと) | `UNREVIEWED` / `APPROVED` / `REJECTED` / `ON_HOLD` / `EXPIRED_UNRESOLVED` / `APPLIED` / `NOT_WRITABLE` / `STALE` / `CONFLICT` / `RESOLVED_BY_DATA`(WDS が元の値に戻り、候補が自然に消えた)/ `SUPERSEDED_BY_NEWER`(値がさらに変わり、新しい候補に置き換わった) |

##### 16.14.5.1 既存のDB機構との比較(P2-6。コード・マイグレーションの読み取り調査)

**要件**: ① 49点の**全証拠** ② **イベントのない月**の保持 ③ **改定候補の保留・再評価**(状態の履歴) ④ **再現性**(ダイジェストの再計算) ⑤ **不変性** ⑥ 承認の監査 ⑦ 同じ公表日の**複数 version** ⑧ 一意制約による冪等性。

**既存機構の事実(`20261015000003_ingestion_accuracy.sql`、`20261022000004`)**
- `ingestion_staged_values`: `event_id` が **NOT NULL**(イベントのある月だけ)。`kind` が `RELEASE` / `REVISION`、`old_value` / `new_value`、`verification_status`(`AWAITING_OFFICIAL` / `PENDING_REVIEW` / `VERIFIED` / `SINGLE_SOURCE` / `REJECTED`)、`resolved_at` / `resolved_by`(自由記述)、`detail` jsonb。**未解決の行は (event, kind, field) ごとに1行だけ**(一意索引)で、`updated_at` のトリガーで**行を更新して状態を進める設計**(履歴を残さない)。
- `official_observations`: `source` が **`FRED` / `BLS` のチェック制約**。`(source, series_id, period_start, as_of_date)` が一意で、`as_of_date` は **date**(1日1値)。イベントとは無関係。更新・削除を止める仕組みは無い。
- `ingestion_logs`: 実行ごとに1行。一意制約なし、更新・削除を止める仕組みなし、保存期間の定めなし。`details` jsonb(`note` は1項目50件まで)。ステータスは `SUCCESS` / `FAILURE` / `PARTIAL` だけ。
- どれも RLS 有効・ポリシーなしで、anon / authenticated の権限は取り消し済み(`20261022000004`)。**service_role は更新・削除ができる**。

| 要件 | `ingestion_staged_values` | `official_observations` | `ingestion_logs` | **新規2テーブル案(固定記録 + 追記専用ログ)** | 新規3テーブル案(第4版) |
|---|---|---|---|---|---|
| ① 49点の全証拠 | 不可(1行 = 1イベントの1値) | 可(1行 = 1月の1観測。49行/系列/公表。ただし `source` に `STATCAN` を足す変更が要る) | 可(jsonb)。ただし1項目50件の上限、実行ごとに散在 | **可**(固定記録の `points`) | 可 |
| ② イベントのない月 | **不可**(`event_id` NOT NULL) | 可 | 可 | **可** | 可 |
| ③ 保留・再評価の履歴 | **不可**(未解決は1行を更新。履歴が残らない) | 不可(候補の概念がない) | 不可 | **可**(追記専用ログに `CARRY` / `RESOLUTION` / `DECISION`) | 可 |
| ④ 再現性 | 弱い(行が更新される) | 弱い(1日1値。同日の A→B→A を区別できない) | 弱い(どの行が基準か曖昧) | **強い**(`(指標, 公表日, 対象月, version)` で1件。ダイジェスト) | 強い |
| ⑤ 不変性 | **無い**(設計上、更新する) | 無い | 無い | **ある**(トリガー + 権限、§16.14.5.2) | ある |
| ⑥ 承認の監査 | `resolved_by` の自由記述だけ | 無い | 無い | **可**(追記専用ログ。証跡の区別 §16.14.6) | 可 |
| ⑦ 複数 version | 不可(1行を更新) | 不可(`as_of_date` は date) | 可(行が増える)が曖昧 | **可** | 可 |
| ⑧ 一意制約 | 部分的(未解決1行) | あり(上の粒度) | なし | **あり** | あり |
| 既存の取り込みへの影響 | 他のパイプライン(`ingest:official`・経済カレンダー)が使用。意味を変えると影響 | `ingest:official` が使用。制約変更の影響 | 広く使用 | **なし**(新規) | なし |
| 保存期間 | 定めなし | 定めなし | 定めなし | **永続**(削除しない設計) | 永続 |

**結論**
1. **既存の機構の拡張だけでは、要件 ②③⑤⑥⑦を満たせない**。
   - `ingestion_staged_values` はイベントのある月だけで、行を更新する設計。履歴・不変性・version・イベントのない月が満たせない。意味を変えると、他のパイプラインに影響する。
   - `official_observations` は、49点の**生データの保管**には使えるが、`FRED` / `BLS` 限定のチェック制約と、日単位の一意性が、同日の変更の区別と version に合わない。候補・ダイジェスト・状態を持てない。
   - `ingestion_logs` は一意性・不変性・保存期間のいずれも保証できない。
2. **新規テーブルは必要。ただし3つから2つに減らせる**(第4版の「決定」と「書き込み」の2テーブルを、**追記専用ログ1つにまとめる**)。理由: 両者とも追記専用で `record_id` に紐づき、**通番で全体の順序が付く**ので、「最新の決定」と「書き込みの前後」の関係が1つの順序で決まる(承認の取り消しの判定に必要。§16.14.7)。
3. 新規2テーブル: **(a) 固定記録**(不変)、**(b) 追記専用ログ**。
4. 49点を `official_observations` にも二重に持つ案は採らない(不変でない表に証拠を置くと、固定記録の再現性が損なわれる)。
5. この比較は設計上の評価。**新規テーブルのマイグレーションは、別の承認が要る(第2段階)**。

##### 16.14.5.2 固定記録の不変性(P2-2)
**設計(コード・SQL は書かない)**
1. **更新・削除の拒否**: 固定記録と追記専用ログに、行ごとの更新・削除を拒否するトリガー(`event_snapshots` の `prevent_release_snapshot_mutation` と同じ考え方)。
2. **TRUNCATE の対策**: 行ごとのトリガーは TRUNCATE を捕まえない。**TRUNCATE を拒否する文単位のトリガー**を別に置く。
3. **権限**: 2テーブルの `UPDATE`・`DELETE`・`TRUNCATE` を **anon・authenticated に加えて service_role からも取り消す**。service_role は RLS を迂回するが、**表の権限は迂回できない**ため、取り消しは有効。書き込みに必要なのは `INSERT` と `SELECT` だけ。
4. **連鎖(任意の強化)**: 各記録に、同じ系列の直前の記録のダイジェストを含める。途中の記録の改ざん・削除が、検証で見つかる。
5. **読み出し時の検証**: 記録を使う前に、保存されたダイジェストを `points` と `candidates` から再計算して一致を確かめる。一致しなければ `RECORD_TAMPERED` で**その系列の改定処理を停止**。

**保証範囲**
- 防げる: アプリの不具合、service_role を使う運用ミス・スクリプトによる更新・削除・TRUNCATE、anon / authenticated による変更。
- 検出できる: 読み出し時のダイジェスト不一致、連鎖の途切れ(4. を採用した場合)。

**限界(明記)**
- **テーブルの所有者(Supabase では `postgres` ロール。ダッシュボードの SQL Editor が使う)や superuser は、トリガーの無効化、権限の再付与、テーブルの削除ができる**。この設計は、それを**防げない**。
- Supabase のプラットフォーム管理者・バックアップの復元も範囲外。
- 連鎖は、所有者が全体を書き換えれば破れる(検出は「部分的な改ざん」まで)。
- **参考(既存の事実)**: `event_snapshots` のトリガーは行ごとだけで、TRUNCATE と service_role の権限は対策していない。この点は今回の範囲外だが、同じ限界がある。
- 対策の運用面: 所有者権限の操作は、HQ承認の手順(DEV の SQL 実行と同じ)でのみ行い、実行の前後に固定記録の件数・ダイジェストの連鎖を読み取り専用で確認する。

**テスト(実装時。権限・トリガーを含む。ローカルの DB で実行)**
| # | 状況 | 期待 |
|---|---|---|
| I1 | service_role で固定記録を UPDATE | 拒否(権限エラー) |
| I2 | service_role で固定記録を DELETE | 拒否 |
| I3 | service_role で固定記録・ログを TRUNCATE | 拒否(権限エラー) |
| I4 | 権限を一時的に再付与した状態で UPDATE / DELETE | トリガーが拒否 |
| I5 | 権限を再付与した状態で TRUNCATE | 文単位のトリガーが拒否 |
| I6 | anon / authenticated で SELECT・INSERT・UPDATE・DELETE・TRUNCATE | すべて拒否(RLS・権限) |
| I7 | 所有者が `points` を書き換えた状態(テストで再現) | 読み出し時のダイジェスト検証で `RECORD_TAMPERED`。その系列の改定処理が停止 |
| I8 | 連鎖: 途中の記録を削除した状態 | 連鎖の検証で検出(採用した場合) |
| I9 | INSERT と SELECT は service_role で可能 | 取り込みが動く |
| I10 | 限界の文書化 | 所有者による変更は防げないことを、設計書とテストの説明に明記(自動テストは「防げる範囲」だけ) |

#### 16.14.6 承認情報の受け渡しと、承認者の監査(第5版で改訂)

**区別する3つの情報(P2-5)**
| 情報 | 内容 | 検証 | 位置づけ |
|---|---|---|---|
| 実行者(`executed_by`) | 決定を記録した GitHub のユーザー(`github.actor`)と実行(`run_id`) | GitHub が認証した値 | **証拠として強い**(誰が操作したか) |
| 主張された承認者(`claimed_approver`) | 実行担当が入力した、承認者の氏名・役職(自由記述) | **認証できない** | **HQ承認の証明として扱わない**。記録するだけ |
| 指示の参照(`instruction_ref`) | HQの指示の日付・文書・メッセージの参照 | 人が突き合わせ可能。システムは検証しない | 監査時に人が確認する手がかり |
- 記録する項目: 承認ID、指示の参照、実行者、主張された承認者、承認対象月、ダイジェスト(`candidates_digest`)、決定、理由、時刻、**証跡の水準**(`evidence_level`)。
- **証跡の水準**: `OPERATOR_ATTESTED`(既定。実行担当が「HQが承認した」と入力。**HQ承認の証明にはならない**)。強化案として `ENVIRONMENT_APPROVED`: 承認つき書き込みの手動実行を、HQ を必須レビュアーにした GitHub の環境(Environment の承認ゲート)に置く。**GitHub が認証した承認者の情報が実行に残る**。ただし workflow の変更が要り、**利用可否は未確認**(今回は変更しない)。
- **監査の保証範囲**: 誰が(GitHub のアカウント)、いつ、どの記録・月・ダイジェストに対して、どの指示の参照で決定を記録したか、を後から追える。
- **限界**: 「HQが実際に承認したか」は、システムでは証明できない(自由記述は偽れる)。指示の参照と、HQ側の記録との突き合わせが必要。`ENVIRONMENT_APPROVED` を採用しても、承認ゲートの設定自体は管理者が変更できる。

**承認情報の受け渡し**
| 項目 | 保存先 | 渡し方 |
|---|---|---|
| 承認ID | 追記専用ログの `DECISION` の行 | **書き込みの実行には承認IDだけ**を渡す |
| 指標・系列・公表日・対象月 | 固定記録 | 承認IDから固定記録を引いて取得(入力しない) |
| 承認対象月 | `DECISION` の行(月ごと) | 決定の記録の手順で入力 |
| ダイジェスト | 固定記録 + `DECISION` の行 | **確認用に入力**し、固定記録と一致しなければ決定を記録しない |
| 承認者・指示の参照・理由 | `DECISION` の行 | 決定の記録の手順で入力 |
- 手順(新しい手動 target が2つ必要。**今は作らない**): ① `record-decision` ② `apply-approved-revisions`(承認IDだけ)。
- `--allow-revision-burst` は廃止し、承認つき書き込みの1つに統一(第4版のまま)。通常月の `STOP_BURST` も同じ仕組み。

**書き込みの再試行履歴と一意制約(P2-5)**
- 書き込みの記録は、**試行ごとに1行**を追記する: `(record_id, period, attempt_no)` が一意。1回目 `FAILED`、2回目 `APPLIED` のように、**失敗から成功への履歴が一意制約と矛盾しない**。
- さらに、**`APPLIED` は `(record_id, period)` につき1行だけ**(結果が `APPLIED` の行に限った一意性)。同じ月に2回 `APPLIED` を記録しようとすると拒否される(二重書き込みの防止)。
- `attempt_no` は、同じ `(record_id, period)` の既存の試行数 + 1。同時に採番して衝突した場合は、一意制約違反を検知して再読込し、再試行(上限3回)。

#### 16.14.7 承認つき書き込みの手順(冪等・再開可能・取り消しに対応)(第5版で改訂)

```
[承認ID] → 追記専用ログから、この承認IDの DECISION を読む
   → 固定記録を読む → ダイジェストを再計算して一致を確認(記録 = 決定 = 再計算)、記録が SUPERSEDED でない
   → 最新の WDS を取得して検証(61点: 49 + 12。承認の後の公表で窓がずれても、承認された月が範囲に残る)
   → 承認された月(イベントあり)を古い順に、1か月ずつ:
        ① 【書き込み直前】その月の「最新の決定」を再読込(通番が最大の DECISION / INVALIDATION)
              最新が、この承認IDの APPROVED でなければ → 書かない (APPROVAL_REVOKED)。以降の月も止める
        ② その月の WDS の値 == 固定記録の `to` か(承認時点と同じか)
              違えば → 1行も書かず、残りも止める (STALE)。承認を無効化(INVALIDATION を追記)
        ③ イベントの直近値 == to → ALREADY_APPLIED / == from → 改定を書く(APPLIED を追記)/ それ以外 → CONFLICT(以降を止める)
   → 記録の状態を導出
```
- **承認の取り消し(P2-3)**: 後から同じ月が `REJECTED` / `ON_HOLD` にされた、または別の決定で上書きされたとき、**以前の承認IDは無効**(最新の決定が別になるため)。書き込みは**各月の書き込み直前**に最新の決定を再確認するので、**古い承認IDでは書き込めない**。実行の途中で取り消されても、次の月から止まる。
- **限界**: 取り消しと書き込みが**同時刻**に起きる場合、再確認と書き込みの間の短い間(1行分)は排除できない。トランザクションをまたぐ排他は、このデータ層では持たない(PostgREST)。実運用では、取り消しの前に書き込みの実行がないことを確認する手順にする。
- **STALE の再承認の経路(P2-1)**: ② で承認時点と値が違えば、承認は `INVALIDATION`(理由 `STALE`)で無効になる。その月は `OPEN` のまま次の記録に引き継がれ(§16.14.8)、新しい値で**新しい候補(新しいダイジェスト)**として再提示される。HQは新しい決定を出し、それに対する新しい承認IDで書く。古い承認IDは使えない。
- 判定は**承認された月ごと**に行う(以前の「49点の全体の一致」は、次の公表で必ず崩れるため廃止)。承認されていない月の値の変化は、書き込みを止めない(その月は別の候補として扱う)。
- **途中失敗の再開**: 同じ承認IDで再実行できる。書けた月は `ALREADY_APPLIED`、未完了の月だけが書かれる。
- **冪等性・原子性**: 同じ承認IDで何度実行しても、書かれるのは未完了の月だけ。複数行をまたぐトランザクションは無い(§16.9)。

#### 16.14.8 未解決候補の引き継ぎ・既知の値の寿命・version(第5版で改訂)

**原則**: 未解決の候補は、**次の公表の記録に必ず引き継がれ、黙って消えない**。`KNOWN` は「決定済みの値」だけで、未決定の候補を隠さない。

**引き継ぎの方法(P2-1)**
- 新しい公表の記録を作るとき、追記専用ログから**この系列の未解決の項目(`UNREVIEWED` / `ON_HOLD` / `EXPIRED_UNRESOLVED` / 承認済みで未書き込みのもの)をすべて読む**。
- 各項目を、今の WDS の値で再評価する:
  | 今の WDS の値 | 結果 | 新しい記録での扱い |
  |---|---|---|
  | イベントの直近値に戻った | `RESOLVED_BY_DATA` | `RESOLUTION` を追記。`carried[]` から外れる(**理由が記録されて消える**) |
  | 項目の `to` と同じ | 未解決のまま | `carried[]` に引き継ぐ(`origin_record_id`、`releases_open` を更新)。ログに `CARRY` を追記 |
  | 上のどちらとも違う(さらに変わった) | `SUPERSEDED_BY_NEWER` | 古い項目を閉じ、新しい値で**新しい候補**(`candidates[]`)にする。古い承認は無効 |
- 引き継ぎは**記録の `carried[]`(不変)とログの `CARRY`(追記)の両方**に残る。次の公表の記録を作る処理は、前の記録だけでなく**ログ全体の未解決**を読むので、前の公表の記録が飛んでいても(実行されなかった回があっても)項目は消えない。

**`OPEN` と `KNOWN` の寿命(P3)**
| 状態 | N への扱い | 毎回の出力 | 寿命・再評価の条件 |
|---|---|---|---|
| `UNREVIEWED`(承認待ち) | 数えない | `open_reviews` に必ず出る | 決定が出るまで。**公表を2回過ぎたら警告を昇格**(HQへ報告) |
| `ON_HOLD`(保留) | 数えない | `open_reviews` | 起点から**公表2回**で `EXPIRED_UNRESOLVED` |
| `EXPIRED_UNRESOLVED` | 数えない | `open_reviews`(昇格した警告)。**`KNOWN` にしない** | **明示の決定(承認 / 却下)が出るまで残る**。次の年次改定の確認までに必ず決定する |
| `REJECTED`(却下) | `KNOWN`(数えない) | `known_divergences` に一覧 | **同じ値が続く間は有効**。解除条件: ① WDS の値が変わった(新しい候補)② HQ が決定を取り消した ③ **年次改定の公表ごとに、却下中の一覧を再確認**(永久に隠れない) |
| `APPROVED`(書き込み前) | 数えない | `open_reviews` | 書き込みで `APPLIED`。STALE なら無効化して再提示 |
- `KNOWN` は**決定済みの却下**だけ。承認待ち・未決定・期限切れは `KNOWN` ではなく `OPEN` で、**毎回の出力に出る**(通常月を妨げないが、隠れない)。

**`ON_HOLD` の起点と「公表の回数」の数え方(P3)**
- **起点** = 保留の決定を記録した時刻(`DECISION` の行の時刻)。
- **回数** = 起点より後に公表予定が到来した回の数。**公表予定表(StatCan のスケジュール)の `release_datetime` が起点より後で、今以前のもの**を数える。**実行の有無は関係ない**(実行しない回があっても、公表の回は経過する)。2回を超えたら `EXPIRED_UNRESOLVED`。
- 起点の公表日と同じ日に決定した場合、その公表は数えない(起点より後だけ)。

**同じ公表日の旧 version と新 version の候補(P2-1・P3)**
| 旧 version の項目 | 新 version | 扱い |
|---|---|---|
| 同じ `(period, from, to)` | あり | **引き継ぐ**(状態が `REJECTED` / `ON_HOLD` なら維持。`APPROVED` は**引き継がず再承認が必要**) |
| 値が変わった | 新しい値 | `SUPERSEDED_BY_NEWER`。新しい候補 |
| 消えた(WDS が戻った) | なし | `RESOLVED_BY_DATA` |
| なかった | 新しく出た | 新しい候補 |
- 旧 version の記録は `SUPERSEDED`(書き換えない)。旧 version への承認は無効(`INVALIDATION` を追記)。
- **A→B→A**: 同じ公表日に、WDS が A→B→A と変わった場合: v1(B を観測。候補あり)→ v2(A に戻る。候補が消えて v1 の項目は `RESOLVED_BY_DATA`、v1 への承認は無効)→ v3(再び B。v1 と**同じ内容のダイジェスト**だが、**別の記録(別の `record_id` と `version`)**。v1 の承認は再利用できない)。**version は取得内容(49点)が変わるたびに上がる**(内容が同じ版には戻さない)。

**同時作成の一意制約違反と再試行(P3)**
- 固定記録の `(指標, 公表日, 対象月, version)` は一意。2つの実行が同時に同じ `version` を作ろうとすると、後の方が一意制約違反になる。
- 対応: 違反を検知したら、**最新の `version` を再読込**する。最新の `points` が自分の取得内容と同じなら**何もしない**(冪等)。違えば `version + 1` で作り直す。**上限3回**。それでも作れなければ `RECORD_CREATE_CONFLICT` で、その系列の改定処理を停止して報告(初回値の保存は続行)。
- 追記専用ログの通番・`attempt_no` の衝突も同様に再試行する。

**テスト**: §16.14.10 の H1〜H14。

#### 16.14.9 処理フロー

**通常月**
```
[取得 49点・検証] → 経路 A: 初回値の保存(独立)→ 分類(年齢 0〜48、比較元・既知の値を除外)
   NORMAL    : N ≤ 5 → イベントのある候補をN'件、自動で書く(N' ≤ N)
   STOP_BURST: N ≥ 6 → 固定記録 + safe_stops。改定の書き込みだけ停止
```
**年次改定(想定される大量改定)**
```
[取得 49点・検証] → 経路 A: 初回値の保存(独立)→ 分類 → 固定記録(候補を全部、イベントなしの月も)
   ANNUAL_REVIEW / STOP_UNEXPECTED_EXTENDED / STOP_POLICY_MISMATCH / ANNUAL_NO_BASELINE
        → 書かない → 黄色 warning + Step Summary(revision_reviews)
        → [人の確認・決定(承認・却下・保留)] → 承認つき書き込み(16.14.7)
```

**人による確認・承認・再実行(§16.2 と整合)**
| 手順 | 担当 | 内容 |
|---|---|---|
| 1 検知 | 実行担当 + B | 実行後、Actions の run ページで黄色 warning と Step Summary を確認。B が注記から `revision_reviews` と固定記録IDを取り出す |
| 2 証拠の収集 | B(読み取り専用) | The Daily の注記、表4(直近6か月)、18-10-0256-01 の現在値、固定記録の `points`、`vectorId`、範囲(年齢 36 以内か)、変更の幅(参考: ±0.2 超に印) |
| 3 判定 | C(独立)+ HQ | 正当 / 異常 / 不明。異常・不明は承認しない(却下または保留) |
| 4 決定の記録 | HQ の決定を実行担当が `record-decision` で記録 | 承認対象月・承認者・理由・確認用ダイジェスト |
| 5 承認つき書き込み | 実行担当 | `apply-approved-revisions`(承認IDのみ) |
| 6 確認 | B(読み取り専用) | `event_revisions` の増加が承認対象月のうちイベントのある月と一致、初回値のスナップショットと他のイベントの fingerprint が不変、再実行しても増えない |
- 実行担当は**未確定**(§16.6)。決まるまで、手順 4・5 は実行できない。

#### 16.14.10 テスト(Y1〜Y20、Z1〜Z44)

**固定テストデータ(実データ)**: 2026-02-17 の年次改定(18-10-0259-01 の Release 2026-01-19 と 2026-02-17 の比較)。対象月 2026-01(年齢 0)。
- median: 14か月の変更 — 2023-04 4.1→4.2 / 2023-11 3.6→3.7 / 2024-04 3.1→3.0 / 2024-07 2.7→2.8 / 2024-11 2.7→2.6 / 2024-12 2.5→2.4 / 2025-01 2.6→2.5 / 2025-02 2.8→2.7 / 2025-03 2.8→2.7 / 2025-05 3.0→2.9 / 2025-06 3.0→2.9 / 2025-08 3.1→3.0 / 2025-10 3.0→2.9 / 2025-12 2.5→2.6。年齢は 2023-04 が 33、2025-12 が 1。年齢 1〜6(2025-07〜12)で変更されたのは 2025-08・10・12 の **3件**。
- trim: 6か月の変更 — 2024-05 3.0→3.1 / 2024-09 2.5→2.6 / 2024-10 2.7→2.8 / 2025-02 3.0→2.9 / 2025-04 3.2→3.1 / 2025-06 3.0→3.1。年齢 1〜6 では **0件**。
- 49点の窓: 年齢 0〜48 = 2026-01 〜 2022-01。

| # | 状況 | 期待 |
|---|---|---|
| Y1 | 通常月(対象月が1月以外): 年齢 1〜6 のうち3点が改定、`older` なし | `NORMAL`。3件(イベントのある月)を自動で書く |
| Y2 | 通常月: N = 6 | `STOP_BURST`。改定0件。初回値は保存。`safe_stops` |
| Y3 | 年次: 上の median の実データ(14か月、対象月 2026-01) | `ANNUAL_REVIEW`。候補14行。**書かない**。初回値は保存。終了コード 0。固定記録が作られる |
| Y4 | 年次: 上の trim の実データ(6か月。年齢 1〜6 は0件) | 候補6行を一覧化(通常月の窓では0件でも36か月で6件が見える)。書かない |
| Y5 | 6か月の窓の外(年齢 33)だけが変わった | 検知される(`older`)。`age` が出る |
| Y6 | 年次で候補が6件を超える(14件) | `REVISION_BURST_STOP` にならない。`ANNUAL_REVIEW` |
| Y7 | 承認前に何度実行しても | `event_revisions` は0行。候補一覧は固定記録から同じ内容 |
| Y8 | 承認(ダイジェスト一致)つきの実行 | 承認された月のうちイベントのある月だけ書かれる |
| Y9 | Y8 の直後に、同じ承認IDで実行 | 書き込み0(冪等) |
| Y10 | 承認の後に値が変わった | 書き込み0(`APPROVAL_STALE`)。新しい `version` で再確認 |
| Y11 | 対象月が1月以外で、年齢 7 以上が変わった | `STOP_UNEXPECTED_EXTENDED`。書かない |
| Y12 | 年齢 37〜48 が変わった | `STOP_POLICY_MISMATCH`。書かない |
| Y13 | 49点が取れない / 対象月が不正 / `vectorId` 不一致 | `STOP_UNKNOWN`。書かない |
| Y14 | 対象月が1月、年齢 1〜36 すべてに比較元があり、候補が0 | `ANNUAL_NO_CHANGE`。記録のみ |
| Y15 | 公表日が2月16日だが対象月は12月 | `NORMAL`(日付で分岐しない) |
| Y16 | trim が `ANNUAL_REVIEW` のとき、median は通常月 | median は通常どおり処理。ヘッドラインと初回値も独立 |
| Y17 | 部分承認 | §Z12〜Z14 |
| Y18 | イベントの無い月が候補 | 一覧・固定記録に出る。書かない(`NOT_WRITABLE`) |
| Y19 | dry-run | 一覧が出る。書き込みなし。固定記録も作らない |
| Y20 | 承認の記録に必須の項目が欠けている | 書かない |

**第4版で追加(Z1〜Z44)**
| # | 区分 | 状況 | 期待 |
|---|---|---|---|
| Z1 | 取得点数 | 年齢 0〜48 の49点が連続してそろう | 受理。点数 = 1 + 6 + 30 + 12 = 49 |
| Z2 | 取得点数 | 48点しかない(年齢 48 が欠ける) | `STOP_UNKNOWN` |
| Z3 | 取得点数 | 50点以上 | `STOP_UNKNOWN`(窓の定義と不一致。切り捨てて進めない) |
| Z4 | 取得点数 | 途中の1か月が欠ける(49点だが非連続) | `STOP_UNKNOWN` |
| Z5 | 取得点数 | 先頭の点が対象月でない | `STOP_UNKNOWN` |
| Z6 | 年齢の境界 | 年齢 48 の月だけが変わる | `STOP_POLICY_MISMATCH` |
| Z7 | 年齢の境界 | 年齢 47・48 が変わる | `STOP_POLICY_MISMATCH` |
| Z8 | 年齢の境界 | 年齢 36 だけが変わる(1月の対象月) | `ANNUAL_REVIEW`(年次の範囲内) |
| Z9 | 年齢の境界 | 年齢 37 だけが変わる | `STOP_POLICY_MISMATCH`(範囲外) |
| Z10 | 年齢の境界 | 年齢 6 と 7 の境界: 年齢 6 だけ / 年齢 7 だけ(1月以外) | 年齢 6 は N に数える(`NORMAL`)/ 年齢 7 は `STOP_UNEXPECTED_EXTENDED` |
| Z11 | 年齢の算出 | `refPer` の月差で年齢を出す(位置ではない) | 並びが乱れても年齢が正しい |
| Z12 | 部分承認 | 14候補のうち3月だけ承認 | その3月(イベントあり)だけ書かれる。残りは `UNREVIEWED` のまま |
| Z13 | 部分承認 | Z12 の後の次の実行 | 残りは `open_reviews` に出る。書かれない |
| Z14 | 部分承認 | 承認対象月に、候補に含まれない月が入っている | 決定の記録を拒否(承認対象月 ⊆ 候補) |
| Z15 | 比較元 | 初回の実行(固定記録が1つも無い)・対象月が1月 | `ANNUAL_NO_BASELINE`(`ANNUAL_NO_CHANGE` ではない)。`baseline_state = FIRST_OBSERVATION` |
| Z16 | 比較元 | 直前の固定記録に一部の月が無い | その月は `NO_BASELINE`。`ANNUAL_NO_CHANGE` にならない |
| Z17 | 比較元 | 直前の固定記録が保存期間切れ・削除 | `BASELINE_EXPIRED`。`ANNUAL_NO_CHANGE` にならない |
| Z18 | 比較元 | WDS の取得失敗 | `STOP_UNKNOWN`(`FETCH_FAILED`)。「変化なし」にならない |
| Z19 | 比較元 | 4種(初回・比較元なし・期限切れ・取得失敗)の記録の区別 | `baseline_state` がそれぞれ違う値で記録される |
| Z20 | 固定記録 | 承認の前後で固定記録が変化しない | `points`・`baseline`・`candidates`・`digest` が同一 |
| Z21 | 固定記録 | 固定記録の不変の項目を更新しようとする | 拒否(更新・削除が失敗する) |
| Z22 | 固定記録 | ダイジェストは固定記録から再計算できる | 再計算 = 保存 = 決定の記録のダイジェスト |
| Z23 | 固定記録 | 同じ公表日の2回目の実行(WDS が同じ) | 新しい記録を作らない(既存の記録のまま) |
| Z24 | 固定記録 | 同じ公表日の2回目の実行(WDS が変わった) | 新しい `version`。古い記録は `SUPERSEDED`。承認は無効 |
| Z25 | 承認後の再実行 | 最新の WDS が承認時点と異なる | **1行も書かない**(`APPROVAL_STALE`) |
| Z26 | 承認後の再実行 | 次の公表が出て窓がずれた | 書かない(`APPROVAL_STALE`) |
| Z27 | 途中失敗 | 5月のうち3月目で書き込みが失敗 | 1〜2月は書かれたまま。エラー。終了コード 1 |
| Z28 | 途中失敗 | Z27 の後、同じ承認IDで再実行 | 3〜5月だけ書かれる。1〜2月は `ALREADY_APPLIED` |
| Z29 | 途中失敗 | 書けたが書き込みの記録の追記が失敗 | 再実行でイベントの直近値 = `to` を見て `ALREADY_APPLIED`。重複しない |
| Z30 | 途中失敗 | イベントの直近値が `from` でも `to` でもない | `CONFLICT`。以降を止めて報告 |
| Z31 | 却下・保留 | 候補を却下した後の通常月 | `KNOWN`。N にも `older` にも数えない。停止しない |
| Z32 | 却下・保留 | 保留した候補の、次の公表での実行 | `REEVALUATION_DUE` の警告。通常月は妨げられない |
| Z33 | 却下・保留 | 保留が2回の公表を過ぎても未決定 | `EXPIRED`。HQ に報告。通常月は妨げられない |
| Z34 | 却下・保留 | 却下した候補の値が、StatCan でさらに変わった | 新しい `CANDIDATE`(既知の値と違う) |
| Z35 | 通常月の N | 年齢 0〜6 のうちイベントのない3月に比較元(固定記録)があり、7点とも違う | N = 7(イベントなしも数える)。`STOP_BURST` |
| Z36 | 通常月の N | 年齢 0〜6 のうち比較元のない月がある(N が不完全) | `STOP_BASELINE_INCOMPLETE`。自動で書かない(第5版で変更) |
| Z37 | 通常月の N | 初回値を保存する実行 | 年齢 0 は数えない。N の最大は6 |
| Z38 | 通常月の N | 後日の実行(年齢 0 が保存済み) | 年齢 0 も数える。最大7 |
| Z39 | 通常月の N | 同日の差・`KNOWN` の月 | N に数えない |
| Z40 | 系列の独立 | trim が `ANNUAL_REVIEW`、median が `NORMAL`、ヘッドラインが初回値 | median の改定は書かれる。ヘッドラインの初回値も保存される |
| Z41 | 系列の独立 | trim の承認つき書き込み | median・ヘッドラインのイベントは変わらない |
| Z42 | 重複防止 | 同じ承認IDで2回実行 | 2回目は書き込み0 |
| Z43 | 重複防止 | 同じ承認IDで2つの実行が同時に走る(ワークフロー外) | 書く直前の再読込で、一方だけが書く |
| Z44 | 役割の整理 | `--allow-revision-burst` を渡した | 受け付けない(廃止)。承認つき書き込みの1つの仕組みだけ |


**第5版で追加するテスト(H・R・A・D。I は §16.14.5.2、G は §16.15.1)**

*H: 引き継ぎ・既知の値・version(P2-1・P3)*
| # | 状況 | 期待 |
|---|---|---|
| H1 | 記録 R1 の `UNREVIEWED` の候補が、次の公表(R2)でも WDS の値が同じ | R2 の `carried[]` に `origin_record_id = R1` で入る。ログに `CARRY`。消えない |
| H2 | 引き継ぎ中の候補で、WDS が元の値(イベントの直近値)に戻った | `RESOLVED_BY_DATA`。`RESOLUTION` が1回だけ追記される。`carried[]` から外れる |
| H3 | 引き継ぎ中の候補で、WDS の値がさらに変わった | 古い項目は `SUPERSEDED_BY_NEWER`、新しい値で新しい候補。古い承認は無効 |
| H4 | `UNREVIEWED` の候補が、通常月の N に数えられない | N に数えないが、`open_reviews` に毎回出る(`KNOWN` に隠れない) |
| H5 | `ON_HOLD` の起点から、公表予定が2回到来(実行はなし) | `EXPIRED_UNRESOLVED`(実行の有無に関係なく、公表予定表で数える) |
| H6 | `EXPIRED_UNRESOLVED` | `KNOWN` にならない。`open_reviews` に昇格した警告で出る。明示の決定まで残る |
| H7 | `REJECTED`(`KNOWN`)の値が StatCan でさらに変わる / 年次改定の公表 | 新しい候補になる / 年次改定の確認で却下中の一覧が再掲される |
| H8 | 承認の後に WDS の値が変わった(STALE) | その月は書かない。承認が `INVALIDATION` で無効になる。項目は `OPEN` のまま次の記録へ。新しい値で再提示。古い承認IDでは書けない |
| H9 | 同じ公表日の v1 → v2: 同じ項目 / 値が変わった項目 / 消えた項目 / 新しく出た項目 | 同じ: `REJECTED`・`ON_HOLD` は維持、`APPROVED` は再承認が必要 / 変わった: `SUPERSEDED_BY_NEWER` / 消えた: `RESOLVED_BY_DATA` / 新規: 新しい候補 |
| H10 | 同じ公表日の A→B→A→B | v1(B)、v2(A。v1 の項目は `RESOLVED_BY_DATA`)、v3(B)の3つ。v3 は v1 と同じダイジェストでも別の `record_id`。v1 の承認で v3 には書けない |
| H11 | 2つの実行が同時に `version + 1` を作る | 一方が一意制約違反 → 再読込。最新の `points` が同じなら何もしない / 違えば `version + 1`。上限3回。超えたら `RECORD_CREATE_CONFLICT`(初回値は保存) |
| H12 | 直前の公表日の記録がない(古い記録だけ) | 古い記録を比較元にし、`baseline_gap_releases` を記録。記録が全くなければ `FIRST_OBSERVATION` |
| H13 | 49点の中に同じ月が2回ある(点数は49、または50) | `STOP_UNKNOWN`。重複した月の値が違っていても同じ |
| H14 | 前の記録が飛んでいる(実行されなかった公表がある)状態で、新しい記録を作る | 未解決の項目はログ全体から読まれ、`carried[]` に入る(前の記録がなくても消えない) |

*R: 承認の取り消し・無効化(P2-3)*
| # | 状況 | 期待 |
|---|---|---|
| R1 | 同じ月に `APPROVED` の後、`REJECTED` が追記される | 最新の決定は `REJECTED`(通番が最大)。以前の承認IDは無効 |
| R2 | 古い承認IDで書き込みを実行 | 書かない(`APPROVAL_REVOKED`) |
| R3 | 書き込みの実行中(3か月目の前)に取り消しが追記される | 次の月から止まる。書けた月は残る。残りは書かれない |
| R4 | 書き込み直前の再確認 | 各月の書き込みごとに最新の決定を読み直している(読み取り回数で検査) |
| R5 | 月ごとの決定が違う(月 A は承認、月 B は保留) | A だけ書く、B は書かない |
| R6 | 同じ記録・同じ月に複数の決定 | 通番が最大のもの(同時刻でも通番は一意) |
| R7 | `INVALIDATION`(STALE)の後に、同じ承認IDで実行 | 書かない |

*A: 承認者の監査・再試行履歴(P2-5)*
| # | 状況 | 期待 |
|---|---|---|
| A1 | 承認者を自由記述で入力 | `claimed_approver` として記録。`evidence_level = OPERATOR_ATTESTED`。HQ承認の証明として扱わない(出力・ログに「未認証」と明示) |
| A2 | 実行者 | `github.actor` と `run_id` が記録される(入力では上書きできない) |
| A3 | 指示の参照が空 | 決定を記録しない |
| A4 | 記録される項目 | 承認ID・指示の参照・実行者・主張された承認者・承認対象月・ダイジェスト・証跡の水準がそろう |
| A5 | 1回目 `FAILED`、2回目 `APPLIED` | 2行とも記録される(`attempt_no` が違う)。一意制約と矛盾しない |
| A6 | 同じ `(record_id, period)` に2回目の `APPLIED` | 拒否される(`APPLIED` は1行だけ) |
| A7 | `attempt_no` の採番が衝突 | 再読込して再試行(上限3回) |
| A8 | 承認対象月が候補に含まれない月 | 決定の記録を拒否 |

*D: 固定記録の保存先が使えないとき(P2-4)*
| # | 状況 | 期待 |
|---|---|---|
| D1 | 保存先が使えない(テーブルなし・接続失敗) | `STOP_NO_RECORD_STORE`。**初回値の保存は続行**。改定検知・改定書き込みは停止。黄色 `REVISION_DETECTION_UNAVAILABLE`。終了コード 0 |
| D2 | D1 のとき | N を計算しない(イベントだけの縮退計算が実行されないこと) |
| D3 | 初回の公表(固定記録が1件目、イベントのない月に比較元なし) | `STOP_BASELINE_INCOMPLETE`。自動で書かない |
| D4 | 2回目の公表(直前の記録が比較元) | N が完全。通常どおり判定 |
| D5 | 保存先が復旧した後の実行 | 通常の判定に戻る。停止中の分は取り戻さず、比較元は最新の記録から |

*変更するテスト(第5版)*
| # | 変更 |
|---|---|
| T7b | 「イベントのない3つの月に比較元が無い → N=4、4件書く」を廃止し、「N が不完全 → `STOP_BASELINE_INCOMPLETE`、自動で書かない」に変更 |
| Z16 | 比較元のない月 → `ANNUAL_NO_CHANGE` にならない(変更なし) |
| Z36 | 「比較元のない月は数えず、書き込みは対象外」を、「N が不完全 → 自動書き込みなし(`STOP_BASELINE_INCOMPLETE`)」に変更 |
| Z13・Z14・Z25・Z26・Z28・Z42 | 承認つき書き込みの判定を「承認された月ごと」(§16.14.7)に変更。Z25: 承認された月の WDS の値が違えば書かない / Z26: 次の公表で窓がずれても、61点の取得で承認された月が範囲に残れば書ける(範囲外なら `STALE`) |
| Z24 | 同じ公表日の 2回目の実行で 49点が変わった → 新しい `version` |


#### 16.14.11 未解決(この節)
1. 年次改定の**日付の規則**と**毎年1月分の公表が年次になる一般則**(公式の改定カレンダーは見つかっていない)。判定は日付に頼らない設計。
2. 「3年」の厳密な範囲(36か月の数え方)。観測では年齢 33 まで(2023-04)に収まった(1回の観測)。
3. **固定記録・追記専用ログ(新規2テーブル)のマイグレーションは、別の承認(第2段階)**。承認と実装が最初の年次改定(推定 2027-02-16)に間に合わなければ、候補は書き込まない。
4. 決定の記録・承認つき書き込みの2つの新しい手動 target と、workflow の入力の追加(今回は変更しない)。
5. 新方針下の観測が3回(通常月は2回)。6件閾値と ±0.2 の印は暫定。5〜10月分の実時間表が未更新。
6. ヘッドライン CPI の年次改定の有無(公式情報なし)。
7. 通常月の N に「イベントのない月」を数える定義は、固定記録の比較元がある場合だけ有効。最初の公表(比較元が無い)では、実質的に停止が機能しない期間がある。
8. 保留の「2回の公表」の期限は暫定値(HQ判断)。
9. 固定記録の保存先(新規2テーブル)のマイグレーション、トリガー・権限の変更は**別の承認(第2段階)**。所有者(`postgres`)・superuser による変更は防げない(§16.14.5.2)。
10. 承認者の証跡は `OPERATOR_ATTESTED` では**HQ承認の証明にならない**。環境の承認ゲートの利用可否は未確認(§16.14.6)。
11. 取り消しと書き込みが同時刻に起きる場合の1行分の競合は排除できない(§16.14.7)。
12. 年次改定の候補の書き込み対象は、保存済みのイベントのある月だけ(過去のイベントがない月は一覧にだけ出る)。

### 16.15 実装の2段階分離(第5版。HQ指示 2026-11-13「CA_CPIを2段階に分離する」)

**位置づけ**: 設計のみ。**今回、実装開始は承認されていない**。HQが第1段階の実装範囲を改めて判断する。

**原則**: 第1段階は、**固定記録のマイグレーションが未承認・未適用でも**、3指標の初回値の取り込みが動く構成にする。改定の検知・書き込みは第1段階で**停止**し、第2段階で、固定記録を前提に設計する。

#### 16.15.1 第1段階: 通常月の初回値の取り込み

**含めるもの(固定記録の保存先を使わない)**
| 項目 | 内容 | 設計書の節 |
|---|---|---|
| 3指標の初回値の取得・保存 | `CA_CPI`(指数から計算)・`CA_CPI_TRIM`・`CA_CPI_MEDIAN`(公表値) | §4.1・§4.2・§5.1 |
| 経路A / 経路B の分離 | 経路A(初回値)だけを有効にする。経路B(過去点の改定検知)は**モジュールとして分離するが、第1段階では呼ばない** | §4.3・§16.1 |
| 7日期限の一元管理 | `firstValueWindow`(7日・Toronto の暦日)。3指標すべてに設定。漏れは起動時に停止 | §15.2・§16.7 |
| 系列単位の部分失敗 | 系列ごとの独立と、構造破壊のときの CA_CPI 系3系列の停止 | §16.3 |
| 対象月を含む `attribution.notice` | `Adapted from …, October 2026.` / `Source: …, October 2026.`(A案)。内部の対象月から作り、公開 API に新しい項目は足さない | §16.5 |
| 初回値が取れないときの安全な停止と再試行 | 何も書かず PENDING のまま。期限内なら再実行してよい(冪等)。期限切れは自動救済しない(HQ承認の別手順) | §16.2・§16.6 |
| 期限間近の警告 | `deadline_warnings`(終了コード 0) | §16.6 |
| 指標のマスター(コア2指標のみ) | 指標2行・通貨ペア2行のマイグレーション(§15.6)。**これは固定記録のマイグレーションではない**。ヘッドライン `CA_CPI` は、既存の指標行を使うためマイグレーション不要 | §15.6 |
| `value_decimals`・出典・同日差のログ | `value_decimals` の一覧、`attribution` の関数、`same_day_diff` の記録(`ingestion_logs.details` への記録は既存の仕組み) | §14.2・§15.3 |

**含めないもの(第1段階で停止)**
- 改定の検知と書き込み(`event_revisions` への書き込み)。**3系列すべてで、`revisionMode = DISABLED`**(新しい設定。既存の `officialValues` が RELEASED の回に対して自動で改定を書く経路(`REVISE`)は、この3系列では**動かさない**)。
- 通常月の N 判定、`REVISION_BURST_STOP`、年次改定、`ANNUAL_*` のモード、承認、固定記録、追記専用ログ、新しい手動 target。
- 固定記録がない状態で、**不完全な N 判定を行わない**。イベントのある月だけで N を数える縮退動作は採用しない。

**第1段階の改定に関する出力(書き込みなし)**
- 実行の結果に `revision_detection: { mode: 'DISABLED_STAGE1' }` を出し、`::notice`(情報。警告ではない)を出す。
- **参考情報として**、保存済みの初回値と今の WDS の値が違う月があれば、`revision_observations: [{period, stored, observed}]` を標準出力に出す(**書き込まない・N を数えない・停止の根拠にしない**)。人が見るための情報。

**第1段階の独立性**
- 第1段階のコードは、固定記録・追記専用ログのモジュールを**読み込まない**(静的に検査する)。
- 固定記録のテーブルが DB に無くても、第1段階は動く(テーブルへの問い合わせをしない)。

**第1段階のテスト(G1〜G12)**
| # | 状況 | 期待 |
|---|---|---|
| G1 | 3系列の WDS の値がスナップショットと違う(後日の実行) | **`event_revisions` に1行も書かない**。`revision_observations` に出るだけ |
| G2 | 公表日に3系列の初回値 | 3系列とも保存される(独立) |
| G3 | `revision_detection` | `DISABLED_STAGE1`。終了コード 0。`REVISION_BURST_STOP` は出ない |
| G4 | 固定記録のテーブルが存在しない DB | 第1段階が通常どおり動く(固定記録への問い合わせが発生しない) |
| G5 | 系列単位の部分失敗(F1〜F12) | 第1段階でも成立 |
| G6 | notice に対象月 | N1〜N14 が成立(第1段階の範囲) |
| G7 | 7日期限の設定漏れ | V1〜V8 が成立 |
| G8 | 取得失敗 → 期限内の再実行 | 保存される。期限切れの再実行は保存されない |
| G9 | 静的検査 | 第1段階のコードが固定記録のモジュールを import しない |
| G10 | 設定 | `revisionMode` が 3系列とも `DISABLED`。他の値にすると、固定記録の保存先が使えない限り起動時に停止(第2段階の有効化は保存先の確認を必須にする) |
| G11 | 既存の GB・AU・`CA_UNEMPLOYMENT_RATE` | 挙動不変(回帰) |
| G12 | 経路Bのソース | `releaseTime` を参照しない(R10) |

#### 16.15.2 第2段階: 改定検知・承認・書き込み

**含めるもの(固定記録のマイグレーションの承認が前提)**
- 固定記録・追記専用ログ(新規2テーブル。§16.14.5)、不変性(§16.14.5.2)。
- 通常月の N 判定と `STOP_BURST`、`STOP_BASELINE_INCOMPLETE`、`STOP_NO_RECORD_STORE`。
- 年次改定の検知(36か月)、承認、承認つき書き込み、取り消し、STALE、再承認。
- 未解決候補の引き継ぎ、`KNOWN` / `OPEN`、`ON_HOLD` の期限。
- 新しい手動 target(`record-decision`・`apply-approved-revisions`)と、承認者の証跡。

**第2段階が固定記録を使えないとき(P2-4)**: 保存先が使えない(マイグレーション未適用・接続失敗)と、**改定検知・改定書き込みを停止**し、**初回値の取り込みは続行**する。`STOP_NO_RECORD_STORE`(§16.14.4 #0)。警告として `SAFE STOP: REVISION_DETECTION_UNAVAILABLE`(黄色。終了コード 0)。N は計算しない。**第2段階のコードを入れても、保存先が無ければ第1段階と同じ動き**になる。

**境界のまとめ**
| | 第1段階 | 第2段階 |
|---|---|---|
| 初回値の保存 | する | する(変更なし) |
| 改定の検知 | しない(参考表示のみ) | する(固定記録が前提) |
| 改定の書き込み | しない | する(通常月 N ≤ 5。年次は承認後) |
| 固定記録の保存先 | 不要 | 必要(新規2テーブル) |
| 新しい手動 target | 不要 | 必要(2つ) |
| マイグレーション | コア2指標の指標行・通貨ペア(ヘッドラインは不要) | 固定記録・追記専用ログ |
| workflow の変更 | 初回値の取り込みは既存の `official-values` の target(**変更の要否は実装時に確認**) | 2つの新しい手動 target |

#### 16.15.3 承認事項

**第1段階の実装に必要な承認(HQ)**
1. 第1段階の実装範囲(上の表)の承認と、実装開始の承認(ブランチ上の実装・テスト・CI まで)。
2. コア2指標の指標行・通貨ペアの**マイグレーションの作成**(別の承認)と、**DEV への適用**(さらに別の承認)。ヘッドラインのみなら不要。
3. 公表予定の取り込み(コア2指標の予定10件)の DEV 反映(dry-run → 承認 → 実行)。
4. 実行担当・副担当・週末の当番の確定(§16.6。**未確定**)。
5. 説明文・表示名の最終文言(表示名は確定済み。説明文は未確定)。
6. 出典の文言の最終確認(A案は確定。Aの追加確認の結果)。

**第2段階で残る承認事項**
1. 固定記録・追記専用ログのマイグレーション(新規2テーブル。トリガー・権限の変更を含む)の作成と DEV 適用。
2. 追記専用ログの構成(決定と書き込みの統合)の承認。
3. `record-decision`・`apply-approved-revisions` の新しい手動 target と、workflow の変更。
4. 承認者の証跡の水準(`OPERATOR_ATTESTED` のままか、環境の承認ゲートを使うか)。
5. 年次改定の範囲(書き込み対象を保存済みイベントに限る点)。
6. `ON_HOLD` の期限(2回の公表)、`KNOWN` の再確認の頻度、閾値(6件)の暫定の扱い。
7. 通知(PRO の3件)、他の面の出典、`CA_UNEMPLOYMENT_RATE` の notice の対象月。

### 16.16 Cの P2-1〜P2-6 と P3 への対応表(第5版)

| 指摘 | 修正箇所 | テスト |
|---|---|---|
| P2-1 保留・未決定候補の引き継ぎ(次回公表で消えない、次の記録への引き継ぎ、STALE の再承認経路、`KNOWN` が隠さない、旧 / 新 version の候補) | §16.14.8(引き継ぎの表、`OPEN` / `KNOWN` の寿命、version の表)、§16.14.7(STALE の再承認)、§16.14.5(`carried[]`) | H1〜H9 |
| P2-2 固定記録の不変性(UPDATE / DELETE トリガー、TRUNCATE、service_role の権限、保証と限界) | §16.14.5.2 | I1〜I10 |
| P2-3 承認の取り消し・無効化(最新の決定の特定、古い承認IDの無効化、書き込み直前の再確認) | §16.14.5(通番で最新の決定)、§16.14.7 | R1〜R7 |
| P2-4 固定記録がないときの N 判定(縮退動作を採用しない) | §16.14.4 の #0・#5b、§16.15.1・§16.15.2 | D1〜D5、G1〜G12 |
| P2-5 承認者の監査(実行者 / 主張された承認者 / 指示の参照、再試行履歴と一意制約、保証と限界) | §16.14.6 | A1〜A8 |
| P2-6 既存DB機構との比較(`ingestion_staged_values`・`official_observations`・`ingestion_logs`・新規テーブル案) | §16.14.5.1 | — |
| P3 `KNOWN` の寿命と再評価条件 | §16.14.8 | H4〜H7 |
| P3 `EXPIRED` の起点と公表回数の数え方 | §16.14.8 | H5・H6 |
| P3 同一公表日の A→B→A の version | §16.14.8 | H10 |
| P3 同時作成の一意制約違反と再試行 | §16.14.8 | H11 |
| P3 直前の公表日の記録がない場合の比較元 | §16.14.3 | H12 |
| P3 49点内の重複月の検出 | §16.14.4 の #1 | H13 |
| 運用(11/16・11/23・体制・エスカレーション) | §16.6、§16.12 | O9〜O12 |

