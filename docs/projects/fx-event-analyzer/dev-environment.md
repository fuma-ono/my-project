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
