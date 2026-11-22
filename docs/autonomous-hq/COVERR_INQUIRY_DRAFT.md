# Coverr への問い合わせ文案(最終版・**未送信**。Owner 名義で送る)

宛先: team@coverr.co(ライセンスページに記載のアドレス)
送信前に差し替える箇所: `[OWNER NAME]`、`[OWNER CONTACT]`(私は、Owner の氏名・連絡先を持っていないため入れていない。登録済みのメールは非公開用の転送アドレスなので、勝手に入れない)
**回答(書面での許可)が得られるまで、Coverr の素材は取得・使用しない。**

## 英語(送信用・全文)

Subject: Written permission request: using Coverr stock videos to evaluate and compare video-editing AI (nothing has been downloaded yet)

Hello Coverr team,

I am an independent developer, [OWNER NAME], building a consumer app that automatically edits several video clips into one short video. Before downloading anything, I would like your written confirmation about the clause in your license (last updated November 4, 2026) that says Coverr content may not be used to "train, fine-tune, distill or evaluate AI models, or go into a dataset for that purpose."

I would like to use about 15–20 Coverr stock clips, obtained through the free (Demo) API, only as test inputs for a private, internal quality check of my own editing pipeline. I am asking whether each of the following six uses is permitted:

1. AI model performance evaluation and comparison. I would run the same clips through (a) my own local, rule-based editing software and (b) a hosted large language model (Anthropic's Claude) that is asked to choose which parts of the clips to keep, then compare the two edited results and have a person score them.

2. Temporary storage as an evaluation dataset. The clips would be stored temporarily on a private machine as a fixed test set, so that the same inputs can be reused across test runs. They would not be published, redistributed, or committed to any repository, and I would delete them within 30 days after the test ends.

3. Feeding the same clips to multiple models. The same clip would be input to several different models or versions (my local software, pre-trained vision models used only for analysis, and the hosted LLM) so that their results can be compared.

4. Sending still frames that show people to an external LLM. A few still frames extracted from the clips, which may show people, would be sent to the hosted LLM's API for the clip-selection task above. No face recognition or identification of any person would be performed, and the frames would be used only to understand the video content needed for editing.

5. No training, fine-tuning, or distillation. I will not use the clips, their frames, or their metadata to train, fine-tune, or distill any model, and I will not opt in to any data-sharing setting that would let a provider train on them.

6. Credit and download tracking. For every clip I would keep the creator credit ("Video by <creator> on Coverr", linking to the creator's Coverr profile and to coverr.co) and call PATCH /videos/:id/stats/downloads whenever a clip is actually downloaded, as the free API tier requires. I would not resell, re-upload, or claim the files as my own.

This is a one-off internal test, not a feature of a released product at this stage.

Could you tell me, for each of items 1–6, whether it is permitted, and if any is not, whether you can grant a written exception? A reply that I can keep on file would be very helpful. Until I hear from you, I will not download or use any Coverr content.

Thank you very much,
[OWNER NAME]
[OWNER CONTACT]

## 日本語(Owner が内容を確認するための訳)

件名: 動画編集 AI の評価・比較への Coverr 動画の利用について、書面での許可のお願い(まだ何もダウンロードしていません)

私は個人開発者の [OWNER NAME] で、複数の動画クリップから短い動画を自動編集する、一般向けのアプリを作っています。何かをダウンロードする前に、貴社のライセンス(2026年11月4日改訂)の「AI モデルの学習・ファインチューン・蒸留・評価、またはそのためのデータセットに使えない」という条項について、書面で確認したいです。

無料(Demo)の API で入手した Coverr の素材を15〜20本ほど、自分の編集処理の品質を、非公開・社内で確認するためのテスト入力にだけ使いたいです。次の6つの使い方が、それぞれ許されるかをお尋ねします。

1. AI モデルの性能の評価・比較: 同じクリップを、(a) 自分のローカルの、ルールに基づく編集ソフトと、(b) どの部分を残すかを選ばせる外部の LLM(Anthropic の Claude)に入れ、2つの編集結果を比べて、人が採点する
2. 評価用データセットとしての一時保存: 同じ入力をテストのたびに使えるよう、固定のテストセットとして、非公開のマシンに一時的に保存する。公開・再配布・リポジトリへのコミットはせず、テスト終了後30日以内に削除する
3. 同じクリップを複数のモデルに入力: 同じクリップを、自分のソフト、分析だけに使う学習済みの映像モデル、外部の LLM に入力し、結果を比較する
4. 人物が写った静止画の外部 LLM への送信: クリップから取り出した静止画を数枚、上の選択のために外部の LLM の API に送る。人物が写る場合がある。顔認識や個人の特定はせず、編集に必要な映像内容の把握だけに使う
5. 学習・ファインチューン・蒸留には使わない: クリップ・静止画・メタデータを、どのモデルの学習・ファインチューン・蒸留にも使わず、提供元が学習に使える設定にも同意しない
6. クレジット表示とダウンロード通知: 各クリップに「Video by <作者> on Coverr」(作者の Coverr のページと coverr.co へのリンクつき)を残し、実際にダウンロードしたときは `PATCH /videos/:id/stats/downloads` を呼ぶ(無料 API の条件)。ファイルの再販・再アップロード・自分の作品としての主張はしない

単発の社内テストで、現時点では公開した製品の機能ではありません。
1〜6 のそれぞれが許されるか、許されないものがあれば書面での例外が可能かを教えてください。残しておける形での返信をお願いします。返信をいただくまで、Coverr のコンテンツはダウンロードも利用もしません。

## 送る前にあなたが確認すること
- 「テスト終了後 30 日以内に削除」は、私が置いた期限です。変えてよいです(変えたら、私も記録を合わせます)
- 外部の LLM は Anthropic の Claude です。社名を出したくなければ、`a hosted LLM` に変えてよいです
- 回答は、メール本文を保存し、日付と回答者名を `STOCK_DATASET.md` に記録します(私が記録します)
