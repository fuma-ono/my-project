# 取得元への問い合わせの記録

作成: 2026-10-16(HQ判断「6件の問い合わせを進め、結果を記録する」)

送るのは大野さん。会社名・担当者名・メールアドレスを確認してから送る(HQ判断)。返事が来たら、下の表と「結果」の欄を更新する。利用条件の確認結果は data-sources.md 11章。

## 1. 状況

| # | 送り先 | 窓口 | 目的 | 送った日 | 返事 | 状態 |
|---|---|---|---|---|---|---|
| 1 | Trading Economics | ウェブサイトの Contact / Sales フォーム | 経済カレンダーの見積もり・お試し | — | — | 未送信 |
| 2 | Twelve Data | sales@twelvedata.com | 必要なプラン・追加料金 | — | — | 未送信 |
| 3 | Massive(旧 Polygon) | sales@massive.com | 用途がプランの範囲か | — | — | 未送信 |
| 4 | 日本銀行 情報サービス局 | post.prd8@boj.or.jp | 商用利用の相談 | — | — | 未送信 |
| 5 | イングランド銀行(BOE) | enquiries@bankofengland.co.uk | 商用利用の許可の申請 | — | — | 未送信 |
| 6 | 欧州中央銀行(ECB) | ウェブサイトの問い合わせフォーム | 時刻の決まり・無料入手の案内の出し方 | — | — | 未送信 |

## 2. 結果の記録(返事が来たら埋める)

各社・各機関について、次の項目を記録する(HQ判断)。返事に書かれていないものは「未回答」と書き、推測で埋めない。

| 項目 | 内容 |
|---|---|
| 費用 | 月額・年額、最低契約期間、従量課金の有無 |
| 商用表示権 | 有料アプリの利用者に見せてよいか、条件 |
| 保存期間 | 自社DBに保存してよい期間、解約後の扱い |
| 再配布権 | 端末への送り方の制限、追加料金の要否 |
| 派生値 | pips・前年比などを計算して見せてよいか |
| 出典表示 | 必要な文言と表示場所 |
| その他 | お試しの可否、時刻・価格の定義など |

### 2.1 Trading Economics
(未回答)

### 2.2 Twelve Data
(未回答)

### 2.3 Massive
(未回答)

### 2.4 日本銀行
(未回答)

### 2.5 BOE
(未回答)

### 2.6 ECB
(未回答)

## 3. 送る文面

[ ] は送る前に埋める。

### 3.1 Trading Economics
```
Subject: Enterprise quote and trial – Economic Calendar API for a paid iOS app

Hello,

We are developing a paid iOS app (Japan) that shows economic calendar events and the FX market reaction around each release. We would like a quote and, if possible, a trial for the Economic Calendar API.

Scope: about 10 countries (US, Japan, Euro area, UK, Australia, Canada, Switzerland, China, New Zealand, Germany); forecast, actual, previous and revised values; release times; history of about 5 years.

Could you please let us know:
1. Which plan includes the calendar for this use, and its price (do we need live streaming?)
2. Whether we may display the values to our app users and store them in our own database, and for how long
3. Whether derived values (e.g. our own percentage calculations) are allowed
4. The required attribution text
5. What happens to stored data after cancellation
6. The full API terms of use
7. Whether a trial key is available

Best regards,
[Name] / [Company] / [Email]
```

### 3.2 Twelve Data
```
Subject: Plan question – 1-minute FX bars displayed in a paid iOS app

Hello,

We plan to show 1-minute FX charts and price moves (pips) for 9 currency pairs (USD/JPY, EUR/USD, EUR/JPY, GBP/USD, GBP/JPY, AUD/USD, AUD/JPY, USD/CHF, CAD/JPY) to the users of our paid iOS app.

1. Is the Venture plan enough for this, or do we also need the Redistribution Rights Add-On? What would it cost?
2. How long may we store or cache the bars in our own database?
3. What attribution text is required?
4. How are FX prices defined (bid, ask or mid), and where do they come from?

Best regards,
[Name] / [Company] / [Email]
```

### 3.3 Massive
```
Subject: Currencies Business – use case check for a paid iOS app

Hello,

We are considering Currencies Business to show 1-minute bars for 9 FX pairs in our paid iOS app (charts and price moves around economic releases).

1. Is this use covered by section 2.2(b) of your terms? Is there a limit on how many bars we may send to a device?
2. Is attribution required?
3. Are bars built from bid or mid prices?
4. Do you offer startup discounts?

Best regards,
[Name] / [Company] / [Email]
```

### 3.4 日本銀行
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

### 3.5 BOE
```
Subject: Permission request – speech schedule in a paid mobile app

Dear Sir or Madam,

We are developing a paid iOS app that shows central-bank speech schedules alongside FX market moves. We would like to display the date, time, title and speaker of upcoming Bank of England speeches, with attribution and a link to your website.

As your legal notice limits site content to personal or internal non-commercial use, we would like to ask whether you can grant permission for this commercial use, and under what conditions and fees.

Best regards,
[Name] / [Company] / [Email]
```

### 3.6 ECB
```
Subject: Time zone of the weekly speaking schedule, and the free-availability notice

Hello,

1. In the "Weekly schedule of public speaking engagements", does "CET" mean Frankfurt local time, i.e. CEST (UTC+2) during summer time?
2. How should we read entries without a time zone (e.g. "Time: 10:00")?
3. Our paid app will include ECB information. Where in the app, and how often, should we show that the information is available free of charge on the ECB website so that we meet your conditions?

Best regards,
[Name] / [Company] / [Email]
```
