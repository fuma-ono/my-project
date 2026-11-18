# 改定確認期間と状態修復期間の設計案(第 3 版、2026-11-18)

担当 D。設計のみ(コード・migration・DB・DEV の変更なし)。前提: settings `7fa2df26`(QA-1・WPI 統合後)。

**第 3 版の変更**(C のレビューによる):
① 状態修復の安全性: 修復期間は **90 日**(180 日の記述を整理)。`economic_events.updated_at` と `event_snapshots.created_at` を使い、**スナップショットの保存後にイベントが更新された行は自動修復せず `REPAIR_CANDIDATE` として報告**。
② 修復上限 `maxRepairsPerRun = 20` を**ジョブ実行全体の上限**にし、処理順・失敗行の扱い・件数の記録を定義。
③ 英国 GDP は **「日数」ではなく「直近 N 件」方式**(QoQ 直近 12 四半期、MoM 直近 36 か月。HQ の暫定方針)。1,700 日の固定案は採用しない。
④ 公表間隔の回帰テストの**保証する範囲・しない範囲**を明記。WPI の 97 日の計算に必要な、既公表日の行を表に含める。

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

## 3. 英国 GDP: 日数ではなく「直近 N 件」方式(HQ の暫定方針)
**1,700 日の固定案は採用しない**(C の指摘・HQ の方針)。日数では、導入直後は件数が少なく、改定の長さも一定でない。

### 3.1 方針
| 指標 | 追跡範囲 | 備考 |
|---|---|---|
| **GB_GDP_QOQ**(四半期) | **直近 12 四半期**(12 件のイベント) | 約 3 年 |
| **GB_GDP_MOM**(月次) | **直近 36 か月**(36 件のイベント) | 約 3 年。現在の 56 日方式から置き換え |
- **追跡範囲外の過去の改定は、検出されない可能性がある**。ONS は数年前を動かすことがある(英国 GDP 四半期の実測で、270 日超の改定が 76%、最長 3,458 日。詳細は d2 の `01-uk-gdp-quarterly-ons.md`)。**追跡範囲を超えた改定は、`event_revisions` に入らない**。
- **初回値と最新公式値の区別は維持する**:
  - 初回値 = `RELEASE` スナップショット(不変)。
  - 最新の公式値 = `event_revisions` の最後の ACTUAL(**追跡範囲内**の最新の値)。
  - **追跡範囲外のイベントの「最新の公式値」は、最後に追跡した時点の値**で、現在の ONS の値と一致しない可能性がある。画面・API でこの値を「最新の公式値」と呼ぶ場合は、追跡範囲外のものがあり得ることを、運用上の注意として残す。
- 範囲は、実測と運用で見直す(毎年 9 月の改定の後)。

### 3.2 設定の持ち方
```ts
revisionWindow?: { days: number } | { latestEvents: number }
```
- `latestEvents: N` = そのソースの表の行のうち、**公表日時が `now` 以前の、新しい順の N 件**のイベントを対象にする。日数の絞りは**かけない**。
- `days: D` = 従来の日数方式(§2)。
- 優先順位: 実行時 `deps.revisionLookbackDays`(日数)> `source.revisionWindow` > 既定(日数 45)。**実行時の指定があれば、全ソースが日数方式になる**(復旧・年次改定用)。
- 初回値の期限 `maxDaysAfterRelease`(GB_GDP_QOQ・GB_GDP_MOM は 7 日と明示)と、状態修復の期間は、**どちらも別**。

### 3.3 費用・処理件数・保存履歴
| 項目 | 評価 |
|---|---|
| 対象イベント数 | QoQ 最大 12、MoM 最大 36。導入直後は、作られたイベントだけ(公表予定の表の行が増えるにつれて増える) |
| 公式 API の呼び出し | 変わらない(指標ごとに 1〜2 回。四半期は pn2 と qna) |
| DB の問い合わせ | イベントごとに `getReleaseSnapshot`・`latestRevisionValues` の 2 回。MoM 36 件で約 72 回/実行。日次実行なら**無視できる**。必要なら「API の releaseDate が直近 3 日以内のときだけ全件を確認し、他の日は直近 3 件だけ」のゲートで減らせる |
| 保存履歴(`event_revisions`) | **値が変わったときだけ**書く。1 回の公表で数件、9 月は多い。年に数十行 |

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
4. 絞った行についてだけ `getReleaseSnapshot`(RELEASE)を取得し、**スナップショットが有る行だけ**を、§5.2 の安全判定にかける。
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

### 5.3 複数のスナップショットがある場合の比較方法
- `event_snapshots` は `unique (event_id, snapshot_type)`。**RELEASE は 1 イベントに 1 件**(DB のトリガーで更新・削除不可)。**現在のコードが書く・読む種別は RELEASE だけ**だが、`snapshot_type` に CHECK 制約は無く(text、既定 'RELEASE')、**スキーマ上は他の種別が同じイベントに別に存在しうる**。
- **比較の基準は、RELEASE のスナップショットの `created_at` だけ**。他の種別の `created_at` は見ない(発表前に作られるものは、RELEASE より前の時刻で、判定に無関係)。
- 同じイベントに RELEASE が 2 件以上あるように見える場合(制約上は起きない異常)は、**自動修復せず `REPAIR_CANDIDATE`**(理由 `MULTIPLE_RELEASE_SNAPSHOTS`)。
- 比較は `event.updated_at ≤ RELEASE.created_at`。**別の種別のスナップショットが RELEASE の後に作られていても、それを理由に修復しない・することもしない**。

### 5.4 修復の上限と処理順(`maxRepairsPerRun`)
- **`maxRepairsPerRun = 20` は、ジョブの実行全体の上限**(表ごと・ソースごとではない)。official-values の 1 回の実行で、成功した修復の合計が 20 を超えない。JP CPI の修復は、**別のジョブなので別の上限**(同じ定数)。
- **処理の順序**: 全表の修復の候補を集め、**公表日時の古い順**に並べて処理する(古い stuck を先に直す)。
- **失敗行が上限枠を占有しない**:
  - 上限に数えるのは**成功した修復だけ**。失敗した行は、次の行に進む(枠を消費しない)。
  - ただし、無限に試さないよう、**試行の上限**(案: 上限の 2 倍 = 40 行)と、**連続失敗の打ち切り**(案: 3 連続で失敗したら、DB の障害とみなして中断し、残りは次の実行)を置く。
- **上限を超えた分**は、修復せず `repair_capped` として件数を記録し、`REPAIR_CANDIDATE` として報告する(人の確認)。
- 想定外の大量の stuck を、一度に公開しないための安全弁。

### 5.5 件数の記録(`JobCounters.note` の 50 件制限への対応)
- `note` は、キーごとに**50 件で打ち切る**。stuck が多いと、**件数が欠ける**ので、**件数は `note` に頼らず、別管理**する。
- `counters.details` に、**数値のフィールド**として記録する(`note` のリストとは別):

| フィールド | 内容 |
|---|---|
| `repair_attempted_count` | 試行した行 |
| `repaired_count` | 成功した修復 |
| `repair_failed_count` | 失敗した行 |
| `repair_candidate_count` | `REPAIR_CANDIDATE`(理由別の内訳も `repair_candidate_by_reason`) |
| `repair_capped_count` | 上限で見送った行 |
| `repair_aborted` | 連続失敗で中断したか(bool) |
- 個々の行の記録(`note`)は、**最初の 50 件**だけ(従来どおり)。**件数は上の数値が正**。ログ・通知は数値を見る。

### 5.6 API 障害中の受け入れ条件
公式 API がすべて 503 でも、`repairStuckReleasedStates` は、範囲内(90 日)の対象行(§5.2 の条件を満たす行)を `RELEASED/AVAILABLE` に直す。取り込み(②)は、これまでどおり `FETCH_FAILED` で何も書かない。

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
- 90 日の理由: 通常は次の実行(翌日以内)で直る。90 日は、実行の長期の停止を覆うのに十分で、手動の取り下げの記憶が残る範囲。

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
11. 件数方式(`latestEvents`): 直近 N 件の外のイベントは、改定確認の対象にならない。N 件以内は、公表から何日経っていても対象。

## 8. 影響と実装の順序
- API・DB・migration の変更なし(`updated_at`・`created_at` は既存の列)。`OfficialValueSource` に任意の項目(`revisionWindow`)、`deps` に項目、独立した関数 1 つ。store の select の列の追加(コード)。
- 実装の順序案: ①`repairStuckReleasedStates`(独立化・`updated_at` 判定・上限・件数)→ ②`revisionWindow` と指標別の値・既公表日の行・回帰テスト → ③JP CPI → ④英国 GDP(件数方式)→ ⑤経済カレンダー経路(第 2 段階)。
- 実装は HQ の承認後。

## 9. 未解決
- `updated_at ≤ created_at` の判定が、**正常な stuck 行を誤って除外する場合**があるか(例: 日程の変更が、スナップショットの保存の直前に別のジョブで更新した場合は `updated_at` ≤ `created_at` で問題ない。保存の後に日程だけ更新された正常な stuck 行は、`REPAIR_CANDIDATE` になり、人の確認に回る = 安全側)。実装の前に、DEV の読み取り専用の確認で、stuck 行の `updated_at`・`created_at` の実際の並びを確かめる。
- `maxRepairsPerRun`(20)・試行の上限(40)・連続失敗の打ち切り(3)の値は仮。
- 英国 GDP の追跡範囲(12 件・36 件)の妥当性(毎年 9 月の改定の後に見直す)。
- 経済カレンダー経路の独立した修復は、提供元ごとの設計が要る(第 2 段階)。
