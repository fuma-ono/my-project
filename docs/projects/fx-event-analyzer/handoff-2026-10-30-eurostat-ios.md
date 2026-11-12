# A への引き継ぎ: ユーロ圏の経済指標(Eurostat)の iOS 表示(2026-10-30)

- 依頼元: HQ判断 2026-10-30「Eurostat経済指標 第1弾」4(iOS の変更は A が担当)
- Backend: `claude/fx-eurostat-indicators`(B)。**settings には未統合・DEV 未反映**(統合・migration・デプロイは別の承認)
- API の仕様: api-design.md **v1.43**

## 1. 追加される指標

| code | 一覧の表示名 | 国・通貨 | 重要度 | 単位 | 値 | 関連ペア |
|---|---|---|---|---|---|---|
| `EU_HICP` | 消費者物価指数（CPI） | `EU`・`EUR` | HIGH | `%` | HICP 前年比の**速報値** | EURUSD 1・EURJPY 2 |
| `EU_UNEMPLOYMENT_RATE` | 失業率 | `EU`・`EUR` | MEDIUM | `%` | 失業率(季節調整済み) | EURUSD 1・EURJPY 2 |

- 国旗・「ユーロ圏」・国の絞り込みは、今の iOS のままで出る見込み(`Formatting.swift` に `EU` あり)
- **予想(`forecast`)は常に `null`**(Eurostat は予想を出さない)。米国の指標と同じく「予想なし」の表示でよい
- **発表時刻は `APPROXIMATE`**(11:00 ルクセンブルク時間。公式に時刻を明記した文が無いため)
  - `release_datetime_precision` / カレンダーの `datetime_precision` が `APPROXIMATE`
  - 1分足の相場反応は出ない(API が返さない・分析できない扱い)。既存の `APPROXIMATE` の表示に従う
- 失業率は直近の発表(2026-10-30、9月分)から始まる(過去の月は登録しない。HQ判断)。HICP の速報は 2026年1月分から

## 2. 出典・告知(`attribution`)

形は要人発言(v1.38)と同じ `{ source, source_url, notice }`。Eurostat の指標だけに付き、それ以外の指標は `null`。

```json
{
  "source": "Eurostat（欧州連合統計局）",
  "source_url": "https://ec.europa.eu/eurostat",
  "notice": "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。"
}
```

| API | 場所 | 今の iOS |
|---|---|---|
| `GET /events/{id}` | `event.attribution`(過去の発表の制限でロックされても返る) | 読んでいない(`EventDetailModels.swift` に項目が無い) |
| `GET /indicators/{id}` | 応答の最上位の `attribution` | 読んでいない |
| `GET /calendar` | INDICATOR の各項目の `attribution`(項目自体は v1.38 からある) | 読んでいない(`CalendarModels.swift`) |

- 変わらないもの: `GET /home`・過去比較・検索・通知(`/notifications/upcoming`・`/notifications`)の指標の項目(通知仕様の変更は別の承認)

## 3. 表示の要件(Eurostat の規約から。文言は実装候補で、規約上十分かは未確定)

Eurostat の規約(https://ec.europa.eu/eurostat/web/main/help/copyright-notice): 商用の再利用は**出典を示せば可**。**加工したらその旨を明示**し、**Eurostat が責任を負わない旨の免責文**を含める。

| 画面 | 出すもの(案) | 理由 |
|---|---|---|
| イベント詳細(EU の指標) | `source` と `notice`(結果の値の近く) | 値を見せる画面。出典と免責文が要る |
| 指標詳細(EU の指標) | `source` と `notice` | 同上 |
| カレンダー・一覧 | なし、または小さく `source` だけ(A の判断) | 値を出さない一覧は、詳細で出せば足りる見込み(未確定) |
| アプリ情報「データの出典」 | Eurostat の固定の文(ECB の文と同じ場所) | 既存の ECB と同じ扱い |

- **加工の明示**: 相場反応(pips・変化率)や過去比較の計算は、アプリが計算したもの。今の画面の注記(相場反応はアプリの計算)があれば足りる見込み(未確定)。結果の値そのもの(Eurostat の公表値)は加工していない
- 要人発言の表示(`SpeechDetailCards.swift` の `attributionNotice`、notice があるときだけ出す)と同じ部品を使える見込み

## 4. 確認の材料

- DEV に反映されるまで、実データは API から出ない。iOS の画面の確認は、統合・DEV 反映の後
- 値の例(2026-10-30 に Eurostat から取得): HICP 速報 2026年9月 = 3.8(前回 3.2 = 8月の確報)、2026年7月 = 2.9(前回 2.8)。失業率 2026年8月 = 6.4
