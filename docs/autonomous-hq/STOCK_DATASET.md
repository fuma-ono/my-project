# ストック動画による代替テストデータセット(2026-11-21 の方針変更)

方針: オーナーが実動画を用意する方式は取りやめ、動画素材サイトの利用条件を確認した動画で代替のテストデータセットを作る。
**ストック動画の検証は、実際に撮影された動画の品質検証と同一視しない。** 素材は Git に入れない(置き場は `~/vae-testdata/stock_v1`、環境変数 `VAE_TESTDATA_DIR` で変更)。
台帳(取得元 URL・素材名・作者・ライセンス・根拠 URL・取得日・ハッシュ)は `tools/stock_dataset.py` が `manifest.json` に記録する。ライセンスを確認できない動画は台帳に入れられない。

**現在の状態: 取得できた素材は 0 本。** 理由は下の「サイト別の判定」のとおり。

## サイト別の判定(2026-11-21、各サイトの規約の原文を確認。法的助言ではない)
| サイト | 規約の確認結果 | 「スクリプトで少数を取得してよいか」 | この環境での実際 |
|---|---|---|---|
| Pexels(規約の更新日 2026-10-20) | 商用利用・加工・表記不要は許可。複数素材の編集で「新しい作品」にする利用は Standalone ではない。**スクレイピング・ロボットによる自動取得は禁止**("including for machine learning purposes"、大量・組織的な複製も禁止)。API(無料のキー)の利用は許可と読めるが、API 規約の本文は読めず、動画ダウンロードの扱いや、評価・ベンチマーク目的との関係は文言から判断できない | API は**不明**、HTML の取得は禁止 | スクリプトのアクセスは 403 |
| Pixabay(規約の更新日 2026-10-20) | 商用・加工・表記不要は許可。**自動取得は禁止**(上記と同じ文言)。API は「大量の組織的なダウンロードは不可」だが、少数が該当するかの基準が無い | API は**不明**、HTML の取得は禁止 | 403 |
| Mixkit(User Terms 2025-10-02) | 「スクリプトやボットで大量にダウンロードすること」を禁止。動画の「Free License」の本文を読めず、加工・表記の条件は未確認。少数の取得は明示的には禁止されていないが、許可の明示もない | **不明**(保守的には禁止寄り) | 429 |
| Coverr(ライセンス 2026-11-04) | **"Nothing from Coverr may be used to train, fine-tune, distill or evaluate AI models, or go into a dataset for that purpose."** データセット作成のための大量ダウンロードも禁止。規約でロボット・クローラーも禁止 | **禁止** | — |
| Wikimedia Commons | ファイルごとにライセンス(CC BY・CC BY-SA・CC0・公有)がファイルのページとAPIで確認できる。商用不可(NC)は受け付けない。API の作法(連絡先つきの User-Agent、直列、maxlag)を守る前提で、自動取得は許可と読める。AI の評価利用についての記述は無い。CC BY・BY-SA は帰属表示が必要 | **許可と読める(条件つき)** | **配信サーバーが、この環境の共有の出口を 429 で拒否**(待ち時間の指示なし)。API のメタデータは取れるが、動画のダウンロードができない |
| NASA | 原則、著作権の対象外だが、ロゴ・人物・AI 関連の使い方に制限。自動取得の記述なし | 不明 | 403 |
| Internet Archive | 検索 API で CC0 と表示された動画に、MTV・Nickelodeon など明らかに権利者が別のテレビ番組が多数含まれていた(投稿者の誤ったライセンス表示) | **この表示は根拠にできない**(使わない) | 動画は取得していない |

## 実施したこと(安全面)
- ボット対策を回避する工夫(ブラウザのふり、複数の出口、速度の偽装、ヘッドレスブラウザでのボタン操作)は**しない**。
- Wikimedia へのリクエストは直列・低頻度(12 秒以上の間隔)、`maxlag=5`、429 では指示された秒数だけ待って1回だけやり直す。取得できなかった本は台帳に入れない。
- YouTube・TikTok などは使っていない。

## 取得を再開する条件と選択肢
1. **Wikimedia Commons の制限が解けるのを待つ**: 1回だけ、時間をおいて再試行する(下の「次の再試行」)。解けたら、`tools/stock_dataset.py commons-get` で、候補(下)を1本ずつ、60 秒以上あけて取得する。
2. **オーナーが、動画素材サイトで少数の動画をブラウザで手動でダウンロードする**(自動取得を禁じる条項の対象外と読めるが、規約に明示はない)。取得したら `stock_dataset.py add` で、URL・ライセンス・規約のページを付けて台帳に入れる。
3. **オーナーまたは第三者の権利者が、素材の利用を許諾した動画を提供する**(自分で撮った動画に限らない)。
4. Pexels の API を使う場合: オーナーが無料のキーを登録し、「評価・ベンチマーク目的の取得が規約に反しないか」を Pexels に確認する(規約の文言からは判断できない)。

## 準備済みの候補(Wikimedia Commons。ファイルごとのライセンスを API で確認済み。**未取得**)
内容の区分を混ぜ、似た映像・短い映像・長い映像・縦横・4K を含む 20 本。AI が生成した動画(例: "Sora/OpenAI" の公有表示)は除いた。BY・BY-SA は帰属表示を台帳に残す。
| 区分 | ファイル(File: 以降) | ライセンス |
|---|---|---|
| 旅行・海(似た映像 3本) | Azure Waves at Teluk Prancis Beach (2)/(8)/(5).webm | CC BY-SA 4.0 |
| 食事 | Cooking Boodog - 2.webm、Cooking Boodog - 3.webm | CC BY-SA 4.0 |
| 街・市場・人 | Talisay Lechon Market Cebu.webm | CC BY-SA 4.0 |
| 移動・車窓(似た映像 2本) | View of Anqing snow scene from the high-speed train window (20250208 ~ Video 1)/(… Video 3).webm | CC BY 4.0 |
| 移動・機内/空港(短い) | Landscape shot on the way from Doha to Delhi aircraft.webm、Timelapse of aircraft landing at Delhi airport, India.webm | CC BY-SA 4.0 |
| 自然・滝(似た映像 2本) | Watagataki Falls (Video).webm(CC0)、Cascade de Syratu.webm(CC BY 4.0) | CC0 / CC BY 4.0 |
| 人・遊び | Hikers on a swing in Steigerwald.webm、Children Playing in Cameroon.webm | CC BY-SA 4.0 |
| イベント・人混み | Charlwood Music Festival 2026 Surrey England.webm(4K)、Crowd of Bhagoriya 2026 in Ranapur.webm | CC BY-SA 4.0 |
| 街・走行(長い) | Market Street, Fremantle.ogv | CC0 |
| 動きのある映像 | Eurostar train speeding near Hoegaarden, Belgium 175446 1.webm、Mountain Biking in Kullu, Himachal Pradesh.webm | CC BY-SA 4.0 |
| 夜景 | City skyline (time lapse).webm | CC BY 3.0 |
| 景色(とても短い) | Sunset at the sea of Azov.webm | CC BY 4.0 |

注意: 人物が写る動画は、公開しない(社内の検証用だけ)。完成した検証用の動画も公開しない。BY-SA の素材を使った動画には、同じライセンスの条件が及ぶ。

## 比較検証の準備(素材が取れたらすぐ実行できる)
- `python tools/highlight_ready.py <素材フォルダ>`: 事前点検
- `python tools/highlight_poc.py <素材フォルダ> -o <出力> --manifest <台帳> [--llm dry|run]`: 無料版と Sonnet 版を同じ解析結果から作る。ストック動画には撮影日時が無いので、台帳の順を擬似の撮影順として使い、評価シートと Sonnet への入力に「擬似」と明記する
- 出力: 完成動画 2本、`compare.md`(客観指標、6項目の評価表、処理時間、API 費用)
- Sonnet 版の実行は、API キーの登録(API_KEY_SAFETY.md)が前提。予算 500 円・自動再試行なしを維持

## 再試行の結果(2026-11-21 15:45 UTC)
約90分あけて、Wikimedia Commons から1本だけ(Azure Waves at Teluk Prancis Beach (2).webm)の取得を再試行した。**再び HTTP 429 で拒否された**(待ち時間の指示なし)。取得できた素材は 0 本のまま。
予定どおり、これ以上は自動では試さない。制限は、この環境の共有の出口に対するもので、時間をおいても解けない可能性がある。ボット対策の回避はしない。
**次に進むには、上の選択肢 2(あなたによる手動のダウンロード)または 3(許諾済みの動画の提供)が必要。**

## 2026-11-22 取得元の確認(15〜20本の素材セットは、まだ 0 本)
| 取得元 | この環境からの到達 | 利用条件の確認 | 判断 |
|---|---|---|---|
| Pexels | 403(送信元の IP が拒否される) | 読めていない | 迂回しない。対象外 |
| Pixabay | 403 | 読めていない | 迂回しない。対象外 |
| Mixkit | 200 | 動画の条件(「Stock Video Free License」)の本文が、読み込み後にしか出ず、取得できなかった | 条件を確認できないため使わない |
| Coverr | 200、`robots.txt` は許可 | 本文を確認。**商用・個人利用は無料。加工・トリミング可。生ファイルの販売・再アップロード・Content ID 登録は不可。AI の学習に使うことは不可**(今回は学習ではなく編集の分析だが、条件として記録)。人物はモデルリリースあり、ブランド・建物は無し。ウォーターマーク付きは使用不可 | 公式の入手は **API キー(`api_key`)**。ページから直リンクを集めると、`cdn-staging` や AI 生成が混ざるため、そのやり方は採らない。API キーの取得が必要かは、オーナーに確認する |
| Wikimedia Commons | 429(以前から) | ― | 取得中止(迂回しない) |
**結論**: 利用条件を確認でき、公式の方法で取れる素材は、現時点で 0 本。素材セットの作成は、(a) Coverr の API キー(無料登録かどうか未確認)、(b) 到達できる別の取得元の追加調査、のどちらかが必要。
