# RevenueCat設定 手順書(99回目)

「購読する」を押すと「購入できませんでした」になる件への対応。これは仕様通りの挙動(README「課金基盤(RevenueCat)導入」参照)で、RevenueCat・App Store Connect側の設定が未完了の間はこのエラーになる。以下を順番に終えれば動くようになる。**この作業はApp Store Connect/RevenueCatへのログイン・銀行口座情報の入力を伴うため、私(Claude)は代理でできない。オーナー側の作業。** 各ステップの実行後、詰まったら聞いてもらえれば個別にサポートする。

現状(2026-09-03時点、README記載): Apple Developer Program(Individual)・Google Play Consoleは登録・支払い完了済み。以下はその先の工程。

---

## ステップ1: App Store Connectの「Agreements, Tax, and Banking」

**これが終わっていないと有料販売自体ができない**ので最優先。

1. https://appstoreconnect.apple.com にログイン
2. 左上のメニュー(または「Business」)→「Agreements, Tax, and Banking」を開く
3. 「Paid Applications」の契約(Agreement)に同意
4. 銀行口座情報(振込先)を登録
5. 税務情報(個人事業主として、屋号「kashikari」の情報)を入力

銀行口座の確認(少額入金でのベリファイなど)が発生する場合、**数日かかることがある**。ここが一番のボトルネックになりやすいので、他の設定と並行して先にこの手続きだけでも進めておくのがおすすめ。

## ステップ2: App Store Connectでサブスクリプション商品を作る

1. App Store Connect →対象アプリ(kashikari)→「機能(Features)」→「App内課金(In-App Purchases)」、または「サブスクリプション(Subscriptions)」タブを開く
2. 「サブスクリプショングループ」を新規作成(例: `kashikari_premium`)。1グループ=同じ枠内で切り替え可能なプラン群、という単位なので、月額プランだけなら1グループに1プランでよい
3. グループ内にプランを追加:
   - **参照名**(内部管理用、ストアには出ない): 例 `Premium月額`
   - **商品ID**: 例 `com.kashikari.premium.monthly`(あとでRevenueCat側にも同じ値を登録する。**このIDは一度作ると変更できない**ので、typoに注意)
   - **価格**: 月額300円のTierを選択(Appleは価格を「Tier」という段階で選ぶ形式。¥300に一番近いTierを選べばよい)
   - **表示名・説明文**: 日本語でユーザー向けの表示名(例: 「kashikari Premium」)・説明文を入力
   - **審査用のスクリーンショット**: サブスク機能を説明する画面のスクリーンショットが必要(`docs/screenshots/store/`の画像を流用可)
4. ステータスが「审査待ち(Waiting for Review)」または「Ready to Submit」になればOK。**Sandbox(テスト購入)は審査完了を待たずに動く**ので、審査中でも次のステップに進める

## ステップ3: RevenueCatアカウント作成・プロジェクト作成

1. https://app.revenuecat.com でアカウント作成(無料枠で開始可能。月間トランザクション収益が一定額を超えるまで無料)
2. 新規プロジェクトを作成(例: `kashikari`)
3. 左メニュー「Apps」→「+ New」→ iOSアプリを追加
   - **Bundle ID**: `app.json`(または`app.config.js`)の`ios.bundleIdentifier`と完全に一致させる
   - **App Store Connect API Key**: App Store Connect側で発行したApp Store Connect API Key(.p8ファイル)をアップロードする。持っていない場合は、App Store Connect →「ユーザーとアクセス」→「統合(Integrations)」→「App Store Connect API」でキーを新規発行してダウンロード(**ダウンロードは1回きり**なので保管しておく)
4. Androidも同様に「+ New」→ Androidアプリを追加(Google Play Consoleのサービスアカウント連携が必要。Androidは後回しでも構わない)

## ステップ4: エンタイトルメント・商品・オファリングの紐付け

RevenueCatの用語で、「Entitlement(エンタイトルメント)」=ユーザーが持つ権利の単位、「Product(商品)」=各ストアの実際の商品ID、「Offering(オファリング)」=アプリに見せる商品の束、という3層構造になっている。このアプリのコード(`src/lib/purchases.ts`)は`premium`というエンタイトルメントIDが有効かどうかだけを見ているので、以下の名前は変えずに揃える。

1. 左メニュー「Product catalog」→「Entitlements」→「+ New」
   - **Identifier**: `premium`(**このスペルはコード側と完全一致させる必要がある**。`src/lib/purchases.ts`の`PREMIUM_ENTITLEMENT_ID`参照)
2. 「Products」→「+ New」→ iOS用に、ステップ2で作った商品ID(例: `com.kashikari.premium.monthly`)を登録。少し待つとApp Store Connect側の情報と自動で同期される
3. 作成した商品を、ステップ1で作った`premium`エンタイトルメントに紐付ける(商品の詳細画面から「Attach to entitlement」)
4. 「Offerings」→デフォルトの`default`オファリングに、この商品を含んだPackage(例: `$rc_monthly`)を追加。**「Current」に設定しておく**こと(コード側は`offerings.current`を見ている。`src/lib/purchases.ts`の`getPremiumOffering`参照)

## ステップ5: APIキーをEASに登録

1. RevenueCat →「API Keys」→ iOSアプリの**Public API key**をコピー(Secret keyではない方)
2. `personal-side-projects/kashikari/mobile`で以下を実行(EAS CLIでログイン済みの状態で):
   ```
   eas env:create --scope project --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value "<コピーしたPublic API key>" --environment production
   ```
   (Androidも設定する場合は`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`で同様に)
   または expo.dev のダッシュボード(Project → Environment Variables)から直接GUIで登録してもよい
3. 既存の`EXPO_PUBLIC_SUPABASE_URL`等と同じ場所に並ぶはず(README 79回目の実績と同じ手順)

## ステップ6: 再ビルド・Sandboxでテスト購入

1. `eas build --platform ios --profile production`で再ビルド
2. TestFlightに配信し、実機にインストール
3. **Sandboxテスター**(App Store Connect →「ユーザーとアクセス」→「Sandboxテスター」で作成した、本番と別のApple ID)でサインインした状態で購入フローを試す。本番のApple IDのままだと課金確認画面で本当に請求されてしまうので注意
4. 「購読する」を押して、Sandbox環境の購入確認ダイアログが出て購入が完了すればOK。RevenueCatのダッシュボード(Customers)にも購入履歴が反映される

---

## つまずきやすいポイント

- **エンタイトルメントIDのtypo**: `premium`以外の文字列にしてしまうと、購入自体は成立してもアプリ側は「無課金のまま」に見える(`isPremiumFromInfo`がfalseを返し続ける)
- **Offeringが「Current」になっていない**: `getPremiumOffering`は`offerings.current`しか見ないので、Currentに設定し忘れると「購入可能なプランが見つかりませんでした」のままになる
- **Bundle IDの不一致**: RevenueCat側に登録したBundle IDと`app.json`の値が1文字でも違うと、`getOfferings()`が空で返ってくる
- **本番Apple IDでSandboxテストしようとする**: 必ずSandboxテスター専用のApple IDでサインインし直す(設定 → App Store → Sandboxアカウント、またはOSバージョンによって設定場所が異なる)

## 進捗チェックリスト

- [ ] Agreements, Tax, and Banking登録(App Store Connect)
- [ ] サブスクリプション商品を作成(App Store Connect)
- [ ] RevenueCatアカウント・プロジェクト作成
- [ ] App Store Connect API Keyを連携
- [ ] `premium`エンタイトルメント作成・商品を紐付け
- [ ] Offering(`default`、Current)にPackageを追加
- [ ] `EXPO_PUBLIC_REVENUECAT_IOS_KEY`をEASに登録
- [ ] 再ビルド・Sandboxテスターで購入確認
- [ ] (任意)Android版も同様に設定
