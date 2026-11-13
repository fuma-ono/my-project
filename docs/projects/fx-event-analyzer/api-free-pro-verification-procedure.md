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

### 2.2 新しく作る場合(HQ回答 2026-11-13: 専用アカウントを新規に用意する。**作成・SQL実行は、HQの別途承認の後**)

#### 2.2.1 テーブルの構造と依存関係(マイグレーションから確認済み)
- `auth.users`(Supabase の認証): ダッシュボードの Authentication → Users → Add user で作る。SQL では作らない(パスワードのハッシュ処理を Supabase に任せるため)。
- `profiles`(`20260917000002`): `id uuid primary key references auth.users(id) on delete cascade`、`display_name`、`deleted_at`、`created_at`、`updated_at`。**ユーザーを作ると自動で行ができる仕組みは、マイグレーションに無い**(「初回アクセス時に作る」とコードの注記にある)。ただし、先に行を入れておいても害はない。
- `entitlements`(同上): `id`、`user_id references profiles(id) on delete cascade`、`feature_code`、`enabled default false`、`expires_at`、`unique(user_id, feature_code)`。
- `default_entitlements`(`20261016000002`): 全員に既定で付く機能(`VIEW_BASIC_EVENT`・`VIEW_HISTORICAL`・`VIEW_MARKET_REACTION`)。FREE のアカウントには、`entitlements` の行を足さない。
- `subscriptions`: PRO の判定は `entitlements` で行うので、この検証では行を作らない(アプリ内課金の検証用で、API の権限判定には使わない — 未確認の点は下に書く)。
- 削除: `auth.users` を消すと、`profiles` → `entitlements` が `on delete cascade` で連動して消える。

#### 2.2.2 手順(承認の後)
1. 【大野さん・ダッシュボード】DEV プロジェクトであることを確認(2.2.3)。Authentication → Users → Add user → Create new user で2人作る。
   メールは `fx-dev-test-free@example.com`・`fx-dev-test-pro@example.com`(受信しない宛先)。「Auto Confirm User」にチェック。パスワードは、パスワードマネージャーで作った長いランダムなもの(**チャットに貼らない**)。
2. 【大野さん・SQL Editor】下の 2.2.4 の SQL を、DEV で1回流す。**Service Role Key は使わない**(ダッシュボードの SQL Editor は、ログイン中の大野さんの権限で動く)。
3. 検証用の SQL(2.2.6)を流して、結果の件数だけを報告してもらう(メール・ID・パスワードは書かない)。

#### 2.2.3 DEV プロジェクトであることの確認
- ダッシュボードの URL が `https://supabase.com/dashboard/project/pbemckwnqmeaoveelihd/...` であること(DEV の ref)。
- SQL Editor で、最初にこの1行を流し、**期待どおりの結果**が出てから次へ進む(PROD にも `auth.users` はあるので、これだけでは判別できない。ref は URL で確かめる):
  ```sql
  select current_database() as db, (select count(*) from events) as events_count;
  ```
  期待: `events_count` が **276**(2026-11-13 の DEV 反映後の件数。変わっていたら、その時点の DEV の件数をHQに確認してから進める)。
- PROD の件数と見分けるため、PROD の events 件数は書かない(PROD は一切触らない)。

#### 2.2.4 実行予定の SQL 全文(1回の取引。何度流しても同じ結果になる)
```sql
begin;

-- 1. 前提の確認: 2人のユーザーがダッシュボードで作られていること。足りなければ止める。
do $$
declare n int;
begin
  select count(*) into n from auth.users
   where email in ('fx-dev-test-free@example.com', 'fx-dev-test-pro@example.com');
  if n <> 2 then
    raise exception 'テスト用ユーザーが2人そろっていません(found=%)', n;
  end if;
end $$;

-- 2. profiles(すでにあれば何もしない)
insert into profiles (id)
select id from auth.users
 where email in ('fx-dev-test-free@example.com', 'fx-dev-test-pro@example.com')
on conflict (id) do nothing;

-- 3. PRO にだけ有料の権限を足す(FREE には何も足さない)。すでにあれば何もしない(unique(user_id, feature_code))
insert into entitlements (user_id, feature_code, enabled, expires_at)
select id, 'VIEW_ADVANCED_STATS', true, null
  from auth.users
 where email = 'fx-dev-test-pro@example.com'
on conflict (user_id, feature_code) do nothing;

commit;
```
- ID の貼り替えが要らない(メールで引く)ので、貼り間違いが起きない。
- 変更するのは `profiles` 2行と `entitlements` 1行だけ。他のテーブル・既存のユーザーには触れない(where がテスト用のメール2つに限られる)。

#### 2.2.5 二重実行の防止
- `profiles` は `on conflict (id) do nothing`、`entitlements` は `unique (user_id, feature_code)` の `on conflict do nothing`。2回流しても行は増えない。
- 手順 1 の確認で、ユーザーが2人そろっていなければ例外で止まり、何も書かれない(`begin … commit` の中なので、途中で失敗しても元に戻る)。
- 既存の `entitlements` の行は上書きしない(`do nothing`)。もし PRO の行が `enabled=false` で既にあれば、書き換えずに検証の SQL で見つかる(その場合は報告して判断を仰ぐ)。

#### 2.2.6 作成後の検証 SQL(読み取りだけ)
```sql
-- (a) 件数: profiles 2、PRO の権限 1、FREE の個別の権限 0 が期待
select
  (select count(*) from profiles p join auth.users u on u.id = p.id
    where u.email in ('fx-dev-test-free@example.com','fx-dev-test-pro@example.com')) as profiles_rows,
  (select count(*) from entitlements e join auth.users u on u.id = e.user_id
    where u.email = 'fx-dev-test-pro@example.com' and e.feature_code = 'VIEW_ADVANCED_STATS' and e.enabled and e.expires_at is null) as pro_advanced,
  (select count(*) from entitlements e join auth.users u on u.id = e.user_id
    where u.email = 'fx-dev-test-free@example.com') as free_individual_entitlements;
-- 期待: 2 | 1 | 0

-- (b) 既存ユーザーに影響がないこと: テスト用以外の entitlements が増減していない(実行の前後で同じ数)
select count(*) as other_entitlements from entitlements e join auth.users u on u.id = e.user_id
 where u.email not in ('fx-dev-test-free@example.com','fx-dev-test-pro@example.com');

-- (c) 既定の権限が変わっていないこと
select feature_code from default_entitlements order by 1;
-- 期待: VIEW_BASIC_EVENT / VIEW_HISTORICAL / VIEW_MARKET_REACTION
```
- (b) は、**実行の前にも流して数を控える**(前後で同じであることを確かめる)。

#### 2.2.7 ロールバック(元に戻す)
- 権限だけ戻す(ユーザーは残す):
  ```sql
  delete from entitlements
   where feature_code = 'VIEW_ADVANCED_STATS'
     and user_id = (select id from auth.users where email = 'fx-dev-test-pro@example.com');
  ```
- 全部戻す: Authentication → Users から2人を削除する。`profiles`・`entitlements` は連動して消える(`on delete cascade`)。SQL の `delete from auth.users` は使わない。
- どちらも、テスト用のメールに限られる。他のユーザーには影響しない。

#### 2.2.8 コードで確認した点(2026-11-13)
- `src/authorization/` は `subscriptions` を参照しない(権限は `entitlements`・`default_entitlements` だけで決まる)。PRO の判定に `subscriptions` の行は要らない。
- `profiles` は、API へのアクセス時に `ensureProfile`(`src/repositories/profilesRepository.ts`、`upsert … ignoreDuplicates`)で作られる。SQL で先に入れる 2. は必須ではないが、`entitlements` の外部キー(`profiles(id)`)のために、PRO の行を足す前に `profiles` が要る。そのため残す。

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
