# FX Event Analyzer: データ取得元と正確さの仕組み v1.0

## 変更履歴

- **v1.0**(2026-10-15): 初版。取得元の構成(①〜⑤、ユーザー承認済み)、各取得元の利用条件の確認結果、正確さの仕組み、取り込みジョブ、有料候補の比較ツールをまとめた。実装は `fx-event-analyzer-backend/src/ingestion/`。DB変更は db-design.md v4.15、設計方針は design.md v1.11、API は api-design.md v1.29

---

## 1. 方針

**いちばん大事なのはデータの正確さ、次に費用の安さ。** 確かめきれない値は利用者に見せない(「データ準備中」= `DATA_PENDING` のままにする)。値を推測で補わない。

| 区分 | 役割 | 取得元 | 状況 |
|---|---|---|---|
| ① | 経済指標の予定・予想・結果・改定 | 有料の経済指標カレンダー(候補: Trading Economics / Finnhub / Financial Modeling Prep) | 未契約。読み取り部分の下書き(公開ドキュメントの形式どおり)と比較ツールを実装 |
| ② | ①の結果の照合(無料の公式統計) | FRED(米セントルイス連銀)、BLS(米労働統計局)。今後 e-Stat(日本)、ECB など | **FRED・BLSを実装**(BLSは実データで確認済み) |
| ③ | 為替の1分足 | 有料(候補: Twelve Data / Polygon(Massive)) | 未契約。読み取り部分と比較ツールを実装(Twelve Data は公開デモキーで形式を確認) |
| ④ | 要人発言の予定 | 中央銀行の公式サイト(FRB・ECB・日銀・BOE) | **FRBを実装**(実データで確認)。ECBは読み取りのみ(時刻の扱いのため既定では取り込まない、5章)。日銀・BOEは利用条件のため未実装 |
| ⑤ | ③の照合用の2つ目の為替(任意) | ③の候補のもう一方など | 照合の仕組みを実装(6.4節) |

設計上の位置づけ(design.md 4.3節): Ingestion Worker → Provider Adapter(取得元ごとの読み取り) → 共通の形(UTC・単位・値の種類) → 検証 → DB。Read API は外部の取得元を呼ばない。

---

## 2. 取得元ごとの利用条件(2026-10-15 に確認)

「確認」はプロキシ経由で各サイトの利用条件のページを読んだ結果。読めなかったものは **要確認** と書く。費用は契約前のため **要確認**。

| 取得元 | 用途 | 利用条件(要点) | アプリでの表示義務 | 費用 |
|---|---|---|---|---|
| FRED API(fred.stlouisfed.org) | ② | 確認済み(https://fred.stlouisfed.org/docs/api/terms_of_use.html)。APIキー必須。第三者が著作権を持つ系列はその持ち主の許可が要る(ここで使う CPI・雇用統計・小売売上高は米政府機関の系列)。FRED の体験を置き換えるアプリは不可。帯域の使いすぎ不可 | **必須**: "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." をアプリ内の目立つ場所に表示する | 無料 |
| BLS Public Data API(api.bls.gov) | ② | 利用規約のページ(bls.gov/developers/termsOfService.htm)はプロキシから 403 で **読めず要確認**。API自体は応答した。米政府の著作物で一般にパブリックドメインとされる(要確認)。v2 はキー登録で 500回/日、キーなし(v1)は 25回/日 | 出典の記載(要確認) | 無料 |
| FRB 公式サイト(federalreserve.gov、`/json/calendar.json`) | ④ | 確認済み(https://www.federalreserve.gov/disclaimer.htm):「特に断りがなければパブリックドメインで、許可なく複製・配布できる。出典として FRB を示す」。リンク可、フレーム内表示は不可 | 出典「米国連邦準備制度理事会(FRB)」 | 無料 |
| ECB 公式サイト(`/rss/press.html`) | ④ | 確認済み(https://www.ecb.europa.eu/services/disclaimer/html/index.en.html):自由に使えるが、正確に再現し出典として ECB を示す。**有料の商品に組み込む場合は、購入前と利用のたびに「この情報は ECB のサイトで無料で入手できる」と利用者に知らせる**。加工した場合(季節調整・伸び率の計算等)はその旨を明示 | 出典「欧州中央銀行(ECB)」+ 上記の無料入手の案内(有料プランで見せるため) | 無料 |
| 日本銀行 公式サイト | ④(未実装) | 確認済み(https://www.boj.or.jp/about/copyright.htm):出所を明記すれば転載・複製できるが、**商用目的の場合は事前に情報サービス局(post.prd8@boj.or.jp)へ相談**。無断改変不可 | — | 無料(要相談) |
| イングランド銀行(BOE) 公式サイト | ④(未実装) | 確認済み(https://www.bankofengland.co.uk/legal):サイトの内容は個人利用・組織内の非商用利用のみ。それ以外は許可の申請が必要(Database の統計は Open Government Licence) | — | 要申請 |
| Trading Economics | ① 候補(第一候補、design.md 6.2節) | ゲストアカウント(guest:guest)は廃止済み(2026-10-15 に HTTP 410 を確認)。商用表示・保存・派生値の権利は契約時に確認(design.md 6.2節の確認事項) | 要確認 | 要確認(https://tradingeconomics.com/api/pricing.aspx) |
| Finnhub | ① 候補 | 経済指標カレンダーは有料プランの機能(要確認)。再配布条件 要確認 | 要確認 | 要確認 |
| Financial Modeling Prep | ① 候補 | 再配布・商用表示の条件 要確認 | 要確認 | 要確認 |
| Twelve Data | ③ 候補(代替候補、design.md 7.3節) | 個人向けプランは商用の外部表示・再配布に使えない。Business 系プラン+データライセンスが必要(design.md 7.3節)。公開デモキー(`demo`)で USD/JPY・EUR/USD の1分足の形式を確認 | 要確認 | 要確認 |
| Polygon(Massive) | ③/⑤ 候補 | 再配布条件 要確認 | 要確認 | 要確認 |

**本番で使ってよいのは、商用配信の権利を確認できた取得元だけ**(requirements.md 6章)。無料・個人向けの API をそのまま本番に使わない。公式サイトの非公式なスクレイピングもしない(FRB の calendar.json・ECB の RSS は公式に配信されているもの)。

---

## 3. 指標・通貨ペアの対応表(コードレビュー対象の設定ファイル)

取り込むのは**対応表に載っている指標・通貨ペアだけ**。ファイルの変更は利用者に見える数字を変えるので、必ずレビューする。

- `src/ingestion/mappings/indicators.ts` — 指標ごとに: `economic_indicators.code`、各有料カレンダーでの名前(国+指標名)、照合に使う公式系列、単位、値の種類(前年比・前月比・変化幅・水準)、季節調整の有無、公表の小数桁、想定範囲、前回からの変化の上限、発表時刻(現地時刻)
- `src/ingestion/mappings/fxPairs.ts` — 通貨ペアごとに: 取得元での記号、pip の大きさ、小数桁(`fx_pairs` の値と違えば取り込まない)
- `src/ingestion/mappings/speakers.ts` — 要人の英語表記 → `speakers` の行(機関+日本語名)と重要度

### 3.1 米国の指標と公式系列

| code | 値 | 季節調整 | 単位・桁 | 照合1(FRED) | 照合2(BLS) | 計算 | FRED release |
|---|---|---|---|---|---|---|---|
| `US_CPI` | CPI 前年比 | **なし**(BLS の見出しの前年比は季節調整なしの指数で計算される) | %・小数1桁 | `CPIAUCNS` | `CUUR0000SA0` | 当月 ÷ 12か月前 − 1 | 10 |
| `US_CORE_CPI`(DB に行なし) | コアCPI 前年比 | なし | %・1桁 | `CPILFENS` | `CUUR0000SA0L1E` | 同上 | 10 |
| `US_NFP` | 非農業部門雇用者数 前月差 | あり | 千人・整数 | `PAYEMS` | `CES0000000001` | 当月 − 前月(前月は同じ発表で改定された値) | 50 |
| `US_UNEMPLOYMENT_RATE`(DB に行なし) | 失業率 | あり | %・1桁 | `UNRATE` | `LNS14000000` | 水準 | 50 |
| `US_RETAIL_SALES`(DB に行なし) | 小売売上高 前月比 | あり | %・1桁 | `RSAFS` | (BLS になし) | 当月 ÷ 前月 − 1 | 9 |

確認の根拠: BLS の4系列は 2026-10-15 に API から実データを取得(テストの記録データ `tests/fixtures/ingestion/bls-v1-2025-2026.json`)。2026年9月の CPI 前年比 336.940 ÷ 324.800 − 1 = 3.74% → 3.7、雇用者数 159,044 − 159,015 = +29千人、失業率 4.2%。2025年10月は政府閉鎖で公表されておらず、BLS は値を `-` で返す(**補わない**)。FRED の系列ID・release id は FRED のページがプロキシから開けなかったため、`npm run eval:providers` が FRED_API_KEY ありのとき `fred/series/release` で自動確認する(**要確認**)。

`US_CORE_CPI`・`US_UNEMPLOYMENT_RATE`・`US_RETAIL_SALES` は `economic_indicators` に行がないため、取り込み時に「DB に無い指標」としてスキップされ、ログに残る。追加するときは表示名のルール(indicator-display-names.md)に沿って HQ が行を追加する。

日本の指標(`JP_CPI` など)は対応表に未登録 = 取り込まない。e-Stat(総務省 統計局)の API を照合元にするのが次の手順(10章)。

---

## 4. 公式統計による照合(②)

1. 有料カレンダーの結果(actual)を、対応表の単位に直す(例: `29K` → 29 千人。`%` の指標に `K` が来たら単位違い)。
2. 対応表の公式系列から、同じ期間の値を計算する。**FRED は発表日時点の値**(ALFRED の realtime = 発表日)で計算する。後から改定された値と比べると、正しい速報値を誤って「不一致」にするため。BLS は時点指定ができない(いまの値だけ)ので、発表から 20 日を過ぎた照合には使わない。
3. 両方を、その指標が公表される小数桁で四捨五入(0.05 → 0.1 のように 0 から遠い方へ。2進数の誤差が出ないよう文字列で計算)してから比べる。許容差は既定 0。
4. 一致 → 公開(`event_snapshots` の RELEASE に `verification_status = VERIFIED`・照合元・公式値を記録)。不一致 → 要確認(`PENDING_REVIEW`、両方の値を記録)。公式値がまだ無い → 公式待ち(`AWAITING_OFFICIAL`)。`npm run ingest:official` が後から照合し直す。

公式値の取得元は対応表の順(FRED → BLS)。1つ目が失敗・値なしなら2つ目を使う。どれも無いときに「照合なしで公開」してよいのは、対応表で `requireOfficialMatch: false` にした指標だけ(いまは全指標 `true`)。

---

## 5. 要人発言(④)

| 機関 | 取得元 | 時刻 | 実装 |
|---|---|---|---|
| FRB | `https://www.federalreserve.gov/json/calendar.json`(サイトのカレンダーの元データ) | 予定の時刻が米東部時間で書かれている(例 "10:55 p.m.")。夏時間込みで UTC に直す。速報RSSの GMT 時刻と照合して東部時間であることを確認 | 取り込む。種類 `Speeches`・`Testimony` のみ |
| ECB | `https://www.ecb.europa.eu/rss/press.html` | **原稿の公開時刻**しかない(例: 午前2時(中央ヨーロッパ夏時間)の公開)。発言の開始時刻ではない | 読み取るが、既定では取り込まない(`TIME_NOT_EXACT` としてログに残す)。値動きは発言時刻から1分単位で計算するため、ずれた時刻は使えない |
| 日銀 | 新着RSS(`/rss/whatsnew.xml`、「【挨拶】」等) | 公開時刻のみ | 未実装。商用利用は事前相談が必要(2章) |
| BOE | `/rss/speeches` | 公開時刻のみ | 未実装。商用利用は許可が必要(2章) |

- **要人の照合**: 取得元の英語名から役職(Chairman / Vice Chair for Supervision / Governor など)を除き、`speakers.ts` の別名表で `speakers` の行(機関+日本語名)に結び付ける。**表に無い人・DB に行が無い人はスキップしてログに残し、自動で作らない**(別人に発言と値動きを結び付ける危険があるため)。2026-10-15 時点では、ウォラー理事(別名はあるが DB に行が無い)とミラン理事(別名なし)がスキップされる。追加するときは migration で `speakers` に行を入れてから別名を足す
- **ID**: FRB のカレンダーには ID が無いため「日付・時刻・要人・種類」から作る。時刻が変わると別の発言として入り、元の予定は「取得元から消えた予定」としてログに残す(中止か変更かは取得元から分からないので、自動で中止にはしない)
- **期間**: カレンダーには数年分の履歴があるため、既定では14日より前の発言は取り込まない
- **タイトル**: 「講演: 〈取得元の題〉」のように種類だけ日本語にし、題は訳さない(機械翻訳で意味を変えないため)
- **状態**: 開始時刻を過ぎたら `DELIVERED`、それまでは `SCHEDULED`

ECB の発言の正確な予定時刻は「Weekly schedule of public speaking engagements」(https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html、HTML)にある。ただし夏時間の期間でも「CET」と書かれている例があり、時刻帯の扱いを確かめてから実装する(10章)。

---

## 6. 正確さの仕組み

### 6.1 検証の流れ(経済指標)

```
有料カレンダー ─▶ 対応表に無い ─▶ スキップ(ログ)
      │
      ▼
   予定の登録(economic_events。provider + provider_event_id で1行)
      │  発表時刻がいつもの時刻でない → 新規は APPROXIMATE で登録、既存の予定は変えない(ログ)
      ▼
   結果(actual)あり?
      ├ まだ RELEASE スナップショットが無い ─▶ 検証ルール(6.2) + 公式統計の照合(4章)
      │        ├ 問題なし・公式と一致   ─▶ event_snapshots(RELEASE、VERIFIED)を作成、data_status = AVAILABLE
      │        ├ 公式値がまだ無い       ─▶ ingestion_staged_values(AWAITING_OFFICIAL)
      │        └ 問題あり・公式と不一致 ─▶ ingestion_staged_values(PENDING_REVIEW、理由と両方の値)
      └ もう RELEASE がある ─▶ 改定の候補(6.3)
```

`ingestion_staged_values` は Read API が読まないテーブル。保留中のイベントは `data_status = PENDING` のままなので、API は `DATA_PENDING`、スナップショットは `null` を返す。RELEASE スナップショットは DB のトリガーで書き換え・削除ができないため、**確かめる前の値を入れない**ことで誤りが残らないようにしている。

### 6.2 検証ルール

| コード | 内容 | 扱い |
|---|---|---|
| `UNIT_MISMATCH` | 単位が対応表と合わない(% の指標に K 等) | 要確認 |
| `OUT_OF_EXPECTED_RANGE` | 対応表の想定範囲の外 | 要確認 |
| `OUTLIER_VS_PREVIOUS` | 前回からの変化が対応表の上限を超える | 要確認 |
| `MISSING_EXACT_TIME` | 取得元に正確な時刻が無い | 要確認(予定は APPROXIMATE 等で登録) |
| `RELEASE_TIME_UNEXPECTED` | 発表時刻が公表機関のいつもの時刻(米国は 8:30 ET)でない | 要確認 |
| `FUTURE_DATED_ACTUAL` | 取得時点でまだ発表前なのに結果がある | 要確認 |
| `DUPLICATE_IN_BATCH` | 同じ指標・同じ期間の行が1回の取得に2つ以上 | 両方要確認 |
| `UNPARSEABLE_ACTUAL` | 結果を数値にできない | 要確認 |
| `REFERENCE_PERIOD_INFERRED` | 取得元が対象期間を出さず(Finnhub・FMP)発表月から推定した。公式統計と一致しない限り公開しない | 公式待ち / 要確認 |
| `OFFICIAL_MISMATCH` | 公式統計と一致しない(丸めを合わせて) | 要確認 |

閾値は指標ごとに `mappings/indicators.ts`、共通の値は `src/ingestion/config.ts` の `INGESTION_SETTINGS`。

### 6.3 改定

- 公開済みの結果と違う結果が後から来た → `event_revisions`(`ACTUAL`)の候補。取得元の「改定後の前回値」(Trading Economics の `Revised`)→ `event_revisions`(`PREVIOUS`)の候補
- 候補も公式統計と照合し、一致したときだけ `event_revisions` に追記する(同じ値は二重に記録しない)。RELEASE スナップショットは変えない(db-design.md 4章)
- 速報値と改定値は、RELEASE スナップショットと `event_revisions` に分かれて残る

### 6.4 為替の1分足

- 足の時刻は**足の始まり**(db-design.md 3.11節)。Twelve Data は `timezone=UTC` を付けないと取引所の時刻帯(UTC+11)で返すことを実データで確認したため、必ず付ける
- **欠けた分は補わない**。まだ終わっていない足(取得時点で1分たっていない足)・分の区切りでない足・高値/安値が矛盾する足・同じ分に値の違う足が2本ある場合は取り込まない
- 2つ目の取得元(⑤)があるときは同じ分の終値を比べ、差が 3 pips(`fxCrossCheckMaxDiffPips`)を超えた分は `fx_prices.verification_status = UNVERIFIED`(差も記録)。2つ目に同じ分が無いときは `SINGLE_SOURCE`、範囲内は `VERIFIED`。直前の分から 500 pips を超えて飛んだ分も `UNVERIFIED`
- 5分・15分・30分・60分足は取得元から別に取らず、取り込んだ1分足から組み立てる(`aggregateMinuteRows`)。どの時間足も値動きの計算に使う1分足と食い違わず、取得回数も増えない。区切りの中の1分足が1本でも欠けている・`UNVERIFIED`・まだ終わっていない区切りは作らない(次の実行で揃えば作る)。全部 `VERIFIED` なら `VERIFIED`、それ以外は `SINGLE_SOURCE`
- Read API は `UNVERIFIED` の足を使わない(チャートに出さず、最新価格にも使わない)。要人発言の値動きでその足が必要なら `DATA_UNAVAILABLE`。経済指標の値動き(`event_price_reactions`)を計算するジョブも同じ扱いにする(`usableForReactions`)

### 6.5 再実行しても重複しない

| データ | 重複しないための鍵 |
|---|---|
| 経済指標イベント | `provider` + `provider_event_id` |
| RELEASE スナップショット | `event_id` + `snapshot_type`(既にあれば改定の扱い) |
| 保留中の値 | イベント・種類・項目ごとに未解決は1行(DB の一意インデックス) |
| 公式統計 | 取得元・系列・期間・時点 |
| 要人発言 | `provider` + `provider_event_id` |
| 為替 | 通貨ペア・`1m`・足の始まりの時刻 |

### 6.6 取得の作法

`src/ingestion/http.ts`: 取得元ごとの間隔(レート制限)・タイムアウト・失敗時の再試行(429・5xx・通信エラーのみ、待ち時間を倍々に。`Retry-After` に従う)。設定は `PROVIDER_HTTP_SETTINGS`(無料枠の上限以下)。URL に入る API キーはエラーやログに出す前に `***` に置き換える。

### 6.7 取り込みのログ

ジョブごとに `ingestion_logs` に1行: 取得元・ジョブ名・開始/終了・件数(取得/成功/失敗/スキップ/要確認)・エラー・内訳(スキップの理由別件数、DB に無い指標、不明な要人、保留にした値の一覧など)。ジョブが途中で例外になっても記録する。

---

## 7. 有料候補の比較(`npm run eval:providers`)

契約前に、候補の正確さを同じ期間で比べるためのツール。DB には書かない。キーが1つも無いときはメッセージを出して正常終了する。

```
npm run eval:providers -- --from 2026-09-01 --to 2026-10-14 --fx-pairs USDJPY,EURUSD --fx-hours 6 --out eval-reports
```

- 経済指標(キーがある候補ごと): 公式統計との不一致、予想が無い件数、発表時刻のずれ(いつもの時刻との違い・候補どうしの違い・FRED の公表日との違い)、対応表に無い行(対応表の名前の確認用)、FRED の release id の確認
- 為替: 2つの候補の同じ分の終値の差(pips の平均・中央値・95%点・最大、3 pips を超えた分の数、片方にしか無い分の数)。1つだけのときは取れた分の数
- 出力: `eval-reports/provider-eval-<日時>.json` と `.md`(`.gitignore` 済み。契約データを含みうるのでコミットしない)

候補ごとの読み取り部分は、公開ドキュメントの応答例どおりに書いた**下書き**で、実際のキーではまだ動かしていない(Twelve Data のみ公開デモキーで確認)。キーを入れたら、まずこのツールで形式と対応表の名前を確かめる。

---

## 8. ジョブと実行間隔の案(自動では登録しない)

| コマンド | 内容 | 必要なもの | 実行間隔の案 |
|---|---|---|---|
| `npm run ingest:official` | FRED/BLS の観測値を `official_observations` に保存し、公式待ちの値を照合し直す | Supabase、FRED_API_KEY(任意)、BLS_API_KEY(任意) | 米国の発表日は 12:30〜15:00 UTC(21:30〜24:00 JST、冬時間は1時間遅く)に15分ごと、それ以外は1日1回 |
| `npm run ingest:speeches` | FRB のカレンダー・ECB の RSS → `speech_events` | Supabase | 1日2回(例 06:00・18:00 JST) |
| `npm run ingest:fx-prices` | Twelve Data の1分足(+ POLYGON_API_KEY があれば照合)→ `fx_prices`、5分〜60分足も組み立てる。既定は直近120分・対応する全ペア(`--minutes`・`--pairs` で変更) | Supabase、TWELVE_DATA_API_KEY(無ければ何もしない)、POLYGON_API_KEY(任意) | 無料枠(1分8回・1日800回)・9ペアなら20分ごと(1日648回) |
| `npm run eval:providers` | 有料候補の比較(7章) | 候補のキー | 手動 |

① の取り込み(`ingestCalendarReleases`)は実装・テスト済みだが、契約前のためコマンドは用意していない。③ は HQ指示(2026-10-16)「今日はこちらで進める」により `ingest:fx-prices` を用意した。**Twelve Data の無料・個人向けキーで動かすのは社内の開発ビルド確認だけ**(個人向けプランは商用の表示・再配布不可、要件定義書 6.4節)。一般向けに公開する前に、表示が認められたプランに切り替える。別ブランチ `claude/fx-price-provider-adapter` の同じ役割のジョブ(`jobs:ingest-fx-prices`)はこれで置き換える(照合・ログ・`UNVERIFIED` の扱いが無いため取り込まない)。社内プロキシの内側で動かすときは `NODE_USE_ENV_PROXY=1` と `HTTPS_PROXY` を設定する(Node 22.21 以降の標準 fetch がプロキシを使う)。

---

## 9. 用意が必要なキー(値はコードに書かず `.env` に入れる。名前は `.env.example`)

| 環境変数 | 取得先 | 費用 |
|---|---|---|
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html(無料アカウント) | 無料 |
| `BLS_API_KEY`(任意) | https://data.bls.gov/registrationEngine/ | 無料 |
| `TRADING_ECONOMICS_API_KEY` | https://tradingeconomics.com/api/pricing.aspx | 要確認 |
| `FINNHUB_API_KEY` | https://finnhub.io/pricing | 要確認 |
| `FMP_API_KEY` | https://site.financialmodelingprep.com/developer/docs/pricing | 要確認 |
| `TWELVE_DATA_API_KEY` | https://twelvedata.com/pricing | 要確認 |
| `POLYGON_API_KEY` | https://polygon.io/pricing(Massive) | 要確認 |

ほかに Supabase の `SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`(既存)。

---

## 10. 未確認のこと・次の手順

- **契約**: ① ③ の候補の商用表示・保存・派生値・再配布の権利と費用(design.md 6.2節・7.3節の確認事項)。キー取得後に `eval:providers` で比較
- **FRED**: 系列ID・release id の FRED 上での確認(`eval:providers` が自動確認)。アプリへの FRED の表示文の追加(iOS、HQ判断)
- **BLS**: 利用規約ページの確認(プロキシから 403)
- **ECB**: 有料プランで ECB の情報を見せる場合の「無料で入手できる」案内の表示方法(HQ判断)。週間予定ページからの正確な時刻の取り込み(時刻帯の表記の確認が先)
- **日銀・BOE**: 商用利用の相談・許可(日銀は post.prd8@boj.or.jp)。許可が出るまで実装しない
- **日本の指標**: e-Stat API(https://www.e-stat.go.jp/api/、アプリケーションID が必要。利用規約・出典の書き方は要確認)を照合元として対応表に追加
- **要人**: ウォラー理事・ミラン理事・ECB 役員会などの `speakers` の行の追加(役職の確認と migration)
- **指標**: `US_CORE_CPI`・`US_UNEMPLOYMENT_RATE`・`US_RETAIL_SALES` の `economic_indicators` の行(表示名ルールに沿って)
- **管理機能**: `ingestion_staged_values` の要確認の値を人が承認・却下する画面/API(design.md 13章。いまは DB を直接確認する)
- **値動きの計算ジョブ**: `event_price_reactions` を `fx_prices` から計算するジョブ(`UNVERIFIED` の足を使わない)
- 発表前の予想(forecast)の変化は、RELEASE スナップショットができるまで保存していない(発表前のスナップショットの種類を足すかは HQ 判断)
