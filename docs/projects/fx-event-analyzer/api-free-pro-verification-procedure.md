# FREE/PRO の API 検証の準備手順(DEV)

HQ指示 2026-11-13「FREE/PRO API検証: テストアカウントの準備方法と、GitHub Secrets への安全な登録手順を整理する」。
**この文書は手順の案。承認と、アカウント・Secret の準備が済むまで、検証は実行しない。認証情報は、チャット・ログ・文書に書かない。**

## 1. 目的
DEV の API で、FREE と PRO の応答の違いを、読み取りだけで確かめる(アプリの表示の元になる値)。
- 表示の差(FREE で隠れる/ロックされる項目、PRO だけの項目)
- イベントの詳細(値・単位・対象期間・出典・前回値)
- 出典(`attribution`)の表示
- 値がまだ無い状態の応答(例: 予定だけの GB/AU/CA・JP_CPI のイベント、`DATA_PENDING`)
- 要人発言(`summary_status`・`summary_method`・本文が返らないこと)

## 2. テストアカウント(専用。個人のアカウントは使わない)

| アカウント | 役割 | 権限 |
|---|---|---|
| FREE のテスト用 | 無料プラン | 既定の権限(`default_entitlements`)だけ。個別の `entitlements` の行なし |
| PRO のテスト用 | 有料プラン | FREE と同じ ＋ `VIEW_ADVANCED_STATS`(`entitlements` に行を足す) |

権限は、コードに FREE/PRO と書かず、データ(`entitlements`・`default_entitlements`)で決まる(`src/authorization/entitlements.ts`)。

### 2.1 すでにあるアカウントを使えるか(まず確認)
これまでの確認(2026-10-27 など)で使った FREE/PRO のアカウントがある。**それが検証専用に作ったものかどうか**を、大野さんに確認する。
- 専用なら: そのまま使ってよい(パスワードは変えて、下の Secret に登録する)。
- 個人のアカウントなら: 使わない。下の 2.2 で新しく作る。

### 2.2 新しく作る場合(大野さんが DEV の Supabase の画面で)
1. Supabase の DEV プロジェクト(`pbemckwnqmeaoveelihd`)→ Authentication → Users → Add user → Create new user
2. メールは、受信できない専用の宛先にする(例: `fx-dev-test-free@example.com`、`fx-dev-test-pro@example.com`)。「Auto Confirm User」にチェック。
3. パスワードは、パスワードマネージャーなどで長いランダムなものを作る(**チャットには貼らない**)。
4. 作ったユーザーの `id`(UUID)を控える(これは機密ではない)。
5. 下の SQL を、DEV の SQL Editor で流す。**書き込みなので、HQ の承認の後。** `<FREE_ID>`・`<PRO_ID>` を差し替える。
   ```sql
   -- profiles の行は自動では作られない(テストの共通部品と同じ)
   insert into profiles (id) values ('<FREE_ID>'), ('<PRO_ID>') on conflict (id) do nothing;
   -- PRO だけ、有料の権限を足す(FREE には何も足さない)
   insert into entitlements (user_id, feature_code, enabled, expires_at)
   values ('<PRO_ID>', 'VIEW_ADVANCED_STATS', true, null);
   ```
6. 確認(読み取りだけ):
   ```sql
   select user_id, feature_code, enabled from entitlements where user_id in ('<FREE_ID>', '<PRO_ID>');
   ```
   期待: PRO の1行だけ。
- 不要になったら、Authentication の画面でユーザーを削除する(`profiles`・`entitlements` は連動して消える)。

## 3. GitHub Secrets への登録(大野さんが画面で。チャットに値を貼らない)

GitHub → このリポジトリ → Settings → Secrets and variables → Actions → New repository secret

| Secret 名 | 値 |
|---|---|
| `FX_DEV_TEST_FREE_EMAIL` | FREE のテスト用アカウントのメール |
| `FX_DEV_TEST_FREE_PASSWORD` | 同じアカウントのパスワード |
| `FX_DEV_TEST_PRO_EMAIL` | PRO のテスト用アカウントのメール |
| `FX_DEV_TEST_PRO_PASSWORD` | 同じアカウントのパスワード |
| `FX_DEV_SUPABASE_ANON_KEY` | DEV プロジェクトの anon(公開)キー。Supabase の Project Settings → API |

- **既存の `FX_SUPABASE_ANON_KEY`・`FX_SUPABASE_URL`・`FX_API_BASE_URL` は使わない。** これらは iOS のビルド用で、どのプロジェクト(DEV か PROD か)を指しているか確認できていないため。DEV 専用の名前で新しく登録する。
- DEV の URL(`https://pbemckwnqmeaoveelihd.supabase.co`)と API(`https://fx-event-analyzer-api-dev.onrender.com/api/v1`)は公開の値なので、ワークフローに書く。
- `service_role` の鍵は、この検証では使わない。

## 4. 検証のしくみ(案。承認の後に実装して実行)
- ワークフロー: ブランチ `verify/fx-api-free-pro` への push と手動だけで動く、読み取り専用のもの(定期実行なし)。
- 認証: Supabase の `POST /auth/v1/token?grant_type=password` でトークンを取り、**`::add-mask::` でメール・パスワード・トークンをログから伏せる**。トークンはメモリ上だけで、ファイルにもログにも出さない。
- 通信は、ログイン(POST)と **GET だけ**。それ以外の HTTP の動詞は、コードの許可リストで禁止し、テストで確かめる。
- DEV 以外には接続しない(URL を固定し、トークンの `ref` が DEV であることも確かめる)。
- 出力: HTTP の状態コード、選んだ項目の値、FREE と PRO の差分だけ。応答の本文全体は出さない。個人の情報(メール・ID)も出さない。

### 比べる内容

| 対象 | FREE と PRO で比べるもの |
|---|---|
| `GET /entitlements` | 機能の一覧(PRO だけ `VIEW_ADVANCED_STATS` があるか) |
| `GET /indicators`・詳細 | GB/AU/CA・JP_CPI の指標が出るか、表示名・出典(`attribution`)、通貨ペア |
| `GET /calendar` | GB/AU/CA・JP_CPI のイベント(予定だけ・値なし)が出るか、期間の制限(FREE の1か月など) |
| `GET /events/{id}` | 値がない状態の応答(`DATA_PENDING`)、ロックされた項目、前回値・予想値の扱い |
| `GET /speeches`・詳細 | `summary_status`・`summary_method`・`source_url`・`body_status`。**本文(`speech_body`)と内部の理由が返らないこと** |
| 共通 | FREE の過去の発表の制限(ロック)、PRO で出る項目、`attribution` の有無 |

値が入った後(各公表の後)は、同じ検証で、値・単位・対象期間・初回値/改定の区別・前回値/予想値が混ざらないことも比べる。

## 5. 進め方(止める所)
1. 【ここまでが今回】手順の提示。
2. 大野さんが、2.1 を判断し、アカウントを準備し(2.2)、Secret を登録する(3)。**登録の前に、私から認証情報を要求しない。**
3. HQ の承認の後、検証のワークフローを実装し、CI を通し、DEV で実行して比べる。
4. 結果を報告する。不要になったら、Secret とアカウントを削除する。
