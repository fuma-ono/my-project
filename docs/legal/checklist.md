# 規約・コンプライアンス チェックリスト(法務/コンプライアンス部)

各事業を実際に公開する前に必要な規約・表記の一覧。ドラフトはこちらで用意できるが、最終的な内容確認・公開はオーナー側で行う。

## BGM動画(YouTube/TikTok/Reels)

- [ ] 音源はすべて `bgm-pipeline` による完全自社生成のため、著作権/Content IDリスクは低い(`docs/marketing/2026-08-market-research.md` の調査結果より)
- [ ] チャンネル概要欄に「音源はオリジナル生成」である旨を明記すると、万一のContent ID誤検知時の異議申し立てがスムーズになる
- [ ] YouTubeパートナープログラム規約の確認(登録者/視聴時間の条件は達成後に申請)

## アプリ「Focus & Sleep Sounds」

- [x] **プライバシーポリシー**(App Store / Google Play 申請に必須)— ドラフト作成済み(`docs/legal/privacy-policy.md`)。連絡先メールアドレスの記入と法的最終確認はオーナー側の作業
- [x] **利用規約** — ドラフト作成済み(`docs/legal/terms-of-service.md`)。事業者名・連絡先・準拠法の記入と法的最終確認はオーナー側の作業
- [ ] アプリ内課金(サブスク)を実装する場合、Apple/Googleそれぞれの課金ガイドライン準拠が必要
- [ ] 睡眠/集中アプリという性質上、「医療行為ではない」旨の免責表記があると安全(不眠症治療等を謳わない)

## アプリ「kashikari」

- [x] **プライバシーポリシー**(App Store / Google Play 申請に必須)— ドラフト作成済み(`docs/legal/kashikari-privacy-policy.md`)。連絡先メールアドレス(shanqikanghuang271@gmail.com)記入済み。法的最終確認はオーナー側の作業
- [x] **利用規約** — ドラフト作成済み(`docs/legal/kashikari-terms-of-service.md`)。事業者名(屋号: kashikari)・連絡先メールアドレス・準拠法(日本法・運営者住所地の裁判所)すべて記入済み。法的最終確認はオーナー側の作業
- [x] **両ページの公開URL**(Artifact、74回目)を作成済み。App Store Connect / Google Play Consoleに登録する前に、**共有メニューから公開状態への切り替えが必要**(既定で非公開)
  - プライバシーポリシー: https://claude.ai/code/artifact/984fcff8-5d34-4ea0-a750-2d0968cb4173
  - 利用規約: https://claude.ai/code/artifact/2fbe0df7-aa78-4277-b890-b32f76bf7022
- [x] **ストア掲載情報の下書き**(`personal-side-projects/kashikari/mobile/docs/store-listing.md`、74回目)— サブタイトル・説明文・キーワード・カテゴリ・プライバシー質問票の回答目安まで用意済み
- [ ] 「グループ内はメンバーなら誰でも他人の記録の精算状態を変更・削除・編集できる(信頼前提)」という設計は、利用規約に明記済み。ストア審査・ユーザーからの問い合わせで誤解が生じないよう、アプリ内(オンボーディング等)でも一言触れておくと親切かもしれない
- [ ] Apple Developer Program・Google Play Consoleへの登録(`personal-side-projects/kashikari/mobile/README.md`の「ストア公開までに、まだ人間がやる必要があること」参照)。**Apple側はIndividual(個人)登録に決定**(オーナー判断)。Individual登録では、屋号「kashikari」ではなくApp Store上の「販売元」表示に本名が使われる仕様のため、その前提で進める

## note記事

- [ ] 有料記事販売を行う場合、**特定商取引法に基づく表記**が必要になるケースがある(要確認・note側の規定次第)
- [ ] 記事内で引用・参考にした調査データの出典明記(`docs/marketing/2026-08-market-research.md` に情報源リストあり)

## 会社形態

- [x] **個人事業主として運営する方針に決定**(オーナー判断)。屋号は「kashikari」に決定し、利用規約の事業者名欄にも反映済み
- [ ] **開業届は、アプリを公開すること自体には不要**(App Store / Google Playへの登録は個人アカウントで完結し、政府への事業登録は求められない)。開業届が必要になるのは、実際に収益が発生し、それを事業所得として確定申告したい時(青色申告の節税メリットを使いたい場合など)。今は無収益のため未提出のままでよく、収益化のタイミングで検討すれば十分

## オーナーへの依頼

- `docs/legal/privacy-policy.md` の連絡先メールアドレス欄、`docs/legal/terms-of-service.md` の事業者名・連絡先・準拠法欄を記入(別事業「Focus & Sleep Sounds」用。まだ未着手)
- 両アプリのドラフトの法的な最終確認(必要なら専門家レビュー)
