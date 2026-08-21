# kashikari (mobile)

Expo/React Native製のスマホアプリ版kashikari。友達との貸し借り(お金も頼みごとも)を、グループごとに完全に分離して記録・精算する。

Web版プロトタイプ(`../app/index.html`、Claude Artifacts)は「1URL=1つの共有台帳」で、URLを知っていれば誰でも全データにアクセスできた。**このアプリはSupabase(認証+データベース)を使い、グループに参加しているメンバー以外はそのグループの一切のデータ(メンバー・記録・残高・レシート画像)にアクセスできないよう、データベース側(RLS)で強制している。**

## セットアップ(オーナー向け、初回のみ)

### 1. Supabaseプロジェクトを作る

1. https://supabase.com でアカウント作成、新規プロジェクト作成(無料枠でOK)
2. プロジェクトの **SQL Editor** を開き、`supabase/schema.sql` の中身を全部貼り付けて実行する
3. **Authentication > Sign In / Providers** で **Anonymous Sign-Ins** を有効にする(このアプリはメールアドレス登録を一切求めない設計のため必須)
4. **Project Settings > API** から `Project URL` と `anon public` キーを控える

### 2. 環境変数を設定する

```bash
cd personal-side-projects/kashikari/mobile
cp .env.example .env
# .env を開いて、手順1で控えた値を貼り付ける
```

### 3. 動作確認

```bash
npm install
npx expo start
```

スマホに **Expo Go** アプリを入れてQRコードを読み込めば、すぐ動作確認できる。

## デモモード(Supabase未接続でUIを確認する)

Supabaseプロジェクトをまだ作っていなくても、UIだけならすぐ確認できる。

```bash
EXPO_PUBLIC_DEMO_MODE=1 npx expo start --web
```

ダミーの3人グループ(たろう・はなこ・じろう)とダミーの記録が入った状態で起動する。認証・DB通信は一切行わない。画面例:

| グループ一覧 | グループ詳細 | 記録を追加 |
|---|---|---|
| ![groups](docs/screenshots/groups.png) | ![group detail](docs/screenshots/group-detail.png) | ![add entry](docs/screenshots/add-entry.png) |

`EXPO_PUBLIC_DEMO_MODE` は本番の `.env` には設定しないこと(設定するとログイン・実データが一切表示されなくなる)。

## 構成

- `App.tsx` — フォント読み込み・認証状態に応じた画面切り替え(オンボーディング/グループ一覧/グループ詳細)。会社の`app/`と同じく、ルーティングライブラリなしのシンプルな画面切り替え
- `src/hooks/useAuth.ts` — 匿名サインイン+表示名(プロフィール)の管理
- `src/hooks/useGroups.ts` — 自分が参加しているグループの一覧・作成・招待コード参加
- `src/hooks/useGroupData.ts` — グループ内のメンバー・記録の取得、追加・精算・削除、リアルタイム同期
- `src/lib/balances.ts` — 相手×通貨ごとの残高計算(Web版プロトタイプと同じロジック)
- `src/screens/` — オンボーディング/グループ一覧/グループ詳細(残高・台帳・記録追加)
- `supabase/schema.sql` — テーブル定義・RLSポリシー・グループ作成/参加用RPC・レシート画像用ストレージ設定

## データの分離について(重要)

- グループの作成・参加はすべて `create_group` / `join_group` というサーバー側関数(RPC)経由で行われ、招待コードを知っている人だけがそのグループに参加できる
- 参加していないグループのデータは、アプリのUIで隠しているのではなく、**データベースのRow Level Securityで物理的に取得できないようになっている**(不正なクライアントから直接APIを叩かれても漏れない)
- レシート画像も非公開ストレージに保存され、そのグループのメンバーだけが署名付きURLで閲覧できる

## 既知の制約(現時点)

- グループ内は「お互いを信頼する前提」で、メンバーなら誰でも他人が記録した内容を編集・削除・精算できる(記録した本人だけに制限する権限管理はまだない)
- プッシュ通知はまだない(誰かが記録しても、アプリを開くまで気づけない)
- 為替換算はしない(通貨が違う残高は合算せず、別々に表示する。設計判断の詳細はWeb版プロトタイプとのやり取りの経緯を参照)

## EASでビルドする

```bash
npm install -g eas-cli
eas login
eas build --platform all --profile preview   # 内部テスト用ビルド
eas build --platform all --profile production
```

## ストア公開までに、まだ人間(オーナー)がやる必要があること

- **Expo/EASアカウント**(無料)— `eas login` してから `eas build` を実行
- **Apple Developer Program**(年額$99)+ **Google Play Console**(買い切り$25)のアカウント作成
- **アプリアイコンの本番差し替え**: `assets/icon.png`等は`scripts/generate_icons.py`で生成したプレースホルダー(コーラル×バイオレットのグラデーションに⇄マーク)。正式なブランドアイコンができたら差し替える
- プライバシーポリシー・利用規約(`docs/legal/`に会社事業用の雛形があるが、kashikari用に内容を書き換える必要がある。特に「匿名認証」「グループ内で他メンバーの表示名・記録が見える」という仕様は明記した方がよい)
- `eas submit`(または手動でのXcode/Android Studioビルド)で実際にストアへ提出
