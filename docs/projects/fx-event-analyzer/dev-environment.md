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
