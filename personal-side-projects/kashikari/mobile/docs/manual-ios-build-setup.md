# EASを使わないiOSビルド(GitHub Actions)のセットアップ手順

EAS(`eas build`)の無料枠を使い切った場合の代替経路。GitHub Actionsの
無料macOSランナー上でXcodeビルド→TestFlight提出まで行う
(`.github/workflows/kashikari-ios-manual-build.yml`、`fastlane/`参照、
100回目)。

**Macは不要**。すべてブラウザ(iPadでも可)とCodespaceのターミナルだけで
完結する。以下を順番に進めてください。

## 1. 証明書の元になる鍵ペアを作る(Codespaceのターミナルで)

```bash
cd personal-side-projects/kashikari/mobile
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr \
  -subj "/emailAddress=<Apple IDのメールアドレス>/CN=<あなたの名前>/C=JP"
```

`ios_distribution.csr`が生成される。中身をターミナルで表示してコピーして
おく(次のステップでアップロードする):

```bash
cat ios_distribution.csr
```

## 2. Apple Developer Portalで配布証明書を作る

1. https://developer.apple.com/account/resources/certificates/list を開く(iPadのSafariでOK)
2. 「+」→ 種類は **Apple Distribution** を選択
3. 「Choose File」で、さっきの`ios_distribution.csr`の中身をファイルとして選ぶ(Codespace上のファイルをダウンロードしてアップロードするか、テキストをコピーして`.csr`拡張子のファイルとして保存してからアップロード)
4. 生成された証明書(`distribution.cer`)をダウンロード

## 3. 証明書を.p12形式に変換する(Codespaceのターミナルで)

ダウンロードした`distribution.cer`をCodespaceにアップロードしてから:

```bash
openssl x509 -in distribution.cer -inform DER -out ios_distribution.pem -outform PEM
openssl pkcs12 -export \
  -inkey ios_distribution.key \
  -in ios_distribution.pem \
  -out ios_distribution.p12 \
  -password pass:<好きなパスワードを決める>
```

このパスワードは後で`IOS_DIST_CERT_PASSWORD`というsecretに使う。

## 4. App Store用のProvisioning Profileを作る

1. https://developer.apple.com/account/resources/profiles/list を開く
2. 「+」→ **App Store Connect** を選択
3. App ID: `com.kashikari.mobile`(EASが既に登録済みのものを選ぶだけでよい)
4. 証明書: ステップ2で作った配布証明書を選ぶ
5. **プロファイル名は必ず `kashikari AppStore Distribution` にする**(`fastlane/Fastfile`がこの名前を参照しているため。違う名前にする場合はGitHub Secretsの`IOS_PROVISIONING_PROFILE_NAME`をその名前に変える)
6. 生成して`.mobileprovision`をダウンロード

## 5. App Store Connect APIキーを作る

1. https://appstoreconnect.apple.com/access/integrations/api を開く
2. 「+」でキーを新規作成、権限は **App Manager**
3. **ダウンロードできるのは1回だけ**なので、`.p8`ファイルを必ず保存する
4. 画面に表示される **Key ID** と **Issuer ID** をメモしておく

## 6. ファイルをbase64化する(Codespaceのターミナルで)

```bash
base64 -i ios_distribution.p12 | tr -d '\n' > p12.b64
base64 -i <ダウンロードした.mobileprovisionファイル> | tr -d '\n' > profile.b64
base64 -i <ダウンロードした.p8ファイル> | tr -d '\n' > key.b64
```

それぞれ`cat p12.b64`のように中身を表示して、次のステップでコピーする。

## 7. GitHubリポジトリにSecretsを登録する

`fuma-ono/my-project`リポジトリの Settings → Secrets and variables →
Actions → New repository secret で、以下を1つずつ登録する:

| Secret名 | 値 |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | `p12.b64`の中身 |
| `IOS_DIST_CERT_PASSWORD` | ステップ3で決めたパスワード |
| `IOS_PROVISIONING_PROFILE_BASE64` | `profile.b64`の中身 |
| `IOS_PROVISIONING_PROFILE_NAME` | `kashikari AppStore Distribution` |
| `ASC_KEY_ID` | ステップ5のKey ID |
| `ASC_ISSUER_ID` | ステップ5のIssuer ID |
| `ASC_KEY_P8_BASE64` | `key.b64`の中身 |
| `IOS_BUILD_KEYCHAIN_PASSWORD` | 何でもよい適当な文字列(CI内で一時的に使うだけ) |
| `APPLE_ID` | Apple IDのメールアドレス |
| `APPLE_TEAM_ID` | `K39989F7L2`(EASのビルドログに表示されていたTeam ID) |
| `ASC_TEAM_ID` | App Store Connect右上などに表示されるチームID(Apple Team IDと同じ場合が多い) |
| `EXPO_PUBLIC_SUPABASE_URL` | `.env`と同じ値 |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env`と同じ値 |
| `EXPO_PUBLIC_LINE_CHANNEL_ID` | `.env`と同じ値 |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | `.env`と同じ値 |
| `EXPO_PUBLIC_ADMOB_BANNER_IOS` | `.env`と同じ値(未設定ならテストIDのままでOK、空でも動く) |
| `EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS` | 同上 |
| `EXPO_PUBLIC_SENTRY_DSN` | 未設定なら空でよい |

(`.env`の値が手元にない場合は、expo.devのダッシュボード → kashikariプロジェクト → Environment Variablesから確認できる)

## 8. ワークフローを実行する

GitHubの`fuma-ono/my-project`リポジトリ → Actions タブ →
「kashikari iOS manual build (no EAS)」を選択 → 「Run workflow」ボタン。

実行には20〜40分程度かかる想定(macOSランナーは通常のLinuxランナーより
遅い)。失敗した場合はログをコピーして共有してもらえれば、一緒に原因を
調べる。

## 使い終わったら

`ios_distribution.key` / `.csr` / `.p12` / `distribution.cer` /
`.mobileprovision` / `.p8` / `*.b64` は、いずれも秘密情報を含むため
**リポジトリにはコミットしない**こと(`.gitignore`で除外を推奨)。
GitHub Secrets登録後は、Codespace上のこれらのファイルは削除してよい。
