# 投稿方針(モヤスカ)

オーナー指示(2026-08-06): 「基本はショート動画で作成して、日本人向け（日本語で）。毎日投稿（多くの人が見る時間帯をマーケティングして）」

## 決定事項

- **フォーマット**: YouTube Shorts中心(縦型・60秒前後)。長尺版は当面作らない
- **言語**: 完全日本語(台本・字幕・タイトル・概要欄すべて日本語。`bgm_pipeline`と同じくローカライズは妥協しない)
- **頻度**: 毎日1本投稿
- **投稿時刻**: **毎日20:00 JST(11:00 UTC)固定**

## 投稿時刻の根拠

日本向けショート動画マーケティングの一般的な知見を調査した結果:

- **20:00〜23:00**が視聴者数・おすすめ欄露出ともに最大の「ゴールデンタイム」([出典1](https://0120.co.jp/blog/video-16/), [出典5](https://herozz.co.jp/blog/youtube-short-buzz-time/))
- 次点で17:00〜19:00(帰宅前後のスキマ時間)、12:00〜14:00(ランチ休憩層)
- 投稿頻度そのものより「一貫した曜日・時刻での投稿」が伸びに寄与するとの指摘が複数あり([出典2](https://edimakor.hitpaw.jp/video-editing-tips/best-time-to-post-on-youtube-shorts.html), [出典3](https://pamxy.co.jp/marke-driven/sns-marketing/youtube/youtube-short-time/))

モヤスカの題材(LINE風スカッと系ドラマ)は「一日の終わりに気軽に見る」用途と相性が良いため、ゴールデンタイムの先頭である**20:00**を固定投稿時刻として採用する。時間帯を毎回変えるより固定した方が視聴者の習慣化とYouTube側のおすすめ精度向上の両面で有利、というのが上記調査の一致した見解。

実データが溜まり次第(YouTube Analytics)、実際の自チャンネルの視聴者層に合わせて再検証する。

## 運用体制

- 投稿はYouTube Data API経由の自動化を前提とする(`bgm_pipeline`のRoutineと同じ仕組みを流用予定)
- ~~現時点でのブロッカー: ①新チャンネル未作成(オーナー対応)、②VOICEVOX音声合成が手元PCセットアップ待ち、③台本の量産パイプライン未構築(サンプル1本のみ)~~ → **2026-08-10更新**:
  - ①は解消済み(2026-08-06、チャンネル作成・API確認済み)
  - ②はiPad Shortcuts自動化(方式A')に置き換わり、台本01は実機確認済み(2026-08-09)。ただし02の収録分はAPI呼び出しがほぼ全滅(404エラー)しており、まだ安定運用とは言えない
  - ③は未解消のまま(台本は3本のみ、量産の仕組みなし)
  - **新たに判明・解消**: 「毎日投稿」を実装する最後のピースとして、実は`YouTube Data APIへの公開呼び出し自体`が一度も実装されていなかった(台本01の実音声動画はオーナーへの送付止まりで、投稿されたことがない)。`moyasuka/publish.py` + `moyasuka/youtube_auth.py`(`@moyasuka`専用OAuth、`bgm_pipeline`のコードを再利用)を新設し、この部分は解消
- **残るブロッカー**: (a) `@moyasuka`チャンネルのOAuth認可(オーナー対応、`python3 -m moyasuka.youtube_auth login`)、(b) 台本02のナレーション再収録(API失敗分)、(c) 台本の量産(現状3本のみ)。この3点が揃い次第、毎日20:00 JST発火のRoutineを新設し自動投稿を開始する

## 出典

- [YouTubeショート 投稿時間と頻度の正解｜曜日別ベスト【2026】](https://0120.co.jp/blog/video-16/)
- [YouTubeショートがバズる時間は？毎日投稿の最適タイミングを解説](https://edimakor.hitpaw.jp/video-editing-tips/best-time-to-post-on-youtube-shorts.html)
- [YouTubeショート動画のベストな時間は？目的別のおすすめ時間や注意点を解説](https://pamxy.co.jp/marke-driven/sns-marketing/youtube/youtube-short-time/)
- [YouTubeショートがバズる時間帯は夜が最強！投稿時間5選と頻度を現役インフルエンサーが解説](https://herozz.co.jp/blog/youtube-short-buzz-time/)
