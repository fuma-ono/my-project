# 英国 GDP 四半期(ONS)の導入調査(2026-11-18)

担当 D。調査のみ(コード・migration・DB・DEV の変更なし)。確認した事実と、確認できなかったことを分けて書く。

## 1. 結論(先に)
- **公式の四半期前期比(%)の系列がある**(ONS の時系列 API、CDID **IHYQ**「Gross Domestic Product: Quarter on Quarter growth: CVM SA %」)。計算は要らない。取得は既存の ONS の仕組み(GB_GDP_MOM と同じ API)に近い。
- **実装可能**。ただし既存の ONS アダプターは月次(`months` の 'YYYY MON')しか読まないので、**四半期('quarters'、'YYYY Qn')を読む拡張**が要る。ABS の WPI で四半期の系列を足した考え方と同じ。
- **注意が 2 点**: ① 系列の**データセット ID が公表ごとに変わりうる**(下記)。② **改定が遅く、何度も入る**(1 年近く後まで動く)ので、改定確認の期間(現行 45 日)では足りない。指標別の期間(別資料の `revisionLookbackDays`)とセットで導入するのが前提。
- 推奨: 導入する(優先度は中)。GB_GDP_MOM の次の ONS 指標として妥当。

## 2. 公式ソースと数値系列(実 API、2026-11-18)
| 系列 | 内容 | 値(2026-11-12 公表分) |
|---|---|---|
| **IHYQ**(推奨) | GDP 前期比、CVM、季節調整、%(unit `%`) | 2026 Q3 = **0.7**、Q2 = 0.5、Q1 = 0.6、2025 Q4 = 0.0 |
| IHYR | 当年の第 4 四半期に対する伸び(年内の累計) | 2026 Q3 = 1.9 |
| IHYP | 前年比(**年次**のみ。四半期ごとではない) | 2025 = 1.2 |
| ABMI | GDP の水準、CVM、季節調整、£m | 2026 Q3 = 749,999 |
| ED3H(月次データセット MGDP) | 「3 か月/前の 3 か月」。四半期の最終月(9・12・3・6 月)の値は四半期の前期比と同じ値になる(2026-09 = 0.7) | 参考。独自の系列として使わない |
- 公式の発表文: 「UK real GDP is estimated to have increased by 0.7% in Quarter 3 (July to Sept) 2026, following growth of 0.5% in Quarter 2」と IHYQ が一致。
- 前年同期比(四半期ごと)の公式の系列は今回見つけていない(IHYP は年次)。必要なら別途調査。
- 取得: `https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/ihyq/<データセット ID>/data`(JSON、鍵なし)。

## 3. データセット ID の問題(重要)
- 同じ IHYQ が、データセットごとに別の URL・別の更新状態で見える(2026-11-18 に確認)。

| URL のデータセット | 最新の四半期 | releaseDate |
|---|---|---|
| `…/ihyq/pn2/data` | **2026 Q3 = 0.7** | 2026-11-12 |
| `…/ihyq/ukea/data` | 2026 Q2 = 0.5 | 2026-09-29 |
| `…/ihyq/qna/data` | 2026 Q2 = 0.5 | (古い) |
- 初回の四半期推計(GDP first quarterly estimate)の値は **`pn2`**(`datasetUri` = `/economy/grossdomesticproductgdp/datasets/secondestimateofgdp`)に入る。`ukea`・`qna` は別の公表(UK economic accounts・四半期国民経済計算)のときに更新される。
- 既存の ONS パーサー(`description.releaseDate` が公表日と一致したときだけ値を返す)は、この違いを**安全側に倒す**(古いデータセットは公表日が合わず null)。ただし、**どのデータセットが公表ごとに更新されるか**(特に 12/22 の四半期国民経済計算で pn2 が更新されるか)は未確認。実装前に、公表日の翌日に実 API で確認する。
- 対策案: `OnsSeries` に `datasetId` の確認(`description.datasetId`)を足し、系列の取り違えを防ぐ(GB_GDP_MOM の title 照合と同じ)。

## 4. 公表日・公表時刻(ONS の各公表ページで確認、すべて 07:00 ロンドン時間)
| 公表 | 日付 | 対象 |
|---|---|---|
| GDP first quarterly estimate, UK: July to September 2026 | 2026-11-12(公表済み) | 2026 Q3 の初回値 |
| **GDP quarterly national accounts, UK: July to September 2026** | **2026-12-22** | Q3 の改定(第 2 推計) |
| GDP first quarterly estimate, UK: October to December 2026 | **2027-02-12** | 2026 Q4 の初回値 |
| GDP quarterly national accounts, UK: October to December 2026 | 2027-03-25 | Q4 の改定 |
| GDP first quarterly estimate, UK: January to March 2027 | **2027-05-14** | 2027 Q1 の初回値 |
| GDP quarterly national accounts, UK: January to March 2027 | 2027-06-30 | Q1 の改定 |
- 初回の四半期推計は、**月次 GDP(GB_GDP_MOM)と同じ日・同じ時刻**(2027-02-12、2027-05-14 など)。市場が見るのは初回値。
- 各ページのスラッグは `gdpfirstquarterlyestimateuk<月から月><年>` と `gdpquarterlynationalaccountsuk<…>`。URL を読んで日付を確認した(2026-11-18)。

## 5. 改定履歴と頻度
- **過去の版(vintage)が API で取れる**: 系列ページの `versions` に 47 版(`/ihyq/pn2/previous/vN/data`)。初回の四半期推計の公表日(2/5/8/11 月)ごとに 1 版。
- 直近の版で、同じ四半期の値がどう動いたか(実 API):

| 四半期 | 初回値(最初の版) | その後 |
|---|---|---|
| 2025 Q2 | 0.3(2025-08) | 0.3(11 月)→ 0.2(2026-02)→ … |
| 2025 Q4 | 0.1(2026-02) | 0.2(05 月)→ 0.1(08 月)→ **0.0(2026-11)** |
| 2026 Q2 | 0.4(2026-08) | **0.5(2026-11)** |
- 直近 4 回の公表(2026-02・05・08・11)の版を比べると、**毎回、どれかの四半期が ±0.1 動いている**。直前の四半期が動いたのは 2 回(05 月・11 月)。**±0.1 の改定が頻繁**で、**最初の公表から 9 か月後でも動く**(Q4 2025)。
- 初回値と最新値が違うため、**初回値は不変、後の値は改定として別履歴**にする既存の方針がそのまま使える。
- 月次 GDP の方も、同じ公表で前の月が改定される(今回、2026-08 が 0.1 → 0.0)。

## 6. 取得 API・形式
- JSON(ONS の `…/data`)。鍵なし。応答の `quarters` 配列(`date` = '2026 Q3'、`value`、`updateDate`)。月次は `months`。
- `updateDate` は、値が変わらなくても公表日に更新される(2025 Q4 の行も 2026-11-12)ので、**改定の検知には使えない**(値の比較が必要)。初回値の確認には使える(その回の行が公表日に更新されている)。

## 7. 既存基盤との適合性
| 項目 | 評価 |
|---|---|
| 取得・照合 | `parseOnsValueForRelease` とほぼ同じ。**`quarters` と 'YYYY Qn' を読む分岐**が必要(period は 'YYYY-Qn')。ABS の四半期対応(`quarterly: true`)と同様の変更 |
| 公表予定 | `gbAuCaSchedule.ts` に 3 回分(2027-02-12・05-14 と、必要なら改定の回)を追加。referencePeriod は題名の月から 'YYYY-Qn'(Q4 = October to December) |
| 初回値の保存 | 既存の official-values(公表日・対象期間の一致、数値・単位・出典) |
| 改定 | 既存の `event_revisions`。ただし**期間は指標別設定が前提**(次節) |
| migration | 指標 1 行 + 通貨ペア(GBPUSD・GBPJPY)。frequency は QUARTERLY(スキーマ上許可済み) |
| 公表の重なり | 2027-02-12 07:00 に GB_GDP_MOM と GB_GDP_QOQ が同時刻で並ぶ。UI・通知は、別の指標として扱えるか確認 |

## 8. ライセンス・利用条件
- ONS: **Open Government Licence v3.0**(商用可、出典の表示)。時系列 JSON の `license` も OGL v3.0。既存の `ONS_ATTRIBUTION` がそのまま使える。API は鍵なし。

## 9. 初回実装に必要な変更とリスク
**変更(小〜中)**
1. `OnsSeries` に四半期の系列(`quarterly: true`、`datasetId`)と、`quarters` を読むパーサー。
2. `GB_GDP_QOQ` の系列(IHYQ・`pn2`)と、公表予定の表(Q4・Q1 の初回の回)。
3. 指標別の改定期間(`revisionLookbackDays`、推奨 **60〜270 日**。下記)。
4. 出典(既存)、migration(未適用)、テスト(正常・公表前・別データセット・別の四半期・改定・夏時間)。

**期間の見積り**: 初回の四半期推計から、次の公表(四半期国民経済計算)までは **40〜47 日**(11/12→12/22 = 40 日、2/12→3/25 = 41 日、5/14→6/30 = 47 日)。現行の 45 日では 5/14 の回が**範囲外**。さらに、**次の四半期の公表でも前の四半期が動く**(上表)ので、改定の確認は 100 日以上が望ましい。**指標別設定が前提**。

**リスク**
1. **データセット ID の揺れ**(12/22 の更新先が未確認)。
2. **改定の多さ**: `event_revisions` への書き込みが増える。月次より長期間・複数回。
3. **GB_GDP_MOM との二重表示**: 同じ日に月次と四半期が並び、ユーザーが混同する可能性。表示名で区別する(「GDP（前期比）」と「GDP（前月比）」)。
4. **前年同期比が無い**: 市場が併せて見る数値の一部が出せない。
5. 予想値・前回値は登録しない(公式データに無い)。

## 10. 推奨と次の実装候補
- 導入を推奨する。順序: ① 指標別の改定期間(設計は `../indicator-research-2026-11-18/03-…`)→ ② 四半期の ONS パーサー → ③ `GB_GDP_QOQ` の追加。
- **最初の公表(2027-02-12)まで時間があるので、12/22 の更新を実 API で観察してから**データセットの方針を確定できる。
