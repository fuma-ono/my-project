# FX Event Analyzer: データ取得元と正確さの仕組み v1.6

## 変更履歴

- **v1.6**(2026-10-26): 米国コアCPI・失業率・平均時給を BLS の独立経路(14章)に追加(HQ指示 2026-10-26)。指標ごとの系列・季節調整・単位・前月比/前年比の計算・発表日は16章。指標マスタは migration `20261026000001_us_bls_indicators.sql`。US_CPI・US_NFP の系列・予定・値は変えていない
- **v1.5**(2026-10-26): BLS の独立経路(14章)の安全対策(HQ指示 2026-10-26「BLSの安全対策」)。2026-10-24 に統合された未来の予定行の作成をベースに、表のエントリの取りやめ(`cancelled`・`cancelledNote`。未発表の行を`CANCELLED`にし、`RELEASED`の行は変えない)、予定表から消えた未発表の行の記録、書き込む前の内訳(`details.plan`)、`--dry-run`を追加した。取りやめ・消えた行の点検は発表済みの値の取り込みの後に別の try/catch で行い、失敗しても過去の発表の取り込みは止まらない。DEV の手順は dev-environment.md 11章
- **v1.4**(2026-10-23): 要人発言の鮮度の監視(HQ承認 2026-10-23)。`ingest:speeches` が `ingestion_logs.details` に `source_latest_at`・`source_future_count` を記録し、品質レポート第9章で取得元ごとに判定する(5章)。取り込む行・スキップ・状態は変えない。`GET /home` に `speeches_status`(api-design.md v1.34)
- **v1.3**(2026-10-22): FOMCの会合日程(HQ承認 2026-10-22 Task 3)。FRBの公式ページを人が書き写した表から、指標`US_FOMC`の政策発表の予定を`economic_events`に入れるジョブ`npm run ingest:fomc-schedule`を追加(15章)。暫定の会合は`economic_events.is_provisional`(db-design.md v4.17)で区別する。定期実行には登録していない
- **v1.1**(2026-10-16): HQ判断(方針は承認、契約・公開には前提条件)を受けて、利用条件を再確認(11章)、品質の測り方(12章)、為替の取り込みジョブ `ingest:fx-prices` を追加。**FRED は API 規約が「保存・DBへの取り込み」を禁じていると分かったため、`ingest:official` で使うのをやめた**(公式値は BLS のみ。FRED を使うには書面の許可が必要)。アプリ情報に「データの出典」を追加
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
- **鮮度の監視(v1.4)**: 取り込みのたびに `ingestion_logs.details` へ、取得した全件(スキップした項目も含む)の開始時刻の最大値 `source_latest_at`(0件なら `null`)と、未来の件数 `source_future_count` を記録する(記録するだけで、取り込む行は変えない)。品質レポート第9章「要人発言の鮮度」が FRB・ECB を別々に、取得の失敗(最新の実行の失敗・18時間以上 SUCCESS なし)/取り込みの漏れ/取得元の更新なし(10日以上)/時刻なしで未取り込み(ECB の通常の状態)を判定する。読み方は dev-environment.md 14章。ホームの `speeches_status.stale` は FRB だけの「取得の失敗」(ECB は仕様上 `speech_events` を書かないため入れない)

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

#### 6.4.1 取りこぼしの回収(HQ判断 2026-10-16)

GitHub Actions の定期実行は遅れたり飛んだりする(実際に340分の空白があった)ため、「最後に保存した足の後ろ」だけでなく、**毎回、直近7日の市場が開いている分を全部見て、欠けている分を取り直す**(`pipelines/fxGapRepair.ts`、`ingestFxWithGapRepair`)。

- 欠けとみなさない分: 市場が閉じている分(`marketHours.ts`: NY時間 日曜17:00〜金曜17:00、夏時間対応、12/25・1/1は終日休み)、今から2分以内の分(`finalityLagMinutes`、まだ確定していない)、そのペアの取り込み開始より前の分。初回(そのペアの足が1本も無い)は今までどおり直近120分だけ取る
- 1回の取得の範囲: 最大4800分(Twelve Data の1回の上限5000本より少なく、途中で切れない)。市場が閉じている時間をまたがない(週末・休日で分ける)。同じ取引時間の中の近い欠けは1回にまとめる
- 順番: ペアごとに最新の範囲(FORWARD、今で終わる120分。近くの欠けはこれに含める)を先に、次に古い欠け(REPAIR)を新しい順に。ペアを順番に回し、1つのペアが他を待たせない
- 上限: 1回の実行で27回(9ペア×3。再試行を含む HTTP の回数)。1日(UTC)の上限は台帳で守る(下記)。上限で取れなかった分は次の実行で取る
- 何度取り直しても重複しない(通貨ペア・時間足・足の始まりで上書き)。5分〜60分足は、取り直した範囲にかかる1時間ごとに、**保存済みの1分足と合わせて**組み立て直す

**訂正の扱い**: 取得元の新しい値で上書きする(取得元が正)。上書きの前に保存済みの1分足と比べ、始値・高値・安値・終値のどれかが変わった本数を `corrected` として数え、例を20件まで記録する(`corrections`)。行は削除しない。

**回収できなかった分(未回収)**: 実行のたびに、7日以内の欠けを1分ずつ次のどれかに分けてログに残す。「永久に取れない」とは扱わない。

| 理由 | 表示 | 意味 |
|---|---|---|
| `BUDGET` | 未回収(クレジット上限) | 回数の上限で送らなかった。次の実行・翌日に取る |
| `RATE_LIMITED` | 未回収(レート制限) | 再試行しても 429。この実行ではそれ以降 Twelve Data に送らない |
| `TIMEOUT` | 未回収(タイムアウト) | 再試行してもタイムアウト。次の実行で取り直す |
| `API_ERROR` | 未回収(APIエラー) | その他の HTTP エラー・応答の形式違い・保存の失敗。次の実行で取り直す |
| `NO_DATA_UNCONFIRMED` | 取得元にデータなしの可能性(未確認) | 取得は成功したが足が無かった。取得元に本当に無いかは確かめられない。別の日(UTC)にあと2回まで取り直し、それでも無ければ取りに行かない(表示はそのまま) |
| `BEYOND_HORIZON` | 未回収(回収期間外・7日超) | 7日より古い欠け。自動では取らない(期間外になってから1日だけ報告する) |

**APIの回数(クレジット)**: Twelve Data の `/time_series` は1回の取得が1ペアにつき1クレジット(取得本数 1〜5000 に関係なし。https://twelvedata.com/docs time_series の「API credits cost 1 per symbol」、2026-10-16 確認)。無料の Basic は1分8・1日800クレジット、日次のリセットは 00:00 UTC、使い切ると 429(https://support.twelvedata.com/en/articles/5615854-credits、2026-10-16 確認)。

- **前提(未確認)**: 契約は Basic(1日800・1分8)と仮定している。アカウントの実際のプランは管理画面での確認が必要(大野さん)。失敗・再試行した取得がクレジットを使うかは公式に書かれていないため、**HTTP を送る1回ごと(再試行を含む)に1クレジットとして数える**
- **台帳**: `api_credit_usage` と `reserve_api_credits()`(migration `20261016000003`)。送る前に1クレジットを予約し、予約できなければ送らない。同じ日付の予約はロックで1本ずつ処理するので、定期実行・手動実行・`eval:providers` が同時に動いても合計が上限を超えない。台帳に届かないときも送らない
- **上限は DB が持つ**(`api_credit_limits`、Twelve Data は 合計800 / 自動700。HQ判断 2026-10-16)。呼び出し側は「自動(AUTOMATIC)か手動(MANUAL)か」だけを渡し、上限の値は渡さない。上限の行が無い取得元は予約できない
  - 判定はその日の**全部の予約(自動・手動・`eval:providers`)の合計**で行う。自動は「合計+1 ≦ 700」のときだけ、手動は「合計+1 ≦ 800」のときだけ予約できる
  - そのため1日の合計は最大800、自動は最大700。手動が使えるのは「800 − その日の予約済み」で、自動がいくら動いても最低100は手動に残る。自動700と手動800が別枠で足されて1,500になることはない
  - 例: 手動が先に300使った日は、自動は合計700まで(=あと400)、手動は残り100
  - `src/ingestion/config.ts` の `API_CREDIT_CAPS` は、1回の実行で何回送るかを計画するための写し。値を間違えても、DB の上限を超えることはない
  - 1回の実行は27まで(実行ごとの上限。台帳とは別に、送る側で数える)
- **予約は解放しない**: 予約は「送る前」に1回ずつ行い、あとから戻さない。送った後のタイムアウト(取得元が処理したか分からない)、再試行(1回ごとに予約)、予約した直後に実行が止まった場合(送ったか分からない)も、使ったものとして数える。実際より多めに数えることはあっても、少なく数えることはない
- 予約に失敗した場合(台帳に届かない・上限の行が無い)は送らない(`LEDGER_UNAVAILABLE`、範囲は `API_ERROR`/`BUDGET` として未回収に残る)
- 使う回数: 通常は1回9(市場が閉じている間は0)。20分ごと×1日72回で最大648。取り直しがあっても1回最大27・1日700。上限に達した実行は `ingestion_logs` に理由を残し、送らなかった範囲は `BUDGET`(途中で達した場合は `PARTIAL`、実行前から達していた場合は送らずに `SUCCESS`)

**ログ(`ingestion_logs.details`)**: `api_requests`(この実行で送った回数)、`budget`(`mode`・`daily`・`used_before_run`・`left_after_run`)、`requests`(範囲ごとの結果 `OK`/`RATE_LIMITED`/`TIMEOUT`/`API_ERROR`/`BUDGET`、50件まで)、`unrecovered`(50件まで)と `unrecovered_total`、`no_data_unconfirmed`(この実行で足が無かった範囲と何日目か、ペアごと50件まで。次の実行が読む)、`reconciliation`(取得・取り込み・理由別の不採用・保存した1分足/組み立てた足・訂正・失敗。取得 = 取り込み + 不採用、保存した1分足 = 取り込み を毎回確かめる)、`corrections`、`latest_candle`、`range`(最新の範囲)。

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

契約前に、候補の正確さを同じ期間で比べるためのツール。取り込んだ値は DB に書かない。ただし Twelve Data を使うときは、API クレジットの予約(`api_credit_usage`、6.4.1)だけを DB に書く(Supabase の接続先が要る。予約できなければ Twelve Data を呼ばない)。キーが1つも無いときはメッセージを出して正常終了する。

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
| `npm run ingest:fx-prices` | Twelve Data の1分足(+ POLYGON_API_KEY があれば照合)→ `fx_prices`、5分〜60分足も組み立てる。毎回、直近120分に加えて直近7日の欠けを取り直す(6.4.1)。対応する全ペア(`--pairs` で変更)。`--manual` は手動実行(1日800まで)、`--minutes` は手動で最新の範囲を延ばす(4800分まで) | Supabase(クレジット台帳を含む)、TWELVE_DATA_API_KEY(無ければ何もしない)、POLYGON_API_KEY(任意) | 20分ごと(変更なし)。回数は通常1回9(1日最大648)、取り直しがあっても1回最大27、定期実行の合計は1日700まで(台帳で止める) |
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

---

## 11. 利用条件の再確認(2026-10-16、HQ判断を受けて)

HQ指示(2026-10-16)「契約・本番利用の前に、取得元ごとの利用条件を確認し直す」による再確認。2026-10-16 に各サイトの利用条件・料金のページをプロキシ経由で読んだ(curl。BLS は curl が 403 のため WebFetch で読んだ)。引用は英語の原文のまま。**ページに書かれていないことは「要確認」**とし、推測で埋めていない。料金は税抜・米ドル、公開ページの表示どおり(見積・契約条件ではない)。

表の記号: ◯=ページに許可の記載あり、△=条件付き、×=ページに禁止の記載あり、要確認=ページに記載なし・読めなかった。各セルの [番号] は表の下の根拠(URL と原文)。

### 11.1 公式統計(②)

| 取得元 | 商用アプリでの利用 | DBへの保存 | 内部照合 | 利用者への表示/再配布 | 派生値 | 出典表示 | 料金(公開価格) | 未解決(機関に確認すること) |
|---|---|---|---|---|---|---|---|---|
| FRED API | △ 商用は銀行の書面の同意が原則 [F3]。ただし「Public Domain: Citation requested」の系列は社内の商用利用・顧客向けレポートでの表示は可 [F4]。有料アプリでの表示はこの例に**書かれておらず要確認** | **× API の追加規約で保存・キャッシュ・DB への組み込みを禁止** [F5]。終了時は全コピーの破棄 [F6] | △ 社内の商用利用は上記の系列なら可 [F4]。**ただし保存せずに照合する場合に限る**(保存は [F5] で禁止) | 要確認(有料アプリでの表示は [F4] の例に無い)。第三者の系列の商用再配布は持ち主の書面の許可が必要 [F7] | 要確認(派生値の規定なし) | **必須** "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." [F8]。アプリ利用者に FRED API 利用規約へのリンクを示し、アプリの規約で利用者もそれに従うと明記 [F8]。系列の出典(例 "Source: BLS via FRED")[F4] | 無料。**120回/分**まで(超えると 429・一時遮断)[F9] | 有料アプリでの表示と、照合用の値の DB 保存(期間)を書面で認めてもらえるか(stlsFRED@stls.frb.org [F10]) |
| BLS Public Data API | ◯ 規約に商用の禁止なし。"Data accessed through BLS.gov do not, and should not, include controls over its end use." [B1]。BLS の公表物は原則パブリックドメイン [B3] | ◯ 規約に保存の制限の記載なし [B1](期間の定めもなし) | ◯(同上) | ◯ パブリックドメイン [B3]。ただし内容を改変・偽って示したまま BLS を出典にしない [B2] | △ 可。ただし派生値については下の免責文を示す [B2] | **必須** 取得日の記載と "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov." [B2]。出典として BLS を示す(依頼)[B3]。BLS のロゴは使えない [B2] | 無料。v2(登録)500回/日・1回50系列・20年、v1 25回/日・25系列・10年、どちらも 50回/10秒 [B4] | なし(念のため、規約ページを社外の回線のブラウザで原文確認。プロキシからは 403) |
| e-Stat API(日本) | ◯「商用利用も可能です。」[E2] | ◯ 複製・公衆送信・翻案を自由に利用できる [E2](期間の定めなし) | ◯ [E2] | ◯ [E2]。第三者が権利を持つ部分は利用者が確認 [E2] | △ 可。加工したことを出典とは別に書く(例「○○調査結果(A省)を加工して作成」)。国が作ったように見せない [E2] | **必須** API のクレジット「このサービスは、政府統計総合窓口(e-Stat)のAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません。」[E3] + 出典「出典:政府統計の総合窓口(e-Stat)(https://www.e-stat.go.jp/)」等 [E2] | 無料(アプリケーションID 要)。回数の上限の数値は記載なし。「短時間における大量のアクセス」は禁止、負荷に応じて制限あり [E1] | 回数の目安(数値) |

根拠(2026-10-16 確認):

- [F1] https://fred.stlouisfed.org/docs/api/terms_of_use.html — FRED API 利用規約(下の [F5]〜[F8] と同じ内容は https://fred.stlouisfed.org/legal/ の "Additional Terms of Use for the FRED® API" にもある)
- [F2] https://fred.stlouisfed.org/legal/ "FRED provides data and data services to the public for non-commercial, educational, and personal uses subject to a few prohibitions. Furthermore, other uses (e.g., commercial) are subject to additional restrictions."
- [F3] 同 FRED® Services Terms of Use: "(j) Except as expressly authorized in the FRED® Terms of Service, use the FRED® Services for any commercial use without the prior written consent of the Bank."
- [F4] 同 "IV. Commercial Use: Series with the following copyright labels—Public Domain: Citation requested and Copyrighted: Citation required—may be used for internal commercial uses and may be displayed in textbooks, newsletters, or reports to clients provided that appropriate attribution is given to FRED as well as the original source of the data." / "Public Domain: Citation requested … When using, please cite the data source and acknowledge that you obtained the data from FRED (example, "Source: BLS via FRED") when displaying or publishing it."
- [F5] 同 "Prohibitions for FRED® API … (l) Use the FRED® API in connection with storing, caching, or archiving any portion of the FRED® Services or FRED® Content; providing any stored, cached, or archived portion of the FRED® Services or FRED® Content to any third party; or incorporating any FRED® Content in any database, compilation, archive, cache, or other medium."
- [F6] 同 "Upon termination of the licenses, you shall cease all use of the FRED® Services, and destroy all copies, full or partial, of the FRED® Content."
- [F7] 同 "Redistribute any third party's proprietary content, including any graphs, maps, images, logos, data, or datasets, for commercial use without first obtaining express written permission from the data provider."
- [F8] [F1] "Requirements … Place the following notice prominently on your application: …" / "If you develop a FRED® API application for use by other users, display to the users of your application the link to these Terms of Use, and explicitly state in your application's terms of use that, by using your application, your users are agreeing to be bound by the FRED® API Terms of Use"
- [F9] https://fred.stlouisfed.org/docs/api/fred/errors.html "429 Too Many Requests (Up to 120 requests per minute are allowed before being served a 429 error code. Not complying with the throttling can result in a temporary block.)"
- [F10] https://fred.stlouisfed.org/legal/ "For comments or questions about the data in the FRED® database, we prefer you send an email to stlsFRED@stls.frb.org." / "If you are unsure if a data series is under copyright, please contact us."
- [F11] 系列の著作権の表示(各系列のページのタグ): https://fred.stlouisfed.org/series/CPIAUCNS ・ /CPILFENS ・ /PAYEMS ・ /UNRATE はいずれも出典 "U.S. Bureau of Labor Statistics"、/RSAFS は出典 "U.S. Census Bureau"。**5系列とも "Public Domain: Citation Requested"**(第三者の著作権の系列 "Copyrighted: Pre-approval required" ではない)。ページ内の "Data in this graph are copyrighted." は非表示(`hide`)の定型文で、これらの系列には当たらない
- [B1] https://www.bls.gov/developers/termsOfService.htm(Last Modified: August 30, 2023。WebFetch で取得)"Data accessed through BLS.gov do not, and should not, include controls over its end use."
- [B2] 同 "cite the date that data were accessed or retrieved using the API" / "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov." / "may not modify or falsely represent content accessed through BLS.gov and still cite the source as BLS.gov" / "The BLS.gov logo may not be used by persons who are not BLS employees or on products (including web pages) that are not BLS-sponsored."
- [B3] https://www.bls.gov/opub/copyright-information.htm(WebFetch)"everything that we publish, both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs and illustrations." / "You are free to use our public domain material without specific permission, although we do ask that you cite the Bureau of Labor Statistics as the source."
- [B4] https://www.bls.gov/developers/api_faqs.htm(WebFetch)v2: Daily query limit 500、Series per query 50、Years per query 20、50 requests per 10 seconds / v1: 25・25・10・50 requests per 10 seconds。"Users must renew registration with the BLS Public Data API at least once a year."
- [E1] https://www.e-stat.go.jp/api/terms-of-use 第6条「コンテンツ…の利用条件等は、『政府統計の総合窓口(e-Stat)利用規約』に準じる」、第7条「本機能を利用したサービスを提供する場合には、別途定める方法により、本機能を利用している出所等を明示する」、第8条「短時間における大量のアクセスその他本機能の運用に支障を与える行為」の禁止、第5条3「負荷状況に応じてアクセス制限をかけることがあります」
- [E2] https://www.e-stat.go.jp/terms-of-use「どなたでも以下の1)〜6)に従って、複製、公衆送信、翻訳・変形等の翻案等、自由に利用できます。商用利用も可能です。」「コンテンツを編集・加工等して利用する場合は、上記出典とは別に、編集・加工等を行ったことを記載してください。」「政府標準利用規約(第2.0版)に準拠」「CC BY と互換性」
- [E3] https://www.e-stat.go.jp/api/api-info/credit(上記の文言)「利用される方が参照できる場所であれば、表示場所の指定はございません。」

**FRED についての結論**: いまの実装(`ingest:official` が FRED の観測値を `official_observations` に保存し、照合した公式値を `event_snapshots` に記録。4章・8章)は、FRED API の追加規約 [F5] の「保存・キャッシュ・DB への組み込み」の禁止に当たる。2章の「確認済み」はこの条項を見落としていた。照合に使う5系列はどれも元は BLS・Census(米政府)の数値で、FRED 上もパブリックドメイン扱い [F11]・[B3]。**保存・表示する公式値は BLS(と Census)から直接取り、FRED は「保存しない一時的な照合」だけに使うか、使わない**のが規約上安全。FRED の発表日時点の値(ALFRED)を使った照合(4章 2.)を続けるなら、セントルイス連銀の書面の許可が要る。米国の小売売上高(RSAFS、Census)を直接取る場合の Census API の利用条件は今回確認していない(**要確認**)。

### 11.2 要人発言(④)

| 取得元 | 商用アプリでの利用 | DBへの保存 | 内部照合 | 利用者への表示/再配布 | 派生値 | 出典表示 | 料金(公開価格) | 未解決(機関に確認すること) |
|---|---|---|---|---|---|---|---|---|
| FRB(federalreserve.gov、`/json/calendar.json`) | ◯ 特に断りがなければパブリックドメイン [R1] | ◯(パブリックドメイン。制限の記載なし)[R1] | ◯ [R1] | ◯ 許可なく複製・配布できる [R1]。フレーム内表示は不可 [R2] | 要確認(規定なし。パブリックドメインのため制限は書かれていない) | 出典として FRB(the Board)を示す [R1]。FRB の印章・ロゴは使えない [R3] | 無料 | **calendar.json の `time` に時刻帯が無い**(例 `"time": "11:30 p.m."`。ほかの項目は `month`・`days`・`title`・`type`・`location`・`description`・`link`・`live` だけ)。カレンダーのページにも時刻帯・「開始時刻か」の説明は無い [R4]。米東部時間であること・開始予定時刻であることを FRB に確認(5章では速報RSSとの照合で東部時間と判断している) |
| ECB(サイト・RSS・週間予定・Data Portal) | △ 自由に使える。ただし**有料の商品に組み込む場合は、購入前と利用のたびに「ECB のサイトで無料で入手できる」と知らせる** [C1] | 要確認(保存の規定なし) | ◯ 自由に使える [C1] | △ 正確に再現し ECB を出典とする [C1]。著者名のある文書(Working Paper 等)の再掲は事前の書面許可が必要 [C1] | △ 加工した場合(季節調整・伸び率の計算等)はその旨を明記 [C1] | 出典「ECB」+ 有料プランで見せる場合は上記の無料入手の案内 [C1] | 無料 | 週間予定の時刻帯(下記)。Data Portal 独自の利用条件のページ(https://data.ecb.europa.eu/help/terms-use)は 404。Data Portal のページの法的情報は同じ ECB の disclaimer にリンク [C3] |
| 日本銀行 | **要相談**。商用目的の転載・複製は予め情報サービス局に相談 [J1] | 要確認(商用は相談が前提)[J1] | 要確認(同上) | 要相談 [J1]。無断改変は不可 [J1] | 要確認(無断改変の禁止 [J1] との関係) | 出所を明記 [J1] | 無料(相談) | **窓口**: 著作権・商用利用は 情報サービス局 post.prd8@boj.or.jp。サイトの利用に関するその他の相談は prd.hp-mds@boj.or.jp(メール)[J1] |
| イングランド銀行(BOE) | × サイトの内容は個人利用・組織内の**非商用**利用のみ [K1]。それ以外は許可が必要。許可は通常、非商用(学術・教育)に出すと書かれている [K1] | 要確認(許可次第) | △ 組織内の非商用利用は可 [K1]。商用の社内照合は要確認 | × 許可が必要 [K1] | 要確認 | 要確認(許可の条件次第) | 無料(許可制) | **窓口**: enquiries@bankofengland.co.uk、電話 +44 (0)20 3461 4878 [K1]。統計 Database は UK Open Government Licence(ただし一部の為替レートの系列は対象外)[K2] |

ECB の週間予定の時刻帯(https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html、2026-10-16 時点で 10月9日〜18日分): 時刻は「Time: 10:00 CET」のように **10月(夏時間の期間)でも "CET"** と書かれ、ページに時刻帯の説明は無い。現地時刻が併記された予定では "Time: 20:30 CET / 19:30 local time"(ダブリン、10月13日)、"Time: 04:10 CET / 09:10 local time"(バンコク、10月14日)、"Time: 10:15 CET / 15:15 local time"(バンコク)とあり、いずれも **"CET" が UTC+2(=フランクフルトの夏時間 CEST)** のとき計算が合う。つまり "CET" は「フランクフルトの現地時刻」の意味で使われていると読める(**推測。ECB への確認が必要**)。統計の公表など一部は "Time: 10:00" と時刻帯が無い。「Last modified: 14 October 2026, 15:30 CET」も同じ書き方。

根拠(2026-10-16 確認):

- [R1] https://www.federalreserve.gov/disclaimer.htm "Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information."
- [R2] 同 "This permission extends only to a hyperlink, however, and does not include authority to engage in any other activities such as the "framing" of the Board's website on another website"
- [R3] 同 "The use of the Board seals, logos and other official insignia is protected by federal law and may not be used or reproduced without the Board's written permission."
- [R4] https://www.federalreserve.gov/json/calendar.json(2,602件。最新の例 `{"title": "Discussion - Chairman Kevin Warsh", "time": "11:30 p.m.", "month": "2026-10", "days": "15", "type": "Speeches", "location": "… Bangkok, Thailand"}`)、https://www.federalreserve.gov/newsevents/calendar.htm(時刻帯の記載なし)
- [C1] https://www.ecb.europa.eu/services/disclaimer/html/index.en.html "users of this website may make free use of the information obtained directly from it subject to the following conditions: When such information is distributed or reproduced, it must appear accurately and the ECB must be cited as the source. Where the information is incorporated in documents that are sold (regardless of the medium), the natural or legal person publishing the information must inform buyers, both before they pay any subscription or fee and each time they access the information taken from this website, that the information may be obtained free of charge through this website. If the information is modified by the user (e.g. by seasonal adjustment of statistical data or calculation of growth rates) this must be stated explicitly." / 著者名のある文書は "permitted only with the explicit prior written authorisation of the ECB or the authors."
- [C3] https://data.ecb.europa.eu/help/terms-use は 404。Data Portal のページの法的情報のリンク先は [C1]
- [J1] https://www.boj.or.jp/about/copyright.htm「当サイトの内容については、以下の場合を除き、転載・複製を行うことが出来ます。転載・複製を行う場合は、出所を明記してください。 i.商用目的で転載・複製を行う場合 …上記i.〜iii.の場合には、予め情報サービス局(post.prd8@boj.or.jp)までご相談ください」「当サイトの内容については、日本銀行に無断で改変を行うことはできません。」「当サイトの利用に関するその他のご相談は、情報サービス局(prd.hp-mds@boj.or.jp)までメールにてお願いします。」
- [K1] https://www.bankofengland.co.uk/legal "You may … download, display or print the Resources for personal use or internal use within an individual organisation for non-commercial purposes." / "You can email enquiries@bankofengland.co.uk and can also phone on +44 (0)20 3461 4878." / "The Bank typically grants permission for non-commercial re-use of the Resources, particularly in an academic or education context."
- [K2] 同 "Reproduction of data in the Database is subject to the terms of the UK Open Government Licence" / "selected exchange rate data and series are excluded from this licence as they are reproduced by the Bank under licence from third parties."

### 11.3 経済カレンダー候補(①)

| 取得元 | 商用アプリでの利用 | DBへの保存 | 内部照合 | 利用者への表示/再配布 | 派生値 | 出典表示 | 料金(公開価格) | 未解決(業者に確認すること) |
|---|---|---|---|---|---|---|---|---|
| Trading Economics | △ **経済カレンダーの API は Enterprise プランだけ**(Standard・Professional は "Economic Calendar" が含まれない)[T1] | 要確認(利用規約のページが見つからない)[T2] | 要確認 [T2] | △ Enterprise に "White Label"・"Data Distribution … Redistribute data to your clients and partners under enterprise licensing." [T1]。条件は要確認 | 要確認 [T2] | 要確認 [T2] | Basic $29.99/月(API なし)、Standard $199/月(API 500回/月、カレンダーなし)、Professional $399/月(5,000回/月、カレンダーなし)、**Enterprise は非公開("Customized and priced to your needs. Billed quarterly or yearly"、最大 100万回/月)**。四半期15%・年25%引き。試用は1週間(Standard $49・Professional $99、返金なし)、試用は 100,000 データ点・100 リクエストまで [T1]。→ **10か国のカレンダーは Enterprise の見積が必要(公開価格なし)** | Enterprise の見積(10か国・カレンダー+Live Streaming)、アプリでの表示・DB 保存・保存期間・派生値・出典表示・解約後の扱い、利用規約の原文。Enterprise に試用があるか |
| Finnhub | × 公開プランはすべて個人用。"All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise. Personal plan can't be used by any business even internally without a written approval." [N1] | △ 購読が終わったら全データを削除 [N1]。購読中の保存期間は要確認 | × 個人プランは企業の内部利用も書面の承認なしでは不可 [N1] | × 書面の承認なしにデータ・派生結果の再配布・共有は不可 [N1]。Enterprise は "Commercial use. Redistribution right." [N2] | × 派生結果も再配布不可 [N1](Enterprise は要確認) | 要確認 | Economic-1 **$50/月(四半期ごと $150 の請求)**、"License: Personal Use"、150回/分、経済カレンダー10年分 [N2]。全プランに上乗せで 30回/秒 [N1]。**商用(Enterprise)は "Flexible"・要問合せ(support@finnhub.io)**[N2] | Enterprise の見積(カレンダーのみ・10か国)、表示・保存・派生値の範囲、出典表示 |
| Financial Modeling Prep | × 個人プランは個人の非商用のみ。会社のための利用・第三者が使うアプリへの組み込みは不可 [M2] | △ 保存場所のセキュリティ管理と、保存場所の IP・ドメインの FMP への通知が必要 [M3]。終了時はキャッシュを含め全削除・削除の合意書に署名 [M4] | △ 商用プランの "Grow" は "for internal usage"・"Internal Commercial Use" [M1]。個人プランは不可 [M2] | × **"Displaying or redistributing data sourced from FMP requires a specific Data Display and Licensing Agreement with FMP."** [M1]。表示・再配布は Enterprise ("Perfect if you're looking for data display and redistribution")[M1] | × 書面の承認なしに派生物の作成不可 [M2] | 要確認 | 個人: Basic $0(250回/日)、Starter $29/月(年払い $19/月)、Premium $69/月($49)、Ultimate $139/月($99)[M1]。**商用(Build・Grow・Enterprise)の価格は公開ページから読めず要確認**。どのプランで経済指標カレンダー("Economic Data Releases Calendar")が使えるかも表から読み取れず要確認 [M1] | Enterprise(表示・再配布)の見積、Data Display and Licensing Agreement の内容、カレンダーの国の範囲、対象期間(reference period)を返すか |

根拠(2026-10-16 確認):

- [T1] https://tradingeconomics.com/api/pricing.aspx(価格表はページが読み込むデータ https://d3e5kp2e91w0k0.cloudfront.net/pricing/pricing-data.js?v=20260316 にある): Standard・Professional とも "Economic Calendar … included: false"、Enterprise "Economic Calendar … included: true"・"Live Streaming … included: true"、"White Label: Display real-time and historical market or economic data directly on your website, fully branded to match your branding."、"Data Distribution: Power your own applications using your branding but with our data and API. Redistribute data to your clients and partners under enterprise licensing." / ページ本文 "The trial fee is not refundable …" "To prevent abuse, trial users are limited to 100000 data points and 100 requests for data."
- [T2] https://tradingeconomics.com/terms-of-use.aspx ・ /terms-of-service.aspx ・ /terms は 404(見つからない)。サイトのフッターにも利用規約のリンクが無い(privacy-policy のみ)
- [N1] https://finnhub.io/terms-of-service "All data must be deleted should your subscription to that data ends." / "You hereby agree to not redistribute or share access to data or derived results from the data obtained from Finnhub with anyone or any 3rd party without written approval from Finnhub. All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise. Personal plan can't be used by any business even internally without a written approval." / "There is a 30 API calls/second limit on top of all plan's limit"
- [N2] https://finnhub.io/pricing(価格はページのデータ `"economic-1":50` とページのスクリプトの表): "Economic-1 … $50/month … Billing Frequency: Quarterly … License: Personal Use. Terms apply … Limit: 150 API calls/minute … Global Economic Calendar: 10 years of data" / Enterprise "Pricing: Flexible … Contact Sales (support@finnhub.io) … License: Commercial use. Redistribution right. … Limit: Unlimited API calls"
- [M1] https://site.financialmodelingprep.com/developer/docs/pricing 上記の価格と "Displaying or redistributing data sourced from FMP requires a specific Data Display and Licensing Agreement with FMP." / 商用プランの説明 "Build: Begin building with instant access to financial market data that powers startups and enterprises." "Grow: A full set of financial data to cover all cases for internal usage" "Enterprise: Perfect if you're looking for data display and redistribution, unlimited volume, and priority support"
- [M2] https://site.financialmodelingprep.com/terms-of-service(Last updated: August 1, 2023)"2.2.1 Personal Use: This license may only be used by a Customer who is an individual, and strictly for their own personal, non-business and non-commercial purposes. … integrate the Data or Services into any tools or applications accessible by any third parties …" / "without the prior written approval of FMP, the Customer may not distribute, publicly perform or display, … create derivative works from …" / "2.2.2 Data Display: Without a specific agreement with FMP, customers are prohibited from showcasing FMP Services or Data on platforms including … software products, or applications designed for utilization by multiple individuals, irrespective of whether such usage is complimentary or paid"
- [M3] 同 "2.8 Customer Security. … Customer will notify FMP of the IP and domain aliases of any location where data is stored or processed."
- [M4] 同 "6.3 Data Deletion. Upon termination of this Agreement, Customer must delete all Data it has received from FMP …, including data cached, and sign the Data Deletion Agreement in Exhibit A."

### 11.4 為替候補(③・⑤)

| 取得元 | 商用アプリでの利用 | DBへの保存 | 内部照合 | 利用者への表示/再配布 | 派生値 | 出典表示 | 料金(公開価格) | 未解決(業者に確認すること) |
|---|---|---|---|---|---|---|---|---|
| Twelve Data | △ **Business プランが必須**(会社の利用は表示しなくても Business)[W1]。個人プランは個人・非商用のみ [W1] | △ 内部利用のための保存は可 [W2]。ただし「ドキュメントの定める期間を超えて保存・キャッシュしない」[W2](期間の数値は要確認)。終了後30日以内に全削除 [W3] | ◯ Business の内部利用 [W2] | △ 外部表示は Business の **Venture 以上("External display data access")**、外部配布は **Enterprise("External distribution market data")**[W1]。規約では外部表示・再配布は「Redistribution Rights Add-On または別の書面契約で明示的に認められた場合のみ」[W2] | ◯ 元データを復元できない派生データは可・権利は顧客 [W2]。再配布目的の派生物は不可 [W3] | 要確認(外部表示の帰属表示の要件は「追加の条件」による [W2]) | Business: Venture **$149/月**(610クレジット/分)・$299(1,597)・$499(2,584。年払い $414/月相当・$4,990/年)、Enterprise **$1,099/月**(10,946。年払い $916/月相当)、Enterprise+ 要見積。年払い17%引き [W1]。→ **9ペアの1分足(1回1クレジット×9)は Venture $149/月の枠で足りる**。外部「配布」扱いなら Enterprise $1,099/月。リアルタイムの為替は Basic から含まれ、Venture は "Everything from Basic" [W1]。遅延表示の別料金の記載なし | iOS アプリでの1分足・値動き(pips)の表示は Venture の "external display" で足りるか、Redistribution Rights Add-On が要るか。保存期間の上限。帰属表示の文言。**価格の定義(bid・ask・mid のどれか)は記載なし**("Currency data is sourced from well established commercial providers and large banks" [W4]) |
| Massive(旧 Polygon.io) | △ 個人プランは個人・非商用のみ [P2]。商用は "Currencies Business"(license_type: commercial)[P1] | ◯ 購入した範囲で保存可 "access, receive, process, transmit, store, and use" [P3]。終了時は全削除(自社で作った派生物は保持可)[P4] | ◯ 社内の業務目的 [P3] | △ 自社のアプリ内で利用者(Edge Users)に**表示**は可 [P3]。データフィード・ファイル等の機械可読な形での提供、表示に必要な範囲を超えて端末に送ることは不可 [P5]。第三者提供元が求める帰属表示・遅延表示が必要 [P5] | ◯ 派生物(計算・分析等)は、元データを含まなければ自由に利用・表示・配布可 [P3](元データを復元できるものは元データ扱い [P6]) | 要確認(第三者提供元が求める場合に表示 [P5]) | 個人: Currencies Basic $0(5回/分・日足)、Currencies Starter **$49/月**(リアルタイム・分足・無制限。個人のみ)[P1]。**Business: Currencies Business $999/月(年払い $9,588/年 = $799/月相当)、リアルタイム・無制限・分足・商用**[P1]。遅延の安いプランの記載なし | 9ペアの1分足を iOS で表示する用途が Currencies Business の範囲か。チャート用に1分足の配列を端末に送ることが「表示に必要な範囲」に入るか [P5]。帰属表示の要否。スタートアップ割引(初年度25%以上、sales@massive.com)の対象か |

価格の定義: Massive の為替の足は "these aggregates are generated from quoted bid/ask prices rather than executed trades."、足の時刻は "The Unix millisecond timestamp for the start of the aggregate window."、気配の更新が無い分は足が作られない(https://massive.com/docs/rest/forex/aggregates/custom-bars、WebFetch)。bid・ask のどちらか・仲値かは書かれておらず**要確認**。取得元は "Forex quotes come from institutional bank feeds"(https://massive.com/currencies)。Twelve Data は [W4] のみで価格の定義の記載なし(**要確認**)。

根拠(2026-10-16 確認):

- [W1] https://twelvedata.com/pricing.md(と https://twelvedata.com/pricing ・ https://twelvedata.com/pricing-business)"Business plans are required for any company, team, fund, or organization using Twelve Data — even if the data is only used internally and never displayed externally. Business plans also unlock external display rights and, on Enterprise tiers, external distribution." / Individual: "For individuals only — personal, internal, and non-commercial use." / Venture "ideal for companies showcasing data on client-facing apps or websites"、"External display data access" / Enterprise "External distribution market data"
- [W2] https://twelvedata.com/terms(Last updated: January 1, 2026)"(a) Access, receive, process, and store Data solely for Internal Use (or as otherwise permitted by your Subscription Tier or add-ons)" / "(c) Create Derived Data that cannot be reverse-engineered to recreate the original Data" / "(e) Redistribute or provide external display of Data only if and as expressly authorized by a Redistribution Rights Add-On or separate written agreement with Twelve Data (including compliance with attribution requirements)" / 禁止事項 "(g) Store or cache Data beyond permitted timeframes specified in the Documentation" / "2.4 Redistribution and External Display: Certain Subscription Tiers or Data Add-ons may permit limited redistribution or external display of Data, subject to additional terms, attribution requirements, exchange rules, and separate agreements. Contact sales@twelvedata.com" / "Customer retains rights to Derived Data created in compliance with this Agreement."
- [W3] 同 "16.2 Data Deletion: Upon termination or expiration: (a) All Data must be deleted within 30 days" / "17.1 … (g) Create derivative works for redistribution"
- [W4] https://twelvedata.com/forex "Currency data is sourced from well established commercial providers and large banks, that correspond to the institutional grade performance standards." "Prices get updated at least once per minute depending on the currency pair."
- [P1] https://massive.com/pricing?product=currencies ・ https://massive.com/business(価格はページのデータ): Currencies Starter `monthly_price 4900`(個人)、Currencies Business `monthly_price 99900`・`annual_price 958800`・`"license_type":"commercial"`・"Real-time Data"・"Unlimited API Calls"・"10+ Years Historical Data"・"Minute Aggregates" / "Qualifying startups can get 25% or more off their first year … Email sales@massive.com"
- [P2] https://massive.com/legal/individuals-terms-of-service "solely for your own personal, non-commercial, and non-business purposes."
- [P3] https://massive.com/legal/businesses-terms-of-service(Last Updated: October 6, 2026)"to access, receive, process, transmit, store, and use the Information available via the Services solely (a) for Customer's internal business purposes; (b) to display it to Authorized Users or Edge Users within products, services, applications, and websites owned or licensed by Customer; and (c) to create derivative works, analyses, calculations, models, and other data or works from the Information, and to use, display, and distribute those outputs for any lawful business purpose, provided that they do not contain Information." / "Edge Users" means natural persons who use Customer's products or services.
- [P4] 同 "11.3 … Customer must delete all related Information in its possession or control, including downloaded files, and certify the deletion on request … Customer may retain the data and works it created under Section 2.2(c)"
- [P5] 同 "(d) … make it available to Edge Users other than by display under Section 2.2(b), transmit it to an Edge User's device beyond what that display requires, or provide any display that gives anyone access to the Information as a data feed, file, or other systematic or machine-readable delivery …" / "(g) … fail to display with any Information the attribution, delay label, or other notice that the applicable Third-Party Provider requires"
- [P6] 同 ""Information" means Third-Party Data, Massive Data, and any data derived from either, in whole or in part, that can be used to identify, recalculate, reverse engineer, or decompile either, or that is or can be used to create a substitute for either"

### 11.5 本番利用の可否(現時点)

- **FRED**: **条件付き(いまの使い方は不可)** — DB への保存は API 規約で禁止 [F5]。保存しない一時的な照合なら社内の商用利用として可 [F4]。保存・有料アプリでの表示には書面の許可が要る
- **BLS**: **可** — 取得日と免責文の表示 [B2] が条件
- **e-Stat**: **可** — API のクレジット表示 [E3] と出典・加工の記載 [E2] が条件
- **FRB**: **可**(出典表示)。ただし calendar.json の時刻の定義は**要確認**
- **ECB**: **条件付き** — 出典表示、有料プランで見せるなら「ECB のサイトで無料で入手できる」の案内(購入前と利用のたび)、加工したらその旨。週間予定の時刻帯は**要確認**
- **日本銀行**: **要確認**(商用は事前相談。相談が済むまで使わない)
- **BOE**: **不可**(許可が出るまで)
- **Trading Economics**: **要確認** — カレンダーは Enterprise のみで、価格・規約が非公開
- **Finnhub**: **不可**(公開プラン)/ Enterprise は**要確認**
- **Financial Modeling Prep**: **不可**(個人プラン)/ Enterprise・Data Display and Licensing Agreement は**要確認**
- **Twelve Data**: **条件付き** — Business の Venture 以上が必須。iOS での表示に Redistribution Rights Add-On が要るかは**要確認**。いまの個人・無料キーは社内の開発確認だけ(8章)
- **Massive**: **条件付き** — Currencies Business($999/月)なら利用者への表示は規約上可 [P3]。端末に送る1分足の範囲 [P5] は**要確認**

### 11.6 送る質問(業者・機関ごと)

- **セントルイス連銀(FRED、stlsFRED@stls.frb.org)**: ① 有料 iOS アプリで、FRED API から取った公共の系列(CPIAUCNS・CPILFENS・PAYEMS・UNRATE・RSAFS)を発表値の照合に使い、照合結果と公式値を自社 DB(Supabase)に保存してよいか。保存期間の上限は。② 利用者に「公式値(出典: BLS via FRED)」として表示してよいか。③ ALFRED の時点指定の値も同じ扱いか
- **BLS**: (原則不要)規約ページの原文を社外回線で確認するのみ
- **FRB(Board)**: calendar.json の `time` は米東部時間か、発言の開始予定時刻か。calendar.json をアプリのデータ源として定期取得してよいか(頻度の目安)
- **ECB**: ① 週間予定の "CET" は、夏時間の期間も中央ヨーロッパ夏時間(UTC+2)の現地時刻の意味か。② "Time: 10:00" のように時刻帯が無いものの扱い。③ 有料アプリで「無料で入手できる」案内をアプリ内のどこに・どの頻度で出せば条件を満たすか
- **日本銀行(post.prd8@boj.or.jp)**: 有料アプリで講演・挨拶の予定(日時・題・登壇者)を掲載し、リンクを張る使い方の可否と条件(出所の書き方、題の翻訳は改変に当たるか)
- **BOE(enquiries@bankofengland.co.uk)**: 有料アプリでスピーチの予定(日時・題・登壇者)を掲載する商用利用の許可の可否・条件・費用
- **Trading Economics**: Enterprise の見積(経済カレンダー約10か国、予想・結果・改定、Live Streaming の要否)。アプリでの表示・DB 保存と期間・派生値(前年比など)・出典表示・解約後の扱い。利用規約の原文。試用の可否
- **Finnhub(support@finnhub.io)**: 経済カレンダーだけの Enterprise(商用・表示)の見積。保存と派生値の範囲、出典表示。対象期間(reference period)を返すか
- **Financial Modeling Prep**: Build・Grow・Enterprise の価格、経済カレンダーが含まれるプラン、Data Display and Licensing Agreement の内容と費用、保存場所の通知の手続き
- **Twelve Data(sales@twelvedata.com)**: iOS アプリで9ペアの1分足チャート・値動き(pips)を見せるのに Venture で足りるか、Redistribution Rights Add-On が要るか(費用)。保存・キャッシュの許容期間。帰属表示の文言。為替の価格の定義(bid・ask・mid)と取得元
- **Massive(sales@massive.com)**: Currencies Business で9ペアの1分足を iOS アプリに表示する用途が §2.2(b) の範囲か(端末に送る足の本数の上限)。帰属表示の要否。価格の定義(bid か mid か)。スタートアップ割引の対象か

---

## 12. 品質の測り方(2026-10-16、HQ判断を受けて)

HQ判断: 取得率・欠損率・照合一致率・時刻ずれを**実データで**測る。数日〜数週間の連続稼働で確認し、経済指標の発表前後は重点的に見る。そのためのレポートを `npm run report:data-quality` として用意した(READ-ONLY。DB には何も書かない)。

### 12.1 実行方法

```
cd fx-event-analyzer-backend
npm run report:data-quality -- --days 7                    # 直近7日(既定)、有効な全通貨ペア
npm run report:data-quality -- --days 14 --pairs USDJPY,EURUSD
```

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` が必要(他のジョブと同じ)。`--days` は 1〜31
- Markdown を標準出力に出す。環境変数 `GITHUB_STEP_SUMMARY` があれば同じ内容をそのファイルにも追記する(GitHub Actions の実行画面の Summary に出る)
- 品質が悪くても exit 0(レポートなので)。exit 1 は処理が落ちたときだけ。キーや URL は出さない
- GitHub Actions では **1日1回** の実行を想定。ただし main のスケジュール済みワークフローへの追加は別の手順で、HQ・大野さんの承認後に行う(このブランチでは追加していない)
- 期間の終端は「いま − 30分」。`ingest:fx-prices` は20分ごとなので、直近の分はまだ取得されていないだけの可能性があるため判定しない
- コード: 計算は `src/ingestion/quality/metrics.ts`(I/O なしの関数、`tests/ingestion/dataQuality.test.ts`)、表示は `quality/report.ts`、読み取りは `quality/reader.ts`(PostgREST は1回1000行までなので `.range()` で全件読む)
- 読むもの: `fx_pairs`・`fx_prices`(通貨ペアごとの一番古い1分足も)・`economic_events`(件数)・`speech_events`・`ingestion_logs`・`event_snapshots`・`ingestion_staged_values`・`api_credit_usage`。select だけで、insert/update/upsert/delete/rpc は使わない。外部 API は呼ばない

### 12.2 指標と計算式

市場時間は `src/ingestion/marketHours.ts` の1つの定義を、欠損の補完(`ingest:fx-prices`)とこのレポートで共通に使う: **ニューヨーク時間の日曜 17:00 〜 金曜 17:00**(タイムゾーン America/New_York で判定するので米国の夏時間に自動で連動する。UTC では夏 21:00、冬 22:00)。**12/25・1/1(ニューヨークの日付)は終日休場**として想定に含めない。

**取り込み開始**: 通貨ペアごとに、保存されている一番古い1分足の時刻(`fx_prices` を時刻の昇順で1件だけ読む)。それより前の市場時間は「取り込み開始前(対象外)」として別に数え、欠損には入れない。1分足が1本も無い通貨ペアは「データなし(取り込み未開始)」と表示し、欠損率 100% にはしない。

分母が0の指標は 0% や「0件」にせず、**「—(理由)」**と出す。「データが存在しない」と「検証処理を実行していない」は分けて表示する。

| 指標 | 計算式 | 見るもの |
|---|---|---|
| 取り込み開始前(対象外) | 期間の始め 〜 取り込み開始 の市場時間の分数 | 欠損ではない。取り込みを始める前の分 |
| 想定分数 | max(期間の始め, 取り込み開始) 〜 期間の終わり の市場時間の分数 | 通貨ペアごと |
| 取得率 / 欠損率 | 取得 = 想定の範囲にある `fx_prices` 1分足の数。欠損 = 想定 − 取得(実際の取りこぼし)。欠損率 = 欠損 ÷ 想定(取得率 = 取得 ÷ 想定) | UNVERIFIED の足も「取得」に数える。反応計算に使える分(UNVERIFIED を除く)は別の列。想定が0なら「—(理由)」 |
| 欠損の内訳 | 欠損の各分を `ingest:fx-prices` のログ(`ingestion_logs.details`)で分類: `no_data_unconfirmed` の時間帯 →「取得元にデータなしの可能性(未確認)」、最新の実行の `unrecovered` の時間帯 → 理由ごとに「未回収(回収期間外・7日超)」(BEYOND_HORIZON)/「未回収(クレジット上限)」(BUDGET)/「未回収(レート制限)」(RATE_LIMITED)/「未回収(タイムアウト)」(TIMEOUT)/「未回収(APIエラー)」(API_ERROR)、どちらにも無い分 →「未取得(原因未特定)」 | ログのキーはすべて任意(古い形式の行には無い)。古い形式のログしか無い期間の欠損はすべて「未取得(原因未特定)」になる |
| 長い欠損 | 想定の範囲で連続して足が無い分の並び。長い順に上位5件(開始時刻・長さ) | 市場が閉じる時間で区切る(週末・休場日をまたいで1つにしない) |
| 照合一致率(為替) | VERIFIED ÷ 照合した足(`cross_check_diff_pips` が入っている = VERIFIED + 照合して差が閾値を超えた UNVERIFIED) | 照合した足が0なら「—(照合未実行: 照合元未設定)」。最大差 = max \|cross_check_diff_pips\| |
| 集約足 (a) 作成可能区間での成功率 | 作成済み ÷ 作成可能な区間。作成可能な区間 = 1分足が全部あり UNVERIFIED を含まない 5/15/30/60分の区間(§6 の集約の条件と同じ) | 集約処理が正しく動いているか |
| 集約足 (b) 評価期間全体に対するカバレッジ | 作成済み ÷ 評価対象の区間。評価対象の区間 = 取り込み開始後 〜 期間の終わりに収まり、全体が市場時間の区間 | 実際に使える集約足の割合(1分足の欠損があると下がる) |
| 発表・発言前後の揃い具合 | 発表時刻 T(`economic_events` の RELEASED、`speech_events` の DELIVERED)× 通貨ペアごとに、開始時刻 T−5分〜T+59分(= T+60分の価格まで)の1分足が全部あるか(UNVERIFIED は欠損扱い)。完全率 = 完全 ÷ 通貨ペア別の判定件数 | **件数(発表・発言の数)と通貨ペア別の判定件数を分けて出す**(例: 発言 1件 × 9ペア = 9判定)。未判定は理由ごとに数える: 取り込み開始前(時間帯の始めが取り込み開始より前、またはデータなし)/ 市場時間外 / 期間の端 |
| ジョブの実行状況 | `ingestion_logs` のジョブごとの実行回数・SUCCESS/PARTIAL/FAILURE の数・所要時間(completed_at − started_at)の中央値・スキップ理由の合計 | |
| 実行間隔(`ingest:fx-prices`) | SUCCESS の実行どうしの started_at の間隔の最長値。間隔が120分(1回の取得範囲)を超えたものは一覧にし、「どの実行も取得しなかった市場時間」= 前回の実行 〜 次の実行 − 120分 のうち市場時間の分数 を出す | PARTIAL は成功に数えない(一部の通貨ペアが失敗しているため)。最後の成功からの経過分も出す |
| API リクエスト | `ingest:fx-prices` のログの `api_requests` の合計、UTC 日ごとの合計(プラン上限 800/日・予算 700/日 に対する割合)、1回の実行の最大。最新の `budget`(1日の予算・実行前の使用・実行後の残り)、最新の実行の `unrecovered`(理由ごとの分数)と `unrecovered_total` | 記録のある実行が無ければ「—(ログに API リクエスト数の記録なし)」 |
| API クレジット | `api_credit_usage`(READ のみ)を UTC 日 × 取得元ごとに、自動取り込み(`ingest:fx-prices`、上限 700)/ 手動(`ingest:fx-prices --manual` と他のジョブ、上限 800)/ `eval:providers` に分けて合計し、上限・契約プラン(800/日)を超えた日に印を付ける | 契約プランは未確認(Basic 前提)。失敗・再試行がクレジットを消費するかは未確認のため、試行ごとに予約して数えている。テーブルが無い・読めないときは「—(クレジット記録なし)」 |
| 取り込み件数の照合 | ログの `reconciliation` の合計: fetched / accepted / rejected(理由ごと)/ upserted_1m / upserted_aggregated / corrected / failed_requests | **不一致の印**: fetched ≠ accepted + Σrejected、または upserted_1m ≠ accepted(実行ごとと合計の両方で確認) |
| 時刻ずれ(為替) | レポート作成時点での最新1分足の経過時間(いま − 足の終了時刻) | 実行ごとの「足の時刻と取得時刻の差」は未集計 |
| 時刻ずれ(要人発言) | `ingest:speeches` のスキップ理由 TIME_NOT_EXACT の合計 | `ingest:speeches` の実行が無ければ「—(実行なし)」。発言時刻そのもののずれは自動では測れない(公式発表と手作業で照合) |
| 経済指標の値 | 状態を3つに分ける: (i) 期間内に `economic_events`・`event_snapshots` の行が無い →「未検証(経済指標データ未取得)」、(ii) データはあるが期間内に `ingest:official`(reverify を含む)の実行が無い →「未検証(照合処理未実行)」、(iii) それ以外 → 一致率 = `event_snapshots`(RELEASE)の VERIFIED ÷ (VERIFIED + `ingestion_staged_values` の PENDING_REVIEW のうち理由に OFFICIAL_MISMATCH を含むもの) | (i)(ii) では一致率を出さない。(iii) でも分母が0なら「—(公式値と照合できた値なし)」。公開済みの値・検証待ち・要確認の内訳も出す |

期間の絞り込み: 為替は足の時刻、発表は発表時刻、ログは started_at(レポート作成時点まで)、スナップショットは captured_at、`ingestion_staged_values` は fetched_at、`api_credit_usage` は usage_date(UTC 日)。

### 12.3 わかっている限界

- **休場は 12/25・1/1 のみを扱う**。その他の祝日・短縮取引(例: 12/24・12/31 の早い終了)は考慮していないため、その日の欠損は過大になる場合がある。取引の無い分に取得元が足を出さないこともある(ログに `no_data_unconfirmed` があれば内訳に出る)
- **Twelve Data の無料プラン**: 8リクエスト/分・800/日のため、9通貨ペアで20分ごと・1回120分の取得にしている(§8)。実行が遅れたり抜けたりすると取りこぼしが出る(GitHub Actions の schedule は混雑時に遅れ・抜けがある)。レポートの「取得範囲を超えた間隔」「欠損の内訳」で見る。また無料・個人プランのデータは内部確認用で、一般の利用者には見せられない(要件定義書 6.4)
- **照合元が無いとき**: Polygon のキーが無いと全部 SINGLE_SOURCE になり、照合一致率は「—(照合未実行: 照合元未設定)」
- **欠損の内訳は最新の実行のログに依存**: 「未回収(…)」は最新の `unrecovered` を記録した実行の内容だけを使う。それより前の実行の `unrecovered` は、その後に回収された可能性があるため使わない。ログの一覧は1件あたり最大50区間までなので、それを超えた分は「未取得(原因未特定)」に入る
- **手動・自動の区別**: `api_credit_usage` の job が `eval:providers` なら比較ツール。`ingest:fx-prices` は定期・手動とも同じ job 名なので、予約したときの上限(cap)が 700 を超えるもの(= `--manual` の 800)を手動、それ以外を自動とする。他のジョブは手動として数える
- 経済指標の一致率は、公式統計で照合できる指標(§4)だけが分母に入る

### 12.4 例: 2026-10-16 の最初のレポート

最初の実データのレポートは「取得率 15.11%・欠損率 84.89%・集約足 100%・要人発言 100%(9)・経済指標 0」だった。調べると(期間 2026-10-15 10:47Z 〜 10-16 10:17Z、1410分、どの分も市場時間):

- 977分は**取り込みを始める前**(最初の1分足が 10-16 03:04Z)だった。旧方式はこれを欠損に数えていた
- 本当の取りこぼしは 05:04 〜 08:44 の220分(この間に実行が無く、10:44:49 の実行は 08:44 以降しか取らない)。取得は213分(03:04〜05:03 の120分 + 08:44〜10:16 の93分)
- 集約足の 100% は「作成可能な区間」だけを分母にした値だった
- 要人発言の「9」は発言1件 × 9通貨ペア
- 経済指標の「0」は検証結果ではなく、経済指標データが1件も取り込まれていなかった

新しいレポートでは(`tests/ingestion/dataQuality.test.ts` の再現テスト、9通貨ペアとも同じ):

| 項目 | 値 |
|---|---|
| 取り込み開始前(対象外) | 977分 |
| 想定 | 433分(03:04 〜 10:17) |
| 取得 / 欠損 | 213分 / 220分(欠損率 50.81% = 220 ÷ 433) |
| 欠損の内訳 | 未取得(原因未特定) 220分(この時点のログは古い形式で、原因の記録が無い) |
| 集約足 5分 | (a) 成功率 41/41 = 100%、(b) カバレッジ 41/86 = 47.67% |
| 集約足 15分 / 30分 / 60分 | (a) 13/13・5/5・2/2(いずれも 100%)、(b) 13/28 = 46.43%・5/13 = 38.46%・2/6 = 33.33% |
| 要人発言 | 1件 × 9ペア = 9判定(完全 9) |
| 経済指標の値 | 未検証(経済指標データ未取得) |
| 実行間隔 | 05:04 → 10:44 の341分。どの実行も取得しなかった市場時間 220分(= 欠損と一致) |

---

## 13. BLS で照合できる指標と、代わりが必要な指標(2026-10-16、HQ判断「FRED を外す」を受けて)

FRED は公式統計の取り込みから外した(`ingest:official` は FRED を使わない。対応表 `mappings/indicators.ts` からも FRED の系列を削除)。照合元は BLS だけになる。

**BLS の制約**: BLS の API は「いまの値」しか返さない(発表日時点の値を指定できない)。発表から20日を過ぎた値は、その後の改定で速報値と食い違うため照合に使わない(4章)。速報値の照合は、発表後20日以内に行う。

### 13.1 指標ごとの照合元

| code | 指標 | DB に行 | 照合元 | 状態 |
|---|---|---|---|---|
| `US_CPI` | CPI 前年比(季節調整なし) | あり | BLS `CUUR0000SA0` | **BLS で照合できる** |
| `US_CORE_CPI` | コアCPI 前年比 | なし | BLS `CUUR0000SA0L1E` | BLS で照合できる(DB に行を足せば使える) |
| `US_NFP` | 非農業部門雇用者数 前月差 | あり | BLS `CES0000000001` | **BLS で照合できる** |
| `US_UNEMPLOYMENT_RATE` | 失業率 | なし | BLS `LNS14000000` | BLS で照合できる(DB に行を足せば使える) |
| `US_RETAIL_SALES` | 小売売上高 前月比 | なし | (なし) | **代わりが必要**。作成元は Census(米国勢調査局)。Census の API の利用条件は未確認。それまでは公開しない(`requireOfficialMatch: true` のため公式待ちのまま) |
| `US_FOMC` | FOMC 政策金利 | あり | (なし) | **代わりが必要**。FRB の声明(パブリックドメイン、11章)から誘導目標の範囲を取る仕組みが未実装。数値の照合ではなく、声明の文面との照合になる |
| `JP_CPI` | 全国CPI | あり | (なし) | **代わりが必要**。e-Stat(総務省 統計局)の API(商用利用可・出典と加工の明示が必要、11章)を照合元にする。未実装 |
| `BOJ_RATE` | 日銀の政策金利 | あり | (なし) | **代わりが必要**。日本銀行の公表文が元。商用利用は事前相談が必要(問い合わせ中、vendor-inquiries.md) |

### 13.2 米国以外の地域の候補(未確認)

経済カレンダーで扱う予定の地域は、BLS では照合できない。各国の統計局の公開データを候補にする。どれも**利用条件はまだ確認していない**(要確認)。確認できたものだけを本番の候補にする。

| 地域 | 候補 | 確認すること |
|---|---|---|
| ユーロ圏 | Eurostat(HICP・失業率・GDP)、ECB Data Portal | 商用アプリでの再利用・保存・出典の書き方 |
| 英国 | ONS(Office for National Statistics) | Open Government Licence の範囲(BOE のサイトとは別) |
| オーストラリア | ABS(Australian Bureau of Statistics) | ライセンス(CC BY の範囲)・API の条件 |
| カナダ | Statistics Canada | Open Licence の範囲 |
| スイス・中国・ニュージーランド | 各国の統計局 | 公開データの利用条件(未調査) |

統計局で照合できない地域は、照合元が見つかるまで「要確認」のままにする(自動では公開しない)。または、照合済みの値を提供する商用データ(経済カレンダーの業者)を使う。その場合は、業者の値をそのまま公開してよいかを HQ が判断する。

### 13.3 次の手順

1. `US_CORE_CPI`・`US_UNEMPLOYMENT_RATE` を `economic_indicators` に足す(表示名のルールに沿って HQ が決める)
2. Census の API の利用条件を確かめ、小売売上高の照合元にする
3. e-Stat の取り込み(`JP_CPI`)
4. FOMC の声明から政策金利を取る仕組み
5. 13.2 の各統計局の利用条件の確認

---

## 14. 有料カレンダーに依存しない独立経路(2026-10-17、HQ判断「BLS公式統計データを使った照合基盤の先行整備を承認」)

有料の経済カレンダー(①、未契約)を待たずに、BLSの公式発表スケジュールとBLS自身の実績値だけで`economic_events`・`event_snapshots`を作る経路を追加した(`npm run ingest:official:bls-calendar`)。契約・APIキーの追加費用は無し(BLS APIはキー無しでも動く、v1・25クエリ/日)。

### 14.1 対象・取得範囲

- **対象指標**: `US_CPI`・`US_NFP`。v1.6(2026-10-26)から`US_CORE_CPI`・`US_UNEMPLOYMENT_RATE`・`US_AVG_HOURLY_EARNINGS`も(16章)
- **取得範囲**: 参照期間 2025-12 〜 2027-11(`src/ingestion/mappings/blsSchedule.ts`に書いた表の範囲)。これより前・後の月は扱わない
- **取得できない項目**: 予想値(forecast)は常に`null`(BLSは予想値を出さないため、提供元も取得時刻も無い値として扱う。「予想値は提供元と取得時刻を記録する」というHQ方針どおり、存在しない値を作らない)。米国以外の指標、`US_RETAIL_SALES`(Census の指標で BLS の系列が無い)は対象外

### 14.2 仕組み

- `mappings/blsSchedule.ts`: BLSの公式スケジュールページ(bls.gov/schedule/…、2026-10-17取得、ログイン・キー不要)を人が書き写した表(`mappings/indicators.ts`と同じ、コードレビュー対象の設定ファイル。将来の月は自動で増えないので、表の末尾に達したらHQ/人が追記する)
- `pipelines/blsCalendar.ts`: 表の各行について、BLSが実際にその月の値を発表済みなら(発表予定日を過ぎていて、BLSの値が取れる)`NormalizedCalendarRelease`を作る。既存の①向けパイプライン(`ingestCalendarReleases`、economicCalendar.ts)はまったく変更していない — 新しい"取得元"(`bls_schedule`)として同じ関数にそのまま渡すだけ
- 発表予定時刻と実際の発表時刻: BLSは2つを区別して公表していない(米国統計機関は公表時刻を厳格に守るため)。そのため両方に同じ値(表の日付 + 08:30 America/New_York、`zonedWallTimeToUtc`で夏時間を考慮してUTCに変換)を使う。精度は`EXACT`
- 実績値の出典・取得日時・単位・改定: 既存の`event_snapshots.source`/`source_url`(BLSの公式URL)/`captured_at`にそのまま載る。前回値は毎回の実行でBLSの最新値を取り直すため、初回発表時の値(`event_snapshots.previous`、不変)と、後から変わった値(`event_revisions`、改定ごとに記録)が区別される
- 「一致・差異あり・未照合」: このルートは実績値そのものをBLSから作るため、通常は検証も自分自身との比較になり`VERIFIED`になる(2つの独立した取得元による裏付けではない点は限界として明記する)。発表予定日を過ぎてもBLSの値がまだ無い月は「未照合」としてスキップする(作らない。guessしない)。`validateRelease`の妥当性チェック(範囲外・前回からの変化が大きすぎる等)に引っかかった場合は既存の仕組みのまま`PENDING_REVIEW`になる

### 14.3 BLSの利用条件

bls.gov/opub/copyright-information.htm 等で確認(2026-10-17): BLSのデータ・資料はパブリックドメイン。API経由のデータに利用制限は無く、取得日を明記すること・「BLSは取得後の分析の正しさを保証しない」旨を示すこと・改変したデータをBLS発のものとして示さないことが求められる。この経路はBLSの値をそのまま(改変せず)使い、出典・取得日時を記録しているため、確認できた条件の範囲内。

### 14.4 既存処理への影響

`economicCalendar.ts`・`officialStats.ts`・`ingestOfficial.ts`(既存の①②ジョブ)は1行も変更していない。`mappings/indicators.ts`は、US_CPI・US_NFPの`providers`に`bls_schedule`キーを追加しただけ(既存の`tradingeconomics`/`finnhub`/`fmp`キーは変更なし)。既存のテスト(`economicCalendarPipeline.test.ts`・`officialVerification.test.ts`等)は変更せずに実行し、全て通過を確認した。

### 14.5 照合の独立性(2026-10-17、HQ確認指示への回答)

**この経路の「VERIFIED」は独立検証ではない。** `actual`(載せる値)と`official`(照合先)は同じ`createBlsNativeResolver`インスタンス・同じBLS系列(例: `US_CPI`→`CUUR0000SA0`)から来るため、数学的に同じ値になる(自己一致・トートロジー)。コードで確認: `jobs/ingestBlsCalendar.ts`が1つの`official`を作り、`buildBlsScheduleReleases`(`actual`を決める)と`ingestCalendarReleases`→`processActual`(`official`との一致を判定する)の両方に同じインスタンスを渡している(`pipelines/blsCalendar.ts`)。

- 既存の①(有料カレンダー)× BLS の照合は、provider(例: Trading Economics)という**別の**取得元の値とBLSを比べるため、本当の独立照合。この経路はBLSが唯一の取得元で、provider=BLS・照合元=BLSなので同じ意味の「VERIFIED」ではない
- `event_snapshots.verification_status`は既存のenum(`VERIFIED`/`SINGLE_SOURCE`)のどちらかしか選べず、「唯一の公式機関の値そのもの(裏付け不要)」を表す3つ目の状態が無い。`requireOfficialMatch: true`(US_CPI/US_NFPは有料カレンダー側と共有)の都合上、`official`をnullにすると発行されず`AWAITING_OFFICIAL`のまま止まってしまうため、ステータス自体を変える修正はスキーマ・既存コード双方への影響範囲の確認が先に必要(未実施)
- **区別する手段(2026-10-17、HQ承認を受けて実装済み)**: `event_snapshots`が属する`economic_events.provider`(採用した値の取得元。例: `tradingeconomics`・`bls_schedule`)と、`verification_source`(照合元。例: `BLS:CUUR0000SA0@...`)を比べ、providerが`SELF_SOURCING_PROVIDER_AGENCY`(`metrics.ts`、いまは`bls_schedule`→`BLS`の1行だけ)に載っていて、かつ照合元の機関名と同じなら**自己一致**、それ以外のVERIFIEDは**独立照合済み**、とレポート側(`classifySnapshotMatch`)で区別して表示する。文字列が異なるだけで独立と判定しないよう、この対応表は人がレビューする静的な設定にしている(`provider`が偶然"bls"のような名前でも、表に載っていなければ独立照合として扱う誤りを避けるため、載せる判断自体を人がレビューする)。スキーマ変更なし(`reader.ts`が`event_snapshots`→`economic_events`の既存FKを使って`provider`を読むだけ)。実装: `metrics.ts`(`classifySnapshotMatch`・`EconomicValueStats`の新フィールド)・`reader.ts`(`listSnapshots`/`listStaged`のSELECT拡張)・`report.ts`(§8に「検証の内訳」表と「差異ありの一覧」を追加)。既存の`agreementRate`(自己一致を含む旧来の値)は後方互換のため残し、新しい`independentAgreementRate`(自己一致を除く)をレポートの主要な一致率として表示する
- CPI・NFPの対応(系列・単位・季節調整・対象月)を再確認: `US_CPI`→`CUUR0000SA0`(CPI-U全品目・季節調整なし=NSA、`mapping.seasonalAdjustment`と一致)・YOY_PCT・PERCENT。`US_NFP`→`CES0000000001`(非農業部門雇用者数・季節調整あり=SA、一致)・DIFF(前月差)・THOUSANDS。いずれもmappings/indicators.tsの既存定義(3.1節)と一致しており、この経路で変更していない

### 14.6 発表時刻の精度

`releaseAtPrecision: 'EXACT'`は「発表が実際にこの時刻に行われたことを確認した」という意味ではない。既存のTradingEconomicsアダプタ(`adapters/tradingEconomics.ts`)の`EXACT`も、提供元が具体的な時刻を示しているかどうかだけで判定しており(`DateSpan`フィールド)、実際の公開を独立した手段で確認しているわけではない。この経路の`EXACT`もBLSが公表している予定時刻(`blsSchedule.ts`)を使っているという点で、既存の意味と同じ水準。BLSが長年厳格に時刻を守ってきた実績に基づく前提であり、個々の発表ごとに「本当にその時刻だったか」を確認する独立した手段は無い。

**予定変更への対応(今回の確認で見つけた課題)**: `blsSchedule.ts`は静的な表で、BLSが発表を延期・変更した場合に自動で追随しない(2025年10月の政府閉鎖で実際に発表が遅れた前例がある、13章)。延期が起きると、表の日付のまま値を待ち続け、後から値が出たときに古い(実際とは違う)予定日時を`EXACT`として記録してしまう恐れがある。対策として`overdue`(45日以上経過しても値が無いエントリ)を分けて報告するようにした(`BlsScheduleReleaseResult.overdue`)。これは完全な解決ではなく、「おかしいので人が確認すべき」という合図を出すだけ — 見つかったら`blsSchedule.ts`の該当日付をBLSの最新スケジュールで確認・修正する運用とする。スキーマ変更は行っていない。

### 14.7 未発表データの扱い(確認結果)

将来分・未発表分は推測で補完していない(`buildBlsScheduleReleases`は`official.resolve()`がnullを返す限り`notYetAvailable`に入れるだけで、値を作らない)。「予定」(`notYetAvailable`、まだ発表予定日が来ていない)・「発表済みで実績照合済み」(`releases`、BLSの値で発行)・「発表予定日を過ぎても未発表(要確認)」(`overdue`)の3つを区別して報告する。

## 15. FOMCの会合日程(2026-10-22、HQ承認 Task 3)

指標`US_FOMC`(FOMC政策金利、DEV DBに行あり・`is_active = true`・イベント0件)の政策発表の**予定**を、FRBの公式ページを人が書き写した表から`economic_events`に入れる。値(政策金利の結果)は入れない。

### 15.1 取得元(どちらもログイン・キー不要、federalreserve.gov)

| 取得元 | URL | 取得日時 | 読み取った内容 |
|---|---|---|---|
| 会合日程のページ | https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm | 2026-10-22 01:17 UTC(02:08 UTC に再確認、内容は同じ) | Last Update 2026-10-07。2026年: 10/27-28、12/8-9*。2027年: 1/26-27、3/16-17*、4/27-28、6/8-9*、7/27-28、9/14-15*、10/26-27、12/7-8*(* = 経済見通し(SEP)あり)。注記 "Each meeting date is tentative until confirmed at the meeting immediately preceding it." |
| FRBのカレンダー(JSON) | https://www.federalreserve.gov/json/calendar.json | 同上 | 会合2日目に type `FOMC`・title `FOMC Meeting`・time `2:00 p.m.`、`FOMC Press Conference`・`2:30 p.m.`。2026-10-28・2026-12-09 に有り。JSONは 2017-01〜2026-12 の範囲で、**2027年の項目は1件も無い** |

再確認(2026-10-22 02:08 UTC、各ページ1回ずつGET)では、上の日付・SEPの印・注記・JSONの時刻・JSONの範囲がすべて最初の取得と一致した。federalreserve.gov の内容は特に断りが無ければパブリックドメイン(要人の写真と同じ扱い、api-design.md v1.25)。

### 15.2 表(コードレビュー対象の設定ファイル)

`fx-event-analyzer-backend/src/ingestion/mappings/fomcSchedule.ts`。1行 = 1回の会合で、次を持つ。

- `meetingStart` / `meetingEnd`: 会合の1日目・2日目(ニューヨークの日付)
- `announcement`: 政策発表(声明)の日時。`{ date: meetingEnd, time: '14:00', timeZone: 'America/New_York' }`。**会合の日付とは別のフィールド**として持つ
- `sep`: 経済見通し(SEP)がある会合(ページの *)
- `provisional`: 暫定(15.3節)
- `sources`(上の2つのURL)、`checkedAt`(`2026-10-22`)
- 任意: `cancelled: { note }`(中止)、`eventKey`(会合の日付が後から動いたときに、元の行を使い続けるための元の`meetingEnd`)

2026年10月以降の10回だけを書いた(それより前の会合は過去なので作らない)。

### 15.3 暫定(tentative)のルール

ページの注記どおり、各会合の日程は直前の会合で確認されるまで暫定。表の`provisional`は次のどちらかなら`true`:

1. 直前の会合がまだ開かれていない
2. calendar.json にその会合の 14:00 の `FOMC Meeting` がまだ載っていない

2026-10-22 時点: 10/27-28 だけが確定(`false`)。12/8-9 は JSON には 14:00 で載っているが、10月の会合での確認前なので暫定(`true`)。2027年の8回は JSON に無く、14:00 は FRB の通常の発表時刻を当てはめただけなので暫定(`true`)。**判断**: 2027年分は表から外さず、暫定として載せた(1年先までの予定がカレンダーに出るほうが利用者に役立ち、「予定（暫定）」の表示で確定前であることが分かるため)。外したほうがよいとHQが判断すれば、表から行を消すだけでよい(既に入った行は15.5節のとおりログに出るだけで消えないので、消す場合は手で`status = 'CANCELLED'`にするか、行を残したまま`cancelled`を付ける)。

### 15.4 時刻の変換

`announcement`(America/New_York の壁時計)を`src/ingestion/time.ts`の`zonedWallTimeToUtc`で UTC に直して`release_datetime`に入れる(夏時間を考慮。固定の時差は使わない)。例: 2026-10-28 14:00 EDT → `2026-10-28T18:00:00Z`、2026-12-09 14:00 EST → `2026-12-09T19:00:00Z`、2027-01-27 → 19:00Z、2027-03-17 → 18:00Z(2027年の夏時間は 3/14 開始)、2027-06-09 → 18:00Z、2027-10-27 → 18:00Z(夏時間の終わりは 11/7)、2027-12-08 → 19:00Z。表の10回はすべて 18:00Z か 19:00Z になる(テストで確認)。`release_datetime_precision`は`EXACT`(BLSの経路と同じ意味。予定の時刻が分かっている、14.6節)。

### 15.5 取り込み(`npm run ingest:fomc-schedule`、`src/jobs/ingestFomcSchedule.ts` → `src/ingestion/pipelines/fomcSchedule.ts`)

- 1会合につき1行: 指標`US_FOMC`、provider `fomc_schedule`、provider_event_id `fomc_schedule:<meetingEnd>`(`eventKey`があればそれ)、`status = SCHEDULED`、`data_status = PENDING`、重要度は指標の値、`is_provisional`は表の`provisional`。`RELEASED`の行・値(event_snapshots)は作らない
- 何度動かしても同じ(同じ表なら何も変わらない)
- 表の日時が変わったら同じ行の`release_datetime`を更新する → DBのトリガーが`event_schedule_changes`に`RESCHEDULED`を記録する(通知一覧のカレンダー更新)
- 暫定→確定は`is_provisional`だけを更新する(トリガーは`AFTER UPDATE OF release_datetime, status`なので起動せず、`event_schedule_changes`に行は増えない。単体テストと結合テスト`tests/integration/fomc-schedule.test.ts`で確認)。**暫定→確定はジョブが自動で判断しない**: 表の`provisional`を人が直して、ジョブを動かしたときだけ変わる(15.6節)
- 表示: APIは`is_provisional`を「DBの値が`true`かつ発表日時が今より先」のときだけ`true`で返す(api-design.md v1.32 14.6節)。そのため会合が過ぎた後は、表とDBを直す前でも「予定（暫定）」は出ない
- `cancelled`が付いた会合は`status = CANCELLED`にする(トリガーが`CANCELLED`を記録)。まだ行が無ければ作らない
- 発表時刻を過ぎた会合は作らない。既にある過去の行は変えない。`RELEASED`の行も変えない
- 表から消えた会合(DBにあり、未来・`SCHEDULED`)は**ログに出すだけ**で、消さない・中止にしない
- `ingestion_logs`(provider `fomc_schedule`、job `ingest:fomc-schedule`、data_type `ECONOMIC_EVENT`)の`details`に`inserted`・`updated`・`unchanged`・`cancelled`・`provisional`・`past`・`removed`を残す
- 外部へのアクセスは無い(表を読むだけ)。**定期実行には登録していない**(GitHub Actions のワークフローも変えていない)。表を直したときに手動で動かす。前提: Migration `20261022000002`(dev-environment.md 12章)

### 15.6 表の更新手順(人が行う)

1. 15.1節の2つのページを開き、会合日程ページの日付・* と calendar.json の`FOMC Meeting`の日付・時刻を見比べる
2. 日付が変わった会合は`meetingStart` / `meetingEnd`を直し、`eventKey`に元の`meetingEnd`を入れる(同じ行が更新され、`RESCHEDULED`が記録される)
3. 直前の会合が終わり、calendar.json に 14:00 が載った会合は`provisional`を`false`にする(例: 2026-10-28 の会合の後に 12/8-9。詳しい手順は dev-environment.md 12.7節)
4. 中止になった会合は行を消さずに`cancelled: { note }`を足す
5. `checkedAt`を確認した日に直し、`npm test`(表の整合性のテスト: `meetingEnd` = 発表日、`meetingStart` < `meetingEnd`、SEPの印)を通してからレビューに出す
6. マージ後に`npm run ingest:fomc-schedule`を動かす(DEVで動かす前は dev-environment.md 12章の確認SQLで前後を比べる)

### 15.7 既知の制約(2026-10-22)

- **発表後も予定のまま**: FOMCの行は発表時刻を過ぎても`status = SCHEDULED`・`data_status = PENDING`のまま変わらない。このジョブは値を入れず、他のジョブもFOMCの結果(政策金利)を取りに行かない
- **値動き・過去の結果は自動では入らない**: 値動きの取り込み(`npm run ingest:event-reactions`)は`status = RELEASED`の行だけを対象にする(`src/repositories/ingestionRepository.ts`の`listReleasedEventsForReactions`)。FOMCの行は`RELEASED`にならないので、相場反応・`/events/{id}/history`の過去の結果は作られない
- **ホームでは当日中「これから」の側**: iOSのホームは`status = SCHEDULED`の行を「これからの予定」に分ける(`HomeViewModel.swift`の`upcomingEvents`)。発表後もその日のうちは「これから」の側に出続ける(日付が変われば出なくなる)
- **暫定の表示**: 過ぎた会合は API が`is_provisional = false`で返すので「予定（暫定）」は出ない(15.5節)。DBの値は人が表を直してジョブを動かすまで`true`のまま
- **通知**: 指標`US_FOMC`は重要度`HIGH`なので、暫定の会合も含め、通常の指標と同じく発表の数分前(既定5分前)の通知・通知一覧の対象になる。DEVでの注意は dev-environment.md 12.5節
- 結果の取り込みや「発表済み」への切り替えは、この Task の範囲外(HQの判断を待つ)

## 16. 米国コアCPI・失業率・平均時給(2026-10-26、HQ指示「米国コアCPI・失業率・平均時給の追加」)

3指標とも、US_CPI・US_NFP と同じ BLS の独立経路(14章、`npm run ingest:official:bls-calendar`)で取り込む。新しい取得元・契約・キーは無い。既存の処理(`buildBlsScheduleReleases` → `ingestCalendarReleases`、予定行・取りやめ・内訳・`--dry-run`)をそのまま使い、足したのは設定(`mappings/indicators.ts`・`mappings/blsSchedule.ts`)と指標マスタ(migration `20261026000001_us_bls_indicators.sql`)だけ。

### 16.1 指標ごとの仕様

| | コアCPI | 失業率 | 平均時給 |
|---|---|---|---|
| code | `US_CORE_CPI` | `US_UNEMPLOYMENT_RATE` | `US_AVG_HOURLY_EARNINGS` |
| 表示名(indicator-display-names.md) | コアCPI | 失業率 | 平均時給 |
| BLS 系列(本体) | `CUUR0000SA0L1E`(食品・エネルギーを除く、都市平均、季節調整なし) | `LNS14000000`(U-3、16歳以上、季節調整済み) | `CES0500000003`(民間・全従業員の平均時給、季節調整済み、ドル) |
| 値(actual・previous) | 前年比 %(`YOY_PCT`)。BLS の発表の前年比は季節調整なしの指数で計算する(US_CPI と同じ) | 水準 %(`LEVEL`。変換なし) | 前月比 %(`MOM_PCT`) |
| 副指標(`secondary_*`) | 前月比 %(`MOM_PCT`)。BLS の発表どおり**季節調整済みの`CUSR0000SA0L1E`**で計算する | なし | 前年比 %(`YOY_PCT`)。本体と同じ`CES0500000003` |
| 小数 | 1桁 | 1桁 | 1桁 |
| 発表日 | CPI の発表と同じ日(`blsSchedule.ts`の`cpi`の表) | 雇用統計と同じ日(`nfp`の表) | 雇用統計と同じ日(`nfp`の表) |
| 発表時刻 | 08:30 America/New_York | 同 | 同 |
| 重要度 | HIGH | HIGH | MEDIUM |
| 関連の通貨ペア | USDJPY(1)・EURUSD(2)。US_CPI・US_NFP と同じ | 同 | 同 |
| 妥当性の範囲・前回からの変化の上限 | −3〜12%・1.0 | 2〜20%・1.0 | −3〜5%・2.0 |

- 前年比・前月比は`computeOfficialValue`(`verification/official.ts`)で、BLS の公表値(指数・水準)から計算する: 前年比 = 当月 ÷ 12か月前 − 1、前月比 = 当月 ÷ 前月 − 1(×100)
- 同じ発表の指標は同じ日付を使う。`blsSchedule.ts`の`cpi`・`nfp`の表は1つのまま(`CPI_RELEASE_INDICATORS`・`EMPSIT_RELEASE_INDICATORS`)で、BLS が日付を変えたら1か所直せば全部に効く。取りやめ(`cancelled`)は指標ごとのエントリに付けるので、同じ発表の指標それぞれに付ける
- 有料カレンダーの経路(①、未契約)は、コアCPI・失業率は従来どおりキーを持つ。平均時給は持たない(契約後に実際の応答で確かめて足す)

### 16.2 取り込みの流れ・冪等性・欠損・改定

- 行のID(`provider_event_id`)は`bls_schedule:<code>:<参照月>`。同じIDの行は1つだけで、何度実行しても行は増えない(既存の`findEventByProviderId`による更新。`RELEASED`の行は書き換えない)。単体テスト`tests/ingestion/blsUsIndicators.test.ts`で、2回目の実行の内訳が`released_unchanged`だけになり、行・スナップショット・改定が増えないことを確認した
- **欠損**: BLS がその月の値をまだ出していない(または出さなかった)指標は、その指標だけ作らない(推測しない)。同じ日の他の指標(例: NFP)は影響を受けない。発表日を45日過ぎても値が無ければ`overdue`に出る(14章)
- **改定**: 前回値は毎回 BLS の最新値を取り直し、変わっていれば`event_revisions`に記録する(既存の仕組みのまま。失業率の前月の改定をテストで確認)。失業率は年1回(1月の発表)季節調整を見直し過去5年分が変わる。平均時給・NFP は毎月、前2か月分が改定される
- **指標の行が DB に無い場合**(migration を適用する前): その指標は`indicator_not_in_db`として飛ばすだけで、US_CPI・US_NFP の取り込みは止まらない
- **BLS API の回数**: 1回の実行で系列ごとに1回。US_CPI・US_NFP だけのときの3回(CPI 本体・CPI 前月比・NFP)が **8回**になる(+コアCPI 2系列・失業率・平均時給 2回)。キーなしの v1 は25クエリ/日なので、1日3回までなら足りる(`--dry-run`も同じ回数を使う)

### 16.3 既存の CPI・NFP への影響

- US_CPI・US_NFP の系列・変換・予定(日付・件数・並び)・`provider_event_id`は変えていない(テストで確認)
- 同じ時刻に発表が増える: CPI の日は2件、雇用統計の日は3件が同じ 08:30 に並ぶ。**通知も同じ時刻に複数出る**(既定の設定では重要度 HIGH・MEDIUM が対象。無料プランは HIGH のみなので平均時給は出ない)。まとめるかどうかは未決定(HQ判断)

### 16.4 商用利用・未確認のこと

- BLS のデータはパブリックドメイン(14.3節。bls.gov/opub/copyright-information.htm)。3指標とも追加の契約・許可は不要。出典の表示は既存の`event_snapshots.source`(U.S. Bureau of Labor Statistics)・`source_url`
- **要確認**: 平均時給の前月比・前年比は、BLS が公表する**セント単位に丸めた水準**から計算する。BLS の発表文の%が丸める前の値から計算されている場合、月によって 0.1 違う可能性がある。実データで過去の発表文と比べて確かめる(DEV の取り込み後)
- **要確認**: 予想値(forecast)は無い(BLS は予想を出さない)。サプライズ・「予想を上回ると」の表示は、予想値の取得元が決まるまで出ない(US_CPI・US_NFP と同じ)
- **参考(既存の指摘)**: US_CPI の前月比(副指標)は季節調整なしの`CUUR0000SA0`で計算しているが、BLS の発表の前月比は季節調整済み(`CUSR0000SA0`)。コアCPIでは季節調整済みを使った。US_CPI を直すかは別途判断(既存の値が変わるため、この変更には入れていない)
