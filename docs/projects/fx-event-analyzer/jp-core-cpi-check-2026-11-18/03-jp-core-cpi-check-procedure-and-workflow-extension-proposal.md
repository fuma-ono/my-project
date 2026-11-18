# 日本コア CPI: 確認手順と、ワークフロー拡張案(提案のみ。実装・push・実行はしない)

担当 D。2026-11-18。**文書だけ**(コード・ワークフロー・Secrets・DB・migration・DEV・TEST・PROD の変更なし。**ワークフローの変更・実行は、HQ の個別承認が出るまで行わない**)。指標追加の最終決定は保留(HQ の判断)。
前提: 本書の確認は、**今日(2026-11-18)の公開ページの取得**と**既存コードの記録(2026-11-11、実 API)**に基づく。e-Stat API の実行は、この環境からはできない(appId を持たず、Actions も起動できない)。**確認できなかった項目は、推測せず「未確認」とする**。

## 1. 確認の状況(今日時点)
| 項目 | 状況 | 根拠 |
|---|---|---|
| 品目一覧の取得手順 | **手順は確定**(§2.1)。**実行は未実施**(承認待ち) | 本書 §2 |
| `cat01=0001` と `0161` の値の比較 | 2026-09 分は**統計局の公表値で一致**(総合 2.1・コア 2.1)。API での比較は**未実施** | 統計局のページ(2026-11-18 取得)、既存コードの記録 |
| `tab=3` の意味(前年比であること) | **前年同月比【%】**(既存コードの記録、2026-11-11)。**今日の API での再確認は未実施** | `estatCpi.ts` の冒頭コメント |
| 前月比データの取得可否 | **未確認**(§2.4) | `tab=2` の中身を確認していない |
| 生鮮食品を除く総合の定義 | **未確認**(§2.5) | 今日取得した統計局のページ(解説・FAQ)で、定義の文面を見つけられなかった |
| e-Stat 利用規約の該当箇所 | **確認済み**(§3。原文を今日取得) | e-Stat の規約ページ |
| 既存 JP_CPI との重複・公表日・更新タイミング | **比較済み**(§4) | 既存コード・日程表 |

## 2. 確認の手順(読み取り専用。API の実行は承認後)
前提: 統計表 `0004052037`(消費者物価指数 2025 年基準)。API は e-Stat API 3.0(`https://api.e-stat.go.jp/rest/3.0/app/json`)。`appId` は GitHub Secret `ESTAT_APP_ID`(値は出力しない)。

### 2.1 品目一覧の取得
1. `GET getMetaInfo?appId=…&statsDataId=0004052037`
2. 応答の `GET_META_INFO.METADATA_INF.CLASS_INF.CLASS_OBJ` のうち `@id = "cat01"`(品目)の `CLASS[]` を読む(1 件のときは配列でなくオブジェクトになるため、配列に直す)。
3. 出す項目: `@code`・`@name`・`@level`・`@parentCode`(あれば)。名前は「0001 総合」のように code が前に付いて返る(既存コードの記録)。
4. 絞り込み: `@code` が `0001`・`0161`、または `@name` に「生鮮」「エネルギー」を含むもの(全品目は数百件あり、出力が長くなるため)。
5. 判定: `0161` の `@name` に「生鮮食品を除く総合」が含まれること。**含まれなければ、取り込みに使わない**(既存コードの方針: code と名前の**両方**が合うものだけ使う)。

### 2.2 `cat01=0001` と `cat01=0161` の値の比較
1. `GET getStatsData?appId=…&statsDataId=0004052037&cdTab=3&cdArea=00000&cdCat01=0001,0161&cdTime=2026000909`(2026 年 9 月、公表済み)。
2. 応答の `STATISTICAL_DATA.DATA_INF.VALUE[]`(各要素 `@tab`・`@cat01`・`@area`・`@time`・`@unit`・`$`)から、`0001` と `0161` の値を取る。
3. 期待値: **2.1 と 2.1**(統計局の公表値。今日取得: 総合 2.1%・生鮮食品を除く総合 2.1%)。小数 1 桁で比較する。
4. 違う月も見る(例: `cdTime=2026000808` など、過去の月)と、**総合とコアが違う月**で、取り違えが無いことを確認できる。比較の相手の公表値は、統計局のページ(過去の月の公表)で確認する。
5. **11/20 の公表後**(10 月分)は、`cdTime=2026001010` で同じ比較を行い、統計局の公表値と照合する。

### 2.3 `tab=3` の意味(前年比であること)
1. `getMetaInfo` の `@id = "tab"` の `CLASS[]` を読み、`@code`・`@name`・`@unit` を出す。
2. 期待: `3` = 「前年同月比」、`@unit` = `%`(既存コードの記録: `1` = 指数、`2` = 前月比・前年比・前年度比、`3` = 前年同月比【%】)。
3. 実データでの確認: `cdTab=3` の値(2.1)が、統計局の公表値の「前年同月比 2.1% の上昇」と一致すること(§2.2)。**名前と値の両方で確認**する。

### 2.4 前月比データの取得可否
- 既存の記録では、`tab=2` は「前月比・前年比・前年度比」で、1 つの項目名に複数の比が束ねられている。**`tab=2` の値が前月比を指すのか(時間軸の種類で変わるのか)は未確認**。
- 確認の手順: `getStatsData?…&cdTab=2&cdArea=00000&cdCat01=0001,0161&cdTime=2026000909` を取り、返る `VALUE[]` の `@unit`・件数・値を見る。**統計局の公表の前月比(原数値の前月比があれば)と照合**する。取得できない・意味が特定できなければ、**前月比は載せない**(指数の水準から自前で計算しない = 既存の方針)。
- なお、**季節調整済みの前月比**は、別の統計表(季節調整値)にある可能性があり、`0004052037` に含まれるかは**未確認**。

### 2.5 「生鮮食品を除く総合」の定義
- 統計局の公開ページでは、**定義の文面を、今日は見つけられなかった**(CPI の解説ページ・FAQ を取得して「生鮮食品を除く総合」を検索したが、該当の記述なし)。
- 確認の手順: ①統計局の「消費者物価指数 品目分類の解説(2025 年基準)」の PDF(公表ページからリンク)で、**生鮮食品(生鮮魚介・生鮮野菜・生鮮果物)の範囲**と、「生鮮食品を除く総合」の定義を読む ②e-Stat の `cat01` の階層(`@parentCode`・`@level`)で、`0161` が総合の直下の分類であることを確認する。
- 現時点では、「生鮮食品を除く総合」は、統計局が公表で「生鮮食品を除く総合指数」と呼ぶ分類(総合から生鮮食品を除いた指数)であることまでは、公表ページで確認済み。**生鮮食品の品目の範囲は未確認**。

## 3. e-Stat の利用条件(該当箇所、2026-11-18 に原文を取得)
**API 機能利用規約**(https://www.e-stat.go.jp/api/agreement/):
- **第 3 条(アプリケーション ID)**: appId を**第三者に譲渡・貸与してはならない**。
- **第 6 条(コンテンツの利用)**: API が提供する情報の利用条件は、**「政府統計の総合窓口(e-Stat)利用規約」に準じる**。
- **第 7 条(クレジット表示)**: API を利用したサービスを提供する場合、**別途定める方法で、出所を明示**する(既存コードの `ESTAT_API_CREDIT`: 「このサービスは、政府統計総合窓口(e-Stat)のAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません。」)。
- **第 8 条(禁止事項)**: 本機能の運用の妨害、**短時間における大量のアクセスその他、運用に支障を与える行為**。
- **第 10 条(免責)**: 国・統計センターは、コンテンツの完全性・正確性等を保証しない。
**e-Stat 利用規約**(https://www.e-stat.go.jp/terms-of-use):
- コンテンツは、**複製・公衆送信・翻案等、自由に利用できる。商用利用も可能**。
- **出典を記載**する(例: 「出典:政府統計の総合窓口(e-Stat)(https://www.e-stat.go.jp/)」)。**編集・加工した場合は、その旨を記載**する。**国が作成したかのような態様で公表・利用してはいけない**。
- 第三者が権利を持つコンテンツは別(利用者の責任で確認)。国は、利用者の行為について責任を負わない。
- **政府標準利用規約(第 2.0 版)に準拠し、CC BY 4.0 と互換**。
- 既存の出典の表示: `ESTAT_ATTRIBUTION`(出典・API のクレジット)。コア CPI にも同じ表示を使う。

## 4. 既存 JP_CPI との比較
| 項目 | 既存 `JP_CPI`(総合) | `JP_CORE_CPI`(案) |
|---|---|---|
| 統計表 | `0004052037`(2025 年基準) | **同じ** |
| 地域・表章項目 | `area=00000`(全国)・`tab=3`(前年同月比) | **同じ** |
| 品目(`cat01`) | `0001`(総合) | **`0161`(生鮮食品を除く総合)** |
| 公表日 | 統計局の公表(例 2026-11-20 08:30 JST)。日程表: 2026-10→11-20、2026-11→12-18、2026-12→2027-01-22、2027-01→02-19、2027-02→03-19 | **同じ公表で、同時に出る**(日程表も同じ行) |
| e-Stat への反映の遅れ | 公表から数日(2026-09 分: 10/23 公表 → `table_updated` 10/30、7 日) | **同じ統計表なので同じ**(総合・コアは同時に更新される想定。**同時であることは未確認**) |
| 取得の呼び出し | 1 回(`cdCat01=0001`) | 同じ呼び出しに `cdCat01=0001,0161` と書けば、**追加の API 呼び出しは不要**(2 品目を 1 回で取る) |
| データの重複 | — | **値は 2026-09 分で同じ(2.1)**。月によっては違う(食料の変動が大きい月)。**同じ値に見える月がある**(同日・同時刻の 2 イベント) |
| 初回値の期限 | 14 日(`JP_CPI_MAX_DAYS_AFTER_RELEASE`) | 同じ |
- 既存コードの変更点(実装時): `estatCpi.ts` の `JP_CPI_CLASSES.item` を、指標ごとの品目(0001・0161)に一般化。日程表・初回値・改定の仕組みは共通。
- 英国の `GB_CPI`/`GB_CORE_CPI` と同じ構成(同じ公表で 2 つの指標)。

## 5. ワークフロー拡張案(提案のみ。実装・push・実行しない)
### 5.1 方針と 2 つの案
| 案 | 内容 | 既存ワークフローへの影響 |
|---|---|---|
| **A: 既存の `fx-event-analyzer-estat-check.yml` に step を追加** | 既存のファイルに、独立した step を 1 つ足す | **11/20 の初回取得確認(同じワークフロー)の実行に、追加の step が混ざる**(実行時間が約 10 秒増える。失敗すれば run 全体が失敗に見える)。`continue-on-error: true` で、失敗の影響は避けられる |
| **B(推奨): 別のワークフローファイル**(例 `fx-event-analyzer-estat-core-check.yml`) | 専用ブランチ `verify/fx-estat-core-check` への push と手動実行だけで動く、独立したファイル | **既存のワークフローに一切触れない**(11/20 の確認と干渉しない)。ただし、**ワークフローの追加**であり、HQ の承認が要る |
- 本書では **B を推奨**。差分は B の形で書く(A にする場合は、同じ step を既存ファイルに足す)。

### 5.2 追加する処理の具体的な差分(案 B、新規ファイル。**まだ作成・push していない**)
`.github/workflows/fx-event-analyzer-estat-core-check.yml`(新規):
```yaml
# 日本コア CPI の分類・値の確認(読み取り専用。HQ 承認後に使う)
# - 動くのは、ブランチ verify/fx-estat-core-check への push と、手動の実行だけ(定期実行なし)。
# - DB・Supabase の Secret は使わない。e-Stat の公開 API(getMetaInfo・getStatsData)を数回呼ぶだけ。
# - 出力は注記(::notice)だけ。appId は出さない(マスクし、エラーにも URL を出さない)。
name: FX Event Analyzer - e-Stat core CPI check (read-only)

on:
  push:
    branches:
      - 'verify/fx-estat-core-check'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: fx-estat-core-check
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      ESTAT_APP_ID: ${{ secrets.ESTAT_APP_ID }}
    steps:
      - uses: actions/checkout@v4
      - name: Core CPI classification and values (no appId in output)
        run: python3 .github/scripts/estat_core_check.py
```
`.github/scripts/estat_core_check.py`(新規。標準ライブラリだけ。他のパッケージ・npm・リポジトリのコードを実行しない):
```python
import json, os, sys, urllib.error, urllib.parse, urllib.request

BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json'
STATS = '0004052037'
EXPECT = {'0001': '2.1', '0161': '2.1'}  # 2026-09 分(統計局の公表値、2026-10-23 公表)

def out(title, value):
    body = json.dumps(value, ensure_ascii=False).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::notice title={title}::{body}')

app_id = os.environ.get('ESTAT_APP_ID', '').strip()
if not app_id:
    out('core 0 secret', {'registered': False})
    sys.exit(0)
print(f'::add-mask::{app_id}')

def get(path, **params):
    q = urllib.parse.urlencode({'appId': app_id, 'statsDataId': STATS, **params})
    try:
        with urllib.request.urlopen(f'{BASE}/{path}?{q}', timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'HTTP {e.code} on {path}')          # URL(appId を含む)は出さない
    except Exception as e:
        sys.exit(f'{type(e).__name__} on {path}')

def as_list(x):
    return x if isinstance(x, list) else [x]

meta = get('getMetaInfo')['GET_META_INFO']
objs = {o['@id']: o for o in as_list(meta['METADATA_INF']['CLASS_INF']['CLASS_OBJ'])}
keep = lambda c: c['@code'] in ('0001', '0161') or '生鮮' in c['@name'] or 'エネルギー' in c['@name']
cat01 = [c for c in as_list(objs['cat01']['CLASS']) if keep(c)]
out('core 1 cat01', {'items': cat01, 'table_updated': meta['METADATA_INF']['TABLE_INF'].get('UPDATED_DATE')})
out('core 2 tab', {'items': as_list(objs['tab']['CLASS'])})

values = {}
for tab in ('3', '2', '1'):
    data = get('getStatsData', cdTab=tab, cdArea='00000', cdCat01='0001,0161', cdTime='2026000909')
    rows = as_list(data['GET_STATS_DATA']['STATISTICAL_DATA']['DATA_INF'].get('VALUE', []))
    values[tab] = [{'cat01': v['@cat01'], 'time': v['@time'], 'unit': v.get('@unit'), 'value': v['$']} for v in rows]
out('core 3 values', values)
got = {v['cat01']: v['value'] for v in values['3']}
out('core 4 verdict', {'tab3_matches_bureau': all(got.get(k) == v for k, v in EXPECT.items()), 'got': got, 'expected': EXPECT})
```
(上のスクリプトは**提案**で、まだ作成・実行していない。実装時に、`cat01` の名前の確認(§2.1 の 5)の判定も出力に加える。)

### 5.3 API リクエストの内容と取得する項目
| # | リクエスト | 取る項目 |
|---|---|---|
| 1 | `getMetaInfo`(`statsDataId=0004052037`) | `TABLE_INF.UPDATED_DATE`、`cat01` の分類(`@code`・`@name`・`@level`・`@parentCode`)のうち `0001`・`0161`・名前に「生鮮」「エネルギー」を含むもの、`tab` の全分類(`@code`・`@name`・`@unit`) |
| 2 | `getStatsData`(`cdTab=3`、`cdArea=00000`、`cdCat01=0001,0161`、`cdTime=2026000909`) | 前年同月比。`@cat01`・`@time`・`@unit`・値 |
| 3 | 同上、`cdTab=2` | 前月比の候補(§2.4)。`@unit`・値 |
| 4 | 同上、`cdTab=1` | 指数の水準(参考。計算には使わない) |
- 合計 **4 回**の API 呼び出し(1 回の実行)。「短時間の大量アクセス」(規約第 8 条)に当たらない件数。再実行は人が必要なときだけ。

### 5.4 出力する検証結果
`::notice` の 4 件: `core 1 cat01`(品目・更新日)、`core 2 tab`(表章項目の一覧)、`core 3 values`(`tab` 別の値)、`core 4 verdict`(`tab=3` の値が統計局の公表値と一致するか)。**公開の Actions API の注記から読める**(認証不要。既存の確認と同じ読み方)。

### 5.5 既存ワークフローへの影響
- **案 B**: 既存のファイル・トリガー・Secret に変更なし。`concurrency` のグループは独立(`fx-estat-core-check`)。FX 価格・要人発言・公式統計の取り込みの `concurrency` を妨げない。
- **案 A**: 既存の確認(11/20 の初回取得確認)の run に step が増える(§5.1)。
- どちらも、定期実行(`schedule`)は付けない。

### 5.6 認証情報の取り扱い
- 使う Secret は **`ESTAT_APP_ID` だけ**(他の Secret は参照しない)。環境変数として、**そのジョブにだけ**渡す。
- 値はログに出さない: 先頭で `::add-mask::`(GitHub の Secret の自動マスクに加えて、明示)。**エラーの文面に URL(appId を含む)を出さない**(例外は、種類と path だけ)。出力は、注記の JSON(分類・値)だけ。
- `permissions: contents: read`(書き込み権限なし)。`push` トリガーのブランチを `verify/fx-estat-core-check` に限定(通常のブランチ・PR・fork では動かない)。
- appId を第三者に渡さない(規約第 3 条)。出力に appId が含まれないことを、実行後に確認する。

### 5.7 DB 書き込みが発生しないことの保証
1. **DB の接続情報を渡さない**: ワークフローが参照する Secret は `ESTAT_APP_ID` だけ(`SUPABASE_*` などを参照しない)。
2. **リポジトリのコードを実行しない**: `npm`・`node`・取り込みのジョブ(`src/jobs/*`)を呼ばない。Python の標準ライブラリだけで、外部への通信は `api.e-stat.go.jp` に限る。
3. **書き込みの API を持たない**: e-Stat の API は読み取り専用(`getMetaInfo`・`getStatsData`)。
4. **静的検査で固定**: ワークフローのテストで、次を検査する(§5.8)。

### 5.8 テスト方法(承認後の実装時)
1. **`actionlint`**(既存の `fx-event-analyzer-workflow-lint.yml` と同じ方式): 新ファイルの文法・式・Secret の参照の検査。
2. **静的な検査(ワークフローのテスト)**: 新ファイルに ①`secrets.` の参照が `ESTAT_APP_ID` だけ ②`SUPABASE`・`npm`・`node`・`supabase` の文字列が無い ③`schedule` が無い ④`push` のブランチが `verify/fx-estat-core-check` だけ ⑤`permissions` が `contents: read` だけ ⑥`concurrency` のグループが他のワークフローと重ならない。
3. **スクリプトの単体テスト**(ローカル、通信なし): `get` を差し替え、`getMetaInfo`・`getStatsData` の応答の写し(既存のテストの fixture と同じ形)で、**分類の抽出・値の整形・判定**を検証。**appId(テスト用の偽の値)が、出力・エラーのどこにも出ない**ことを確かめる(例外の経路を含む)。
4. **実行の確認**(承認後、1 回): `verify/fx-estat-core-check` へ push して実行し、4 件の注記が出ること・appId が出ていないことを確認する。**11/20 の初回取得確認とは別の日・別のブランチ**で行う(干渉しない)。

## 6. 承認が必要な事項(HQ)
1. 案 B(新しい確認用ワークフローとスクリプトの追加)の承認(または案 A)。
2. 実行(`verify/fx-estat-core-check` への push と、1 回の確認)の承認。
3. 結果を受けての、`JP_CORE_CPI` の指標追加の判断(最終決定は HQ。本書は決定しない)。

## 7. 未確認事項(まとめ)
1. 品目一覧・`0161` の名前・`0001`/`0161` の値・`tab` の分類の、**今日の API での確認**(承認後の実行が要る)。
2. **前月比**(`tab=2` の中身、季節調整済みの前月比の所在)。
3. **「生鮮食品を除く総合」の定義**(生鮮食品の範囲)。
4. 総合とコアが e-Stat に**同時に反映される**こと。
5. e-Stat の `table_updated` の**時刻**(日付まで)。
