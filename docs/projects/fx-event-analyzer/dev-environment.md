# 社内確認用(実機テスト用)の環境

作成: 2026-10-16(HQ指示「会社のPCにはキーを残さず、クラウドやGit上で」)

本番データを入れて実機で確かめるための環境。一般向けの本番環境ではない。
**Twelve Data の無料キーで取った為替データは社内確認だけに使う**(個人向けプランは商用の表示・再配布不可、要件定義書6.4節)。一般公開の前に、表示が認められたプランに切り替える。

## 1. 全体

| 役割 | 置き場所 | 状態(2026-10-16) |
|---|---|---|
| データベース | Supabase プロジェクト `fx-event-analyzer-dev`(Tokyo) | 作成済み・マイグレーション適用済み |
| データの取り込み | GitHub Actions(20分ごと・1日2回) | 未設定(3章) |
| API サーバー | Render `fx-event-analyzer-api-dev`(リポジトリ直下の `render.yaml`) | 未作成(4章) |
| iOS アプリ | Mac で `API_BASE_URL` などを指定してビルド(5章) | 未 |

**キーはどこにも書かない。** 入れてよい場所は、Supabase・Render・GitHub の各画面の「秘密の値」の欄だけ。リポジトリ(公開)・チャット・会社のPCには残さない。

| キー | 入れる場所 |
|---|---|
| Supabase の URL / service_role の鍵 | GitHub Secrets(`FX_DEV_SUPABASE_URL` / `FX_DEV_SUPABASE_SERVICE_ROLE_KEY`)、Render の Environment |
| Twelve Data のキー | GitHub Secrets(`FX_TWELVE_DATA_API_KEY`) |
| Supabase の anon(publishable)の鍵 | iOS のビルド設定 `SUPABASE_ANON_KEY`(アプリに入れてよい公開用の鍵。service_role は絶対に入れない) |

## 2. データベース(Supabase)

- 新しく作るときは、`fx-event-analyzer-backend/supabase/migrations/` を名前順にすべて流し、`supabase/seed.sql` は **1〜107行目(指標・通貨ペア・指標×通貨ペア)だけ**流す。108行目以降はテスト用の架空のイベント・値動きなので、本物のデータと混ぜない
- 要人のマスタは migration `20261016000001_master_speakers.sql` が入れる
- 作成時の設定: Data API あり、Automatically expose new tables あり(マイグレーションが前提にしている)、automatic RLS あり

## 3. データの取り込み(GitHub Actions)

スケジュール実行はデフォルトブランチ(`main`)のワークフローでしか動かないため、下のファイルを `main` の `.github/workflows/fx-event-analyzer-ingestion.yml` として追加する(自動で動き続ける設定なので、追加は大野さんが判断して行う)。その後、GitHub の Settings → Secrets and variables → Actions に1章の3つを登録する。未登録のうちは何もせず成功で終わる。

```yaml
name: FX Event Analyzer - Data ingestion (dev)

# 社内確認用DB へ本番データを取り込む(docs/projects/fx-event-analyzer/dev-environment.md)。
#   - 為替: 20分ごと。Twelve Data の1分足 → fx_prices(5分〜60分足も組み立て)
#   - 要人発言: 1日2回(06:15 / 18:15 JST)。FRB カレンダー・ECB RSS → speech_events
# Twelve Data の無料キーは社内確認専用(要件定義書6.4)。
on:
  schedule:
    - cron: '7,27,47 * * * *'
    - cron: '15 21,9 * * *'
  workflow_dispatch:
    inputs:
      target:
        description: 'fx-prices / speeches / both'
        default: both

permissions:
  contents: read

concurrency:
  group: fx-ingestion
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: fx-event-analyzer-backend
    env:
      SUPABASE_URL: ${{ secrets.FX_DEV_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.FX_DEV_SUPABASE_SERVICE_ROLE_KEY }}
      TWELVE_DATA_API_KEY: ${{ secrets.FX_TWELVE_DATA_API_KEY }}
    steps:
      - name: Check secrets
        id: check
        working-directory: .
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
            echo "Secrets が未登録のため何もしません"
            echo "ready=false" >> "$GITHUB_OUTPUT"
          else
            echo "ready=true" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/checkout@v4
        if: steps.check.outputs.ready == 'true'
        with:
          ref: claude/fx-settings-screens
      - uses: actions/setup-node@v4
        if: steps.check.outputs.ready == 'true'
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: fx-event-analyzer-backend/package-lock.json
      - run: npm ci --no-audit --no-fund
        if: steps.check.outputs.ready == 'true'
      - name: FX prices
        if: steps.check.outputs.ready == 'true' && (github.event.schedule == '7,27,47 * * * *' || (github.event_name == 'workflow_dispatch' && inputs.target != 'speeches'))
        run: npm run -s ingest:fx-prices
      - name: Speeches
        if: steps.check.outputs.ready == 'true' && (github.event.schedule == '15 21,9 * * *' || (github.event_name == 'workflow_dispatch' && inputs.target != 'fx-prices'))
        run: npm run -s ingest:speeches
```

- 回数: 為替は1回9リクエスト × 1日72回 = 648回(Twelve Data 無料枠は1日800回・1分8回)
- リポジトリが公開なので実行ログも公開される。キーは GitHub が伏せ字にし、取り込み側も URL のキーを伏せる(`redactUrl`)。ログに出るのは件数と時刻だけ
- GitHub のスケジュールは混雑時に数分〜十数分遅れることがある。取り込みは直近120分を毎回取り直すので、遅れても欠けない

## 4. API サーバー(Render)

1. render.com に GitHub アカウントでログインし、New → Blueprint → このリポジトリを選ぶ(`render.yaml` を読む)
2. 画面で `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を入れて作成する
3. 作成後に出る `https://<名前>.onrender.com` を `PUBLIC_BASE_URL` に入れる(要人の写真の URL を https にするため)
4. `https://<名前>.onrender.com/health` が `{"status":"ok"}` を返せば完了。アプリが使うのは `https://<名前>.onrender.com/api/v1`

- 無料プランは15分アクセスが無いと眠る。起きるまで最初の1回は30〜60秒かかる(実機確認では、アプリを開く前に `/health` を一度開いておくとよい)
- `claude/fx-settings-screens` に push すると自動で入れ替わる

## 5. iOS アプリ(Mac)

`xcodebuild` の末尾、または Xcode の Build Settings で3つを指定する(project.yml の `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `API_BASE_URL`)。

```sh
xcodebuild ... SUPABASE_URL="https://<project>.supabase.co" SUPABASE_ANON_KEY="<anon / publishable の鍵>" API_BASE_URL="https://<名前>.onrender.com/api/v1"
```

- ログインは Supabase Auth。実機で新しくアカウントを作れば、無料プランの機能(基本3つ)が使える(`default_entitlements`、db-design.md)
- 2026-10-16 に確認用のアカウント `dev-check@fx-event-analyzer.invalid` を作った(パスワードは控えていない。不要なら Supabase の Authentication から消す)

## 6. 変更案: データ品質レポートを毎日動かす(2026-10-16、HQ判断を受けて。**main に入れる前に確認する**)

HQ判断「実装前に、main に追加する変更内容と実行スケジュール等を確認する」に沿い、入れる前にこの案を確認してもらう。確認が取れたら、3章のファイルをこの内容に置き換えて main に入れる。

### 6.1 変える点

| 項目 | いま | 変更後 |
|---|---|---|
| 実行するもの | 為替(20分ごと)・要人発言(1日2回) | ＋ **データ品質レポート(毎日 09:00 JST、直近1日分)** |
| 接続先の確認 | Secrets が無ければ何もしない | ＋ **接続先が社内確認用のDB(`pbemckwnqmeaoveelihd`)でなければ、何も書かずに失敗で止まる**(本番DBに書き込まないため) |
| 手動実行 | fx-prices / speeches / both | ＋ report(レポートだけ。DBは読むだけ) |

### 6.2 HQ の確認項目への答え

| 確認項目 | 答え |
|---|---|
| main に追加する内容とスケジュール | 6.3 のファイル1つ(`.github/workflows/fx-event-analyzer-ingestion.yml` の置き換え)。為替: 毎時7分・27分・47分、要人発言: 06:15・18:15 JST、レポート: 09:00 JST |
| 社内確認用と本番の区別 | Secrets の名前を `FX_DEV_*` にし、さらにジョブの最初に、接続先の URL と service_role の鍵(JWT)に書かれたプロジェクト番号の両方が社内確認用のプロジェクトと一致するかを確かめる。違えば何も書かずに失敗で止まる。本番用の環境はまだ無い。作るときは別の Secrets・別のワークフローにし、このワークフローからは書き込めないようにする |
| 取得件数・欠損・重複・照合不一致・失敗理由の記録 | 取得件数・飛ばした理由・照合で「未確認」になった件数・エラーの文面は、実行のたびに `ingestion_logs` に残る。欠損・照合一致率・実行の抜けはレポート(data-sources.md 12章)で毎日まとめる。重複は DB の一意制約(通貨ペア・時間足・時刻、発言のID)で入らない仕組みで、同じデータを取り直すと上書きになる |
| 秘密情報がログに出ないこと | キーは Secrets から渡し、GitHub が伏せ字にする。取り込み側も URL に含まれるキーを伏せる(`redactUrl`)。レポートに出るのは件数・割合・時刻だけ(テストで URL・キーが含まれないことを確認) |
| 失敗時の通知と再実行 | 取り込みが失敗するとジョブが失敗になり、GitHub がワークフローを最後に変更した人(大野さんのアカウント)にメールで知らせる。再実行は Actions の画面の「Re-run jobs」か「Run workflow」。取り込みは直近120分を毎回取り直すので、再実行で同じデータが二重に入ることはない |
| 不要な API 利用料・実行時間 | 公開リポジトリなので GitHub Actions の実行時間は無料。Twelve Data は無料枠の範囲(1日648回 / 800回)で、有料の API は使わない。レポートは DB を読むだけで、外部の API を呼ばない。1回の実行は1〜2分 |

### 6.3 変更後のファイル

```yaml
name: FX Event Analyzer - Data ingestion (dev)

# 社内確認用DB へ本番データを取り込み、品質レポートを作る(docs/projects/fx-event-analyzer/dev-environment.md)。
#   - 為替: 20分ごと。Twelve Data の1分足 → fx_prices(5分〜60分足も組み立て)
#   - 要人発言: 1日2回(06:15 / 18:15 JST)。FRB カレンダー・ECB RSS → speech_events
#   - 品質レポート: 毎日 09:00 JST、直近1日分。DB を読むだけ。結果は実行の Summary に出る
# 接続先が社内確認用のDBでなければ止まる(本番DBに書き込まない)。
# Twelve Data の無料キーは社内確認専用(要件定義書6.4)。
on:
  schedule:
    - cron: '7,27,47 * * * *'
    - cron: '15 21,9 * * *'
    - cron: '0 0 * * *'
  workflow_dispatch:
    inputs:
      target:
        description: 'fx-prices / speeches / both / report'
        default: both

permissions:
  contents: read

concurrency:
  group: fx-ingestion
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: fx-event-analyzer-backend
    env:
      DEV_PROJECT_REF: pbemckwnqmeaoveelihd
      DEV_PROJECT_URL: https://pbemckwnqmeaoveelihd.supabase.co
      SUPABASE_URL: ${{ secrets.FX_DEV_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.FX_DEV_SUPABASE_SERVICE_ROLE_KEY }}
      TWELVE_DATA_API_KEY: ${{ secrets.FX_TWELVE_DATA_API_KEY }}
    steps:
      - name: Check secrets and target
        id: check
        working-directory: .
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
            echo "Secrets が未登録のため何もしません"
            echo "ready=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          if [ "${SUPABASE_URL%/}" != "$DEV_PROJECT_URL" ]; then
            echo "接続先が社内確認用のDBではありません。書き込まずに止めます"
            exit 1
          fi
          # 鍵の中身(JWT)に書かれたプロジェクトも社内確認用か確かめる。鍵そのものは出力しない。
          KEY_REF=$(python3 -c 'import os,base64,json; p=os.environ["SUPABASE_SERVICE_ROLE_KEY"].split("."); print(json.loads(base64.urlsafe_b64decode(p[1]+"="*(-len(p[1])%4))).get("ref","") if len(p)==3 else "")' 2>/dev/null || true)
          if [ "$KEY_REF" != "$DEV_PROJECT_REF" ]; then
            echo "鍵が社内確認用のプロジェクトのものではありません(または形式が違います)。書き込まずに止めます"
            exit 1
          fi
          echo "ready=true" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v4
        if: steps.check.outputs.ready == 'true'
        with:
          ref: claude/fx-settings-screens
      - uses: actions/setup-node@v4
        if: steps.check.outputs.ready == 'true'
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: fx-event-analyzer-backend/package-lock.json
      - run: npm ci --no-audit --no-fund
        if: steps.check.outputs.ready == 'true'
      - name: FX prices
        if: steps.check.outputs.ready == 'true' && (github.event.schedule == '7,27,47 * * * *' || (github.event_name == 'workflow_dispatch' && (inputs.target == 'fx-prices' || inputs.target == 'both')))
        run: npm run -s ingest:fx-prices
      - name: Speeches
        if: steps.check.outputs.ready == 'true' && (github.event.schedule == '15 21,9 * * *' || (github.event_name == 'workflow_dispatch' && (inputs.target == 'speeches' || inputs.target == 'both')))
        run: npm run -s ingest:speeches
      - name: Data quality report
        if: steps.check.outputs.ready == 'true' && (github.event.schedule == '0 0 * * *' || (github.event_name == 'workflow_dispatch' && inputs.target == 'report'))
        run: npm run -s report:data-quality -- --days 1
```

## 7. 手動実行(「Run workflow」)の前の確認(HQ判断 2026-10-16)

社内確認用のDBを対象に実行する。実行前に次を確かめる。

| 確認すること | いまの状態 |
|---|---|
| 対象ブランチ | ワークフローは main のファイルで動き、コードは `claude/fx-settings-screens` を取り出す(画面の「Use workflow from」は main のままでよい) |
| 接続先のDB | Secrets `FX_DEV_SUPABASE_URL` = 社内確認用のプロジェクト。6章の変更後は、違う接続先なら止まる |
| 取得対象 | target で選ぶ。fx-prices = 9ペアの直近120分、speeches = FRB・ECB の直近14日、report = 読むだけ |
| 重複登録の防止 | DB の一意制約で同じデータは上書きになる。何回実行しても件数は増えない |
| 費用 | GitHub Actions は無料(公開リポジトリ)。Twelve Data は無料枠を1回あたり9回使う(1日800回まで)。有料の API は使わない |
| 本番への書き込み | 本番環境はまだ無い。本番に書き込む可能性があるときは、実行前に HQ へ報告する |

## 8. クレジット台帳の適用(2026-10-16、HQ判断「開発DBへの適用前に確認」)

`supabase/migrations/20261016000003_api_credit_ledger.sql` を社内確認用DBに適用する。新しい表2つと関数2つを足すだけで、既存の表は変えない。2回実行しても何も変わらない書き方。**本番DBには適用しない。**

1. Supabase の画面の左上が `fx-event-analyzer-dev`、URL に `pbemckwnqmeaoveelihd` が含まれることを確かめる
2. SQL Editor の新しいタブにファイルの中身を貼って実行する
3. 新しいタブで次を実行して確かめる(読むだけ)

```sql
select provider, daily_total_cap, automatic_cap from api_credit_limits;
select relname, relrowsecurity from pg_class where relname in ('api_credit_limits', 'api_credit_usage');
select r.rolname,
       has_function_privilege(r.rolname, 'reserve_api_credits(text,text,text,integer,text)', 'execute') as can_reserve
from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
```

期待: `twelvedata | 800 | 700` / どちらも `true` / `anon`・`authenticated` は `false`、`service_role` は `true`。

適用するまでは、取り込みが台帳に予約できないため Twelve Data を呼ばずに止まる。

### 8.0 権限者向け実行手順(2026-10-17、HQ指示「権限者が実行できる手順を整理する」。SQL本文は§8から変更していない)

この3本の確認SQL(§8のコードブロック)は内容を変更していない。権限者(大野さん、または開発用Supabaseの鍵を持つ担当者)が実行する際の手順を以下に整理する。

1. Supabaseダッシュボードを開き、左上の表示が `fx-event-analyzer-dev`、URLに `pbemckwnqmeaoveelihd` が含まれることを確認する(**別の(本番)プロジェクトを開いていないことを必ず確認してから進める**)。
2. 左メニューの SQL Editor を開き、新しいタブを作る。
3. §8のコードブロック(`select provider, daily_total_cap, automatic_cap from api_credit_limits;` から始まる3行)をそのまま貼り付けて実行する。SQLの文言は変更しない。
4. 返ってきた3つの結果(`api_credit_limits`の行、`relrowsecurity`の2行、`has_function_privilege`の3行)を、画面のコピー等でそのまま記録する。
5. 記録した実際の値を、下記8.1の表の「直接SQLの結果」列に転記してHQへ報告する(期待値と一致するか、しない場合は実際の値)。
6. **接続文字列・APIキー・サービスロールキーなど認証情報そのものは、この報告・リポジトリ・チャットのどこにも含めない。** 貼り付けるのはSQLの「結果」(件数・true/false・文字列)のみ。
7. 実行後、このSQLは読み取り専用(`select`のみ)であり、データの変更・書き込みは発生しない。

### 8.1 確認SQLの実行状況(2026-10-16、HQ判断「直接実行は未完了として記録」)

**この3本の確認SQLは、Claude(セッション)側からは未実行(直接実行は未完了)。** セッション側のサンドボックスには開発DBの認証情報が無く、SQL Editor にアクセスできる人(大野さん、または鍵を持つ担当者)が実行する必要がある。

以下は、Claude が代わりに実施した**間接的な確認**(実際のジョブ実行のログから読み取れること)。直接SQLの結果とは区別して記録する。

| # | 確認項目 | 期待値 | 直接SQLの結果 | 間接確認(ジョブ実行ログより) |
|---|---|---|---|---|
| 1 | `api_credit_limits` の上限値 | `twelvedata \| 800 \| 700` | **未実施** | 一致する動き: AUTOMATIC実行で `budget.daily=700`、MANUAL実行で `budget.daily=800` をそれぞれ観測(2026-10-16 run #38897668088・#38898413039) |
| 2 | 両テーブルの RLS (`relrowsecurity`) | どちらも `true` | **未実施** | 直接は未確認。RLS が無効でも `revoke all` 済みなら `service_role` 以外は読めないはずだが、これは RLS とは別の確認軸であり代替にはならない |
| 3 | `reserve_api_credits` の実行権限 | `anon=false`・`authenticated=false`・`service_role=true` | **未実施** | `service_role` からの呼び出しは2回とも成功(エラー無し)。`anon`/`authenticated` からの呼び出しは試していない(そもそも試す経路が無い) |

## 9. 実機で確認できる品質レポート(2026-10-17、HQ判断「実機テスト配布の必須条件」)

`npm run report:data-quality` と同じ READ-ONLY の集計を、スマホのブラウザから見られるようにした(`GET /api/v1/quality-report`、`src/routes/qualityReport.ts`)。既存のiOSアプリの画面・仕様は変えていない(別のURLを直接開くだけ)。追加のインフラ・費用は無し(既存のRenderサービス上の1エンドポイント)。

- 既定では無効(`INTERNAL_REPORT_TOKEN` が未設定なら常に404)。Renderの環境変数に `INTERNAL_REPORT_TOKEN` を設定すると有効になる(値は会社のPC・チャットには置かない。他の秘密情報と同じ扱い)
- 開き方: `https://<名前>.onrender.com/api/v1/quality-report?token=<設定した値>`(`&days=14` で期間変更、`&pairs=USDJPY,EURUSD` で通貨ペア指定。既定は直近7日・全ペア)
- 内容は`npm run report:data-quality`のMarkdownと同じ(§2に「個別の異常値・差異の一覧」を追加済み: 通貨ペア・対象日時・差(pips)・参照元・理由を表で確認できる)
- 実機テストに参加する知り合いに見せるためのものではない。大野さん・HQがテスト期間中に品質を確認するためのもの

**この表の「間接確認」列は、権限・上限が機能していることの状況証拠であり、SQLを直接実行して値を読んだことの代わりにはならない。** 項目2(RLS自体のフラグ)は間接確認の手段が無く、現時点で完全に未確認。

**担当者向け手順**(上記3本のSQLを実行できる方へ):

1. 本セクション冒頭の3本のSQLを、社内確認用DB(`fx-event-analyzer-dev`、`pbemckwnqmeaoveelihd`)の SQL Editor で実行する
2. 結果を上の表の「直接SQLの結果」列に追記する(このファイルを編集してコミット、または報告コメントで値を伝える)
3. 期待値と食い違う行があれば、特に以下を優先して Claude / HQ に伝える:
   - 上限値が `800`・`700` のいずれかと違う → `api_credit_limits` への insert が重複挿入や誤った値で入っていないか確認
   - RLS が `false` → `alter table ... enable row level security` が流れていない可能性。再実行して良い(べき等)
   - `service_role` の `can_reserve` が `false` → `grant execute ... to service_role` が流れていない。再実行して良い(べき等)

## 10. 経済指標の価格反応(event_price_reactions)のDEV検証手順(2026-10-18、HQ決定「開発DBでの実データ検証」)

**この節の作業は権限者(大野さん、または開発用Supabaseの鍵・GitHub Actions手動実行権限を
持つ担当者)が行う。このセッションには開発DBの認証情報が無く、Claude自身は実行できない。**
ジョブが成功しただけで正確性を保証しない(HQ指示)ため、各項目で手計算・独立した検算との
比較を行うこと。

### 10.0 手動実行前の確認(2026-10-18、HQ指示「手動実行前の確認」への回答)

* `main`の現在のHEADは`commit df15527d`(2026-10-18確認)。これが本節の前提。
* `target`は**ドロップダウンの選択式ではなく自由入力欄**(`workflow_dispatch.inputs.target`に
  `type: choice`を指定していない、既存の`fx-prices`/`speeches`/`both`/`report`/`official-bls`と
  同じ形式)。「選択できる」は正確には「入力欄に`event-reactions`と入力できる」という意味
  (2026-10-18、`main`のYAMLを直接確認)。
* 実行順序: `main`のワークフロー内で「FX prices」ステップの直後に「Event reactions」ステップを
  配置した(価格データ取得後に実行される順序。いずれも`target`の値で排他的に実行される
  ため、1回の手動実行では両方同時には走らない。価格データが既に存在する状態で
  `event-reactions`を単独実行することを想定している — 為替の定期取り込みは20分ごとに
  別途動いているため、手動実行時点で通常は既にfx_pricesにデータがある)。
* APIクレジット消費: **0**(このジョブは外部APIを一切呼ばない。Twelve Data/BLS等への
  問い合わせは無い)。
* DB書き込みの範囲: **`event_price_reactions`テーブルへのupsertのみ**(+実行記録として
  既存の`ingestion_logs`への1行追加、他のジョブと同じ仕組み)。読み取りは`economic_events`・
  `fx_pairs`・`fx_prices`(いずれも既存テーブル、読み取りのみ)。他のテーブル(`event_snapshots`、
  `speech_events`、`api_credit_usage`等)への書き込みは無い。
* 既存のRLS・認証・利用上限設定への変更: **無し**。このジョブはservice_role(既存の
  `SUPABASE_SERVICE_ROLE_KEY`、新しいsecretは追加していない)で動き、RLSポリシー・
  `api_credit_limits`・認証ロジックのいずれも変更していない(マイグレーション追加も無し)。

### 10.1 実行手順

1. GitHub の Actions タブで `FX Event Analyzer - Data ingestion (dev)` を開く
2. 「Run workflow」→ ブランチ `claude/fx-settings-screens` → `target`欄に`event-reactions`と
   入力して実行する(`main`のワークフロー定義自体は`commit df15527d`で追加済みだが、
   **実行自体はまだ行っていない** — まだ「実行済み」とは報告しない)
3. 実行ログ(JSON1行)の `fetched`・`success`・`skipped` を確認する。`errors` が空であることを確認する

### 10.2 検証項目(手計算・独立した検算と比較すること)

| # | 確認項目 | 確認方法 |
|---|---|---|
| 1 | イベントと価格足の対応 | `select id, release_datetime, release_datetime_precision, status from economic_events where status='RELEASED' order by release_datetime desc limit 5;` で直近のRELEASEDイベントを1件選び、その`release_datetime`の前後のfx_prices(1分足、対象ペア)を`select timestamp, close from fx_prices where fx_pair_id='<対象ペアのid>' and timeframe='1m' and timestamp between '<release_datetime - 15分>' and '<release_datetime + 61分>' order by timestamp;`で取得し、目で見て「発表直前の足」「各時間枠の終了時刻の足」が正しく対応しているか確認する |
| 2 | 1分・5分・15分のpips計算 | `select timeframe, pre_release_price, post_release_price, movement, pips from event_price_reactions where event_id='<上記のevent_id>' order by timeframe;` の値を、項目1で取得したfx_pricesのclose値から**自分で** `(post_release_price - pre_release_price) / pip_size`(USDJPY等JPY絡みは0.01、それ以外は0.0001)を計算し、保存されているpips(小数点2桁)と一致するか確認する |
| 3 | 欠損・未到着データの扱い | `select * from event_price_reactions where event_id='<対象>' and data_status='UNAVAILABLE';` が有れば、対応する時間枠の締切(release_datetime + 時間枠の分)が既に過去であること、かつ対応する1分足がfx_pricesに実際に無い(欠けている)ことを確認する。締切がまだ来ていない時間枠の行が**存在しないこと**(PENDING行を明示的に書かない設計のため)も確認する |
| 4 | 後続実行による再計算 | 項目3でUNAVAILABLEだった時間枠について、欠けていた1分足が`ingest:fx-prices`の後続実行で補填された後に`ingest:event-reactions`を再実行し、同じ行が`AVAILABLE`に更新される(行が増えない)ことを確認する |
| 5 | upsertによる重複防止 | `select event_id, fx_pair_id, timeframe, count(*) from event_price_reactions group by 1,2,3 having count(*) > 1;` が**0件**であることを確認する(`ingest:event-reactions`を複数回実行した後に確認するとより確実) |
| 6 | 要人発言側の既存機能への影響 | `GET /speeches/{id}`(既存のAPI)が、このジョブの実行前後で同じ結果を返すことを確認する(このジョブはevent_price_reactionsのみに書き込み、speech_eventsやその場計算ロジックには触れていないため、変化しないはずである) |

### 10.3 まだ確認できていないこと

- 1分足そのもの(Twelve Data由来)の正確性は、本検証の対象外(別途、外部の独立照合が未実装のまま。既報)。本検証は「正しい1分足が入っていれば、正しい時間反応に変換されるか」のみを確認する。
- 実機(iOS)での画面表示は本検証の対象外(§9のブラウザ版品質レポートか、直接SQLでの確認に限る)。

### 10.4 初回DEV実行結果の調査(2026-10-19、HQ指示「event-reactions初回DEV実行結果の調査」)

権限者による初回手動実行(2026-10-19T01:05:52Z)の結果: `fetched:1, success:1`、1イベント×5ペア×5時間枠=25件、**全件UNAVAILABLE(available:0)**。

**このセッションには開発DBの認証情報が無く、DBへの接続・確認は行っていない。** 以下は
コード・既存の設定ファイル(`blsSchedule.ts`、ワークフローの作成日時)からの推定であり、
DB上の実際の値による確認はまだ取れていない(§10.4.3のクエリで権限者に確認を依頼する)。

#### 10.4.1 対象イベントの推定(§調査指示1)

`pairs: 5`は、アクティブな9通貨ペアのうちUSDを含む5ペア(USDJPY・EURUSD・GBPUSD・AUDUSD・USDCHF)
と一致する数であり、対象イベントの`currency_code`は**USD**と推定される。現状USDの
`economic_events`を作れる経路はBLS独立経路(`ingest:official:bls-calendar`、US_CPI・US_NFPのみ、
有料カレンダーは未契約)のみのため、対象はこのいずれかと推定される。

`mappings/blsSchedule.ts`の表と実行時刻(2026-10-19、7日horizon→2026-10-12以降が対象)を
照合すると:
- US_CPI(対象期間2026-09)の発表日は**2026-10-14**(horizon内)
- US_NFP(対象期間2026-09)の発表日は2026-10-02(horizon外、7日より前)
- 次のUS_NFP(2026-10対象)は2026-11-06(未来、まだRELEASEDにならない)

これらから、対象イベントは**US_CPI(対象期間2026-09、発表日2026-10-14、08:30
America/New_York = 12:30 UTC、EDT期間のため)である可能性が高い**と推定する。

`25件`(5ペア×5時間枠、除外された時間枠が無い)という件数は、`release_datetime_precision`が
**EXACT**であることとも整合する(APPROXIMATEなら1m除外で20件、DATE_ONLY/UNKNOWNなら
1m・5m除外で15件になるはず)。

**確認用クエリ**(権限者向け、読み取りのみ):
```sql
select e.id, e.release_datetime, e.release_datetime_precision, e.status, i.code
from economic_events e
join economic_indicators i on i.id = e.indicator_id
where e.id = 'b7a6a88f-131c-4005-9a9a-255a2f223e04';
```

#### 10.4.2 5通貨ペアの1分足データの有無(§調査指示2)

**推定(DB未確認)**: 存在しない可能性が高い。根拠は、為替1分足の定期取り込み
(`ingest:fx-prices`、20分ごと)を実行するGitHub Actionsワークフロー
(`fx-event-analyzer-ingestion.yml`)が**作成されたのは2026-10-16**であり、推定される
発表日時(2026-10-14 12:30 UTC)はそれより**2日前**である。db-design.md
の方針(「イベント周辺の時間窓を中心に保持する」、過去への遡及的バックフィルは
行わない)から、ワークフロー開始前の時刻の1分足は最初から存在しないはずである。

**確認用クエリ**(権限者向け、読み取りのみ):
```sql
select fp.symbol,
       (select min(timestamp) from fx_prices p where p.fx_pair_id = fp.id and p.timeframe = '1m') as first_candle,
       (select count(*) from fx_prices p where p.fx_pair_id = fp.id and p.timeframe = '1m'
          and p.timestamp between '2026-10-14T12:15:00Z' and '2026-10-14T13:31:00Z') as candles_near_release
from fx_pairs fp
where fp.symbol in ('USDJPY','EURUSD','GBPUSD','AUDUSD','USDCHF');
```
期待(推定どおりなら): `first_candle`が2026-10-16以降、`candles_near_release`が0。

#### 10.4.3 25件すべてがUNAVAILABLEになった理由(§調査指示3・4)

`src/domain/economicEventReactions.ts`の`computeEventPairReactionRows`を確認した結果:
`pre_release_price`は(event, pair)ごとに1回だけ計算され、全ての時間枠の行で共有される
(db-design.md §3.12「全timeframe行で共通値」どおりの実装)。**この`pre_release_price`が
null(発表直前の1分足が1本も無い)の場合、その(event, pair)の5時間枠すべてが
UNAVAILABLEになる**(`tests/domain/economicEventReactions.test.ts`「no pre-release
candle at all → every timeframe UNAVAILABLE with pre_release_price null too」で既にこの
挙動を確認済み)。

したがって、**コード側の挙動は仕様どおりであり、バグではない**。25件全てがUNAVAILABLEに
なった根本原因は、**5ペア全てについて発表前後の1分足データがDB上に存在しなかったこと**
(§10.4.2の推定どおりであれば、価格データの取得元(Twelve Data)がまだこの日時のデータを
持っていなかったため)と考えられる。

#### 10.4.4 時間枠ごとの分類(§調査指示4)

| 分類 | 該当件数 | 判定根拠 |
|---|---|---|
| 価格不足(必要な1分足がfx_pricesに無い) | **25件(該当)** | 全件がUNAVAILABLE。締切(release_datetime+各時間枠)はいずれも5日以上前で既に過去のため「対象時間未到達」ではない |
| 対象時間未到達(締切がまだ来ていない) | 0件(該当なし) | 実行時点(2026-10-19)は発表(2026-10-14)から5日後。60分枠まで含め全ての締切が過去 |
| 時刻精度不足(release_datetime_precisionによる除外) | 0件(該当なし) | 25件(5ペア×5時間枠)全てが書き込まれており、除外された時間枠が無い(EXACTと推定) |
| 通貨ペア不一致 | 0件(該当なし) | 5ペアはUSD関連の正しい候補集合と一致(推定どおり選定ロジックは正しく機能) |

#### 10.4.5 SUCCESSの意味(§調査指示5)

**`status: "SUCCESS"`は「ジョブがエラー無く完了した」ことのみを意味し、「データの正確性が
検証済み」であることは意味しない。** `runIngestionJob`の`resolveJobStatus`は
`counters.errors === 0`のときSUCCESSを返す実装で、UNAVAILABLE行の書き込みはエラーとして
数えていない(「データが無いことを正直に記録できた」という意味で、意図的に成功として
扱う設計)。今回のケースでは、**ジョブは「価格データが無いので計算できない」という
正しい結論を正しく記録できた、という意味でのSUCCESS**であり、経済指標の価格反応の
計算結果(pips等)が実際に正しいかどうかは、AVAILABLE行が1件も無いため**今回は検証できていない**。

#### 10.4.6 要人発言側への影響(§調査指示6)

`src/domain/speechReactions.ts`への変更は、既存の非公開関数2つ(`closeTimeMs`・`round`)に
`export`を付けただけで、処理内容・呼び出し元は変更していない(2026-10-18のコミットで確認済み)。
CIでの既存テスト(`tests/integration/speech-reactions.test.ts`含む全726件)が今回のラウンドまで
通過し続けていることをコードレベルで確認済み。本ジョブは`event_price_reactions`テーブルのみに
書き込み、`speech_events`・要人発言のその場計算ロジックには一切触れないため、**影響は無いと
判断する**(コード上の保証。DEV DB上での`GET /speeches/{id}`の前後比較は未実施)。

#### 10.4.7 データ取得を待てば解決するか、コード修正が必要か

**コード修正は不要と判断する(未実施、HQ承認前提)。** 今回UNAVAILABLEになったのは、
たまたま最初に見つかったイベント(推定: 2026-10-14発表のCPI)が、為替1分足の定期取り込みが
始まる(2026-10-16)**より前**に発表されたためで、パイプライン自体の不具合ではないと判断する。

* **このイベント(2026-10-14 CPI)自体は、待っても解決しない**: 1分足の遡及的な
  バックフィルは行わない設計のため、今後`ingest:event-reactions`を何度再実行しても
  UNAVAILABLEのままになる見込み。
* **今後発表される新しいイベント(2026-10-16以降に取り込みが始まった後に発表されるもの)
  であれば、1分足が既に継続的に収集されているため、AVAILABLEになる見込みが高い。**
  次の対象(BLSスケジュールのみ): US_NFP(対象期間2026-10、発表日2026-11-06)、
  US_CPI(対象期間2026-10、発表日2026-11-10)。いずれも約3〜4週間後。

#### 10.4.8 修正案と費用・APIクレジットへの影響

今回判明した制約を踏まえた選択肢を提示する(いずれも実行していない。HQ判断を待つ):

| 選択肢 | 内容 | 費用・APIクレジット |
|---|---|---|
| A. 何もしない(推奨) | 次の自然なBLS発表(3〜4週間後)を待って再実行する | **0円・0クレジット**。ただし検証に数週間かかる |
| B. DEV限定のテスト用イベントを人が手で1件作る | 権限者が、直近(例: 実行日の1〜2時間前)の仮のeconomic_events行を1件INSERTし、その時間帯には既に1分足が存在するため、AVAILABLE行が書かれることを早期に確認できる | **0円・0クレジット**(外部APIは呼ばない)。ただし「DBデータの手動書き換え」に近い操作のため、本指示の禁止事項との整合を先にHQに確認する必要がある。既存データの削除・書き換えではなく新規行の追加のみ |
| C. 過去の1分足を遡及的に取得する | Twelve Dataの履歴APIで2026-10-14前後の1分足を取得し直す | **要確認・おそらく有料**(無料プランでの遡及取得可否は未確認)。今回は提案のみで実施していない |

**Claudeの推奨はAだが、早期に正常系(AVAILABLE)を確認したい場合はBが最もコストが低い。
いずれも今回は実施せず、HQの判断を待つ。**

コード変更・ワークフロー再実行は行っていない。

### 10.5 次回の経済指標イベントでのDEV実データ検証準備(HQ指示 2026-10-19)

この節は調査と検証計画のみ。本番コードの変更・DEV/PROD DBへの接続・外部APIの呼び出しは
行っていない(検証日時の候補もコード内に既に取り込まれている静的なBLS公式スケジュール表
`src/ingestion/mappings/blsSchedule.ts`から確認したのみで、新たな外部への問い合わせはしていない)。

#### 10.5.1 現在の実装の整理(§必須作業1)

**取得対象イベント**(`src/ingestion/pipelines/eventReactions.ts`・`src/repositories/ingestionRepository.ts`):

* `economic_events.status = 'RELEASED'` のイベントのみ(`listReleasedEventsForReactions`)。
* `release_datetime >= now - repairHorizonDays日`(`FX_FETCH_SETTINGS.repairHorizonDays = 7`、
  `src/ingestion/config.ts`)。**7日より古いRELEASEDイベントは対象外**
  (FX価格のgap repairと同じ horizon)。
* 必ず`economic_indicators`と内部結合(`!inner`)するため、対応する`economic_indicators`行が
  無いイベントはそもそも取得されない。

**対象通貨ペア**(`listFxPairs()` + `candidatePairs`フィルタ):

* `listFxPairs()`は`fx_pairs`の全行を無条件に返す(`is_active`での絞り込みは**行っていない** —
  コード中のコメント「アクティブな為替ペア全て」とは裏腹に、実装は`is_active`列を一切見ていない。
  現在のDEV seed(`supabase/seed.sql`)は9ペア全てが列既定値`is_active = true`のため、
  **今回は実害は無い**が、将来どのペアかが`is_active = false`にされた場合、そのペアも
  候補として扱われてしまう実装上のギャップとして記録する(未確認事項とリスクに記載)。
* 候補ペア = イベントの指標の`currency_code`(`economic_indicators.currency_code`、
  `economic_events`自体には通貨列が無い)が`base_currency`または`quote_currency`と一致する
  ペア全て。US_NFP・US_CPIは米国指標のため`currency_code = 'USD'`と推定するが、
  **実際のDEV DB上の値は未確認**(§10.5.4のSQLで確認する)。
* DEV seedの9ペア(`USDJPY, EURUSD, EURJPY, GBPJPY, AUDUSD, GBPUSD, USDCHF, AUDJPY, CADJPY`)
  のうちUSDを含むのは**USDJPY・EURUSD・GBPUSD・AUDUSD・USDCHFの5ペア**
  (§10.4.2で確認済みの5ペアと一致)。

**必要な1分足の範囲**(`ingestEventPriceReactions`内、`fromIso`/`toIso`):

* `fromIso = release_datetime - 15分`(`PRE_STATEMENT_LOOKBACK_MINUTES`、要人発言側と共通)
* `toIso = release_datetime + 60分`(`MAX_TIMEFRAME_MINUTES`、半開区間 `[fromIso, toIso)`)
* つまり発表時刻の15分前から60分後までの、合計75分間の1分足(`timeframe = '1m'`)が
  対象ペアごとに必要。欠けている分だけ、その分を含む時間枠がUNAVAILABLEになる。

**UNAVAILABLEの判定条件**(`src/domain/economicEventReactions.ts`):

1. 時間枠の締切(`release_datetime + 時間枠`)が未来(`now`より後)の場合 → **行を一切書かない**
   (UNAVAILABLEではなく、行が無いためAPI側はDATA_PENDINGとして返す)。
2. 締切が過去で、発表直前価格(`pre_release_price`)または発表後価格(`post_release_price`)の
   いずれかに対応する1分足が無い場合 → **UNAVAILABLE**(movement/pips/change_percent/
   max_upward/max_downward/max_upward_pips/max_downward_pipsは全てnull)。
3. 両方の価格が揃っている場合のみ → **AVAILABLE**(実数値を計算)。
4. `release_datetime_precision`がEXACTでない場合、精度上分析できない時間枠(例: APPROXIMATEは
   1mを除外)はそもそも計算対象に入らない(`availableTimeframes`、`dataQuality.ts`)。

#### 10.5.2 通常のデータ取得処理だけで次回の検証データが揃うか(§必須作業2)

**結論: 1分足は通常のデータ取得処理だけで揃う見込みが高いが、`economic_events`行自体は
自動では作られない。** 定期実行(スケジュール)に入っているのは為替1分足取得
(`ingest:fx-prices`、20分おき、`.github/workflows/fx-event-analyzer-ingestion.yml`の
`cron: '7,27,47 * * * *'`)のみで、BLSカレンダー取り込み(`target=official-bls`)と
経済指標の価格反応計算(`target=event-reactions`)はいずれも**手動実行のみ**
(`workflow_dispatch`)。

* **1分足(fx_prices)**: `ingest:fx-prices`の既定実行対象は`FX_PAIR_MAPPINGS`
  (`src/ingestion/mappings/fxPairs.ts`)の9ペア全てで、対象5ペア(USDJPY等)を含む。
  市場が開いていれば(2026-11-06は金曜・祝日判定対象日`12-25`/`01-01`には該当しない
  通常営業日)20分おきに自動で取り込まれる見込み。§10.4.2で確認済みの通り
  2026-10-16以降は継続的に収集されているはずだが、**今回のセッションでは現時点の
  継続状況そのものは未確認**(§10.5.4 Query 3で確認可能)。
* **economic_events行(RELEASED)**: `src/ingestion/pipelines/blsCalendar.ts`の
  `buildBlsScheduleReleases`は、**BLSが実際にその期間の値を公表した後でなければ
  release(＝economic_eventsの行)を一切生成しない**(`official.resolve(...)`がnullなら
  `notYetAvailable`に積むだけで、行は作られない)。つまり:
  1. 2026-11-06 08:30 America/New_York(BLSの予定通りなら)にNFPが実際に発表される。
  2. その**後**に、権限者が手動で`target=official-bls`を実行しないと、
     `economic_events`に行ができない(定期実行には入っていないため、放置しても
     自動では作られない)。
  3. 行ができて初めて(かつ7日以内に)、権限者が`target=event-reactions`を手動実行する
     ことで`event_price_reactions`が書き込まれる。
* したがって、**「次回の経済指標で検証できる状態」にするには、1分足の自動収集に加えて、
  発表後に権限者が`official-bls`→`event-reactions`の順で2回、手動実行する必要がある**。
  これは実装上の仕様であり、今回のセッションでは変更していない(変更するには別途HQ判断が必要)。

#### 10.5.3 検証手順(文書化のみ、実施はしていない)

| 手順 | 実施者 | 内容 | 備考 |
|---|---|---|---|
| ① 発表前の健全性確認 | 権限者(いつでも可) | §10.5.4 Query 2・3で、対象5ペアの`is_active`と直近の1分足取り込み状況を確認する | 問題があれば`ingest:fx-prices`側の調査が先に必要 |
| ② BLS発表を待つ | — | 2026-11-06 08:30 America/New_York(=13:30 UTC、夏時間終了後のためEST)にNFPが発表される想定 | BLSが延期・変更する可能性は常にある(blsSchedule.tsのコメント参照) |
| ③ 経済指標イベントの取り込み | 権限者 | GitHub Actionsで`target=official-bls`を手動実行する(①と同じワークフロー) | BLSの無料・無認証APIを呼ぶ(既存のHQ承認済み経路、2026-10-17)。追加費用は発生しない |
| ④ イベント行の確認 | 権限者 | §10.5.4 Query 1で`economic_events`にUS_NFP(対象期間2026-10)のRELEASED行ができたこと、`release_datetime`が`2026-11-06T13:30:00Z`であること、`release_datetime_precision`がEXACTであることを確認する | タイムゾーン換算の確認はここで行う |
| ⑤ 発表前後の1分足の確認 | 権限者 | §10.5.4 Query 4で、対象5ペアそれぞれに`2026-11-06T13:15:00Z`〜`14:30:00Z`(発表15分前〜60分後、半開区間)の1分足が欠けなく(75本)存在するか確認する | 欠けていれば、その時間枠はUNAVAILABLEになる見込みと事前に判断できる |
| ⑥ 価格反応の計算・書き込み | 権限者 | GitHub Actionsで`target=event-reactions`を手動実行する(④の行ができてから7日以内 = 2026-11-13まで) | 外部API呼び出しなし・追加費用0円 |
| ⑦ 書き込み結果の検証 | 権限者 | §10.5.4 Query 5で`event_price_reactions`の各時間枠の値を取得し、Query 4で得た生の1分足データから1m・5m・15mのpipsを手計算し、一致することを独立に確認する | §10節の6項目の検証表と同じ要領。今回は実データでAVAILABLE行が期待される |

#### 10.5.4 読み取り専用SQL(提示のみ。実行はユーザー/権限者の判断を待つ)

いずれも**SELECT文のみ**(INSERT/UPDATE/DELETEなし)。**DEV環境専用**
(`fx-event-analyzer-dev`、ref `pbemckwnqmeaoveelihd`)。外部API呼び出し・追加費用は発生しない。

```sql
-- Query 1(③の後、④で実行): US_NFP/US_CPIのeconomic_events行の有無・内容・currency_codeを確認
select e.id, e.release_datetime, e.release_datetime_precision, e.status,
       i.code, i.currency_code
from economic_events e
join economic_indicators i on i.id = e.indicator_id
where i.code in ('US_NFP', 'US_CPI')
  and e.release_datetime >= '2026-10-20T00:00:00Z'
order by e.release_datetime;
```

```sql
-- Query 2(①で実行): fx_pairsのis_activeの実際の値を確認(§10.5.1のギャップの実害有無)
select symbol, base_currency, quote_currency, is_active
from fx_pairs
order by symbol;
```

```sql
-- Query 3(①で実行): 対象5ペアの直近の1分足取り込み状況(定期実行が健全に継続しているか)
select fp.symbol,
       max(p.timestamp) as latest_candle,
       count(*) filter (where p.timestamp >= now() - interval '2 hours') as candles_last_2h
from fx_pairs fp
left join fx_prices p on p.fx_pair_id = fp.id and p.timeframe = '1m'
where fp.symbol in ('USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'USDCHF')
group by fp.symbol
order by fp.symbol;
```

```sql
-- Query 4(⑤で実行): 発表15分前〜60分後の1分足が対象5ペースすべてで欠けていないか
-- (release_datetimeが実際の値と異なる場合はQuery 1の結果に合わせて置き換える)
select fp.symbol, count(*) as candle_count, min(p.timestamp) as first_ts, max(p.timestamp) as last_ts
from fx_pairs fp
join fx_prices p on p.fx_pair_id = fp.id and p.timeframe = '1m'
where fp.symbol in ('USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'USDCHF')
  and p.timestamp >= '2026-11-06T13:15:00Z'
  and p.timestamp <  '2026-11-06T14:30:00Z'
group by fp.symbol
order by fp.symbol;
-- 期待結果: candle_count = 75 (欠けなし)。75未満のペアは、欠けた分を含む時間枠がUNAVAILABLEになる。
```

```sql
-- Query 5(⑦で実行): event_price_reactionsの書き込み結果を取得(手計算との照合用)
select fp.symbol, r.timeframe, r.pre_release_price, r.post_release_price,
       r.movement, r.pips, r.max_upward, r.max_downward,
       r.max_upward_pips, r.max_downward_pips, r.data_status
from event_price_reactions r
join fx_pairs fp on fp.id = r.fx_pair_id
join economic_events e on e.id = r.event_id
join economic_indicators i on i.id = e.indicator_id
where i.code = 'US_NFP' and e.release_datetime = '2026-11-06T13:30:00Z'
order by fp.symbol, r.timeframe;
```

#### 10.5.5 検証日時の候補(§必須作業5、外部への問い合わせなし)

既にコードに取り込まれている静的なBLS公式スケジュール表(`src/ingestion/mappings/blsSchedule.ts`、
2026-10-17にBLS公式ページから人手で取り込んだもの。今回新たな外部アクセスはしていない)から
確認:

| 指標 | 対象期間 | 発表日(America/New_York 08:30) | UTC換算 | 本日(2026-10-19)からの日数 |
|---|---|---|---|---|
| **US_NFP**(推奨・最速) | 2026-10 | 2026-11-06 | **2026-11-06T13:30:00Z**(夏時間終了後のEST、UTC-5) | 約18日後 |
| US_CPI | 2026-10 | 2026-11-10 | 2026-11-10T13:30:00Z(EST) | 約22日後 |

* 2026-11-01(日)に米国の夏時間が終了するため、2026-11-06・2026-11-10はいずれも
  EST(UTC-5)。2026-10-14のCPI(EDT・UTC-4)とはUTCオフセットが異なる点に注意。
* 2026-11-06は金曜日で、`FX_MARKET_CLOSED_DAYS`(`12-25`・`01-01`)に該当しない通常営業日
  (`src/ingestion/marketHours.ts`)。市場はNY時間17:00まで開いているため、発表(08:30)から
  60分枠(09:30)まで市場休場の影響は無い見込み。
* US_NFPの方がUS_CPIより早く発表されるため、**次回の検証対象としてはUS_NFP
  (2026-11-06)を推奨する**。

#### 10.5.6 未確認事項とリスク

* **`economic_indicators.currency_code`が実際に`'USD'`であることは未確認**(Query 1で確認可能。
  推定の根拠は両指標が米国指標であることのみ)。
* **`listFxPairs()`が`is_active`を見ていない実装上のギャップ**(§10.5.1)。現在のDEV seedでは
  実害が無いと推定されるが、Query 2で裏付けていない。これを修正するかはHQ判断が必要
  (本指示では本番コード変更が禁止されているため、今回は実装していない)。
* **BLSが予定日に発表するとは限らない**(過去に政府機関閉鎖等で延期された例がある、
  `blsSchedule.ts`のコメント参照)。延期された場合、§10.5.5の候補日時はずれる。
* **`official-bls`の手動実行自体がBLSの無料API(外部API)を呼ぶ**(2026-10-17にHQ承認済みの
  既存経路)。本指示の「外部API呼び出し禁止」は本セッション(調査・計画作成)に適用されるもので
  あり、将来権限者が実施する①〜⑦の手順そのものを禁止するものではないと解釈している。
  この解釈に相違があればHQの確認を求める。
* **`ingest:fx-prices`が2026-10-19時点で実際に継続稼働しているかは本セッションでは未確認**
  (DB接続権限が無いため。Query 3で確認可能)。市場休場・障害等で止まっていれば、
  11月6日までに復旧していることが前提になる。
* **repairHorizonDaysの7日制約**: `official-bls`実行(④)から7日以内(2026-11-13まで)に
  `event-reactions`を実行(⑥)しないと、そのイベントはhorizon外になり対象外になる
  (再実行しても結果は変わらない設計、§10.4.7と同じ理由)。

コード変更・DB接続・外部API呼び出し・ワークフロー実行は、この節の調査・計画作成では
行っていない。

### 10.6 DEV環境の健全性確認(HQ指示 2026-10-19「調査と読み取り専用SQLの準備・レビューに限定」)

この節もコードレベルの調査のみ。DB接続・SQL実行・ワークフロー実行・外部API呼び出し・
`src/`配下の変更は一切行っていない。

#### 10.6.1 §10.5.4 SQL 5件のレビュー結果

実際のMigration DDL(`supabase/migrations/20260917000003_economic_indicators_and_fx_pairs.sql`・
`20260917000004_economic_events.sql`・`20260917000007_fx_prices_and_event_price_reactions.sql`)と
照合した。**5件とも、テーブル名・カラム名・JOIN条件に不一致なし。**

| Query | 対象テーブル・カラム | 照合結果 |
|---|---|---|
| 1 | `economic_events(id, release_datetime, release_datetime_precision, status, indicator_id)` / `economic_indicators(id, code, currency_code)` | 一致。`economic_events.indicator_id → economic_indicators.id`のJOINも定義通り |
| 2 | `fx_pairs(symbol, base_currency, quote_currency, is_active)` | 一致 |
| 3 | `fx_pairs` LEFT JOIN `fx_prices(fx_pair_id, timestamp, timeframe)` | 一致。`fx_prices."timestamp"`はDDL上は予約語回避のため引用符付きで定義されているが、`p.timestamp`という非引用の列参照は通常のPostgreSQL構文として有効(型名としての予約語制限であり、識別子としての使用は問題ない) |
| 4 | 同上(JOIN使用) | 一致 |
| 5 | `event_price_reactions(event_id, fx_pair_id, timeframe, pre_release_price, post_release_price, movement, pips, change_percent, max_upward, max_downward, max_upward_pips, max_downward_pips, data_status)` | 一致。全カラム名・型がDDLと同一 |

全てSELECT文のみでINSERT/UPDATE/DELETEは含まれない。全てDEV環境(`fx-event-analyzer-dev`)のみを
対象とし、接続先を切り替える記述は無い。**今回も実行はしていない(レビューのみ)。**

#### 10.6.2 `ingest:fx-prices`の起動方法・実行履歴・継続稼働の確認方法(ワークフローは実行していない)

**起動方法**(`src/jobs/ingestFxPrices.ts`):

* 定期実行: GitHub Actions `cron: '7,27,47 * * * *'`(20分おき)で自動実行(`--manual`なし、
  対象ペアは`FX_PAIR_MAPPINGS`の9ペア全て)。
* 手動実行: `workflow_dispatch`で`target: fx-prices`または`both`を指定(`--manual`付き、
  クレジット上限が700/日→800/日になる)。
* ローカルCLI: `npm run ingest:fx-prices`(スケジュール相当)、または
  `npm run ingest:fx-prices -- --manual --pairs USDJPY,EURUSD`(対象ペア指定)。

**実行履歴の確認方法**(いずれも未実施。方法の整理のみ):

1. **GitHub Actionsの実行履歴**: リポジトリの Actions タブ →
   ワークフロー「FX Event Analyzer - Data ingestion (dev)」→ 各runの「FX prices」ステップの
   ログ(JSON形式のサマリ: `job/status/api_requests/budget/fetched/upserted/unverified/skipped/errors`)
   を見る。20分おきに走っているはずなので、runの間隔が空いていないかも確認できる。
2. **`ingestion_logs`テーブル**(DB、未実行・読み取り専用で確認可能):
   `data_type = 'FX_PRICE'`で`started_at desc`に並べると、各回の`status`・`fetched_count`・
   `success_count`・`error_count`が時系列で見える(`20261015000003_ingestion_accuracy.sql`で
   `job`・`details`列も追加済み)。
3. **既存の品質レポート機能**(`npm run report:data-quality`、定期実行は`cron: '0 0 * * *'`、
   毎日のGitHub Actions Summaryに出力): `latestCandleAgeMinutes`・`candleFreshness`
   (NORMAL/WARNING/CRITICAL、§9.2で確定した25/45分の閾値)が対象ペアごとに既に出力される
   設計になっている。**これが最も直接的な「継続稼働」の確認手段**であり、新たなSQLを書かずに
   既存の仕組みで確認できる。
4. **§10.5.4 Query 3**(`fx_prices`から直接`latest_candle`/`candles_last_2h`を読む)も同じ目的で
   使える(③より直接的だが、品質レポートの閾値判定ロジックは経由しない生データ)。

いずれも今回は実行していない(確認方法の整理のみ)。

#### 10.6.3 `listFxPairs()`が`is_active`を参照しない件の調査(§必須作業3、修正はしない)

**呼び出し元は2つのみ**(`grep`で確認、`src/`配下全体):

* `src/ingestion/pipelines/fxPrices.ts`(`resolvePairs`、56行目付近) — 為替1分足の取得対象ペア解決。
* `src/ingestion/pipelines/eventReactions.ts`(43行目) — 経済指標の価格反応の対象ペア解決。

**いずれも`is_active`を一切見ていない。** これは今回の`eventReactions.ts`実装で新たに生じた
ギャップではなく、**Ingestion Worker側(書き込み側)の既存の設計**(`fxPrices.ts`も同様)。
一方、**読み取り側(API)はほぼ全箇所で`is_active = true`を明示的に絞り込んでいる**
(`src/repositories/fxPairsRepository.ts`・`homeRepository.ts`・`rateAlertsRepository.ts`・
データ品質レポートの`src/ingestion/quality/reader.ts`も`is_active = true`で絞り込み済み)。
つまり**「書き込み側(Ingestion Worker)は`is_active`を見ない、読み取り側(API・品質レポート)は
見る」という非対称な設計が、`fx_pairs`を扱うコード全体に既に存在する**。今回のeventReactions.ts
固有の不具合ではない。

**実際にどの通貨ペアが対象になるか**: `supabase/seed.sql`(67-79行目)のINSERT文は`is_active`列を
一切指定していないため、DEV seedの9ペア全てが列既定値`is_active = true`で入る
(マイグレーション`20260917000003_economic_indicators_and_fx_pairs.sql`で`default true`)。
したがって**現在のDEV DBでは`is_active`列の値による実際の絞り込み差異は発生しない**
(全9ペアが事実上「アクティブ」)。US_NFP/US_CPI(`currency_code = 'USD'`)の場合、
`base_currency`または`quote_currency`が`USD`のペアは9ペア中
**USDJPY・EURUSD・GBPUSD・AUDUSD・USDCHFの5ペア**(seed.sqlの定義から確認、§10.4.2で実データでも
確認済み)。EURJPY・GBPJPY・AUDJPY・CADJPYはUSDを含まないため対象外。

**修正は行っていない**(本指示で禁止されているため)。将来誰かが`fx_pairs.is_active`を
`false`に変更した場合、読み取り側・品質レポートはそのペアを除外するが、Ingestion Worker
(`fxPrices.ts`・`eventReactions.ts`)は除外しないという非対称が実害を持つようになる。
修正するかどうかはHQ判断が必要(影響範囲は`listFxPairs()`呼び出し元の2ファイルのみ)。

#### 10.6.4 `currency_code='USD'`と NFPイベント登録方法の根拠(§必須作業4、DB接続なし)

**`currency_code`の根拠**(DB接続せず、コード/seedから確認):

`supabase/seed.sql` 19-26行目:
```sql
insert into economic_indicators (id, code, name, name_en, country_code, currency_code, importance, ...) values
  ('10000000-...0001', 'US_CPI', '米国CPI(消費者物価指数)', 'Consumer Price Index', 'US', 'USD', 'HIGH', ...),
  ('10000000-...0002', 'US_NFP', '米国雇用統計(非農業部門雇用者数)', 'Nonfarm Payrolls', 'US', 'USD', 'HIGH', ...),
```
US_CPI・US_NFPともに`country_code = 'US'`・`currency_code = 'USD'`が**seedファイルに直接記載**
されている。DEV DBがこのseedから作られたままであれば(途中でUPDATEされていなければ)、
DB上の実際の値も`'USD'`である可能性が高いが、**DB上の実値そのものは今回も未確認**
(§10.5.4 Query 1で確認できる)。

**NFPイベントの登録方法**(`src/ingestion/pipelines/blsCalendar.ts`・`economicCalendar.ts`):

1. `buildBlsScheduleReleases`が`blsSchedule.ts`の各エントリについて、BLSの公式系列から
   実際の値(`actual`)が取得できるかを確認する。**`actual`が無い(まだ発表されていない)間は
   release自体を生成しない**(`notYetAvailable`に積むのみ)。
2. `actual`が取得できた回だけ、`NormalizedCalendarRelease`(`provider: 'bls_schedule'`、
   `providerEventId: 'bls_schedule:US_NFP:2026-10'`等)を生成する。
3. `economicCalendar.ts`の`upsertSchedule`が`provider_event_id`で既存イベントを検索し、
   無ければ`store.insertEvent({..., status: release.actual !== null ? 'RELEASED' : 'SCHEDULED', ...})`
   で新規作成する。`buildBlsScheduleReleases`は`actual !== null`の場合しかreleaseを作らないため、
   **BLSパス経由のイベントは常に初回からRELEASEDとして作成される(SCHEDULEDを経由しない)**。
4. `release_datetime_precision`は、スケジュール上の問題(`scheduleIssues`)が無ければ`'EXACT'`になる。

**テストによる裏付け**(`tests/ingestion/blsCalendar.test.ts`、DB接続なしのユニットテスト):

* `does not build a release for a future-dated entry` / `does not build a release when the
  scheduled date has passed but BLS has not published the value` — 上記1を確認済み。
* `publishes a VERIFIED snapshot (actual and the cross-check share the same BLS resolver)` —
  `expect(event?.status).toBe('RELEASED')`で上記3を確認済み。
* `converts an EST-month release date correctly (winter, UTC−5)` — 2026-02-13 08:30
  America/New_York → `13:30:00.000Z`への変換を確認済み。**2026-11-06(NFP)も同じくEST
  (夏時間終了後)のため、同じ変換ロジックが適用される**(このテスト自体は2026-02-13の例だが、
  直後の別テストでは`US_CPI`・`releaseDate: '2026-11-10'`という**今回のCPI候補と全く同じ日付**を
  入力に使っている)。
* 本セッションでは`npx vitest run tests/ingestion/blsCalendar.test.ts`等のテスト実行はしていない
  (読んで確認したのみ。実行禁止ではないが、今回は必須作業に含まれないため実施せず)。

**このDEV環境でBLS経路以外の取り込みが動いていないことの根拠**: `.github/workflows/
fx-event-analyzer-ingestion.yml`の`workflow_dispatch.inputs.target`は
`fx-prices / speeches / both / report / official-bls / event-reactions`のみで、有料カレンダー
(`economicCalendar.ts`経由、Finnhub/FMP等)を呼ぶターゲットはワークフローに存在しない。
したがって**この環境ではUS_NFP/US_CPIの`economic_events`行はBLS経路(`official-bls`)でしか
作られない**(2026-10-17のHQ判断の通り)。

#### 10.6.5 11月6日のNFP検証に必要な手動操作と実行可能期間(§必須作業5)

| 操作 | 実施可能な時期 | 備考 |
|---|---|---|
| ① `target=official-bls`を手動実行 | BLSが実際にNFP(2026-10期間分)を公表した**後**(予定: 2026-11-06 08:30 America/New_York = 13:30 UTC。発表後、BLSの系列に反映されてから) | これより前に実行しても`notYetAvailable`に入るだけで`economic_events`行は作られない(§10.6.4) |
| ② `target=event-reactions`を手動実行 | ①で`economic_events`行(RELEASED)ができた後、かつ**`release_datetime`(2026-11-06T13:30:00Z)から7日以内 = 2026-11-13T13:30:00Z まで** | 実行対象は`release_datetime >= now - repairHorizonDays(7日)`で判定するため、①を実行した日時ではなく**release_datetime基準**で7日間(§10.5.6の記述を訂正: 「④の実行から7日以内」ではなく「release_datetime から7日以内」が正確) |

* **60分枠まで確実にAVAILABLEを得たい場合**、②は2026-11-06T14:30:00Z(発表60分後)以降に
  実行するのが望ましい(それより前だと60分枠はまだ締切未到達でNOTHING_READY_YET扱いになる
  可能性がある。1分・5分・15分枠はそれぞれの締切後なら先に揃う)。
* ①→②の順序は必須(②は①で作られたRELEASED行が無ければ何もしない、§10.5.2参照)。
* ①・②とも、2026-11-13T13:30:00Zを過ぎると、そのイベントはhorizon外になり②を実行しても
  対象外(`counters.fetched`が0のまま)になる見込み。
* いずれも今回は実行していない(手順の整理のみ)。

コード変更・DB接続・SQL実行・外部API呼び出し・ワークフロー実行は、この節の調査でも
行っていない。

### 10.7 価格データの継続取得状況の確認準備(HQ指示 2026-10-19、DB接続・実行はまだ許可されていない)

この節もコードレベルの調査のみ。DB接続・SQL実行・GitHub Actions実行・外部API呼び出し・
`src/`配下の変更は一切行っていない。

#### 10.7.1 既存のdata-quality reportの実行コマンド・出力・対象期間・鮮度判定基準

**実行コマンド**(`src/jobs/reportDataQuality.ts`):

```
npm run report:data-quality                          # 直近7日(既定)、is_active=trueの全ペア
npm run report:data-quality -- --days 14 --pairs USDJPY,EURUSD   # 日数・対象ペアを指定(1〜31日)
```

GitHub Actions上では`cron: '0 0 * * *'`(毎日)で`--days 1`で定期実行されるほか、
`workflow_dispatch`で`target=report`を指定しても手動実行できる(いずれも今回は実行していない)。
出力はMarkdownで標準出力、GitHub Actionsでは`GITHUB_STEP_SUMMARY`にも追記される(実行結果の
画面で読める)。READ-ONLY(SELECTのみ、外部API呼び出しなし)。

**出力項目**(`src/ingestion/quality/report.ts`、章構成):

| 章 | 内容 |
|---|---|
| 1 | 為替1分足の取得率・欠損率(欠損の内訳・長い欠損TOP5) |
| 2 | 照合一致率(1分足、2つ目の取得元との比較) |
| 3 | 集約足(5分〜60分)の作成可能区間での成功率・評価期間全体のカバレッジ |
| 4 | 発表・発言前後の1分足が揃っているか(経済指標・要人発言それぞれ) |
| 5 | 取得ジョブの実行状況(ジョブ別の実行回数・成功/部分/失敗・所要時間・`ingest:fx-prices`の実行間隔) |
| 6 | API利用量とクレジット消費・取り込み件数の照合 |
| 7 | 時刻ずれ(**`latestCandleAgeMinutes`/`candleFreshness`はここ**) |
| 8 | 経済指標の値の検証状況(VERIFIED/SINGLE_SOURCE等) |

**対象期間**(`src/ingestion/quality/run.ts`):`period.from = floor(now) − days日`、
`period.to = floor(now) − 30分`(`REPORT_END_LAG_MINUTES`。直近30分は「まだ取得待ちかもしれない」
ため判定対象から除外)。ただし`latestCandleAgeMinutes`/`candleFreshness`は`period.to`では
なく`now`そのものを基準に計算される(鮮度は「今」を知りたいため、取得待ちの除外を
経由しない)。

**対象ペア**: `reader.listPairs()`が`fx_pairs`を`is_active = true`で絞り込んで取得する
(§10.6.3で確認した通り、DEV seedは9ペア全てが`is_active=true`既定のため、現在は**9ペア全て**が
対象になる。HQの「9通貨ペア」という理解と一致する)。

#### 10.7.2 `candleFreshness`の判定基準(既存実装の再掲、変更なし)

`src/ingestion/quality/metrics.ts`の`classifyCandleFreshness`(HQ決定2026-10-18「価格データ品質の
閾値」で既に実装済み。今回は変更していない):

1. その時点(`now`)で市場が休場中(`isFxMarketOpen`、週末・12/25・1/1) → **`MARKET_CLOSED`**
   (正常/警告/異常の判定対象外。新しい足自体が来ないため)。
2. 市場が開いていて、1分足が1件も無い → **`NO_DATA`**。
3. 市場が開いていて、最新1分足の経過時間(足の終了時刻からの分数)が:
   * **25分以内 → `NORMAL`**(取り込みは20分おき+finality lag 2分のため、1サイクル分の遅れまで)
   * **25分超〜45分以内 → `WARNING`**(2サイクル以内。1回分の取得失敗・リトライに相当)
   * **45分超 → `CRITICAL`**(2サイクル以上連続して取得できていない。配信停止・大幅遅延を検出)

画面(iOSアプリ)には一切表示されない。品質レポート§7にのみ出力される
(`FRESHNESS_LABEL`: NORMAL=正常、WARNING=警告、CRITICAL=異常、MARKET_CLOSED=休場中(判定対象外)、
NO_DATA=データなし)。

#### 10.7.3 GitHub Actions実行履歴で分かることとDB接続でしか分からないこと

| 確認したい情報 | GitHub Actions実行履歴(Actionsタブ)だけで分かるか | DB接続(`ingestion_logs`等)が必要か |
|---|---|---|
| 各runが起動した日時・成功/失敗(workflow全体) | **分かる**(runの一覧・ステータス) | 不要 |
| 「FX prices」ステップのログ出力(JSON、`api_requests`/`fetched`/`upserted`/`skipped`/`errors`) | **分かる**(各stepのログを展開すれば読める。runごとに1件) | 不要。ただし過去runのログはGitHubの保持期間(既定90日)を過ぎると消える |
| 複数runをまとめた傾向(例: 直近7日の成功率、実行間隔の最長、欠損の累積) | **分からない**(1run=1ログの単発情報のみ。横断集計はできない) | **必要**(`ingestion_logs`を集計する`report:data-quality`、またはSQLでの直接集計) |
| 対象ペアごとの1分足の実際の充足状況(欠損区間・原因別の内訳) | **分からない**(ステップのログには出るが、`fx_prices`の実データとの対応確認はできない) | **必要**(`fx_prices`テーブルを直接読む必要がある) |
| `latestCandleAgeMinutes`/`candleFreshness`(現在の鮮度) | **分からない**(「今」の鮮度はレポート実行時点の値であり、過去のrunログには出ない) | **必要**(`report:data-quality`の実行、または§10.5.4 Query 3) |
| APIクレジットの消費状況(`api_credit_usage`) | ステップのログに`budget`は出るが、他ジョブ・他日との合算は**分からない** | 横断的な確認には**必要** |

**まとめ**: 個々のrunが「動いたか」はActions履歴だけで確認できるが、**「継続的に健全に動いているか」
(傾向・現在の鮮度・累積欠損)を確認するにはDB接続が必要**。§10.5.4 Query 3、または
`report:data-quality`の実行(どちらも未実施)がその手段になる。

#### 10.7.4 NFP検証前チェックリスト(§必須作業4)

§10.5.3の7ステップのうち、①(発表前の健全性確認)を具体化したもの。全て未実施(DB接続・
実行の許可を待つ)。

| # | 確認項目 | 確認方法 | 現状 |
|---|---|---|---|
| 1 | 対象5ペア(USDJPY/EURUSD/GBPUSD/AUDUSD/USDCHF)が`is_active=true`か | §10.5.4 Query 2、または品質レポートの対象ペアに含まれているか | 未確認(seed.sql上は既定値true) |
| 2 | 対象5ペアの`candleFreshness`がNORMAL(または市場休場中でMARKET_CLOSED)か | `report:data-quality`の実行、または§10.5.4 Query 3 | 未確認 |
| 3 | `ingest:fx-prices`の直近7日の成功率・実行間隔に異常(長い欠損)が無いか | `report:data-quality`§5「ingest:fx-pricesの実行間隔」 | 未確認 |
| 4 | 対象5ペアの直近の欠損率・長い欠損TOP5に懸念が無いか | `report:data-quality`§1 | 未確認 |
| 5 | `economic_events`にUS_NFP(対象期間2026-10)の行がまだ存在しないこと(事前の状態確認) | §10.5.4 Query 1 | 未確認 |
| 6 | 2026-11-06当日まで`ingest:fx-prices`の定期実行が継続していること(当日に再確認) | 同上①〜④を発表直前に再実行 | 発表直前に再確認が必要 |
| 7 | BLSが予定通り発表したこと(BLS公式ページ、または`official-bls`実行後のログ) | 実行後のログ・§10.5.4 Query 1 | 発表後に確認 |

#### 10.7.5 `is_active`非対称性の修正案と影響範囲(§必須作業5、未実装)

§10.6.3で確認した事実を踏まえ、修正案のみ提示する(実装していない)。

**修正案**: `src/repositories/ingestionRepository.ts`の`listFxPairs()`のSupabaseクエリに
`.eq('is_active', true)`を追加する(`src/ingestion/quality/reader.ts`の`listPairs()`や
各種読み取り側リポジトリと同じ絞り込みを書き込み側にも揃える)。

**影響範囲**:

* 呼び出し元は2箇所のみ: `src/ingestion/pipelines/fxPrices.ts`(為替1分足の取得対象ペア解決)、
  `src/ingestion/pipelines/eventReactions.ts`(経済指標の価格反応の対象ペア解決)。
* **現在のDEV DBでの挙動変化はゼロと推定**(9ペア全てが`is_active=true`既定のため)。
* 将来誰かが`fx_pairs.is_active`を`false`にした場合:
  * 修正後は、そのペアは`ingest:fx-prices`で1分足が取得されなくなり、`event-reactions`でも
    候補ペアから除外される(読み取り側・品質レポートと一致する動きになる)。
  * 修正前(現状)のままだと、非活性化したペアも取得・計算対象に残り続ける(読み取り側は
    表示しないのに、裏では取得・計算だけ継続する無駄が生じる)。
* **テストへの影響**: 現在のユニットテスト(`tests/ingestion/eventReactions.test.ts`・
  `tests/helpers/memoryIngestionStore.ts`)は`is_active`列自体をモデル化していないため、
  修正する場合は`FxPairRef`に`is_active`を追加し、`MemoryIngestionStore`でも絞り込みを
  再現した上で、「非活性ペアは候補から除外される」ことを確認する新規テストが必要になる。
  既存テストへの挙動変化は無い(既存テストは全ペア`is_active`未設定 = 実質true相当のため)。
* **リスク**: 本番/DEVで実際に`is_active=false`のペアが存在する場合、その状態を正としてよいか
  (将来再度活性化する想定か、恒久的に除外する想定か)は確認が必要。現在は該当ペアが無いため
  リスクは理論上のもの。
* マイグレーション・スキーマ変更は不要(列は既に存在)。コード変更は`ingestionRepository.ts`の
  1行(クエリへの`.eq`追加)とテスト追加のみで、他の設計・既存の認証・RLS・API利用上限には
  影響しない。

**実装は行っていない**(本指示で禁止されているため)。実装するかどうかはHQ判断を待つ。

コード変更・DB接続・SQL実行・GitHub Actions実行・外部API呼び出しは、この節の調査でも
行っていない。

## 11. BLSの発表前予定行(SCHEDULED)・取りやめのDEV確認手順(2026-10-26、HQ指示「BLSの安全対策」。統合済みの実装に合わせて書き直し)

`npm run ingest:official:bls-calendar` は、`mappings/blsSchedule.ts`の表から、発表済みの月は`RELEASED`、未来の月は`SCHEDULED`の行を作る(`buildBlsScheduleReleases` → `ingestCalendarReleases`。2026-10-24 統合、`0b198205`)。2026-10-26 の統合で、次の安全対策を足した(`claude/fx-bls-future-schedule`の処理は重複して取り込まず、不足分だけを移した)。

- **取りやめ**: BLS が公式に発表を取りやめた月は、表のエントリに`cancelled: true`と`cancelledNote`(公式の告知のURLと読んだ日)を書く。ジョブはその月の release を作らず(`SCHEDULED`に書き戻さない)、未発表の行を`CANCELLED`・`UNAVAILABLE`にする(行が無ければ`CANCELLED`で作る)。**`RELEASED`の行は変えず**、`schedule_entry_conflict`に記録する(`reconcileBlsScheduleRows`)
- **予定表から消えた行**: 未発表(`SCHEDULED`・`CANCELLED`)の`bls_schedule`の行で、表に無いIDのものは`schedule_rows_not_in_table`に記録するだけ(自動では取りやめにしない)
- **取り込みの内訳**: 書く前に読むだけで数え、`ingestion_logs.details.plan`に残す(`planBlsScheduleWrites`。`scheduled_insert`・`scheduled_reschedule`・`scheduled_unchanged`・`released_insert`・`released_update`・`released_unchanged`・`row_cancelled`)
- **失敗の切り分け**: 取りやめ・消えた行の点検は、発表済みの値の取り込みの**後に別の try/catch で**行う。ここで失敗しても過去の発表の取り込みは済んでいる。失敗は`schedule_reconcile:`付きで`errors`に入り、`details.reconcile_errors`に件数が入り、**終了コードは1**。発表済みの値の取り込みも、1件ごとに try/catch(`ingestCalendarReleases`)
- **`--dry-run`**: 書き込む関数をすべて断るストア(`readOnlyIngestionStore`)で同じ処理を読むだけ行い、内訳と書くはずだった内容を出す。`ingestion_logs`にも書かない。**BLS の API は読む**(キーなしの v1 は25クエリ/日。1回の実行で系列ごとに1回)
- この経路は`is_provisional`(FOMC のマイグレーション 20261022000002)を読まない。前月比(`secondary_*`、マイグレーション 20261025000001)は**書く**ので、**DEV にそのマイグレーションを適用する前にこのジョブを本実行すると、新しい発表の RELEASE スナップショットの INSERT が失敗する**(過去の月の`RELEASED`化がその月だけ止まる。予定行の作成・取りやめには影響しない)。`--dry-run`は書かないので影響しない

このジョブは**手動実行のみ**(定期実行には入っていない。ワークフローは変更していない)。**DEV では 2026-10-24 07:09 UTC に一度実行されている**(GitHub Actions の実行 40073041318、統合前のコード)。実行するかどうか・いつ実行するかは権限者の判断による。

手順は「11.1 実行前の確認(P1〜P5、読み取り専用) → 11.2 `--dry-run` → 11.3 本実行 → 11.4 実行後の確認」。どこかで11.5の中止条件に当たったら、そこで止めて報告する(DBの行を手で直したり消したりしない)。通知への影響は11.7を先に読むこと。

### 11.1 実行前の確認(読み取り専用SQL P1〜P5)

どれも SELECT のみ。結果は実行後との比較に使うので保存しておく。

```sql
-- P1: 既存の bls_schedule の行(実行後に「発表済みの行が変わっていない」ことを比べるため)
select e.id, e.provider_event_id, i.code as indicator, e.status, e.data_status,
       e.release_datetime, e.release_datetime_precision, e.importance, e.created_at, e.updated_at,
       s.actual, s.previous, s.verification_status, s.captured_at
from economic_events e
join economic_indicators i on i.id = e.indicator_id
left join event_snapshots s on s.event_id = e.id and s.snapshot_type = 'RELEASE'
where e.provider = 'bls_schedule'
order by e.release_datetime;

-- P1b: 同じ行の指紋(件数とハッシュ)。実行後に P1c と比べる
select now() as checked_at, count(*) as rows,
       md5(string_agg(concat_ws('|', e.id, e.provider_event_id, e.status, e.data_status,
                                e.release_datetime, e.release_datetime_precision, e.updated_at),
                      ',' order by e.id)) as fingerprint
from economic_events e
where e.provider = 'bls_schedule';

-- P2: 他の取得元(provider <> 'bls_schedule')の5指標の行が、過去60日〜表の末尾(2027-12)に無いこと(0行が正しい)。
--     supabase/seed.sql のテスト用の行(provider = 'seed')や有料カレンダーの行があると、同じ発表が2行になり、カレンダー・通知に二重に出る
select e.provider, e.provider_event_id, i.code as indicator, e.status, e.release_datetime
from economic_events e
join economic_indicators i on i.id = e.indicator_id
where i.code in ('US_CPI', 'US_NFP', 'US_CORE_CPI', 'US_UNEMPLOYMENT_RATE', 'US_AVG_HOURLY_EARNINGS') and e.provider <> 'bls_schedule'
  and e.release_datetime >= now() - interval '60 days' and e.release_datetime < timestamptz '2028-01-01'
order by e.release_datetime;

-- P3: 指標の行があること(11.9 の migration の後は5行。US_AVG_HOURLY_EARNINGS だけ MEDIUM、他は HIGH が正しい。
--     適用前は US_CPI・US_NFP の2行で、3指標は indicator_not_in_db として飛ばされる)
select code, importance, country_code, currency_code, display_name from economic_indicators
where code in ('US_CPI', 'US_NFP', 'US_CORE_CPI', 'US_UNEMPLOYMENT_RATE', 'US_AVG_HOURLY_EARNINGS') order by code;

-- P4: bls_schedule の行の状態ごとの件数(2026-10-24 の実行で未来の SCHEDULED が入っているはず。件数を記録する)
select status, data_status, count(*) filter (where release_datetime > now()) as future,
       count(*) filter (where release_datetime <= now()) as past
from economic_events where provider = 'bls_schedule'
group by status, data_status order by status;

-- P5: 通知の対象になりうるアカウントの数(集計のみ。11.7)
select (select count(*) from profiles) as profiles, count(*) as user_settings_rows,
       count(*) filter (where notify_push) as push_on,
       count(*) filter (where notify_push and notify_indicators and 'HIGH' = any(notify_importances)) as would_notify_cpi_nfp
from user_settings;

-- P6: 前月比のマイグレーション(20261025000001)が DEV に入っているか(4 なら入っている。0 なら本実行の前に、この章の冒頭の注意を読む)
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'event_snapshots' and column_name like 'secondary%';
```

### 11.2 書き込みなしの事前実行(`--dry-run`)

```bash
cd fx-event-analyzer-backend
npm run ingest:official:bls-calendar -- --dry-run
```

- 出力(1行のJSON)の`plan`・`reconcile`・`dry_run_writes`・`notes`・`errors`を保存する
- 期待値(2026-10-24 の実行で28行が入っており、表を変えていない場合): `plan.scheduled_insert = 0`、`plan.scheduled_unchanged`が「今より後の表のエントリの数」(10/26 時点で28)、`plan.scheduled_reschedule = 0`、`plan.row_cancelled = 0`、`reconcile`がすべて0、`dry_run_writes`が空、`errors`が空、終了コード0
- 2026-10-24 の実行がされていなかった DB なら`plan.scheduled_insert`が未来のエントリの数になる
- 発表済みの月の`plan.released_*`は、`released_unchanged`(すでに`RELEASED`)が正しい。`released_insert`・`released_update`は、前回の実行より後に BLS が発表した月だけ

### 11.3 本実行

11.1・11.2 で中止条件に当たらず、11.7 の通知対策と11.1のP6の確認を済ませてから実行する。

```bash
cd fx-event-analyzer-backend
npm run ingest:official:bls-calendar
```

### 11.4 実行後の確認(読み取り専用SQL)と期待結果

```sql
-- (1) 状態ごとの件数
select status, data_status, release_datetime_precision, count(*) from economic_events
where provider = 'bls_schedule' group by 1, 2, 3 order by 1, 2;

-- (2) 同じIDの重複が無いこと(0行が正しい)
select provider_event_id, count(*) from economic_events
where provider = 'bls_schedule' group by provider_event_id having count(*) > 1;

-- (3) 発表時刻がニューヨーク時間 08:30 であること(0行が正しい)
select provider_event_id, release_datetime from economic_events
where provider = 'bls_schedule'
  and to_char(release_datetime at time zone 'America/New_York', 'HH24:MI') <> '08:30';

-- (4) トリガーが記録した予定変更・中止(bls_schedule の行だけ)
select c.change_type, e.provider_event_id, c.old_datetime, c.new_datetime, c.changed_at
from event_schedule_changes c join economic_events e on e.id = c.target_id
where c.kind = 'INDICATOR' and e.provider = 'bls_schedule' order by c.changed_at desc;

-- (5) 直近のジョブログ(内訳と要確認の項目)
select started_at, status, error_message,
       details->'plan' as plan, details->'reconcile_errors' as reconcile_errors,
       details->'cancelled_applied' as cancelled_applied, details->'cancelled_conflicts' as cancelled_conflicts,
       details->'rows_not_in_table' as rows_not_in_table,
       details->'schedule_entry_conflict' as conflict, details->'schedule_rows_not_in_table' as not_in_table,
       details->'overdue' as overdue
from ingestion_logs where job = 'ingest:official:bls-calendar' order by started_at desc limit 5;

-- P1c: 実行前からあった行が変わっていないこと(P1b の checked_at を入れて流す。P1b と同じなら正しい)
select count(*) as rows,
       md5(string_agg(concat_ws('|', e.id, e.provider_event_id, e.status, e.data_status,
                                e.release_datetime, e.release_datetime_precision, e.updated_at),
                      ',' order by e.id)) as fingerprint
from economic_events e
where e.provider = 'bls_schedule' and e.created_at < timestamptz '<P1b の checked_at>';
```

**期待結果**(表を変えていない場合): (5)の`plan`が11.2の dry-run と同じ、`reconcile_errors = 0`、`cancelled_applied = 0`、`rows_not_in_table = 0`、`conflict`・`not_in_table`が空。(2)(3)は0行。(4)は増えない。P1c は、前回の実行より後に BLS が発表した月の行(`SCHEDULED` → `RELEASED`)だけが違う。

**取りやめを入れたとき**: 該当月の行が`CANCELLED`・`UNAVAILABLE`になり、(4)に`CANCELLED`が1行増える(行がまだ`SCHEDULED`だった場合。新しく作った場合は INSERT なので増えない)。(5)の`cancelled_applied = 1`。

### 11.5 中止条件

次のどれかに当たったら、その段階で止めて報告する(DBの行を手で更新・削除しない)。

- **実行前**: P2 が1行以上/P3 が2行でない・HIGH でない/P5 で通知の対象のアカウントがあり、11.7 の対策をまだしていない/P6 が0なのに本実行しようとしている
- **dry-run**: 終了コード1、`errors`が空でない、`plan.scheduled_reschedule`・`plan.row_cancelled`・`reconcile`の件数が想定と違う(表を変えていないのに0でない)、`schedule_entry_conflict`・`schedule_rows_not_in_table`・`indicator_not_in_db`が空でない
- **本実行後**: 終了コード1・`reconcile_errors`が0でない・`errors`が空でない/(2)(3)が0行でない/(4)が想定外に増えた/P1c が想定外に違う/P2 が0行でなくなった

### 11.6 予定変更が記録される場合・されない場合

DBのトリガー(`trg_economic_events_schedule_change`、migration 20261015000002)は、**更新前の行が`SCHEDULED`で、`release_datetime`が変わった(または`CANCELLED`になった)UPDATE**をすべて記録する。発表済みの値の取り込み(`economicCalendar.ts`の`upsertSchedule`)は、行がまだ`SCHEDULED`のうちに発表を取り込むとき、表の日時が行の日時と違えば日時の変更と`RELEASED`化を1回のUPDATEで行う。このため:

- **記録される**: 行が`SCHEDULED`のうちに表の日付を直したとき(通常)/BLSが日付をずらし、表を直したのが元の日付・新しい日付を過ぎた後でも、行がまだ`SCHEDULED`だったとき(発表後の実行の1回のUPDATEで記録される)/取りやめで`SCHEDULED`の行を`CANCELLED`にしたとき
- **記録されない**: 行が`RELEASED`になった後に表を直したとき(この経路は`RELEASED`の行の日時を変えない)/表を直さないまま発表されたとき(古い日時のまま`RELEASED`になる)/新しく行を作るとき(INSERT)

表の修正が発表に間に合わないと、「発表後にカレンダー更新が届く」か「行の時刻が誤ったまま残る」かのどちらかになる。BLS の変更告知を見たら、発表日より前に表を直す(data-sources.md §14)。

### 11.7 通知への影響と、DEV確認中に意図しない通知を出さない方法

- **サーバーからのプッシュ(APNs)は無い**。端末に出る通知は、iOS アプリが`GET /notifications/upcoming`(今から7日先まで)の結果で予約するローカル通知だけ。条件は、プッシュ通知オン・経済指標オン・行が`SCHEDULED`・精度`EXACT`・重要度が設定に含まれる(既定 HIGH と MEDIUM)。**CPI・雇用統計の予定行は既定の設定ならすべて対象**
- 通知一覧(`notification_inbox`)は、アプリが`GET /notifications`を呼んだときに書かれる。予定変更・取りやめ(`event_schedule_changes`の直近7日)は一覧に出るだけで、ローカル通知にはならない。定期的に動くもの(cron・タイマー)は無い
- **今の DEV**: 2026-10-24 の実行で予定行が入っていれば、いちばん近い NFP 2026-11-06 13:30Z(日本時間 22:30)が7日の範囲に入るのは **2026-10-30 22:30(日本時間)以降**。そのあとアプリを開いたテスト端末は、11-06 22:25 に「発表5分前」の通知を出す
- **防ぎ方(おすすめ順)**: ① テスト用アカウントのアプリで「設定 → 通知」の「プッシュ通知」をオフにして保存する(P5 の`push_on`が0) ② 「経済指標」をオフ、または重要度から「高」を外す ③ 端末の iOS 設定で通知を許可しない ④ 時期で避ける(10-30 22:30 より前に確認を終える。行を残す限り、その後は①〜③が必要)

### 11.8 まだ確認できていないこと

- DEV の実データ(2026-10-24 の実行で入った行の件数・重複・`ingestion_logs`)は、読み取り専用SQLで確認が必要(11.1)
- 取りやめ・消えた行の処理は単体テスト(`tests/ingestion/blsScheduleSafety.test.ts`)で確認した。DEV DB でのジョブ実行(`--dry-run`を含む)は、承認後に行う

### 11.9 米国コアCPI・失業率・平均時給の追加(2026-10-26、HQ指示。**DEV への適用・実行はまだ。承認を得てから行う**)

仕様は data-sources.md 16章。DEV でやることは「migration の適用 → 11.1〜11.4 の手順でジョブ」の順。

1. **migration `20261026000001_us_bls_indicators.sql` を DEV に適用する**(3指標の`economic_indicators`の行と、USDJPY・EURUSD との`indicator_fx_pairs`の6行。`on conflict do nothing`なので2回流しても同じ)。確認:
   ```sql
   select i.code, i.display_name, i.importance, count(p.*) as fx_pairs
   from economic_indicators i left join indicator_fx_pairs p on p.indicator_id = i.id
   where i.code in ('US_CORE_CPI', 'US_UNEMPLOYMENT_RATE', 'US_AVG_HOURLY_EARNINGS')
   group by 1, 2, 3 order by 1;
   -- 3行・fx_pairs がどれも 2 が正しい
   ```
2. 11.1(P3 が5行)→ 11.2 の`--dry-run`。期待値は、11.2 の US_CPI・US_NFP の分に、3指標の分が足される: 2026-11-06 13:30Z より前の実行なら`plan.scheduled_insert`が **+42**(14か月 × 3)、`plan.released_insert`が **+30**(参照月 2025-12〜2026-09 の10か月 × 3。BLS が値を出していない月はその分減り、`not_yet_available`に入る)。`unmapped`は0、`indicator_not_in_db`は空
3. 11.3 の本実行・11.4 の確認。(2)(3) の SQL はそのまま使える(3指標の行も 08:30 ニューヨーク時間)
4. 画面: 指標一覧に「コアCPI」「失業率」「平均時給」が出る、イベント詳細・過去比較の値と前月比/前年比(`secondary_value_kind`がコアCPIは`MOM_PCT`、平均時給は`YOY_PCT`、失業率は null)

- **BLS API の回数が 3回 → 8回/実行**になる(data-sources.md 16.2)。dry-run と本実行を同じ日に続けて行っても16回で、v1 の25回/日に収まる
- **通知**: 11.7 と同じ。CPI の日は2件、雇用統計の日は3件が同じ時刻に予約される(平均時給は MEDIUM なので、重要度を HIGH だけにした設定では出ない)
- 戻し方: 3指標の`bls_schedule`の行が作られる前なら、`indicator_fx_pairs` → `economic_indicators` の順にこの3つの code の行を消す。作られた後は、行を消さずに報告して判断を仰ぐ

## 12. FOMCの会合日程と`is_provisional`の適用手順(2026-10-22、HQ承認 Task 3。**実行はまだ。承認を得てから行う**)

`supabase/migrations/20261022000002_economic_events_provisional.sql`(`economic_events`に`is_provisional boolean not null default false`を足すだけ。`add column if not exists`なので2回実行しても同じ)と、`npm run ingest:fomc-schedule`(data-sources.md 15章)を社内確認用DBで使うための手順。Claude(セッション)はDBに接続しておらず、どれも未実行。Migration の適用・デプロイ・ジョブの実行は、それぞれ別に承認を得てから行う。

### 12.1 順番(必ずこの順)と、順番を間違えたときに止まるもの

1. **Migration の適用**(12.3節)
2. **`notify pgrst, 'reload schema';`**(PostgREST に新しい列を読み直させる。これをしないと、列があっても API から見えず同じエラーになる)
3. **このブランチのコードのデプロイ**(Render。12.4節)
4. **ジョブの実行**(手動、`npm run ingest:fomc-schedule`。12.6節)

コードが Migration より先に動くと、`is_provisional`を select する次の処理が「列が無い」エラー(PostgREST のエラー → API は 500)になる。`grep -rn "is_provisional" src/repositories` で select している箇所を確認した結果(2026-10-22):

| 止まるもの | 原因の select |
|---|---|
| `GET /home`(**応答全体**。最初に読む経済指標の取得が失敗するため) | `homeRepository.ts`の`listEventsInRange` |
| `GET /calendar` | 同上 |
| `GET /events/{event_id}` | `eventsRepository.ts`の`getEventById` |
| `GET /events/{event_id}/revisions` | 同上(イベントの存在確認) |
| `GET /events/{event_id}/reaction` | 同上 |
| `GET /events/{event_id}/reaction/chart` | 同上 |
| `GET /events/{event_id}/history` | 同上(`routes/historical.ts`) |
| ジョブ `npm run ingest:fomc-schedule` | `ingestionRepository.ts`の`listEventsByProvider` |

通知(`GET /notifications/upcoming`・`GET /notifications`)・他の取り込みジョブは`is_provisional`を読まないので影響しない(他のジョブの insert は列を指定しないので、Migration 後は既定の`false`が入る)。

### 12.2 適用前の確認(読むだけ)

1. Supabase の画面の左上が `fx-event-analyzer-dev`、URL に `pbemckwnqmeaoveelihd` が含まれることを確かめる(本番のプロジェクトでないこと)
2. SQL Editor の新しいタブで次を実行し、結果を記録する

```sql
-- (a) 列がまだ無いこと(期待: 0行)
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'economic_events' and column_name = 'is_provisional';
-- (b) US_FOMC の行とイベント数(期待: is_active = true、events = 0)
select i.code, i.is_active, count(e.id) as events
from economic_indicators i left join economic_events e on e.indicator_id = i.id
where i.code = 'US_FOMC' group by i.code, i.is_active;
-- (c) fomc_schedule の行がまだ無いこと(期待: 0)
select count(*) from economic_events where provider = 'fomc_schedule';
-- (d) 比較用: economic_events の全件数
select count(*) as total_events from economic_events;
-- (e) 比較用: 予定の変更の記録の件数
select count(*) as schedule_changes from event_schedule_changes;
-- (f) 比較用: 予定の変更を記録するトリガーの定義(Migration の後に同じ文字列か比べる)
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgname in ('trg_economic_events_schedule_change', 'trg_speech_events_schedule_change') order by tgname;
```

### 12.3 Migration の適用とスキーマの再読み込み

3. SQL Editor の新しいタブに`20261022000002_economic_events_provisional.sql`の中身をそのまま貼って実行する
4. 続けて`notify pgrst, 'reload schema';`を実行する
5. 次で確かめる(読むだけ)

```sql
-- 期待: is_provisional | boolean | NO | false
select column_name, data_type, is_nullable, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'economic_events' and column_name = 'is_provisional';
-- 期待: true の行は 0(既存の行はすべて false)
select count(*) as provisional_rows from economic_events where is_provisional;
-- 期待: 12.2 (d) と同じ件数
select count(*) as total_events from economic_events;
-- 期待: 12.2 (f) と同じ文字列(economic_events は「AFTER UPDATE OF release_datetime, status」のまま)
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgname in ('trg_economic_events_schedule_change', 'trg_speech_events_schedule_change') order by tgname;
```

### 12.4 コードのデプロイ

6. 12.3節の確認がすべて期待どおりのときだけ、このブランチのコードを社内確認用の API(Render)にデプロイする(別の承認)
7. アプリ(または curl)で`GET /home`・`GET /calendar`・`GET /events/{id}`(既存のイベント)が 200 を返すことを確かめる。この時点では FOMC の行が無いので、画面の見た目は変わらない(全行`is_provisional = false`)

### 12.5 通知(FOMC固有の注意)

通知の仕組み(サーバーからのプッシュは無く、iOSが`GET /notifications/upcoming`の結果で端末のローカル通知を予約する。通知一覧は`GET /notifications`のときに書かれる)と、DEV確認中に意図しない通知を出さない一般的な方法は **dev-environment.md 11.7節(Task 2、別ブランチ)** にある。ここでは FOMC に固有のことだけを書く。通知のコードは変えていない。

- 指標`US_FOMC`は重要度`HIGH`(`supabase/seed.sql`)・精度`EXACT`・`SCHEDULED`なので、**暫定の会合も含めて**既定の設定(「プッシュ通知」「経済指標」オン、重要度`{HIGH,MEDIUM}`、5分前)なら通知の対象になる。暫定かどうかは通知の条件に入っていない
- **2026-10-28 18:00Z(日本時間 10/29 03:00、通知は既定で 02:55)は、既に`GET /notifications/upcoming`の7日間に入っている**。10/28 より前にジョブを動かすと、その後アプリを開いた(またはバックグラウンド更新が走った)テスト端末は、すぐに深夜 02:55 の「FOMC政策金利の5分前」のローカル通知を予約する。発表時刻の後に通知一覧を開けば一覧にも入る
- 次の 2026-12-09 19:00Z(暫定、日本時間 12/10 04:00、通知は 03:55)が7日間に入るのは 2026-12-02 19:00Z 以降。2027年分は 2027-01-20 以降まで入らない
- 防ぎ方: **ジョブを動かす前に**、11.7節の方法1(テスト用アカウントのアプリで「設定 → 通知」の「プッシュ通知」をオフにして保存)か方法2(「経済指標」をオフ、または重要度から「高」を外す)を行う。どちらもしないなら、2026-10-28 18:00Z を過ぎてから動かす(10/28 の行は作られず、12.6節の期待値は9行・確定0・暫定9になる。ただし12/02 以降は同じ対応が要る)
- 日時を後から直すと`event_schedule_changes`に`RESCHEDULED`が入り、通知一覧の「カレンダー更新」に出る(ローカル通知にはならない)。暫定→確定(12.7節)では何も出ない

### 12.6 ジョブの実行(手動。定期実行には登録していない)と期待値

8. このブランチのコードで、社内確認用DBの`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`を(会社のPCに残さない方法で)渡して`npm run ingest:fomc-schedule`を1回動かす。外部へのアクセスは無い。出力の1行JSONを記録する
   - 2026-10-28 18:00Z より前に動かした場合の期待: `inserted: 10`・`updated: 0`・`unchanged: 0`・`provisional: 9`・`past: 0`・`removed: []`・`errors: []`
   - それより後なら10月の会合は過去なので`inserted: 9`・`provisional: 9`・`past: 1`
9. 次で確かめる(読むだけ)

```sql
-- (1) 期待: 10行(確定 1 = 2026-10-28 18:00Z・false、暫定 9 = 2026-12-09 19:00Z と 2027年の8回・true)。
--     すべて EXACT・SCHEDULED・PENDING・HIGH
select e.provider_event_id, e.release_datetime, e.release_datetime_precision, e.status, e.data_status,
       e.is_provisional, e.importance
from economic_events e join economic_indicators i on i.id = e.indicator_id
where i.code = 'US_FOMC' and e.provider = 'fomc_schedule'
order by e.release_datetime;
-- (2) 期待: 時刻は 18:00Z か 19:00Z だけ(0行)
select provider_event_id, release_datetime from economic_events
where provider = 'fomc_schedule'
  and to_char(release_datetime at time zone 'UTC', 'HH24:MI') not in ('18:00', '19:00');
-- (3) 期待: 確定 1・暫定 9
select is_provisional, count(*) from economic_events where provider = 'fomc_schedule' group by is_provisional;
-- (4) 期待: 他の provider の行に暫定は無い(0)
select count(*) from economic_events where provider <> 'fomc_schedule' and is_provisional;
-- (5) 期待: 12.2 (d) + 10
select count(*) as total_events from economic_events;
-- (6) 期待: 値は入っていない(0)
select count(*) from event_snapshots s join economic_events e on e.id = s.event_id
where e.provider = 'fomc_schedule';
-- (7) 期待: 12.2 (e) と同じ件数(+0。新しい行を入れただけでは記録されない)
select count(*) as schedule_changes from event_schedule_changes;
-- (8) 期待: 最新の1行が SUCCESS、details に inserted / updated / unchanged / cancelled / provisional / past / removed
select status, fetched_count, success_count, error_count, details, started_at
from ingestion_logs where job = 'ingest:fomc-schedule' order by started_at desc limit 1;
```

10. もう一度動かし、`inserted: 0`・`updated: 0`・`unchanged: 10`(10/28 18:00Z より後なら`unchanged: 9`・`past: 1`)であること、(5)(7) が変わらないことを確かめる(何度動かしても同じ)
11. アプリのカレンダーで、2026-12-09 の FOMC の行に「予定（暫定）」が出て、2026-10-28 の行には出ないことを確かめる

### 12.7 暫定→確定の手順(会合ごとに人が行う。ジョブは自動で判断しない)

暫定→確定はコードの表(`src/ingestion/mappings/fomcSchedule.ts`)を直してジョブを動かしたときだけ変わる。ただし API は**発表日時を過ぎた行を`is_provisional = false`で返す**(`src/domain/provisional.ts`、api-design.md v1.32 14.6節)ので、表を直すのが遅れても、過ぎた会合に「予定（暫定）」が残ることはない。表を直すのは「次の会合」を確定と出すため。

例: 2026-10-27〜28 の会合の後

1. 会合日程のページ(https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)と calendar.json(https://www.federalreserve.gov/json/calendar.json)で、2026-12-09 の 14:00(`FOMC Meeting`)が載っていて日付が変わっていないことを確かめる
2. `mappings/fomcSchedule.ts` の`meeting('2026-12-08', '2026-12-09', true, true)`を`meeting('2026-12-08', '2026-12-09', true, false)`に直し、`CHECKED_AT`を確認した日にする。テスト`tests/ingestion/fomcSchedule.test.ts`の表の期待値(と`checkedAt`)も同じく直し、`npm test`を通す
3. コミットしてレビュー・マージ(通常のコードの変更と同じ)
4. **別の承認を得てから** `npm run ingest:fomc-schedule` を動かす。期待: `updated: 1`(12/09 の行の`is_provisional`が`false`になる)・残りは`unchanged`・10/28 は`past`
5. 次で確かめる: 12/09 の行が`is_provisional = false`、`release_datetime`は変わらない(19:00Z)、`event_schedule_changes`の件数は変わらない(トリガーは`AFTER UPDATE OF release_datetime, status`だけで、`is_provisional`だけの更新では起動しない。結合テスト`tests/integration/fomc-schedule.test.ts`で確認済み)

```sql
select provider_event_id, release_datetime, is_provisional, updated_at
from economic_events where provider = 'fomc_schedule' order by release_datetime;
select count(*) as schedule_changes from event_schedule_changes;
```

日付そのものが変わった場合は data-sources.md 15.6節の手順(`eventKey`)で直す。こちらは`RESCHEDULED`が1行記録され、カレンダー更新の通知が出る。

### 12.8 止める条件(どれか1つでも当てはまったら、先へ進まずに報告する)

- 12.2 で、プロジェクトが`fx-event-analyzer-dev`でない、(a) が1行以上、(b) が`is_active = false`または`events`が0でない、(c) が0でない
- 12.3 で、列の型・NOT NULL・既定値が期待と違う、`true`の行がある、全件数が変わった、トリガーの定義が 12.2 (f) と違う
- 12.4 で、デプロイ後に 12.1節の表のどれかが 500 を返す
- 12.6 で、ジョブが`FAILURE`、`errors`が空でない、件数・時刻・暫定の数が期待と違う、他の provider に暫定の行がある、`event_schedule_changes`が増えた、2回目で`inserted`か`updated`が0でない

### 12.9 戻し方(必要なとき。この順番で行う)

1. FOMCの行についた予定の変更の記録を消す: `delete from event_schedule_changes where kind = 'INDICATOR' and target_id in (select id from economic_events where provider = 'fomc_schedule');`(通知一覧に入った分も消すなら`delete from notification_inbox where kind = 'INDICATOR' and target_id in (select id::text from economic_events where provider = 'fomc_schedule');`)
2. FOMCの行を消す: `delete from economic_events where provider = 'fomc_schedule';`(値・反応の行は作らないので、外部キーで止まらない)
3. コードを前の版に戻して再デプロイする
4. **最後に**列を消す: `alter table economic_events drop column if exists is_provisional;` → `notify pgrst, 'reload schema';`

**コードを戻す前に列を消すと、12.1節の表の API(`GET /home`全体・`GET /calendar`・`GET /events/{id}`ほか)とジョブがすべて 500 になる。** 列を残したままでも前の版のコードは問題なく動く(読まないだけ)ので、迷ったら列は消さずに残す。

## 13. 無料プランの「過去の発表」制限の適用(2026-10-22、HQ判断「直近3回」・api-design.md v1.33 28.2節)

`supabase/migrations/20261022000001_past_release_access.sql` を社内確認用DBに適用し、Backend をデプロイする手順。**本番DBには適用しない。** この節の SQL は Claude(セッション)側からは実行していない(鍵が無い。§8.1 と同じ扱い)。実行するのは SQL Editor にアクセスできる人(大野さん、または鍵を持つ担当者)。

このマイグレーションがすること:

- `economic_events`・`event_snapshots`・`event_revisions`・`event_explanations`・`event_price_reactions` の「全認証ユーザー SELECT 可」の policy(`<表>_select_authenticated`)5件を消す
- 同じ5表の `anon`・`authenticated` の権限をすべて取り消す(`revoke all`。SELECT・INSERT・UPDATE・DELETE・TRUNCATE・REFERENCES・TRIGGER)。RLS は有効のまま
- 関数 `visible_released_event_ids(uuid[], int)`(SECURITY DEFINER、実行は `service_role` だけ)を足す

`fx_prices` の直接参照の禁止(`20261022000003_fx_prices_access.sql`)は別のマイグレーションで、手順は 13.7(これとは独立に適用・取り消しできる)。
取り込みの運用データの表の権限(`20261022000004_ingestion_tables_access.sql`)も別のマイグレーションで、手順は 13.8(同じく独立)。

**順番を必ず守る: マイグレーション → `notify pgrst` → Backend のデプロイ。** 先に Backend を入れると、FREE のユーザーで `GET /home`・`GET /indicators/{id}/events`・`GET /events/{id}` と子の `/revisions`・`/history`・`/reaction`・`/reaction/chart` が関数が無いため 500 になる(PRO は関数を呼ばないので影響なし)。逆にマイグレーションだけ先に入れても、今の Backend は service_role で読むので影響しない。iOS は同時に出す必要はない(古いアプリ ビルド17/18 も読める形で返す。api-design.md 14.1節「古いアプリとの互換」)。

### 13.1 適用前の確認(読むだけ)

1. Supabase の画面の左上が `fx-event-analyzer-dev`、URL に `pbemckwnqmeaoveelihd` が含まれることを確かめる(別のプロジェクトを開いていないこと)
2. SQL Editor の新しいタブで次を1つずつ実行し、結果をそのまま記録する(戻すときの基準になる)

```sql
-- (1) 5表の policy。期待: 各表に <表>_select_authenticated が1件ずつ、計5行(cmd = SELECT)
select tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions')
order by tablename, policyname;

-- (2) 5表の権限(戻すときの基準。結果を必ず保存する)
--     期待(Supabase の既定): anon / authenticated / service_role の3役割すべてが
--     DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions')
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;

-- (3) RLS が有効か。期待: 5行すべて relrowsecurity = true
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions');

-- (4) 5表を読む view。期待: 0行
select distinct v.relname as view_name, t.relname as table_name
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class v on v.oid = r.ev_class
join pg_class t on t.oid = d.refobjid
where d.classid = 'pg_rewrite'::regclass
  and v.oid <> t.oid
  and t.relname in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions');

-- (5) 5表の名前を本文に含む関数。期待: prevent_release_snapshot_mutation() の1行だけ(エラー文に
--     'event_snapshots:' と書いてあるだけで表は読まない)。適用後は visible_released_event_ids も加わる
select p.oid::regprocedure as function, p.prosecdef as security_definer
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosrc ~ '(economic_events|event_snapshots|event_revisions|event_explanations|event_price_reactions)';

-- (6) 5表のトリガー。期待: set_updated_at 系・trg_economic_events_schedule_change・
--     trg_prevent_release_snapshot_mutation だけ(どれも OLD/NEW しか使わない)
select tgrelid::regclass as table_name, tgname, tgfoid::regprocedure as function
from pg_trigger
where not tgisinternal
  and tgrelid::regclass::text in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions')
order by 1, 2;

-- (7) Realtime の publication に入っていないか。期待: 0行
select pubname, tablename from pg_publication_tables
where schemaname = 'public'
  and tablename in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions');

-- (8) GraphQL(pg_graphql)の有無。入っていても権限に従うので、適用後は anon / authenticated から5表が見えなくなるだけ
select extname, extversion from pg_extension where extname = 'pg_graphql';

-- (9) 関数名がぶつからないか。期待: 0行
select p.oid::regprocedure from pg_proc p where p.proname = 'visible_released_event_ids';
```

(1)〜(9) のどれかが期待と違えば適用しないで、結果を HQ に報告する。

### 13.2 適用

1. SQL Editor の新しいタブに `supabase/migrations/20261022000001_past_release_access.sql` の中身をそのまま貼って実行する(2回実行しても同じ結果になる書き方)
2. 続けて次を実行する(PostgREST にスキーマを読み直させる)

```sql
notify pgrst, 'reload schema';
```

### 13.3 適用後の確認(読むだけ。`begin`〜`rollback` の中でだけ役割を変える)

```sql
-- (1) 5表の policy。期待: 0行
select tablename, policyname from pg_policies
where schemaname = 'public'
  and tablename in ('economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions');

-- (2) 権限。期待: anon / authenticated は7列すべて false、service_role はすべて true(計15行)
select r.rolname, t.tbl,
       has_table_privilege(r.rolname, t.tbl, 'select') as sel,
       has_table_privilege(r.rolname, t.tbl, 'insert') as ins,
       has_table_privilege(r.rolname, t.tbl, 'update') as upd,
       has_table_privilege(r.rolname, t.tbl, 'delete') as del,
       has_table_privilege(r.rolname, t.tbl, 'truncate') as trn,
       has_table_privilege(r.rolname, t.tbl, 'references') as ref,
       has_table_privilege(r.rolname, t.tbl, 'trigger') as trg
from pg_roles r
cross join unnest(array['economic_events', 'event_snapshots', 'event_revisions', 'event_explanations', 'event_price_reactions']) as t(tbl)
where r.rolname in ('anon', 'authenticated', 'service_role')
order by t.tbl, r.rolname;

-- (3) RLS。期待: 5行すべて relrowsecurity = true(13.1 (3) と同じ SQL)

-- (3b) 前回を隠す発表の判定(読むだけ)。期待: 指標ごとに rn = 3 の行だけ previous_locked = true
--      (その指標に RELEASED が4回以上あるとき)。1・2回目は false
begin;
set local role service_role;
select e.indicator_id, e.release_datetime, v.previous_locked
from visible_released_event_ids(array(select id from economic_indicators where is_active), 3) v
join economic_events e on e.id = v.event_id
order by e.indicator_id, e.release_datetime desc
limit 30;
rollback;

-- (4) 関数の実行権限。期待: anon = false、authenticated = false、service_role = true
select r.rolname,
       has_function_privilege(r.rolname, 'visible_released_event_ids(uuid[],integer)', 'execute') as can_execute
from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
order by r.rolname;
```

アプリの利用者の役割で読めないこと(1ブロックずつ実行する。エラーになるのが正しい):

```sql
-- 期待: ERROR 42501 permission denied for table economic_events
begin;
set local role authenticated;
select count(*) from economic_events;
rollback;
```

`economic_events` を `event_snapshots`・`event_revisions`・`event_explanations`・`event_price_reactions` に替えて同じく4回、`authenticated` を `anon` に替えて5回。どれも 42501 になること(0 件が返るのは誤り)。

service_role では動くこと(期待: エラーなく件数が返る):

```sql
begin;
set local role service_role;
select count(*) from economic_events;
select count(*) from visible_released_event_ids(array(select id from economic_indicators where is_active), 3);
rollback;
```

### 13.4 Backend のデプロイと画面の確認

1. 13.3 がすべて期待どおりなら、Backend をデプロイする(このブランチを `claude/fx-settings-screens` に取り込んで push すると Render が入れ替える。§4)
2. `https://<名前>.onrender.com/health` が `{"status":"ok"}` を返すことを確かめる
3. **FREE のアカウント**(`VIEW_ADVANCED_STATS` が無い)でアプリを開き、次を確かめる
   - `GET /home`: 過去の日付で、その指標の直近3回より古い発表は値が出ず鍵の印、直近3回は値が出る
   - `GET /indicators/{id}/events`(指標詳細の過去の発表): 新しい3回は値あり、4回目より古いものは鍵の印。未発表の行は今までどおり
   - `GET /events/{id}`: 4回目より古い発表を開くと 200 で鍵の印(エラー画面にならない)。値動きの表も鍵の印で、相場反応詳細へは進まない
   - 直近3回目の発表(4回目より古い発表がある指標): 結果・予想は出て、**前回だけ鍵の印**(前回比も出ない)。解説は出ない。改定履歴に「前回」の改定が出ない。1回目・2回目の前回は今までどおり出る(一覧・ホーム・詳細・比較の表で同じ)
4. **PRO のアカウント**で同じ画面を開き、すべての発表に値が出て鍵の印が無いことを確かめる
5. 過去イベント比較(`GET /indicators/{id}/comparison`)は FREE 3行(api-design v1.37。それまでは5行)・PRO 20行。FREE では直近3回より古い行が鍵の印で値・pips が出ず、平均などの統計はロックされていない行だけから出ること。PRO はすべての行に値が出ること

### 13.5 中止する条件(どれかが起きたら止めて HQ に報告する)

- 13.3 で `anon`・`authenticated` の役割のまま5表から行や件数が返った(42501 にならない)、または `has_table_privilege` に true がある
- service_role で `visible_released_event_ids` がエラーになった、または関数が見つからない
- デプロイ後、FREE のアカウントで `/home`・`/indicators/{id}/events`・`/events/{id}` のどれかが 500 になった(すぐ 13.6 の順で戻すか、Backend だけ前の版に戻す)
- PRO のアカウントで鍵の印が出た
- FREE で直近3回目の発表の前回が数字で出た、または1回目・2回目の前回が鍵の印になった

### 13.6 戻す手順

1. 先に Backend を前の版に戻す(FREE でも関数を呼ばなくなる)。関数を消すのは必ずこの後
2. 権限と policy を戻す。権限は 13.1 (2) で記録した内容と同じに戻す(Supabase の既定どおりなら下の `grant all` でよい)。policy は `20260917000009_rls.sql` と同じ定義

```sql
grant all on economic_events to anon, authenticated;
grant all on event_snapshots to anon, authenticated;
grant all on event_revisions to anon, authenticated;
grant all on event_explanations to anon, authenticated;
grant all on event_price_reactions to anon, authenticated;

create policy economic_events_select_authenticated on economic_events
  for select using (auth.role() = 'authenticated');
create policy event_snapshots_select_authenticated on event_snapshots
  for select using (auth.role() = 'authenticated');
create policy event_revisions_select_authenticated on event_revisions
  for select using (auth.role() = 'authenticated');
create policy event_explanations_select_authenticated on event_explanations
  for select using (auth.role() = 'authenticated');
create policy event_price_reactions_select_authenticated on event_price_reactions
  for select using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
```

3. Backend を戻したあとでだけ、関数を消す

```sql
drop function if exists visible_released_event_ids(uuid[], int);
notify pgrst, 'reload schema';
```

4. 13.1 (1)〜(3) をもう一度実行し、適用前に記録した結果と同じになったことを確かめる

### 13.7 fx_prices の直接参照の禁止(2026-10-22、HQ指示。`20261022000003_fx_prices_access.sql`)

`fx_prices` の「全認証ユーザー SELECT 可」の policy(`fx_prices_select_authenticated`)を消し、`anon`・`authenticated` の権限をすべて取り消す(RLS は有効のまま)。これまでは、アプリの anon key でログインした利用者が `fx_prices` を直接読み、ロックされた発表の前後の足から値動きを計算し直せた。

- **13.1〜13.6 とは別に、単独で適用・取り消しできる。** Backend・取り込みジョブ・レートアラートの判定は service_role で読むので、Backend のデプロイの前でも後でもよい(順番の決まりは無い)。iOS は `fx_prices` を直接読まない
- 13.1 の1と同じく、プロジェクトが `fx-event-analyzer-dev` であることを先に確かめる

適用前の確認(読むだけ。結果を記録しておく):

```sql
-- (1) policy。期待: fx_prices_select_authenticated の1行(cmd = SELECT)だけ
select policyname, cmd, roles, qual from pg_policies
where schemaname = 'public' and tablename = 'fx_prices';

-- (2) 権限(戻すときの基準)。期待: anon / authenticated / service_role がすべて
--     DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'fx_prices'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee order by grantee;

-- (3) RLS。期待: relrowsecurity = true
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relname = 'fx_prices';

-- (4) fx_prices を読む view・関数・Realtime。期待: すべて0行
select distinct v.relname as view_name
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class v on v.oid = r.ev_class
where d.classid = 'pg_rewrite'::regclass and d.refobjid = 'public.fx_prices'::regclass and v.oid <> d.refobjid;
select p.oid::regprocedure from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'fx_prices';
select pubname from pg_publication_tables where schemaname = 'public' and tablename = 'fx_prices';
```

適用: SQL Editor にファイルの中身を貼って実行し、続けて `notify pgrst, 'reload schema';`。

適用後の確認:

```sql
-- (1) policy。期待: 0行(13.7 の適用前 (1) と同じ SQL)

-- (2) 権限。期待: anon / authenticated は7列すべて false、service_role はすべて true
select r.rolname,
       has_table_privilege(r.rolname, 'fx_prices', 'select') as sel,
       has_table_privilege(r.rolname, 'fx_prices', 'insert') as ins,
       has_table_privilege(r.rolname, 'fx_prices', 'update') as upd,
       has_table_privilege(r.rolname, 'fx_prices', 'delete') as del,
       has_table_privilege(r.rolname, 'fx_prices', 'truncate') as trn,
       has_table_privilege(r.rolname, 'fx_prices', 'references') as ref,
       has_table_privilege(r.rolname, 'fx_prices', 'trigger') as trg
from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
order by r.rolname;
```

```sql
-- (3) 期待: ERROR 42501 permission denied for table fx_prices(authenticated を anon に替えてもう1回)
begin;
set local role authenticated;
select count(*) from fx_prices;
rollback;
```

```sql
-- (4) 期待: エラーなく件数が返る
begin;
set local role service_role;
select count(*) from fx_prices;
rollback;
```

適用後、次の20分ごとの為替の取り込み(GitHub Actions、§3)が今までどおり成功し、アプリのホームの主要通貨のレートと相場反応詳細のチャートが出ることを確かめる(どちらも Backend 経由なので変わらないはず)。

中止する条件:

- (3) で行や件数が返った、または (2) の anon / authenticated に true がある
- (4) がエラーになった、または為替の取り込み・ホームのレート・チャートが失敗するようになった(すぐ下の手順で戻す)

戻す手順(権限は適用前 (2) の記録と同じに戻す。Supabase の既定どおりなら `grant all` でよい。policy は `20260917000009_rls.sql` と同じ定義):

```sql
grant all on fx_prices to anon, authenticated;

create policy fx_prices_select_authenticated on fx_prices
  for select using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
```

戻したあと、適用前の (1)〜(3) をもう一度実行し、記録と同じになったことを確かめる。

### 13.8 取り込みの運用データの表の権限(2026-10-22、HQ判断。`20261022000004_ingestion_tables_access.sql`)

`ingestion_logs`・`ingestion_staged_values`・`official_observations`(公式の結果の値を含む)の `anon`・`authenticated` の権限をすべて取り消す。RLS は有効のまま、ポリシーは変えない(もともと無い)。13.1〜13.7 とは別に、単独で適用・取り消しできる。順番の決まりは無い。

今の状態と使っているもの(マイグレーションとコードから):

| 表 | RLS | ポリシー | 適用前の anon / authenticated の権限 | 読み書きするもの(どれも service_role) |
|---|---|---|---|---|
| `ingestion_logs` | 有効(`20260917000009_rls.sql`) | なし | Supabase の既定(ALL)。ポリシーが無いので RLS で0件・書き込み不可 | 取り込みジョブ(`ingestionRepository.ts`、書き込み・読み込み)、品質レポート(`quality/reader.ts`、読むだけ) |
| `ingestion_staged_values` | 有効(`20261015000003_ingestion_accuracy.sql`) | なし | 同上 | 取り込みジョブ(読み書き)、品質レポート(読むだけ) |
| `official_observations` | 有効(同上) | なし | 同上 | 取り込みジョブ(`upsertOfficialObservations`) |

- 品質レポートは `npm run report:data-quality`(GitHub Actions)と `GET /quality-report`(`INTERNAL_REPORT_TOKEN` が無いと404。社内向けで、アプリからは使わない)
- 3表を読む view・関数は無い。トリガーは `ingestion_staged_values` の `set_updated_at` だけ

適用前の確認(読むだけ。結果を記録しておく):

```sql
-- (1) RLS。期待: 3行すべて relrowsecurity = true
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('ingestion_logs', 'ingestion_staged_values', 'official_observations');

-- (2) ポリシー。期待: 0行
select tablename, policyname from pg_policies
where schemaname = 'public' and tablename in ('ingestion_logs', 'ingestion_staged_values', 'official_observations');

-- (3) 権限(戻すときの基準)。期待: 3表 × anon / authenticated / service_role がすべて
--     DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('ingestion_logs', 'ingestion_staged_values', 'official_observations')
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee order by table_name, grantee;

-- (4) 3表を読む view。期待: 0行
select distinct v.relname as view_name, t.relname as table_name
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class v on v.oid = r.ev_class
join pg_class t on t.oid = d.refobjid
where d.classid = 'pg_rewrite'::regclass and v.oid <> t.oid
  and t.relname in ('ingestion_logs', 'ingestion_staged_values', 'official_observations');
```

適用: SQL Editor にファイルの中身を貼って実行し、続けて `notify pgrst, 'reload schema';`。

適用後の確認:

```sql
-- (1)(2) は適用前と同じ結果であること

-- (3) 権限。期待: anon / authenticated は7列すべて false、service_role はすべて true(計9行)
select r.rolname, t.tbl,
       has_table_privilege(r.rolname, t.tbl, 'select') as sel,
       has_table_privilege(r.rolname, t.tbl, 'insert') as ins,
       has_table_privilege(r.rolname, t.tbl, 'update') as upd,
       has_table_privilege(r.rolname, t.tbl, 'delete') as del,
       has_table_privilege(r.rolname, t.tbl, 'truncate') as trn,
       has_table_privilege(r.rolname, t.tbl, 'references') as ref,
       has_table_privilege(r.rolname, t.tbl, 'trigger') as trg
from pg_roles r
cross join unnest(array['ingestion_logs', 'ingestion_staged_values', 'official_observations']) as t(tbl)
where r.rolname in ('anon', 'authenticated', 'service_role')
order by t.tbl, r.rolname;
```

```sql
-- (4) 期待: ERROR 42501 permission denied for table ingestion_logs
--     (表を ingestion_staged_values・official_observations に、authenticated を anon に替えて計6回)
begin;
set local role authenticated;
select count(*) from ingestion_logs;
rollback;
```

```sql
-- (5) 期待: エラーなく件数が返る
begin;
set local role service_role;
select count(*) from ingestion_logs;
select count(*) from ingestion_staged_values;
select count(*) from official_observations;
rollback;
```

適用後、次の取り込み(GitHub Actions の為替・要人発言、§3)と毎日の品質レポートが今までどおり成功することを確かめる(どちらも service_role)。

中止する条件:

- (3) の anon / authenticated に true がある、または (4) で件数が返った
- (5) がエラーになった、または取り込み・品質レポートが失敗するようになった(すぐ下の手順で戻す)

戻す手順(権限は適用前 (3) の記録と同じに戻す。Supabase の既定どおりなら `grant all` でよい。ポリシー・RLS は変えていないので戻すものは無い):

```sql
grant all on ingestion_logs to anon, authenticated;
grant all on ingestion_staged_values to anon, authenticated;
grant all on official_observations to anon, authenticated;
notify pgrst, 'reload schema';
```

戻したあと、適用前の (1)〜(3) をもう一度実行し、記録と同じになったことを確かめる。

## 14. 品質レポート第9章「要人発言の鮮度」の読み方(2026-10-23、HQ承認「要人発言の鮮度監視」)

`npm run report:data-quality`・`GET /api/v1/quality-report` の最後に「## 9. 要人発言の鮮度」が付く(第1〜8章は変えていない)。READ-ONLY。対象期間(`days`)に関係なく、取得元ごとに `ingest:speeches` の最新の実行と最後の SUCCESS を読む。異常があってもレポートのジョブは失敗にしない(終了コード0のまま)。

- 列は `frb_calendar`(FRB のカレンダー)と `ecb_press_rss`(ECB の RSS)。**FRB と ECB は混ぜずに別々に判定する**。実行記録が無い取得元も列は出る(「—(実行記録なし)」)
- 行: 判定・判定の理由・最新の実行(開始/完了/状態とエラー件数)・取得件数(前回の実行との差)・取り込み件数・スキップ理由・取得元の最新の予定(`source_latest_at`)・取得元の未来の予定(`source_future_count`)・DB の最新(`speech_events.statement_datetime`、状態問わず)・DB の未来の SCHEDULED 件数・最後の SUCCESS
- 判定(上ほど優先。1つだけ出る):
  1. **取得の失敗(異常)**: 最新の実行(`started_at` が最大)が FAILURE / PARTIAL・エラーあり・取得件数0、または最後の SUCCESS から18時間以上(SUCCESS なしを含む)。前に SUCCESS があっても、その後の実行が失敗していればこれになる。→ Actions の実行ログ・`error_message` を見る(取得元の障害・形式変更など)
  2. **取り込みの漏れ(異常)**: 取得元の最新の予定が直近14日以降(未来を含む)で、DB の最新より新しい(DB に行が無い場合を含む)。取得元の最新はスキップした項目も含むので、最新の予定が**話者未登録(SPEAKER_UNKNOWN / SPEAKER_NOT_IN_DB)**でスキップされたときもこれになる。→ スキップ理由の行を見て、話者の追加(migration + `speakers.ts` の別名)が必要か判断する。期間内の項目がすべて時刻なしの実行(4.)では判定しない
  3. **取得元の更新なし(注意)**: 取得元の最新の予定が10日以上前で、未来の予定が0件。→ 取得元の URL・形式が変わっていないか確認する
  4. **時刻なしで未取り込み(情報)**: 期間内の項目がすべて TIME_NOT_EXACT(公開時刻のみ)で取り込み0件。**ECB の通常の状態**で、対応は不要
  5. **正常**
- 「—(記録なし)」: `source_latest_at` を記録する前のコードで動いた実行。2.・3. は判定せず、1.・4. だけで判定する。次の `ingest:speeches` の実行から記録される
- 優先順位を 異常 > 注意 > 情報 にしたのは、ECB の「時刻なし」(情報)が「更新なし」(注意)を隠さないようにするため
- しきい値は `src/ingestion/quality/metrics.ts` の `SPEECH_SUCCESS_MAX_AGE_HOURS`(18)・`SPEECH_SOURCE_STALE_DAYS`(10)。1回でも失敗すると、次の実行が成功するまで「取得の失敗」になる。18時間は、取り込みの間隔(1日2回、06:15 / 18:15 JST = 12時間)に余裕を持たせた値で、実行そのものが止まったことを検出するためのもの
- ホームの `speeches_status.stale`(api-design.md v1.34)は、FRB の「取得の失敗」と同じ判定
