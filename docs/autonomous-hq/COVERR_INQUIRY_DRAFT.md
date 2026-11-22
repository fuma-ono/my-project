# Coverr への問い合わせ文案(**未送信**。Owner 名義で送る)

宛先: team@coverr.co
送信者: Owner(下の `[Your name]` などを差し替える。私は送らない)
目的: 2026-11-04 改訂のライセンスにある「AI モデルの評価(evaluate)・データセット」の条項が、下の用途に当たるかを、書面で確認する。
**回答(書面での許可)が得られるまで、Coverr の素材は取得・使用しない。**

## 英語(送信用)

Subject: Licensing question: using Coverr stock videos to compare/evaluate video-editing AI (before we download anything)

Hello Coverr team,

I'm an independent developer building a consumer video-editing app that automatically builds one short video from several clips. Before downloading anything, I'd like written confirmation about the "no AI training / evaluation" clause in your license (last updated November 4, 2026), which says Coverr content may not be used to "train, fine-tune, distill or evaluate AI models, or go into a dataset for that purpose."

We would like to use roughly 15–20 Coverr stock clips (free tier API, with the required credit and download-tracking calls) purely as test inputs for a private, internal quality check of our own editing pipeline. We would NOT train, fine-tune or distill any model on them. Specifically, we'd like to know whether the following is permitted:

1. Running the same clips through (a) our own local, rule-based editing software and (b) a third-party hosted LLM (Anthropic's Claude) that is asked to choose which parts of the clips to keep, and comparing the two results.
2. Automated visual analysis of the clips (scene selection, highlight detection, cut timing) using pre-trained models, with no training or fine-tuning.
3. Sending a few extracted still frames (people may appear in them) of those clips to the hosted LLM API for that selection task; the provider's API does not train on our inputs by default.
4. Judging the quality of the resulting edited videos (a human scores them), and keeping the finished test videos privately.
5. Storing the clips temporarily on a private machine as a test set (not published, not redistributed, not committed to any repository), and deleting them when the test is finished.
6. Feeding the same clip to several different models/versions for the comparison.

We would keep the creator credit and the "Video by <creator> on Coverr" link for each clip, never resell or re-upload the files, and not claim them as our own. This is a one-off test and not a commercial product feature at this stage.

If any of these is not allowed, could you tell us which, and whether a written exception is possible? A reply that we can keep on file would be very helpful.

Thank you,
[Your name]
[Your contact]

## 日本語(Owner が内容を確認するための訳)

件名: Coverr の動画を、動画編集 AI の比較・評価に使えるかの確認(ダウンロードの前に)

私は、複数の動画から短い1本を自動で作る個人向けアプリを開発しています。何もダウンロードする前に、貴社のライセンス(2026年11月4日改訂)の「AI モデルの学習・ファインチューン・蒸留・評価、またはそのためのデータセットに使わない」の条項について、書面で確認したいです。

Coverr の素材を15〜20本ほど(無料の API、必要なクレジット表示とダウンロード通知を守る)、自社の編集処理の品質を、社内・非公開で確認するための「テスト入力」にのみ使いたいです。素材で、どのモデルも学習・ファインチューン・蒸留はしません。次の使い方が許されるかを知りたいです。

1. 同じ素材を、(a) 自社のローカルの、ルールに基づく編集ソフトと、(b) 外部の LLM(Anthropic の Claude。どの部分を残すかを選ぶ)に入れて、結果を比べる
2. 学習済みのモデルによる素材の映像分析(場面の選択・見どころの検出・カットの位置)。学習やファインチューンはしない
3. 素材から取り出した静止画(人物が写る場合がある)を数枚、(b) の API に送って、選択をさせる。API の提供元は、既定で入力を学習に使わない
4. できあがった動画の品質を人が採点し、完成したテスト動画を非公開で保存する
5. 素材を、非公開のマシンにテスト用として一時的に置き(公開・再配布・リポジトリへのコミットはしない)、テストが終わったら削除する
6. 同じ素材を、比較のために複数のモデル・版に入力する

各素材の作者の表示と「Video by <作者> on Coverr」のリンクを残し、ファイルを再販・再アップロードせず、自分の作品とも主張しません。これは単発のテストで、現時点では製品の機能ではありません。
許されないものがあれば、どれかと、書面での例外が可能かを教えてください。残しておける形での返信をお願いします。

## 送る前にあなたが確認すること
- 「アプリの利用者のデータは外部の LLM に送る」と約束していないこと(上の 3 は、検証用の素材に限る)
- 回答は、メール本文を保存し、日付と回答者名を `STOCK_DATASET.md` に記録する(私が記録する)
