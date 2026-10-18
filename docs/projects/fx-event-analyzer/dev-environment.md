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

- 新しく作るときは、`fx-event-analyzer-backend/supabase/migrations/` を名前順にすべて流し、`supabase/seed.sql` は **1〜94行目(指標・通貨ペア・指標×通貨ペア)だけ**流す。95行目以降はテスト用の架空のイベント・値動きなので、本物のデータと混ぜない
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
