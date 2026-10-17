# 取得元への問い合わせの記録

作成: 2026-10-16(HQ判断「6件の問い合わせを進め、結果を記録する」)
更新: 2026-10-17(HQ決定「データ提供元の契約判断と次フェーズ」。Massiveの問い合わせ項目を6項目に拡充、FMPを追加)
更新: 2026-10-17(HQ決定「データ品質検証を実機テストの必須条件にする」。Twelve Dataへの問い合わせに、知り合いへの小規模なベータ配布が無料・個人向けプランの範囲内かを追加。規約の文言上は「Internal Use」限定・再配布は別途ライセンスが必要と読め、現状では知り合いへの配布も規約上グレーであることが判明したため)
更新: 2026-10-17(HQ判断「Apple Developer Programの年間99ドルは保留」の付随指示。Twelve Data向け文面を再確認し、集計データ(5/15/30/60分足)の表示許諾を問う項目が無かったため追加。また公式サイトを確認したところ `sales@twelvedata.com` という宛先は掲載されておらず、営業問い合わせは Web フォーム(`https://twelvedata.com/contact/sales`)のみであることが判明したため、送り先を修正。詳細は §1・§4 参照)

送るのは大野さん。会社名・担当者名・メールアドレスを確認してから送る(HQ判断)。返事が来たら、下の表と「結果」の欄を更新する。**書面回答を得る前にAPIキーを取得・設定したり、有料契約を開始したりしない(HQ決定2026-10-17)。** 利用条件の確認結果は data-sources.md 11章、代替候補の比較は調査レポート(外為データ提供元比較調査・経済指標データ提供元調査、2026-10-16)参照。

## 1. 状況

| # | 送り先 | 窓口 | 目的 | 送った日 | 返事 | 状態 |
|---|---|---|---|---|---|---|
| 1 | Trading Economics | ウェブサイトの Contact / Sales フォーム | 経済カレンダーの商用利用・再配布ライセンスの見積もり・お試し | — | — | 未送信 |
| 2 | Twelve Data | ウェブサイトの Contact Sales フォーム(`https://twelvedata.com/contact/sales`)。`sales@twelvedata.com` という宛先は公式サイトに記載が無く、2026-10-17 の確認で誤りと判明(§4参照) | 必要なプラン・追加料金 | — | — | 未送信 |
| 3 | Massive(旧 Polygon) | sales@massive.com | 6項目の明示的な書面回答(下記3.3) | — | — | 未送信 |
| 4 | Financial Modeling Prep (FMP) | ウェブサイトの Contact / Sales フォーム | 経済カレンダーの商用利用・再配布ライセンスの見積もり | — | — | 未送信 |
| 5 | 日本銀行 情報サービス局 | post.prd8@boj.or.jp | 商用利用の相談 | — | — | 未送信 |
| 6 | イングランド銀行(BOE) | enquiries@bankofengland.co.uk | 商用利用の許可の申請 | — | — | 未送信 |
| 7 | 欧州中央銀行(ECB) | ウェブサイトの問い合わせフォーム | 時刻の決まり・無料入手の案内の出し方 | — | — | 未送信 |

## 2. 結果の記録(返事が来たら埋める)

各社・各機関について、次の項目を記録する(HQ判断)。**返事の原文・受信日を必ず残し、確認項目ごとに分けて記録する(HQ決定2026-10-17)。** 返事に書かれていないものは「未回答」と書き、推測で埋めない。

| 項目 | 内容 |
|---|---|
| 受信日 | 返事を受け取った日付 |
| 費用 | 月額・年額、最低契約期間、従量課金の有無 |
| 商用表示権 | 有料アプリの利用者に見せてよいか、条件 |
| 保存期間 | 自社DBに保存してよい期間、解約後の扱い |
| 再配布権 | 端末への送り方の制限、追加料金の要否 |
| クロスチェック権 | 他取得元との内部比較に使ってよいか(Massiveのみ、規約に明文が無いため個別確認) |
| 派生値 | pips・前年比などを計算して見せてよいか |
| 過去データ利用 | 遡って取得・保存してよい範囲(経済指標candidates向け) |
| 出典表示 | 必要な文言と表示場所 |
| 原文 | 返事メールの原文(全文または該当部分の引用) |
| その他 | お試しの可否、時刻・価格の定義、契約期間・解約条件、API移行条件など |

### 2.1 Trading Economics
(未回答)

### 2.2 Twelve Data
(未回答)

### 2.3 Massive
(未回答)

### 2.4 Financial Modeling Prep (FMP)
(未回答)

### 2.5 日本銀行
(未回答)

### 2.6 BOE
(未回答)

### 2.7 ECB
(未回答)

## 3. 送る文面

[ ] は送る前に埋める。

### 3.1 Trading Economics
```
Subject: Enterprise quote and trial – Economic Calendar API, redistribution license for a paid iOS app

Hello,

We are developing a paid iOS app (Japan) that shows economic calendar events and the FX market reaction around each release. We would like a quote and, if possible, a trial for the Economic Calendar API, and specifically a redistribution license that covers displaying the data to the paying end users of a publicly released commercial app (not just internal/personal use).

Scope: about 10 countries (US, Japan, Euro area, UK, Australia, Canada, Switzerland, China, New Zealand, Germany); forecast, actual, previous and revised values; release times; history of about 5 years.

Could you please let us know:
1. Which plan includes the calendar for this use and the redistribution/display license, and its price (do we need live streaming?)
2. Whether we may display the values to our app users and store them in our own database, and for how long
3. Whether derived values (e.g. our own percentage calculations) are allowed
4. How far back historical data may be fetched and retained under this plan
5. The required attribution text
6. What happens to stored data after cancellation (must it be deleted, and by when?)
7. The full API terms of use
8. Whether a trial key is available

Best regards,
[Name] / [Company] / [Email]
```

### 3.2 Twelve Data
```
Subject: Plan question – 1-minute FX bars, including a small ad-hoc beta test

Hello,

We plan to show 1-minute FX charts and price moves (pips) for 9 currency pairs (USD/JPY, EUR/USD, EUR/JPY, GBP/USD, GBP/JPY, AUD/USD, AUD/JPY, USD/CHF, CAD/JPY) to the users of our paid iOS app.

Before that, we would like to run a small, informal beta test (TestFlight/ad-hoc, a handful of friends and acquaintances, not the general public) using live FX data from our current free/personal API key.

1. Does our free/personal plan's "Internal Use" license cover installing the app on a few testers' own devices for this kind of informal beta, or does any distribution beyond our own use already require a paid plan / the Redistribution Rights Add-On?
2. If a paid plan is required even for this small-scale beta, which is the minimum one, and what would it cost?
3. For the eventual public release: is the Venture plan enough, or do we also need the Redistribution Rights Add-On? What would it cost?
4. How long may we store or cache the bars in our own database?
5. We also build our own 5/15/30/60-minute bars by aggregating the 1-minute bars we store, and show these aggregated bars to our end users (not fetched separately from your API). Does our license permit showing such derived/aggregated bars, or does this require separate permission?
6. What attribution text is required?
7. How are FX prices defined (bid, ask or mid), and where do they come from?

Best regards,
[Name] / [Company] / [Email]
```

### 3.3 Massive
```
Subject: Currencies Business – written confirmation needed on 6 points before we subscribe

Hello,

We are evaluating the Currencies Business plan ($999/mo listed) for a paid iOS app that will show 1-minute FX bars for 9 currency pairs (AUDJPY, AUDUSD, CADJPY, EURJPY, EURUSD, GBPJPY, GBPUSD, USDCHF, USDJPY), aggregated into 5/15/30/60-minute bars, with charts and price moves displayed around economic-indicator releases. Before we subscribe, we need written confirmation on the following 6 points (we will not purchase API access or start a paid contract until we have your written answers):

1. Internal cross-check use: we plan to compare your 1-minute bars against a second, independent data source purely for internal data-quality checking (not shown to end users). Your Businesses Terms of Service do not explicitly mention this use — is it permitted under section 2.2, or does it require separate approval?
2. Persistent storage: we store 1-minute bars in our own database indefinitely (not just cached) so we can serve historical charts to our users. Does this conflict with section 6.1(d)'s prohibition on "operating as a data feed" / systematic redistribution, or is storage for our own app's historical charts covered by section 2.2(a)?
3. Aggregation to higher timeframes: we build 5/15/30/60-minute bars from the 1-minute bars we store, and show these aggregated bars to our end users. Please confirm this falls under the "derivative works" permission in section 2.2(c) and the end-user display permission in section 2.2(b).
4. Contract terms: minimum contract length, cancellation terms/notice period, and any early-termination fees for the Business plan (month-to-month vs. annual).
5. Additional fees: under what conditions would we be charged beyond the listed $999/month (e.g. per-ticker fees, bandwidth/call-volume overages, WebSocket connection add-ons)?
6. Coverage and endpoint details: please confirm all 9 pairs listed above are individually available tickers under Currencies Business, which timeframes are officially supported via the timespan/multiplier parameters (1/5/15/30/60-minute), and what the migration plan/timeline is from api.polygon.io to api.massive.com (will old integrations break, and by when must we migrate?).

Best regards,
[Name] / [Company] / [Email]
```

### 3.4 Financial Modeling Prep (FMP)
```
Subject: Commercial redistribution license – Economic Calendar in a publicly released iOS app

Hello,

We are developing a paid iOS app (Japan) that shows economic calendar events (forecast, actual, previous values, release times) and the FX market reaction around each release. Your published FAQ notes that a Data Display and Licensing Agreement is needed to show FMP data in a public app/website/client dashboard, so we are writing to request a quote for that license, specifically for economic calendar data (not equities).

Could you please let us know:
1. Which plan(s) include a commercial redistribution/display license for economic calendar data in a publicly released app, and the price
2. Whether we may store the values in our own database, and for how long
3. Whether we may compute and display derived values (e.g. combining calendar data with our own FX price data)
4. How far back historical calendar data may be fetched and retained under this license
5. What happens to stored data after cancellation (must it be deleted, and by when?)
6. The required attribution text and placement
7. Whether a trial key is available

Best regards,
[Name] / [Company] / [Email]
```

### 3.5 日本銀行
```
件名：講演・挨拶の予定情報の商用アプリでの利用についてのご相談

日本銀行 情報サービス局 御中

[会社名]の[氏名]と申します。
現在、経済指標の発表や要人の発言と、為替相場の動きをまとめて確認できる有料のiPhoneアプリを開発しております。

貴行ウェブサイトで公表されている講演・挨拶の予定(日時・題名・登壇者)を、出所を明記したうえでアプリに掲載し、貴行の該当ページへのリンクを設けたいと考えております。

つきましては、次の点についてご教示いただけますでしょうか。
1. 上記のような商用アプリでの利用の可否と、その条件
2. 出所の記載方法
3. 題名を英語などに訳して掲載することが、改変に当たるかどうか

お忙しいところ恐れ入りますが、どうぞよろしくお願いいたします。

[会社名] [氏名]
[メールアドレス] [電話番号]
```

### 3.6 BOE
```
Subject: Permission request – speech schedule in a paid mobile app

Dear Sir or Madam,

We are developing a paid iOS app that shows central-bank speech schedules alongside FX market moves. We would like to display the date, time, title and speaker of upcoming Bank of England speeches, with attribution and a link to your website.

As your legal notice limits site content to personal or internal non-commercial use, we would like to ask whether you can grant permission for this commercial use, and under what conditions and fees.

Best regards,
[Name] / [Company] / [Email]
```

### 3.7 ECB
```
Subject: Time zone of the weekly speaking schedule, and the free-availability notice

Hello,

1. In the "Weekly schedule of public speaking engagements", does "CET" mean Frankfurt local time, i.e. CEST (UTC+2) during summer time?
2. How should we read entries without a time zone (e.g. "Time: 10:00")?
3. Our paid app will include ECB information. Where in the app, and how often, should we show that the information is available free of charge on the ECB website so that we meet your conditions?

Best regards,
[Name] / [Company] / [Email]
```

## 4. Twelve Data向け文面の網羅性レビュー(HQ指示2026-10-17「送信内容がTwelve Data向けの質問を網羅しているか報告する」への回答)

§3.2の文面(本レビューを反映した版)が、求められた4点を網羅しているか確認した。

| 確認項目 | 文面での対応箇所 | 判定 |
|---|---|---|
| 第三者表示(知り合い・一般利用者への表示) | 項目1(非公開ベータでの他人の端末へのインストールが許諾範囲内か)・項目3(一般公開時にVentureプラン/Redistribution Rights Add-Onが必要か) | 網羅 |
| テスト配布(知り合いへの小規模ベータ) | 項目1・2(ベータでも有料プランが要るか、要るなら最低プランと費用) | 網羅 |
| 保存(自社DBへの保存・キャッシュ期間) | 項目4 | 網羅 |
| 集計データの扱い(1分足から組み立てる5/15/30/60分足の表示) | **本レビューで追加した項目5**。追加前の文面には無く、抜けていた | **追加により網羅**(追加前は未網羅) |

**送信先の確認結果**: `sales@twelvedata.com` という宛先は、公式サイト(`twelvedata.com/contact`・`twelvedata.com/contact/sales`、2026-10-17 WebFetchで確認)に記載が無かった。営業問い合わせは Web フォーム(`https://twelvedata.com/contact/sales`)のみで、一般問い合わせ用のメールアドレスは `info@twelvedata.com`。**メールでの送信を前提にした現在の文面は、宛先をWebフォームに合わせて作り直す必要がある**(本レビューでは文面の内容確認のみ行い、フォーム用への再構成はHQの送信承認と合わせて次回行う)。

**送信権限の確認状況**: `vendor-inquiries.md` 冒頭に記載の通り「送るのは大野さん」がHQ判断で決まっている。今回は会社名・担当者名・連絡用メールアドレス([Name] / [Company] / [Email]の各欄)がまだ未確定(プレースホルダのまま)であり、これらを埋める作業も送信前に必要。**本レビューの時点では送信していない。HQが送信を承認するまで送信しない。**

## 5. Twelve Data: フォーム提出用 最終文面(HQ指示2026-10-17「フォームへ貼り付け可能な最終文面を提示する」への回答)

### 5.1 フォームの構成(2026-10-17 WebFetchで確認)

`https://twelvedata.com/contact/sales` は以下の入力項目を持つ(メール送信ではなくこのフォームのみが窓口)。

| 項目 | 必須 | 内容 |
|---|---|---|
| Request from | 必須 | 「Individual」「Company」の選択式 |
| Surname | 必須 | 自由入力 |
| Name | 必須 | 自由入力 |
| Email | 必須 | 自由入力 |
| Company Name | 必須 | 自由入力 |
| Message | 必須 | 自由入力(文字数制限の表示は確認できなかった。2026-10-17 WebFetchで取得したページ本文に上限の記載が無い) |
| (ラベル無しの2つ目の選択式) | 不明 | 選択肢の内容がWebFetchでは取得できなかった。**送信前に実際のフォーム画面で選択肢を確認する必要がある(要確認のまま)** |

**文字数制限は「記載が確認できなかった」のであって「無いと確認できた」わけではない**。実際にフォームへ貼り付ける際、エラーが出ないか確認すること。

### 5.2 Message欄に貼り付ける最終文面

下記はそのまま貼り付け可能(§3.2の内容と同一、Subject行はフォームに項目が無いため除いた)。

```
We plan to show 1-minute FX charts and price moves (pips) for 9 currency pairs (USD/JPY, EUR/USD, EUR/JPY, GBP/USD, GBP/JPY, AUD/USD, AUD/JPY, USD/CHF, CAD/JPY) to the users of our paid iOS app.

Before that, we would like to run a small, informal beta test (TestFlight/ad-hoc, a handful of friends and acquaintances, not the general public) using live FX data from our current free/personal API key.

1. Does our free/personal plan's "Internal Use" license cover installing the app on a few testers' own devices for this kind of informal beta, or does any distribution beyond our own use already require a paid plan / the Redistribution Rights Add-On?
2. If a paid plan is required even for this small-scale beta, which is the minimum one, and what would it cost?
3. For the eventual public release: is the Venture plan enough, or do we also need the Redistribution Rights Add-On? What would it cost?
4. How long may we store or cache the bars in our own database?
5. We also build our own 5/15/30/60-minute bars by aggregating the 1-minute bars we store, and show these aggregated bars to our end users (not fetched separately from your API). Does our license permit showing such derived/aggregated bars, or does this require separate permission?
6. What attribution text is required?
7. How are FX prices defined (bid, ask or mid), and where do they come from?
```

### 5.3 残っているプレースホルダ(HQが未提供の情報。推測・捏造していない)

| フォーム項目 | 現在の状態 |
|---|---|
| Request from | **[要選択]** Individual / Company のどちらにするかはHQ/大野さんの判断(本調査では決めていない) |
| Surname | **[要記入]** |
| Name | **[要記入]** |
| Email | **[要記入]** (連絡が取れる実在のメールアドレスが必要) |
| Company Name | **[要記入]** |
| ラベル無しの2つ目の選択式 | **[要確認]** フォーム画面で実際の選択肢を見てから選ぶ必要がある |

**本文面はHQの最終確認・送信承認が出るまで送信しない。**
