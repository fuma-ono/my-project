# 豪州の小売売上高(ABS RT)の導入調査(2026-11-18)

担当 D。調査・設計のみ(コード・migration・DB・DEV の変更なし)。確認した事実と、確認できなかったことを分けて書く。

## 1. 結論(先に)
- **ABS の `RT`(Retail Trade、8501.0)は廃止されている。** 導入の対象にならない。
- 後継は **Monthly Household Spending Indicator(HSI_M、5682.0)**。ただし ABS 自身が「実験的な指標」と書いており、中身は小売売上高ではなく**銀行の取引データによる家計支出**。市場が見る「豪州小売売上高」と同じ指標ではない。
- 推奨: **「豪州小売売上高」としての導入は見送る。** 導入するなら、別の指標(`AU_HOUSEHOLD_SPENDING_MOM`、名称は HQ 判断)として、実験的統計であることを明示して追加する。優先度は WPI・英国指標より低い。

## 2. 確認した公式ソース
| 確認 | 内容 | 出典 |
|---|---|---|
| RT の廃止 | SDMX の dataflow `RT` の説明が「CEASED - Dataset: RT. This dataset has been discontinued.」 | `https://data.api.abs.gov.au/rest/dataflow/ABS/RT` |
| RT の最終回 | 「Retail Trade, Australia, June 2025」のページに「This release has ceased」「Next release: Ceased」。最後の値は 2025-06(月次 +1.2%) | `https://www.abs.gov.au/statistics/industry/retail-and-wholesale-trade/retail-trade-australia/latest-release` |
| 後継 | dataflow `HSI_M` 1.6.0「Experimental indicator of household spending using bank transactions data」(カタログ番号 5682.0)。四半期版 `HSI_Q` もある | `https://data.api.abs.gov.au/rest/dataflow/ABS` の一覧 |
| HSI の最新回 | 「Monthly Household Spending Indicator, September 2026」、公表 **04/11/2026 11:30am AEDT**、見出し「rose 0.6% month-on-month on a current price, seasonally adjusted basis」 | `https://www.abs.gov.au/statistics/economy/finance/monthly-household-spending-indicator/latest-release` |
| HSI の次回 | 30/11/2026(2026-10 分)・12/01/2027(同 11 月分)・9/02/2027(同 12 月分)。時刻は「Next Release」に書かれていない(直近の回は 11:30am) | 同上 |
| 小売売上高に近いもの | ページの「Table 19: Experimental estimates of retail turnover」(xlsx のみ。API の dataflow には出ていない) | 同上 |

## 3. HSI_M の取得可能な数値(実 API、2026-11-18)
- キー(次元の順): `MEASURE.CATEGORY.PRICE_ADJUSTMENT.TSEST.STATE.FREQ`。
- 候補の系列: `8.TOT.CUR.20.AUS.M` = MEASURE 8「Household spending - Percentage change from previous period」・CATEGORY TOT・CUR(当年価格)・TSEST 20(季節調整済み)・AUS・月次。
  - 応答: 2026-09 = **0.6**、2026-08 = -0.1、2026-07 = 1.0、2026-06 = 0.8(単位 UNIT_MEASURE=PCT)。公式ページの「rose 0.6%」と一致。
  - 前年比は MEASURE 9。カテゴリ別(商品・サービス・裁量支出など)もある。
- 観測の属性は `OBS_STATUS` / `OBS_COMMENT` のみ(値は空)。DECIMALS なし。
- `updatedAfter` による公表日の照合が使える: `updatedAfter=2026-11-04T00:00:00Z` は 200、`2026-11-05T00:00:00Z` は 404(2026-09 分は 11/04 公表と一致)。

## 4. 更新頻度・改定
- 月次。公表は月初〜月末の間(2026-09 分は 11/04、2026-10 分は 11/30 予定)で、間隔が一定でない。
- 改定: API は**最新版の値だけ**を返す(過去の版は無い)。既存の ABS の仕組みと同じく、初回値は公表日の `updatedAfter` で確定し、後の値の違いは `event_revisions` に記録できる。
- HSI の改定の大きさ・頻度は、**確認できていない**(実験的統計で、ページに注記があるはずだが、今回は読んでいない)。

## 5. ライセンス
- ABS の公開データは CC BY 4.0(`ABS_ATTRIBUTION` がそのまま使える)。HSI にだけ別の条件があるかは、**今回は個別に確認していない**。実装前に確認する。
- API は全 dataflow に `NonProductionDataflow`(beta)の注記あり。WPI・CPI と同じ扱い。

## 6. 既存基盤との適合性
| 項目 | 評価 |
|---|---|
| 取得の仕組み | `absOfficialValues.ts` にそのまま乗る(系列を 1 行追加。単位 PCT、月次、`updatedAfter`) |
| 対象期間 | 月次 'YYYY-MM' で既存と同じ。公表予定の表には、latest-release の「Next Release」で対象月を書ける(WPI と同じ方法) |
| 公表予定 | ABS_RELEASE_CALENDAR には載っていない可能性。latest-release の 3 回だけ使う(WPI と同じ) |
| migration | 指標 1 行 + 通貨ペア(AUDUSD・AUDJPY)。DB スキーマの変更なし |
| 表示名 | 「家計支出（前月比）」など。**「小売売上高」と名乗らない** |

## 7. リスク
1. **名前と中身の不一致**: 「豪州小売売上高」として出すと、市場の予想・過去比較(別の統計)と食い違う。ユーザーが誤解する。
2. **実験的統計**: ABS が改定・仕様変更をする可能性が高く、「初回値は不変」の前提で保存すると、後の大きな改定が履歴に溜まる。
3. **公表日の不規則さ**: 公表予定の確認が、latest-release の 3 回先までしかできない。
4. **予想値**: 市場のコンセンサスは公式データに無く登録できない(現行方針)。

## 8. 推奨と次の実装候補
- 「豪州小売売上高」は**導入しない**(RT 廃止)。
- HSI を入れるかは HQ の判断。入れるなら: 指標名・表示名の決定 → ライセンスと改定の注記の確認 → `ABS_SERIES` に 1 行・公表予定 3 回・migration(未適用)・テスト(WPI と同じ構成)。見積り: WPI と同程度(小)。
