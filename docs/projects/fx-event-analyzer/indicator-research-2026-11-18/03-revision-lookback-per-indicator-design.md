# 改定確認期間と状態修復期間の設計案(第 3 版、2026-11-18)

担当 D。設計のみ(コード・migration・DB・DEV の変更なし)。前提: settings `7fa2df26`(QA-1・WPI 統合後)。

**第 3 版の変更**(C のレビューによる):
① 状態修復の安全性: 修復期間は **90 日**(180 日の記述を整理)。`economic_events.updated_at` と `event_snapshots.created_at` を使い、**スナップショットの保存後にイベントが更新された行は自動修復せず `REPAIR_CANDIDATE` として報告**。
② 修復上限 `maxRepairsPerRun = 20` を**ジョブ実行全体の上限**にし、処理順・失敗行の扱い・件数の記録を定義。
③ 英国 GDP は **「日数」ではなく「直近 N 件」方式**(QoQ 直近 12 四半期、MoM 直近 36 か月。HQ の暫定方針)。1,700 日の固定案は採用しない。
④ 公表間隔の回帰テストの**保証する範囲・しない範囲**を明記。WPI の 97 日の計算に必要な、既公表日の行を表に含める。

**第 4 版の変更**(C の最新レビューによる):
① `latestEvents` の定義の修正(DB にイベントが有る・RELEASE のスナップショットが有る・指標ごとに数える。予定表の行数ではない)、② 英国 GDP の追跡範囲(改定の約 3 分の 1 が範囲外になる可能性、年 1 回の dry-run 確認、追跡範囲外の値を「最新の公式値」と断定しない)、③ QA-1 修復の中断をインフラ系の失敗だけに限定・`repair_unattempted_count`・複数 RELEASE の取得方法、④ 品質レポートでの修復件数の表示、⑤ `revisionWindow` のテスト(上限・下限・0 以下の拒否・`latestEvents` と `days` を別々に)、⑥ **実行頻度の前提**(official-values・JP CPI は今は手動実行だけ)。

第 1 版の「月次は 45 日で足りる」は、余裕が 10 日で基準(21 日)を満たさず、撤回済み。

## 1. 現状(コードで確認した事実)
| 場所 | 現状 |
|---|---|
| `ingestOfficialValues`(`pipelines/officialValues.ts`) | `deps.lookbackDays`(既定 **45**)1 つを、全指標の ①初回値の取り込み ②改定の確認 ③QA-1 の状態修復 に共通で適用 |
| 処理の順序 | **ソースごとに**: `listEventsByProvider(table.provider)`(**ソースごとに 1 回**)→ 公表日時で絞る → **公式 API を取得** → (失敗なら `continue`)→ イベントごとに修復・改定・初回値 |
| **問題 1(結合)** | 状態修復が、改定確認と同じ期間・同じ取得の後ろにある。修復だけ期間を変えられない |
| **問題 2(API 依存)** | 公式 API の取得が失敗する(`FETCH_FAILED`)と、イベントのループに入らず、**状態修復も行われない** |
| 初回値だけの期限 | `OfficialValueSource.maxDaysAfterRelease`(ABS 系 7 日)、`JP_CPI_MAX_DAYS_AFTER_RELEASE`(14 日) |
| `ingestJpCpiValues` | 同様に `deps.lookbackDays`(45)。修復は取得の後ろ |
| `JobCounters.note` | キーごとに**最大 50 件**で打ち切る(`runner.ts`) |
| **実行の頻度(前提)** | **official-values(`official-values`・`official-values-dry-run`)と JP CPI(`jp-cpi-values` など)は、今は手動実行(`workflow_dispatch`)だけ**。定時実行(`schedule`)は無い(`fx-event-analyzer-ingestion.yml` で確認、2026-11-18)。Eurostat(`official-eurostat`)も手動だけ。**「日次で回る」「次の実行で直る」は、定時実行が承認・実装されるまでは成り立たない**。本書の運用上の記述は、すべてこの前提で読む |
| `economic_events.updated_at` | あり(`set_updated_at` トリガーで、**UPDATE のたびに更新**) |
| `event_snapshots.created_at` | あり(`default now()`)。`unique (event_id, snapshot_type)` で、**RELEASE のスナップショットは 1 イベントに 1 件**。RELEASE は DB のトリガーで更新・削除できない |

## 2. 公表間隔の実測と、日数方式の改定確認期間
**基準**: `revisionLookbackDays` ≥ **最長の公表間隔 + 21 日**(次の公表で前の回が改定されるのを確実に拾い、実行の遅れ・障害に 3 週間の余裕を持たせる)。

間隔は、公表予定の表(`gbAuCaSchedule.ts`・`jpCpiSchedule.ts`)の**確認済みの公表日**から数えた(2026-11-18)。**WPI の 97 日は、既に公表済みの 2026-11-18 の回から数える**ので、**表に既公表日の行を含める**(§2.2)。

| 指標 | 公表の間隔(日) | 最長 | +21 | **推奨 `revisionLookbackDays`**(日数方式) |
|---|---|---|---|---|
| GB_CPI・GB_CORE_CPI | 表に 1 回のみ。ONS の他の月次指標の実績 | 35 | 56 | **56** |
| GB_UNEMPLOYMENT_RATE | 28・35・28 | 35 | 56 | **56** |
| GB_RETAIL_SALES_MOM | 28・28・35・28・34・29(2026-10-23 の既公表日から) | 35 | 56 | **56** |
| **AU_CPI** | 28・**42**・21・28・28・35(2026-10-28 の既公表日から) | **42** | 63 | **63** |
| AU_UNEMPLOYMENT_RATE | 35・28・35・28・35・21 | 35 | 56 | **56** |
| **AU_WPI_QOQ** | **97**・85・91(**2026-11-18 の既公表日** → 2027-02-23 → 05-19 → 08-18) | **97** | 118 | **120**(7 日単位に切り上げ) |
| CA_UNEMPLOYMENT_RATE | 28・35・28・35(2026-11-06 の既公表日から) | 35 | 56 | **56** |
| CA_CPI(値は未対応・予定のみ) | 27・28・35・29・27 | 35 | 56 | 56(値の取り込みを入れるとき) |
| JP_CPI | 28・35・28・28 | 35 | 56 | **56**(CPI の前年同月比は通常改定されないが、確認処理があるので揃える) |
| 豪州の家計支出 HSI(調査中) | 26・43・28 | 43 | 64 | 70 |

**日数方式から外すもの(§3)**: GB_GDP_MOM・GB_GDP_QOQ は、改定が長く続くため、**直近 N 件方式**にする。

- 結論: **45 日が基準を満たす指標は無い**。**既存の全ソースに明示の値を持たせる**。
- 7 日単位への切り上げは、運用の数えやすさだけの理由。

### 2.1 回帰テストが保証する範囲(C の指摘)
**保証すること**: 公表予定の表に載っている**公表日の並び**から計算した最長間隔に対して、`revisionLookbackDays ≥ 最長間隔 + 21`。すなわち、**表にある連続する 2 回の公表の間では、前の回が次の公表で改定されたとき、その改定を確認できる期間**が残ること。表の行を足して間隔が延びたら、テストが失敗して見直しを促す。

**保証しないこと**:
1. **それ以上の長期の改定**(次の公表より後、数か月〜数年後の改定)を**検出できる保証ではない**。例: ONS の GDP は数年前が動く。この種の指標は §3 の件数方式で扱い、それでも追跡範囲外の改定は検出されない。
2. **表に載っていない将来の公表**の間隔(日程が変わった・延期された)。
3. 年次改定・基準改定(全履歴が動く)。実行時の指定 `deps.revisionLookbackDays` を一度だけ長くして対応する運用(別設計)。
4. 実行の停止が 21 日を超えたとき(余裕の外)。

### 2.2 表への既公表日の行の追加(WPI の 97 日の前提)
- WPI の最長間隔 97 日は、**2026-11-18(公表済み)→ 2027-02-23** の間隔。現在の表(`ABS_SCHEDULE`)には 2027-02-23 以降の 3 行しかなく、**2026-11-18 の行が無いので、テストが 97 日を計算できない**。
- 設計: 表に、**公表済みの直近の回の行**(WPI は 2026-11-18)を**「既公表」として含める**。イベントは作らない(公表日が過去の行は、既存の取り込みが `past` として数えるだけで書かない)。他の指標も、**直近の既公表日を 1 行ずつ**足す(例: AU_CPI の 2026-10-28、CA_UNEMPLOYMENT_RATE の 2026-11-06、GB_RETAIL_SALES_MOM の 2026-10-23)。
- 既存のテスト「すべての行が確認日より未来」は、既公表の行を許すように変える(実装時)。
- 既公表の行は、**公式ページで公表日を確認したものだけ**(確認できない回は入れない。WPI の 2026-08 は未確認なので入れない)。

### 2.3 既公表日の行を足すときの、更新対象のテスト(列挙)
| テストファイル | 更新の内容 |
|---|---|
| `tests/ingestion/gbAuCaSchedule.test.ts` | 「すべての行が確認日より未来」の検査を、既公表の行を許す形に変更。行数の期待値(ONS・ABS・StatCan の件数、取り込みの `inserted`・`unchanged`・`past`)を更新。`past` に既公表の行が数えられること(イベントは作られない) |
| `tests/ingestion/absOfficialValues.test.ts` | ABS の `referencePeriod` の一覧(`AU_CPI`・`AU_UNEMPLOYMENT_RATE`)に、既公表の行(2026-10-28・2026-10-15)を反映 |
| `tests/ingestion/auWpiValues.test.ts` | WPI の表の行(3 行 → 4 行、先頭が 2026-11-18 の既公表)、`checkedAt`・出典の検査 |
| `tests/ingestion/gbGdpValues.test.ts`・`gbRetailSalesValues.test.ts`・`gbUnemploymentValues.test.ts` | 表の行の件数・並びの検査(既公表日の行が加わる場合) |
| `tests/ingestion/jpCpiSchedule.test.ts`(JP CPI の表を同じ方式にする場合) | 既公表の回の行 |
| 新規 `tests/ingestion/revisionLookbackSchedule.test.ts`(案) | 各ソースの `revisionLookbackDays ≥ 最長間隔 + 21`(WPI = 97、AU_CPI = 42 を含む)。**このテストは、長期の改定を検出できる保証ではない**(§2.1) |
- 既公表の行を入れても、`officialScheduleTable.ts` の取り込みは、公表日が過去の行を `past` として数えるだけで書かない(既存の動作)ことを、テストで確かめる。

## 3. 英国 GDP: 日数ではなく「直近 N 件」方式(HQ の暫定方針)
**1,700 日の固定案は採用しない**(C の指摘・HQ の方針)。日数では、導入直後は件数が少なく、改定の長さも一定でない。

### 3.1 方針(採用)
| 指標 | 追跡範囲 | 備考 |
|---|---|---|
| **GB_GDP_QOQ**(四半期) | **直近 12 四半期**(12 件のイベント) | 約 3 年 |
| **GB_GDP_MOM**(月次) | **直近 36 か月**(36 件のイベント) | 約 3 年。現在の 56 日方式から置き換え |
- 上記を**採用方針**として整理する(HQ の暫定方針。毎年の確認で見直す)。
- **改定の約 3 分の 1 が、追跡範囲外になる可能性がある**。D の実測(英国 GDP 四半期、pn2 の 47 データ点、204 回の改定)で、**約 3 年(1,095 日)を超える改定が 29%(60 件)**。C の集計でも同程度。月次 GDP の 36 か月については、過去の版の集計をしていない(同程度の可能性)。
- **追跡範囲外の値は、「最新の公式値」と断定しない**:
  - 初回値 = `RELEASE` スナップショット(不変)。
  - 追跡範囲内のイベントの最後の ACTUAL(`event_revisions`)= 「**最後に確認した公式値**」(確認の日付つき)。
  - 追跡範囲外のイベントの値は、「最新の公式値」ではなく、**「最後に確認した値(確認時点のもの)」**。現在の ONS の値と一致するとは限らない。画面・API・文書で「最新」と表記しない(表記の変更は別途)。
  - 現在の `event_revisions` には、確認した日付(最後に確認した日時)の列が**無い**(`effective_at` は改定の日付)。「最終確認日」を持たせるには、DB 変更が要る(HQ の承認事項。本書では要望として記録)。

### 3.2 `latestEvents` の定義(修正)
`latestEvents: N` = **その指標の、次の 3 つの条件をすべて満たすイベントを、公表日時の新しい順に N 件**。
1. **DB に `economic_events` の行が存在する**(予定表の行ではない。`listEventsByProvider` の結果を、**指標で絞る**)。
2. **RELEASE のスナップショットが存在する**(初回値が保存済み)。
3. 公表日時が `now` 以前で、`CANCELLED` ではない。
- **指標ごとに数える**。同じ provider の表を共有する他の指標のイベントは、数えない。
- **公表予定表の行数では数えない**。予定表には、まだイベントが作られていない回・未来の回・取りやめの回がある。例: 予定表に 20 行があっても、DB に 12 件、うち RELEASE のスナップショットが有るのが 5 件なら、N = 12 でも対象は **5 件**。
- RELEASE のスナップショットが無い(初回値が未取得の)イベントは、`latestEvents` の件数に**入らない**(初回値の取り込みで別に扱う。`maxDaysAfterRelease` の範囲)。
- 取得の手順: 新しい順に `getReleaseSnapshot` を呼び、RELEASE が有るものを N 件見つけた時点で打ち切る。**DB の問い合わせは、最大でも、その指標のイベント数**(未取得のイベントがあれば、その分が増える)。

### 3.3 設定の持ち方と検証
```ts
revisionWindow?: { days: number } | { latestEvents: number }
```
- **`days` と `latestEvents` は、どちらか 1 つだけ**。両方・どちらも無い指定は拒否。
- **検証(下限・上限)**: `days` は **1 以上 3,650 以下の整数**、`latestEvents` は **1 以上 200 以下の整数**。**0 以下・小数・NaN・無限大は拒否**(起動時にエラー。誤って窓が空になり、改定確認が全く行われなくなるのを防ぐ)。上限は、誤った巨大な値による全件走査の防止。
- 優先順位: 実行時 `deps.revisionLookbackDays`(日数)> `source.revisionWindow` > 既定(日数 45)。**実行時の指定があれば、全ソースが日数方式になる**。
- 初回値の期限 `maxDaysAfterRelease`(GB_GDP_QOQ・GB_GDP_MOM は 7 日と明示)と、状態修復の期間は、**どちらも別**。

### 3.4 追跡範囲外の確認(年 1 回、dry-run)
追跡範囲外で、公式の値が動いていないかを、年 1 回、確認する。
- **時期**: 毎年 **11 月の初回推計の後**(英国 GDP は 11 月中旬)。
- **実行**:
  1. **指標を限定**して実行する(`--indicators GB_GDP_QOQ,GB_GDP_MOM`、またはワークフローの入力)。**他の指標のソースは処理しない**(公式 API の呼び出しも DB の参照も、対象の指標だけ)。この「指標の限定」は、実装時に `ingestOfficialValues` の `deps.indicators`(コードの一覧)として設計する。
  2. **深い窓**: 実行時の指定(`--revision-latest-events 60` など、範囲外まで含める)+ **`--dry-run`**。
  3. **dry-run は書かない**。plan に `REVISE` を出し、**追跡範囲の内/外**の件数、**範囲外で値が違うイベントの件数・最大の差・最も古い日付**を数える。
- **報告**: 件数・差・日付を HQ に報告する。範囲を広げるか(12/36 → 増やす)を判断する材料にする。
- **書き込みを伴う深い確認は、HQ の承認後**にだけ行う(dry-run の結果を見てから)。
- 実行は、今は手動(`workflow_dispatch`)。定時実行は、承認・実装されるまで前提にしない。

### 3.5 費用・処理件数・保存履歴
| 項目 | 評価 |
|---|---|
| 対象イベント数 | QoQ 最大 12、MoM 最大 36(§3.2 の 3 条件を満たすイベントだけ。導入直後は少ない) |
| 公式 API の呼び出し | 変わらない(指標ごとに 1〜2 回。四半期は pn2 と qna) |
| DB の問い合わせ | イベントごとに `getReleaseSnapshot`・`latestRevisionValues` の 2 回。MoM 36 件で約 72 回/実行。**実行は手動**なので、頻度は人の運用次第(**定時実行を前提にしない**)。負荷は小さい |
| 保存履歴(`event_revisions`) | **値が変わったときだけ**書く。年に数十行 |

## 4. 設計: 2 つの期間を完全に分離する
| | 改定確認(`revisionLookbackDays` / `revisionWindow`) | 状態修復(`repairLookbackDays`) |
|---|---|---|
| 目的 | 公式 API の値を使う処理(①初回値の取り込み ②改定の確認) | QA-1 の状態修復だけ |
| 公式 API | **使う**(取得に失敗したら何もしない) | **使わない**(取得の前に、DB だけで完結) |
| 設定の単位 | 実行時 / 指標別 / 既定 | 実行時 / 既定(指標別は持たない) |
| 既定値 | **45 日**(指標別を持たないソースだけに効く保険。既存の全ソースは明示の値・窓を持つ) | **90 日** |
| 優先順位 | 実行時 > 指標別 > 45 日 | 実行時 > 90 日 |
| 初回値の期限 `maxDaysAfterRelease` | **別項目のまま独立**(ABS 7 日・JP 14 日・GB GDP 7 日) | 関係なし |

**`deps.lookbackDays`(既存)の扱い(互換)**: `revisionLookbackDays` の**別名**として残す。**`ingestOfficialValues` と `ingestJpCpiValues` の両方で同じ**(JP CPI の `deps.lookbackDays` も `revisionLookbackDays` の別名)。**QA-1 の修復期間の指定には使わない**。`releaseRecovery.ts` の運用の説明(「一度だけ `lookbackDays` を延ばして回復」)は、`repairLookbackDays` に書き換える(実装時)。

**長い改定確認が修復範囲を広げない**: 修復は、ソースの設定(`revisionWindow`・件数方式を含む)を**受け取らない**。GB_GDP_MOM の 36 件・GB_GDP_QOQ の 12 件、あるいは実行時に `revisionLookbackDays` を延ばしても、**修復の範囲は `repairLookbackDays`(90 日)のまま**。

## 5. 状態修復の設計(API から独立・安全側)
### 5.1 構成
1. `ingestOfficialValues` の**先頭**(ソースのループの前)に独立した処理 `repairStuckReleasedStates` を置く。**`fetcher` を使わない**。
2. **`listEventsByProvider` の呼び出し(正確に)**: 現在は**ソースごとに 1 回**(同じ表を共有する ONS の 5 ソースで 5 回)。修復の前処理は、**表(provider)ごとに追加で 1 回**呼ぶ(ONS・ABS・StatCan の 3 表で**追加 3 回**/実行、JP CPI は別)。DB の問い合わせは**増える**(第 2 版の「増えない」は誤り)。修復の結果を後続のソースの処理へ渡す最適化(同じ一覧を再利用)は、実装の選択肢。
3. メモリ上で絞る: その表の行に当たり、**`status = SCHEDULED` かつ `data_status = PENDING`**、公表日時が `now − repairMs ≤ 公表日時 ≤ now`(`repairLookbackDays` = 90)。公表の日時が未来の行は対象外。
4. 絞った行についてだけ、RELEASE のスナップショットを**配列で取得**(§5.3 の `listReleaseSnapshots` 案。`getReleaseSnapshot` の `.maybeSingle()` は 2 件以上で例外になるため使わない)し、**スナップショットが有る行だけ**を、§5.2 の安全判定にかける。
5. 自動修復: `updateEvent(id, { status: 'RELEASED', data_status: 'AVAILABLE' })` だけ。スナップショット・改定の履歴・値は触らない。
6. 順序: ①状態修復 → ②ソースのループ。dry-run は plan に出すだけ。

**`needsReleasedStateRepair` の扱い**: official-values の経路が対象にするのは **SCHEDULED/PENDING だけ**。現在の `needsReleasedStateRepair`(SCHEDULED/PENDING と **RELEASED/PENDING**)は、**経済カレンダー経路(第 2 段階)のために残す**(カレンダー経路は、実績つきの新規行を RELEASED/PENDING で作り、`publishRelease` が AVAILABLE にするため、RELEASED/PENDING の stuck がある)。official-values 側は、より狭い判定(SCHEDULED/PENDING のみ)に差し替える(実装時)。

### 5.2 自動修復してよい条件(すべて満たすときだけ)
1. RELEASE のスナップショットが存在し、`actual` が非 null。
2. 状態が `SCHEDULED/PENDING`(official-values の経路)。
3. **スナップショットの保存後に、イベントが更新されていない**:
   `event.updated_at ≤ snapshot.created_at`
   - 理由: 正常な stuck 行は、`insertEvent`(`updated_at` = 作成時)→ スナップショットの保存(`created_at`)→ 状態更新の失敗、の順なので、**`updated_at` ≤ `created_at`**。人が後からイベントを SCHEDULED/PENDING に戻した(取り下げ)・日程を変えた、などの行は、`updated_at` > `created_at` になる。
   - 両方とも DB の `now()` で付くので、同じ時計で比べられる(実装側の時計は使わない)。
   - DB のスキーマ変更は不要(列は既存)。**必要な変更**: `listEventsByProvider` の select に `updated_at`、`getReleaseSnapshot` の select に `created_at` を足す(コードの変更。実装時)。
4. 公表日時が `repairLookbackDays` の範囲内。
5. 触らない状態: `CANCELLED`(どの `data_status` でも)、`RELEASED/*`、`SCHEDULED/AVAILABLE|PARTIAL|UNAVAILABLE`。

**3 を満たさない行は自動修復せず `REPAIR_CANDIDATE` として報告**する(plan に `REPAIR_CANDIDATE`、理由 `EVENT_UPDATED_AFTER_SNAPSHOT`)。人が確認してから、手動で直す。
同じく `REPAIR_CANDIDATE` にするもの: 公表日時が 90 日より古い行(理由 `OUTSIDE_REPAIR_WINDOW`。範囲外の行は、件数だけ数え、個別には報告しない案も可)、`actual` が null のスナップショット(`SNAPSHOT_WITHOUT_ACTUAL`)。

### 5.3 複数のスナップショットがある場合の比較方法と、取得方法
- `event_snapshots` は `unique (event_id, snapshot_type)`。**RELEASE は 1 イベントに 1 件**(DB のトリガーで更新・削除不可)。**現在のコードが書く・読む種別は RELEASE だけ**だが、`snapshot_type` に CHECK 制約は無く、**スキーマ上は他の種別が別に存在しうる**。
- **比較の基準は、RELEASE のスナップショットの `created_at` だけ**。他の種別は見ない。
- **取得方法(修正)**: 現在の `getReleaseSnapshot` は、`.maybeSingle()` で 1 件を取る。**行が 2 件以上あると、PostgREST がエラーを返し、例外になる**(= 「失敗」として数えられてしまう)。異常を**候補として分類**するため、**RELEASE のスナップショットを配列で取る取得**(`listReleaseSnapshots(eventId)` 案、`snapshot_type = 'RELEASE'` で絞り、`limit 2`。または複数イベントを一度に取る)を、修復の前処理だけに使う。
  - 0 件 → 対象外(スナップショットなし)。
  - 1 件 → §5.2 の判定。
  - **2 件以上**(制約上は起きない異常)→ **失敗ではなく `REPAIR_CANDIDATE`**(理由 `MULTIPLE_RELEASE_SNAPSHOTS`)。自動修復しない。
- 比較は `event.updated_at ≤ RELEASE.created_at`。別の種別のスナップショットが後に作られていても、それを理由に修復する・しないを変えない。

### 5.4 修復の上限・処理順・失敗の扱い(`maxRepairsPerRun`)
- **`maxRepairsPerRun = 20` は、ジョブの実行全体の上限**(表ごと・ソースごとではない)。JP CPI は別のジョブなので別の上限(同じ定数)。
- **処理の順序**: 全表の修復の候補を集め、**公表日時の古い順**に処理する。
- **失敗行が上限枠を占有しない**: 上限に数えるのは**成功した修復だけ**。失敗した行は、枠を消費せず、次の行に進む。試行の上限(案: 上限の 2 倍 = 40 行)を置く。
- **失敗の種類で、扱いを分ける**(修正)。**中断は、インフラ系の失敗だけ**。

| 種類 | 例 | 扱い |
|---|---|---|
| **インフラ系** | 接続エラー(`fetch failed`・`ECONNRESET`・`ECONNREFUSED`)、タイムアウト(`AbortError`・`ETIMEDOUT`・PostgreSQL の `57014`)、HTTP **5xx**(502・503・504 など)、接続・資源・シャットダウン系の SQLSTATE(`08xxx`・`53xxx`・`57P0x`) | **3 回連続**で失敗したら、DB・ネットワークの障害とみなして**中断**。残りは未試行(`repair_unattempted_count`)。次の実行で再試行 |
| **行固有** | 制約違反(`23xxx`: CHECK・外部キー・一意)、**権限**(`42501`・RLS)、**4xx**(400・401・403・404・409・422)、行が存在しない、DB トリガーの例外(`P0001`) | **その行を失敗として隔離**(`repair_failed_row_count`)し、**次の行に進む**。**連続失敗のカウントには数えない**(カウンターを増やさない・リセットもしない)。成功した行で、連続失敗のカウンターは 0 に戻る |
| **判別不能** | 上のどちらにも当たらない例外 | 行固有として隔離して先に進む(誤って中断しない)。ただし**試行の上限(40)**で全体を止める。分類できなかった件数も数える(`repair_failed_unclassified_count`)。実装時に、実際のエラーの形(supabase-js の `PostgrestError` の `code`・HTTP の `status`)に合わせて、分類を固める |
- 分類は、`isInfrastructureError(error)` として**1 か所**に置く。現在の `ingestionRepository` は、エラー(`PostgrestError`)をそのまま `throw` しており、HTTP の `status` を持たない。**実装時に、`status` を取り出せるよう、`throw` するエラーに付加する**(コードの変更)。
- **上限・中断・試行の上限で修復しなかった行**は、`REPAIR_CANDIDATE` として報告する(人の確認)。

### 5.5 件数の記録(`JobCounters.note` の 50 件制限への対応)
- `note` は、キーごとに**50 件で打ち切る**。stuck が多いと、**件数が欠ける**ので、**件数は `note` に頼らず、別管理**する。`counters.details` に、**数値のフィールド**として記録する。

| フィールド | 内容 |
|---|---|
| `repair_eligible_count` | 修復の対象になった行(§5.2 の条件を満たし、試行の対象) |
| `repair_attempted_count` | 試行した行 |
| `repaired_count` | 成功した修復 |
| `repair_failed_count` | 失敗した行(内訳: `repair_failed_infra_count`・`repair_failed_row_count`・`repair_failed_unclassified_count`) |
| `repair_capped_count` | `maxRepairsPerRun`(20)に達して見送った行 |
| **`repair_unattempted_count`** | **連続失敗の中断・試行の上限のために、試行しなかった行**(`repair_capped_count` とは別) |
| `repair_candidate_count` | `REPAIR_CANDIDATE`(理由別の内訳 `repair_candidate_by_reason`) |
| `repair_aborted` | インフラ系の連続失敗で中断したか(bool) |
- **整合の式**(受け入れ条件): `repair_eligible_count = repaired_count + repair_failed_count + repair_capped_count + repair_unattempted_count`。件数が合わないとき(漏れ・二重計上)は、テストが失敗する。
- 個々の行の記録(`note`)は、**最初の 50 件**だけ。**件数は上の数値が正**。

### 5.6 API 障害中の受け入れ条件
公式 API がすべて 503 でも、`repairStuckReleasedStates` は、範囲内(90 日)の対象行(§5.2 の条件を満たす行)を `RELEASED/AVAILABLE` に直す。取り込み(②)は、これまでどおり `FETCH_FAILED` で何も書かない。

### 5.7 品質レポートでの修復件数の表示(`quality/metrics.ts`・`report.ts`)
- **データの出どころ**: `ingestion_logs.details` の数値フィールド(§5.5)。ジョブは `ingest:official-values`・`ingest:official:jp-cpi-values`(`jobName(log)` で判別、既存)。
- **`metrics.ts`**: 修復の集計を返す関数を追加(例 `summarizeRepairs(logs)`)。ジョブごとに、**最新の実行**の `repair_*_count` と、期間内の実行の合計を返す。`details` に値が無い古い行(この記録より前)は **null**(0 と区別。既存の `source_future_count` などと同じ流儀)。**`note` のリスト(最大 50 件)の長さを件数として使わない**。
- **`report.ts`**: データ品質レポートに「状態修復(QA-1)」の節を追加(`renderDataQualityMarkdown` の中)。表示: 最新の実行の日時・ジョブ、修復の件数(`repaired`・`failed`(内訳)・`capped`・`unattempted`・`candidate`(理由別))、`repair_aborted`、**`REPAIR_CANDIDATE` が 1 件でもあれば警告**(人の確認が要る)。件数が 0 の健全な状態も、「0 件」と表示する。
- **受け入れ条件**:
  1. **stuck 行が 50 件を超える場合でも、正しい件数が確認できる**。例: 60 行の stuck(うち修復 20・上限で見送り 40)を作り、`note` は 50 件で打ち切られても、レポートに「修復 20・見送り 40」が出る。
  2. §5.5 の整合の式が、レポートの数値でも成り立つ。
  3. 古い実行(新しいフィールドが無い)は、エラーにならず「記録なし」と表示。
  4. 修復の候補(`REPAIR_CANDIDATE`)の理由別の件数が出る。
- テストは `tests/ingestion/dataQuality.test.ts` の形式で、`summarizeRepairs` と `renderDataQualityMarkdown` に追加。

## 6. 修復期間 90 日の根拠と、180 日の位置づけ
**既定は 90 日**(180 日ではない)。第 2 版以前の「180 日」を既定とする記述は、**採用しない**。180 日は、**手動の確認を経た一度きりの実行**の値としてだけ使う。

### 6.1 DB 負荷・対象件数
- 判定の大部分はメモリ上。**DB への追加**は、①表ごとの `listEventsByProvider` の追加 1 回(§5.1)、②対象行だけの `getReleaseSnapshot`(健全な状態では 0〜数件)。90 日でも**負荷は小さい**。

### 6.2 古い行を自動修復するリスクと、90 日の理由
| リスク | 対策 |
|---|---|
| 手動の取り下げの取り消し | **`updated_at ≤ created_at` の判定**(§5.2)で、取り下げた行(後から更新された行)は自動修復しない。運用: 手動で戻すときは CANCELLED(対象外) |
| 誤ったスナップショットの公開 | 90 日までを自動、それより古い行は `REPAIR_CANDIDATE` |
| 大量の公開 | `maxRepairsPerRun`(20) |
- 90 日の理由: 修復は**ジョブが実行されたときだけ**行われる。**現在は手動実行だけ**なので、「次の実行で直る」は、人が実行した時点の話になる(定時実行が承認・実装されるまでは、翌日には直らない)。90 日は、**手動の実行が数週間空いても覆える**長さで、手動の取り下げの記憶が残る範囲でもある。

### 6.3 手動確認が必要なケース(自動で触らない)
1. `CANCELLED` で、スナップショットが有る行。
2. `RELEASED/UNAVAILABLE` で、スナップショットが有る行(矛盾)。
3. `SCHEDULED/AVAILABLE|PARTIAL|UNAVAILABLE`。
4. **イベントが、スナップショットの保存後に更新されている行**(`EVENT_UPDATED_AFTER_SNAPSHOT`)。
5. 90 日より古い stuck 行。
6. `actual` が null のスナップショット。
7. 公表日時が未来で、スナップショットが有る行。
8. RELEASE のスナップショットが 2 件以上に見える行。
- 古い stuck 行を直すとき: HQ の確認のうえ、`repairLookbackDays` を一度だけ 180 などに上げて、**dry-run → 件数と行を確認 → 本実行**。

## 7. テスト計画(実装時)
1. **API 障害中の修復**: 取得がすべて失敗しても、対象行(SCHEDULED/PENDING + スナップショット + `updated_at ≤ created_at`)が RELEASED/AVAILABLE になる。
2. **updated_at の判定**: スナップショットの後にイベントが更新された行は、修復されず `REPAIR_CANDIDATE`(`EVENT_UPDATED_AFTER_SNAPSHOT`)。
3. **期間の独立**: `repairLookbackDays` を変えても改定確認は変わらず、`revisionLookbackDays`・`revisionWindow` を変えても修復の範囲は変わらない。**GB_GDP_MOM の 36 件方式でも、100 日前の stuck 行は修復されない**。
4. 優先順位: 改定確認は 実行時 > 指標別 > 45 日。修復は 実行時 > 90 日。`deps.lookbackDays`(別名)は、`ingestOfficialValues`・`ingestJpCpiValues` のどちらでも改定確認だけに効く。
5. 対象外の状態に書き込みが 0 回。
6. **上限**: 20 を超える stuck でも、成功が 20 まで・**公表日時の古い順**。失敗行が枠を消費しない。3 連続失敗で中断。上限を超えた分は `repair_capped_count` と `REPAIR_CANDIDATE`。
7. **件数**: stuck が 50 件を超えても、`repair_*_count` が正しい(`note` が打ち切られても)。
8. 複数スナップショット: RELEASE 以外の種別があっても、RELEASE の `created_at` で判定。RELEASE が 2 件に見える異常は `REPAIR_CANDIDATE`。
9. 初回値の期限(`maxDaysAfterRelease`)が、改定確認の窓を延ばしても変わらない。
10. **公表間隔の回帰テスト**(§2.1): 各ソース(日数方式)で `revisionLookbackDays ≥ 最長間隔 + 21`。既公表日の行を含めて計算(WPI = 97)。**このテストは、長期の改定を検出できる保証ではない**。
11. **`latestEvents` の定義**: 予定表の行数ではなく、①DB にイベントが有る ②RELEASE のスナップショットが有る ③公表日時が過去で CANCELLED でない、イベントだけを、**指標ごと**に新しい順に数える(予定表 20 行・DB 12 件・RELEASE 5 件 → 対象 5 件。他の指標のイベントは数えない。RELEASE が無いイベントは数に入らない)。N 件の外は対象外、N 件以内は何日経っていても対象。
12. **`revisionWindow` の検証**: `days` の下限(1 は可、0・負は拒否)・上限(3,650 は可、3,651 は拒否)、`latestEvents` の下限(1 は可、0・負は拒否)・上限(200 は可、201 は拒否)、小数・NaN・無限大の拒否、`days` と `latestEvents` の同時指定・両方なしの拒否。**`days` と `latestEvents` を、別々のテストで検証**する。
13. **失敗の分類**: インフラ系(接続エラー・タイムアウト・5xx・`08xxx`)は 3 連続で中断し、残りが `repair_unattempted_count` に入る。**行固有(23xxx・42501・4xx)は、その行だけを失敗にして次へ進み、連続失敗に数えない**(行固有の失敗が 3 回続いても中断しない)。成功で連続カウンターが 0 に戻る。判別不能は行固有として扱う。
14. **複数の RELEASE スナップショット**(異常): 失敗ではなく `REPAIR_CANDIDATE`(`MULTIPLE_RELEASE_SNAPSHOTS`)。`repair_failed_count` に入らない。
15. **件数の整合**: `repair_eligible_count = repaired + failed + capped + unattempted` が、成功・失敗・上限・中断の組合せで常に成り立つ。
16. **品質レポート**(§5.7): 60 行の stuck でも、レポートの件数が正しい(`note` が 50 件で打ち切られても)。
17. **年 1 回の dry-run**(§3.4): 指標を限定した実行が、他の指標のソースを処理しない(API・DB の呼び出しが対象の指標だけ)。深い窓の dry-run が、書き込みを 0 回で、範囲内/外の件数を返す。

## 8. 影響と実装の順序
- API・DB・migration の変更なし(`updated_at`・`created_at` は既存の列)。`OfficialValueSource` に任意の項目(`revisionWindow`)、`deps` に項目、独立した関数 1 つ。store の select の列の追加(コード)。
- 実装の順序案: ①`repairStuckReleasedStates`(独立化・`updated_at` 判定・上限・件数)→ ②`revisionWindow` と指標別の値・既公表日の行・回帰テスト → ③JP CPI → ④英国 GDP(件数方式)→ ⑤経済カレンダー経路(第 2 段階)。
- 実装は HQ の承認後。

### 8.1 実行の頻度に関する前提条件
- 本書の運用(修復の期間・年 1 回の確認・取り込み)は、**現在の手動実行**を前提にする。
- **定時実行(`schedule`)の追加は、既存の定期実行ワークフローの変更で、HQ の別承認**。承認・実装されるまでは、「日次」「毎回」を前提にしない。
- Eurostat の取り込み(72 時間の窓)も手動のため、**公表日に人が実行する運用**が前提(別途、B の運用調査)。

## 9. 未解決
- `updated_at ≤ created_at` の判定が、**正常な stuck 行を誤って除外する場合**があるか(例: 日程の変更が、スナップショットの保存の直前に別のジョブで更新した場合は `updated_at` ≤ `created_at` で問題ない。保存の後に日程だけ更新された正常な stuck 行は、`REPAIR_CANDIDATE` になり、人の確認に回る = 安全側)。実装の前に、DEV の読み取り専用の確認で、stuck 行の `updated_at`・`created_at` の実際の並びを確かめる。
- `maxRepairsPerRun`(20)・試行の上限(40)・連続失敗の打ち切り(3)・`revisionWindow` の上限(3,650・200)の値は仮。
- `event_revisions` に「最終確認日」の列が無い(追跡範囲外の値の注記に必要。DB 変更の要望)。
- 英国 GDP の追跡範囲(12 件・36 件)の妥当性(毎年 9 月の改定の後に見直す)。
- 経済カレンダー経路の独立した修復は、提供元ごとの設計が要る(第 2 段階)。
