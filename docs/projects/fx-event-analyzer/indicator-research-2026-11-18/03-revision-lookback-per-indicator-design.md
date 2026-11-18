# 改定確認期間と状態修復期間の設計案(第 2 版、2026-11-18)

担当 D。設計のみ(コード・migration・DB・DEV の変更なし)。前提: settings `7fa2df26`(QA-1・WPI 統合後)。

**第 2 版の変更**(C の独立レビューによる):
① 公表間隔の実測の反映(AU_CPI 最大 42 日、WPI 最大 97 日)と、「最長間隔 + 21 日」の基準での再計算
② 改定確認(`revisionLookbackDays`)と QA-1 の状態修復(`repairLookbackDays`)の**完全な分離**
③ API 障害中でも状態修復できる構成
④ 修復期間 180 日の検証

第 1 版の「月次は 45 日で足りる」は、**余裕が 10 日しかなく、基準(21 日)を満たしていなかった**ので撤回する。

## 1. 現状(コードで確認した事実)
| 場所 | 現状 |
|---|---|
| `ingestOfficialValues`(`pipelines/officialValues.ts`) | `deps.lookbackDays`(既定 **45**)1 つを、全指標の ①初回値の取り込み ②改定の確認 ③QA-1 の状態修復 に共通で適用 |
| 処理の順序 | ソースごとに: 公表予定の表のイベントを `lookbackDays` で絞る → **公式 API を取得** → (取得に失敗したら `continue`)→ イベントごとに修復・改定・初回値 |
| **問題 1(結合)** | 状態修復が、改定確認と同じ期間・同じ取得の後ろにある。修復だけ期間を変えられない |
| **問題 2(API 依存)** | 公式 API の取得が失敗する(`FETCH_FAILED`)と、イベントのループに入らず、**状態修復も行われない**。QA-1 の stuck 行は、API の障害中は直らない |
| 初回値だけの期限 | `OfficialValueSource.maxDaysAfterRelease`(ABS 系 7 日)、`JP_CPI_MAX_DAYS_AFTER_RELEASE`(14 日)。改定確認の期間とは別 |
| `ingestJpCpiValues` | 同様に `lookbackDays`(45)。修復は取得の後ろ |
| 呼び出し側 `src/jobs/ingestOfficialValues.ts` | `lookbackDays` を渡さない(既定) |

## 2. 公表間隔の実測と、改定確認期間の再計算
**基準(C の指摘)**: `revisionLookbackDays` ≥ **最長の公表間隔 + 21 日**。次の公表で前の回が改定されるのを確実に拾い、実行の遅れ・障害に 3 週間の余裕を持たせる。

間隔は、公表予定の表(`gbAuCaSchedule.ts`・`jpCpiSchedule.ts`)の確認済みの行から、日数を数えた(2026-11-18)。**確認できていない回(例: WPI の 2026-08)は使っていない**。

| 指標 | 公表の間隔(日) | 最長 | +21 | **推奨 `revisionLookbackDays`** |
|---|---|---|---|---|
| GB_CPI・GB_CORE_CPI | 表に 1 回のみ。ONS の他の月次指標と同じ | 35(ONS の実績) | 56 | **56** |
| GB_UNEMPLOYMENT_RATE | 28・35・28 | 35 | 56 | **56** |
| GB_GDP_MOM | 29・35・28・27・34 | 35 | 56 | **56** |
| GB_RETAIL_SALES_MOM | 28・28・35・28・34・29 | 35 | 56 | **56** |
| **AU_CPI** | 28・**42**・21・28・28・35 | **42** | 63 | **63**(暫定候補どおり) |
| AU_UNEMPLOYMENT_RATE | 35・28・35・28・35・21 | 35 | 56 | **56** |
| **AU_WPI_QOQ** | **97**・85・91(2026-11-18 → 2027-02-23 → 05-19 → 08-18) | **97** | 118 | **120**(7 日単位に切り上げ。暫定候補どおり) |
| CA_UNEMPLOYMENT_RATE | 28・35・28・35 | 35 | 56 | **56** |
| CA_CPI(値は未対応・予定のみ) | 27・28・35・29・27 | 35 | 56 | 56(値の取り込みを入れるとき) |
| JP_CPI | 28・35・28・28 | 35 | 56 | **56**(CPI の前年同月比は通常改定されないが、確認処理があるので揃える) |
| GB_GDP_QOQ(調査中。初回推計の版) | 92・91(2026-11-12 → 2027-02-12 → 05-14) | 92 | 113 | **1,700(暫定)**。公表間隔の基準(113)ではなく、**改定の実測**で決める(§2.1) |
| 豪州の家計支出 HSI(調査中) | 26・43・28(11/04 → 11/30 → 01/12 → 02/09) | 43 | 64 | 64 → **70** |

- 結論: **45 日が基準を満たす指標は無い**。最も短い最長間隔(35 日)でも 56 日が要る。**既存の全ソースに明示の値を持たせる**。
- 7 日単位に切り上げるのは、運用で数えやすくするためだけの理由(56・63・70・120)。

### 2.1 改定が長く続く指標(英国 GDP 四半期)の例外(C の指摘)
- 英国 GDP 四半期(IHYQ)の改定は、公表間隔(約 92 日)では収まらない。**D の実測**(pn2 の 47 データ点、46 四半期、204 回の改定)で、**270 日を超える改定が 76%**、1,700 日を超える改定が 19%、**最長 3,458 日**(C の集計: 270 日超が 64%、最長 1,645 日。定義の差で数は合わないが、結論は同じ)。
- そこで `GB_GDP_QOQ` の `revisionLookbackDays` は、**暫定 1,700 日**とする(`≥ 最長間隔 + 21` の基準は満たす)。全期間は網羅できない(毎年 9 月の改定で、数年前が動く)ため、**毎年 9 月の後に見直す**。詳細は `claude/fx-indicator-research-d2` の `01-uk-gdp-quarterly-ons.md`(第 2 版)。
- **この長い期間は、改定確認だけに効く**。`maxDaysAfterRelease`(初回値の期限、`GB_GDP_QOQ` は 7 日と明示)も、`repairLookbackDays`(状態修復、既定 90 日)も**変わらない**。**1,700 日だからといって、古い stuck 行を 1,700 日まで自動で直すことはない**(下記 §3・§4)。
- 回帰テスト(下記)は `≥` の検査なので、1,700 日は通る。

**回帰を防ぐテスト案**: 各ソースについて、公表予定の表から最長間隔を計算し、`revisionLookbackDays ≥ 最長間隔 + 21` を検査する。表の行を足して間隔が延びたら、テストが失敗して見直しを促す。表の行が 1 つだけのソース(GB_CPI)は、同じ取得元の他の指標の最長間隔を使う。

## 3. 設計: 2 つの期間を完全に分離する
| | `revisionLookbackDays` | `repairLookbackDays` |
|---|---|---|
| 目的 | 公式 API の値を使う処理(①初回値の取り込み ②改定の確認) | QA-1 の状態修復だけ |
| 公式 API | **使う**(取得に失敗したら何もしない) | **使わない**(取得の前に、DB だけで完結) |
| 設定の単位 | 実行時 / 指標別 / 既定 | 実行時 / 既定(指標別は持たない) |
| 既定値 | **45**(指標別を持たないソースだけに効く保険。**既存の全ソースは明示の値を持つ**) | §5 のとおり **90 を推奨**。180 は条件つき |
| 優先順位 | `deps.revisionLookbackDays` > `source.revisionLookbackDays` > 45 | `deps.repairLookbackDays` > 既定値 |
| 初回値の期限 `maxDaysAfterRelease` | **別項目のまま独立**(ABS 7 日・JP 14 日)。`revisionLookbackDays` を延ばしても変わらない | 関係なし |

**QA-1 の自動回復範囲が、指標別の長い改定確認期間で広がらないこと(C の指摘)**:
- 修復の対象は `repairStuckReleasedStates`(§4)が `repairLookbackDays`(既定 90 日)だけで決める。`source.revisionLookbackDays`(例: `GB_GDP_QOQ` の 1,700 日)は**参照しない**。
- 実装の構造としても、修復は**ソースのループの前**にあり、ソースの設定(指標別の期間)を**受け取らない**。テスト: `GB_GDP_QOQ` の stuck 行が 100 日前でも、修復されない(`REPAIR_CANDIDATE` の報告だけ)。
- 別名 `deps.lookbackDays` も、改定確認の期間だけに効く。

**既存の `deps.lookbackDays` の扱い(互換)**: `revisionLookbackDays` の**別名**として残す(同じ意味・同じ優先順位。呼び出し側の変更は不要)。**QA-1 の期間の指定には使わない**。`releaseRecovery.ts` の「一度だけ `lookbackDays` を延ばして回復」という運用の説明は、`repairLookbackDays` に書き換える(コードの実装時)。

**`maxDaysAfterRelease` との関係(安全性)**: 改定確認を 120 日まで延ばしても、初回値として受け付けるのは期限内だけ。ONS・StatCan は API の公表日の一致(`description.releaseDate`)、ABS は `updatedAfter` と対象期間の一致で、すでに「次の回の値を初回値にしない」が守られている。WPI の `maxDaysAfterRelease`(7 日)は変えない。

## 4. 状態修復を、API から独立させる構成
**現状のどこが問題か**: §1 のとおり、修復は「API 取得の後・ソースごとのループの中」にある。

**設計**
1. `ingestOfficialValues` の**先頭**(ソースのループの前)に、独立した処理 `repairStuckReleasedStates` を置く。**`fetcher` を使わない**(DB の読み書きだけ)。
2. 対象の選び方:
   - 公表予定の表ごとに、`store.listEventsByProvider(table.provider)`(既存。新しい store の関数は不要)を 1 回呼ぶ。**今の処理が同じ呼び出しをしている**ので、DB の負荷は増えない。
   - メモリ上で絞る: その表の行(`provider_event_id`)に当たり、`status = SCHEDULED` かつ `data_status = PENDING`(= `needsReleasedStateRepair`)で、`repairLookbackDays` の範囲(`now − repairMs ≤ 公表日時 ≤ now`)の行。**公表の日時が未来の行は対象外**。
   - 絞った行についてだけ `getReleaseSnapshot` を呼ぶ。**スナップショットが有る行だけ**を修復する。
3. 修復: `updateEvent(id, { status: 'RELEASED', data_status: 'AVAILABLE' })` だけ。スナップショット・改定の履歴・値は触らない。
4. **障害の分離**: 1 行ごとに try/catch。1 行の失敗で他の行・後続の取り込みを止めない(エラーとして数え、次の実行で再試行)。
5. **件数の上限**(`maxRepairsPerRun`、案: 20): 超えたら残りは**修復せず**、`repair_capped` として記録し、人の確認に回す。想定外の大量の stuck を、一度に公開しないため。
6. 実行の順序: ①状態修復 → ②ソースのループ(取得 → 初回値・改定)。②は、修復された行を RELEASED として扱い、改定確認に進む(これまでと同じ)。
7. dry-run: 修復は plan に `REPAIR` を出すだけで、書かない。
8. `ingestJpCpiValues`: 同じ形で、取得の前に修復を置く。経済カレンダー(`economicCalendar.ts`)は、**提供元が返した行**だけを処理するため、提供元の障害中は修復できない。**第 2 段階**として、提供元ごとに同じ独立した修復(RELEASED/PENDING の行)を追加する設計とする。第 1 段階は official-values と jp-cpi-values。

**API 障害中の受け入れ条件**: 公式 API がすべて 503 でも、`repairStuckReleasedStates` は、範囲内の stuck 行(SCHEDULED/PENDING で、スナップショットが有る行)を `RELEASED`/`AVAILABLE` に直す。取り込み(②)は、これまでどおり `FETCH_FAILED` で何も書かない。

**安全性(修復してよい条件をすべて満たすときだけ)**
- スナップショットが存在する(`getReleaseSnapshot` が非 null)。追加の条件案: `actual` が非 null。
- 状態が `SCHEDULED/PENDING`。official-values の経路ではこれだけ。`RELEASED/PENDING` は経済カレンダーの経路(第 2 段階)。
- **触らない状態**: `CANCELLED`(どの `data_status` でも)、`RELEASED/AVAILABLE|PARTIAL|UNAVAILABLE`、`SCHEDULED/AVAILABLE|PARTIAL|UNAVAILABLE`。QA-1 の条件で、C のレビュー済み。

## 5. 修復期間の既定値(180 日)の検証
### 5.1 DB 負荷・対象件数
- 対象の母集団は、公表予定の表の行。現在、ONS 17 行、ABS 15 行、StatCan 9 行など。公表日が過去のものは、1 指標あたり月 1 件。180 日で、**過去の行は多くても 100 件程度**。
- 修復の判定は**メモリ上**(`listEventsByProvider` は今も呼んでいる)で、DB への追加の問い合わせは `getReleaseSnapshot` だけ。**対象は「公表日時を過ぎて、まだ SCHEDULED の行」だけ**で、健全な状態では 0〜数件(値の取得待ちの回)。API が長く止まっていても、その指標の過去の未取得の行が上限(180 日で 6 件程度)。
- よって **180 日でも負荷は無視できる**。期間を長くする本当のコストは、負荷ではなく、**古い行を自動で公開するリスク**。

### 5.2 古い行を自動修復するリスク
| リスク | 説明 | 対策 |
|---|---|---|
| 手動の取り下げの取り消し | 運用者が、誤った値を非公開にするために、イベントを SCHEDULED/PENDING に戻した(スナップショットは更新・削除できない)。古いほど、その記憶が失われ、自動修復で再公開される | 修復の記録(`repaired` の note)と上限。**手動で戻すときは CANCELLED にする運用**(修復の対象外) |
| 誤ったスナップショット | 古い保存の値が間違っていた場合、修復でアプリに誤った値が出る | 90 日までを自動、それより古い行は要確認(下記) |
| 古い行の件数の見落とし | 想定外の大量の stuck を一度に公開 | `maxRepairsPerRun`(20)と dry-run の確認 |

### 5.3 手動確認が必要なケース(自動で触らない)
1. `CANCELLED` で、スナップショットが有る行(取りやめ後に値が入った?)。
2. `RELEASED/UNAVAILABLE`(BLS の値なし)で、スナップショットが有る行(矛盾)。
3. `SCHEDULED/AVAILABLE|PARTIAL|UNAVAILABLE`(QA-1 の対象外の組合せ)。
4. 修復の期間より古い stuck 行。
5. スナップショットの `actual` が null の行。
6. 公表日時が未来で、スナップショットが有る行(日程の変更後に値が入った?)。

### 5.4 推奨
- **既定値は 90 日を推奨する**(180 日を無条件には採用しない)。
  - 理由: 修復が必要になるのは、保存の直後に状態更新が失敗し、次の実行までに直らなかったとき。通常は**次の実行(翌日以内)**で直る。90 日は、実行の長期の停止(最長の公表間隔 97 日の WPI に近い)を覆うのに十分で、手動の取り下げの記憶が残る範囲でもある。
- **90〜180 日の行は、自動修復せず「修復の候補」として報告のみ**(plan に `REPAIR_CANDIDATE`、counters の note)。人が確認してから、`repairLookbackDays` を一度だけ 180 に上げて実行する。
- **180 日を既定にする条件**(満たせば 180 でもよい):
  ① DEV の stuck 行の数を**読み取り専用の確認**で数え、古い行が 0 件、または全件を人が確認済み。
  ② HQ が「手動の取り下げは CANCELLED で行う」運用を決める。
- 初回の導入は、**dry-run** → 件数と行を HQ が確認 → 本実行、の順。

## 6. テスト計画(実装時)
1. **API 障害中の修復**: 取得がすべて失敗しても、stuck 行(SCHEDULED/PENDING + スナップショット)が RELEASED/AVAILABLE になる。取り込み側は `FETCH_FAILED`。
2. **期間の独立**: `repairLookbackDays` を変えても改定確認の範囲は変わらず、`revisionLookbackDays` を変えても修復の範囲は変わらない。
3. 優先順位: revision は 実行時 > 指標別 > 45。repair は 実行時 > 既定。`deps.lookbackDays`(別名)は revision だけに効く。
4. 対象外の状態(CANCELLED・RELEASED/AVAILABLE・SCHEDULED/AVAILABLE など)に書き込みが 0 回。
5. 範囲外(90 日より古い)は修復せず `REPAIR_CANDIDATE` を報告。上限を超えたら残りは修復せず `repair_capped`。
6. 1 行の失敗で他の行・取り込みが止まらない。dry-run は書かない。再実行で二重に書かない。
7. 初回値の期限(`maxDaysAfterRelease`)が、`revisionLookbackDays` を延ばしても変わらない(8 日後の ABS の値は初回値にならない)。
8. **公表間隔の回帰テスト**(§2): 各ソースで `revisionLookbackDays ≥ 最長間隔 + 21`。
9. **長い改定確認期間が修復範囲を広げない**: `revisionLookbackDays: 1,700` のソースで、100 日前の stuck 行が自動修復されない(`repairLookbackDays` が 90 のとき)。

## 7. 影響と実装の順序
- API・DB・migration の変更なし。`OfficialValueSource` に任意の項目 1 つ、`deps` に 2 項目、独立した関数 1 つ。
- 書き込みの増加: 改定確認が長くなる(56〜120 日)が、**値が違うときだけ**書く。公式 API の呼び出しはソースあたり 1 回のまま。
- 実装の順序案: ①`repairStuckReleasedStates` の分離(QA-1 の構造の修正)→ ②`revisionLookbackDays` の指標別設定と回帰テスト → ③JP CPI → ④経済カレンダー。
- 実装は HQ の承認後。QA-1 の統合済みの `officialValues.ts` を前提にする。

## 8. 未解決
- 修復の既定値(90 か 180)は、DEV の stuck 行の実数の確認(読み取り専用)と HQ の運用判断で確定する。
- 公表間隔のうち、WPI の 2026-08 の回は未確認(使っていない)。表の行が増えたら、回帰テストで再計算する。
- `maxRepairsPerRun` の上限値(20)は仮。
- 経済カレンダー経路の独立した修復は、提供元ごとの設計が要る(第 2 段階)。
