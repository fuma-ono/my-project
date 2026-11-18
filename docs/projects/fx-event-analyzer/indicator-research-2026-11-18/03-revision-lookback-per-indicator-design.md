# 改定確認期間(45 日)を指標別に設定する設計案(2026-11-18)

担当 D。設計のみ(コード・migration・DB・DEV の変更なし)。QA-1 とその条件(C のレビュー)の統合後の状態(settings `7fa2df26`)を前提にする。

## 1. 現状(コードで確認した事実)
| 場所 | 現状 |
|---|---|
| `ingestOfficialValues`(`pipelines/officialValues.ts`) | `deps.lookbackDays`(既定 **45**)を、全指標に同じ値で適用。`at >= now - lookbackMs` の範囲のイベントだけを見る |
| 同じ範囲で行われること | ① 初回値の取り込み ② **改定の確認**(`valueForPeriod` との比較 → `event_revisions`)③ QA-1 の状態の修復 |
| 初回値だけの別の期限 | `OfficialValueSource.maxDaysAfterRelease`(ABS 系: **7 日**。次の回の値を初回値にしない) |
| `ingestJpCpiValues`(`pipelines/jpCpiValues.ts`) | 別に `deps.lookbackDays`(既定 45)と、初回値の期限 `JP_CPI_MAX_DAYS_AFTER_RELEASE`(**14 日**)を持つ |
| 呼び出し側(`src/jobs/ingestOfficialValues.ts`) | `lookbackDays` を渡していない(既定の 45 日) |

## 2. 問題
- 公表の間隔が違う指標が、同じ 45 日で扱われる。**四半期の指標(AU_WPI_QOQ、公表間隔は約 90 日)では、45 日を過ぎると、次の公表までの約 45 日間、改定の確認が一切行われない**。
- 月次の指標(ONS・StatCan・ABS の月次)は、次の公表が約 28〜35 日後なので、45 日は「次の公表の後の改定を拾える」長さとして妥当。
- 45 日を過ぎた stuck 行(QA-1)は自動回復されない(C のレビュー条件で明記済み)。指標別の期間にすれば、四半期の指標の回復範囲も広がる。

## 3. 設計案
### 3.1 設定の持ち方(推奨)
`OfficialValueSource` に**任意の項目**を足す。
```ts
/** 初回値の確認・改定の確認・状態の修復で見る、公表からの日数。省略 = deps.lookbackDays(既定 45) */
revisionLookbackDays?: number;
```
- 優先順位: **`deps.lookbackDays`(明示した実行時の指定)> `source.revisionLookbackDays` > 45**。
  - 理由: QA-1 の「一度だけ 120 日で回復する」運用を、指標別の設定より優先させたい。
- `ingestOfficialValues` の中では、**すでにソースごとにイベントを絞っている**ので、`lookbackMs` をソースのループの中で計算するだけで済む(変更は数行)。
- `ons()`・`abs()`・`statcan()` の各ビルダーに、引数で値を渡せるようにする(例: `abs('AU_WPI_QOQ', { revisionLookbackDays: 100 })`)。

### 3.2 指標ごとの推奨値
| 指標 | 公表の間隔 | 推奨 | 理由 |
|---|---|---|---|
| GB_CPI・GB_CORE_CPI・GB_UNEMPLOYMENT_RATE・GB_GDP_MOM・GB_RETAIL_SALES_MOM | 約 28〜35 日 | **45**(現状維持) | 次の公表の後の改定まで拾える。ONS は直前の数か月分を改定する |
| AU_CPI・AU_UNEMPLOYMENT_RATE | 約 28〜35 日 | **45**(現状維持) | 同上。初回値の期限は ABS の 7 日(別の項目)のまま |
| CA_UNEMPLOYMENT_RATE | 約 28〜35 日 | **45**(現状維持) | 同上 |
| **AU_WPI_QOQ(四半期)** | 約 90 日 | **100** | 次の公表(約 90 日後)の後の改定を拾うため。WPI は改定が少ない(季節調整の再推定のとき)ので、**長くしても書き込みは増えにくい** |
| JP_CPI | 約 28〜35 日 | 45(現状維持) | e-Stat の反映の遅れは初回値の期限(14 日)で扱う。CPI(前年同月比)は通常改定されない |
| 将来の四半期の指標(GDP 四半期など) | 約 90 日 | 100 | 同上 |

### 3.3 初回値の期限(`maxDaysAfterRelease`)との関係
- **別の項目のままにする**。「改定の確認の期間」と「初回値として受け付ける期間」は目的が違う。
- 四半期の指標でも、初回値の期限は短いまま(WPI は 7 日)にする。期間を延ばすだけで、改定後の値が初回値になることを防ぐため。

### 3.4 `jpCpiValues.ts` の扱い
- 同じ `lookbackDays` を持つが、**呼び出し側が 1 つの定数(JP_CPI_SCHEDULE)だけ**で、四半期の指標は無い。**今回は変更しない**(必要になれば同じ形で足す)。
- 経済カレンダー(`economicCalendar.ts`)は、取得した範囲に入る行だけを処理するので、この設定の対象外。

## 4. 影響と安全性
- **API・DB・migration の変更なし**。`OfficialValueSource` の任意の項目の追加のみ。
- **書き込みの増加**: 四半期の指標で、公表から 45〜100 日の間に改定の確認が走るようになる。比較して違うときだけ `event_revisions` に足す(同じ値は書かない)。1 回の実行で増える公式 API の呼び出しは、ソースあたり 1 回のまま(同じ応答を使う)。
- **QA-1 との整合**: 状態の修復も同じ範囲で行われるので、四半期の指標の stuck 行は 100 日まで自動回復する。それより古い行は、これまでどおり人手(`deps.lookbackDays` を一度だけ長くして実行)。
- **デフォルトの挙動は変わらない**: `revisionLookbackDays` を指定していない指標は、これまでと同じ 45 日。

## 5. テスト計画(実装時)
1. 四半期の指標: 公表から 60 日後に、**以前は見なかった改定が `event_revisions` に入る**(`revisionLookbackDays: 100`)。同じ条件で 45 日の指標は見ない。
2. 優先順位: `deps.lookbackDays` を渡すと、`source.revisionLookbackDays` より優先される。
3. 初回値の期限(`maxDaysAfterRelease: 7`)は、`revisionLookbackDays` を延ばしても変わらない(8 日後の値は初回値にならない)。
4. QA-1: 公表から 70 日後の WPI の stuck 行が、`revisionLookbackDays: 100` で回復する。
5. dry-run が書かない。再実行で改定が二重に入らない。

## 6. 実装の見積りと順序
- 変更: `officialValues.ts` の型 1 項目・`lookbackMs` の計算 1 か所・ビルダーの引数、テスト。小さい変更(WPI と同程度かそれ以下)。
- **前提**: この設計は QA-1 の統合後に行う(`officialValues.ts` の同じ付近を触るため)。統合は済んでいる。
- 承認が出たら、専用ブランチ(settings `7fa2df26` から)で実装する。

## 7. 未解決
- WPI の改定の実績(季節調整の再推定の頻度)は、今回確認していない。推奨の 100 日は、公表間隔から決めた値(実績で見直す)。
- 将来、半年・年次の指標が入る場合の値(180・400 日など)は、その時に決める。
