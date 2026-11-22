# BGM 提供元への問い合わせ文案(**未送信**。Owner 名義で送る。契約・購入はしない)
差し替える箇所: `[OWNER NAME]`、`[OWNER CONTACT]`、必要なら `[APP NAME]`。
送信窓口: TunePocket = https://www.tunepocket.com/contact/ (フォーム)/ Epidemic Sound = https://support.epidemicsound.com/s/contactsupport (フォーム。API は「Get free API key」のページもあるが、これは契約の前の話なので使わない)
根拠(各社の公式ページでの確認内容)は `BGM_LICENSE.md` を参照。

## A. TunePocket(英語・全文)

Subject: Licensing questions before subscribing: Extended Business Subscription for an AI-assisted video-editing app

Hello TunePocket team,

I am [OWNER NAME], an independent developer building a consumer app that automatically edits a user's video clips into one short video and adds background music. I am considering your Extended Business Subscription (on-demand app license), but your Licensing Agreement contains restrictions on AI that I need to understand before subscribing. I have not purchased anything. Could you answer the following in writing?

1. Automatic music selection by AI. The app would choose a track for the user automatically (the user does not browse a catalog). Your Agreement says the Audio Recordings may not be used or made available "through any AI, machine learning, music generation, audio generation, dataset, model training, model fine-tuning, or automated content creation service, including any service that may analyze, learn from, imitate, transform, or create derivative audio content." Is automatic track selection inside an on-demand video-editing app permitted under the Extended Business Subscription? If so, how does that reconcile with the sentence above?

2. Beat detection and audio analysis. Our own software would analyze the licensed files (tempo/beat grid, loudness, section boundaries) using conventional signal processing, with no model training, so that cuts can be aligned to the music and the music can be lowered under speech. Is this permitted?

3. Sending analysis information to an external LLM. We might send only text information about a track (title, mood tags, BPM, duration, section timings), never the audio itself, to a hosted large language model so that it can choose a track. Is that permitted? Please also say whether sending the audio itself would be permitted (we do not plan to).

4. AI-driven editing and content generation. An AI would cut and arrange the user's own video and mix the chosen track into the result. Is it permitted for the app to use AI for editing and for generating the finished video that contains your music? No model would be trained or fine-tuned on your music.

5. After the subscription ends. (a) Can end users keep using and distributing finished videos they made while the subscription was active, including after it ends? (b) Can the app still preview, re-render, re-export or let users re-edit those existing projects with the same tracks? (c) What must the app do with the licensed files when the subscription ends?

6. Price and scope. Is the Extended Business Subscription $999 per year, and what counts toward the "up to 50,000 users" limit (registered accounts, monthly active users, or finished videos)? Can both free and paid users of the app receive the music? What is the process if we pass 50,000 users?

A written reply that I can keep on file would be very helpful. I will not subscribe until I understand items 1–5.

Thank you,
[OWNER NAME]
[OWNER CONTACT]

### 日本語の要点(Owner 確認用)
1. AI による自動選曲は、Extended の「オンデマンドのアプリ」の範囲か。契約書の「AI・自動コンテンツ作成サービスに使わせない」との関係
2. ビート・テンポ・音量・区間の解析(従来の信号処理。学習なし)は可か
3. 曲のテキスト情報(題名・ムード・BPM・長さ・区間)だけを外部 LLM に送るのは可か。音源そのものを送るのは可か(予定なし)
4. AI がユーザーの動画を編集し、選んだ曲を混ぜて完成動画を作るのは可か(曲での学習はしない)
5. 契約終了後: (a) 利用者が完成動画を使い続けてよいか (b) アプリが過去のプロジェクトを再生・再書き出し・再編集できるか (c) アプリは音源ファイルをどうすべきか
6. 費用(Extended $999 は年額か)、5 万人の数え方(登録・月間利用・完成動画)、無料・有料の両方のユーザーへの提供、5 万人を超えた場合の手続き

## B. Epidemic Sound(英語・全文)

Subject: Partner API questions before choosing a plan: Scale pricing, limits, free users, and what happens to finished videos after a contract ends

Hello Epidemic Sound team,

I am [OWNER NAME], an independent developer building a consumer app that automatically edits a user's video clips into one short video and adds background music. I am evaluating the Partner API (currently only prototyping on the Free plan is under consideration; I have not signed or purchased anything). Your developer pages say that sub-licensing for end users is supported and that there is no separate AI licensing, and that the Scale plan is priced by download volume. Could you answer the following in writing?

1. Scale pricing. What are the prices of the Scale plan (monthly and annual, if both exist), how are download tiers defined, and what is the price for exceeding the monthly download limit? At what volume do you require the Enterprise plan?

2. API usage limits. What are the rate limits, the monthly download caps per plan, and the minimum contract term? Does a preview or a stream count as a download, or only an export of a track into a finished video?

3. Offering music to free users. May the app offer your music to users on its free tier as well as to paying users? Are there restrictions (for example a requirement to charge users, to show attribution, or to limit exports per user)?

4. Permanent use of finished videos. When a user exports a finished video that contains your music, is the user's right to keep and distribute that video permanent (including on YouTube, TikTok, Instagram and other platforms, and including monetized videos)? Are there conditions such as reporting or claim handling?

5. After the contract ends. If the contract with Epidemic Sound ends or is not renewed: (a) can end users keep distributing finished videos exported before the end date; (b) can the app keep storing, previewing, re-rendering or letting users re-edit those existing projects with the same tracks; and (c) what must the app delete or stop doing?

6. Automatic music selection. The app would select tracks automatically using our own algorithm, and might use a hosted large language model that receives only text information about a track (title, mood tags, BPM, duration), never the audio. We would also analyze beats and loudness of the licensed audio with conventional signal processing, with no model training. Is this covered by the license? Does the "no separate AI licensing" statement apply to this use?

A written reply that I can keep on file would be very helpful. I will not sign anything until I understand these points.

Thank you,
[OWNER NAME]
[OWNER CONTACT]

### 日本語の要点(Owner 確認用)
1. Scale の料金(月額・年額)、ダウンロード帯の定義、上限を超えたときの価格、Enterprise が必要になる量
2. API の利用制限(レート制限・月間のダウンロード数・最低契約期間)。プレビュー・ストリームもダウンロードに数えるか、書き出しだけか
3. アプリの無料ユーザーにも音楽を提供できるか。制限(課金の必要・表示・書き出し回数)はあるか
4. 完成動画への音楽の永続的な利用(YouTube・TikTok・Instagram、収益化を含む)。報告やクレーム処理などの条件
5. 契約終了後: (a) 終了前に書き出した動画を利用者が配信し続けてよいか (b) アプリが既存のプロジェクトを保存・再生・再書き出し・再編集できるか (c) アプリが削除・停止すべきこと
6. 自動選曲(自前のアルゴリズムと、曲のテキスト情報だけを受け取る外部 LLM)と、ビート・音量の解析(学習なし)が、ライセンスの範囲か。「別の AI ライセンスは不要」の対象か

## 送る前にあなたが確認すること
- B は、「Free プランでの試作だけを検討」と書いた(契約・購入しないという Owner の指示に合わせた)。違えば直す
- どちらも、外部の LLM の社名は出していない。出す必要が出たら、そのときに相談する
- 回答は、本文を保存し、日付と回答者名を `BGM_LICENSE.md` に記録する(私が記録する)
