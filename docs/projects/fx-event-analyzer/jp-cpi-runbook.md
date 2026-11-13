# JP_CPI(日本の消費者物価指数)の DEV での取り込み手順

HQ指示 2026-11-12「JP_CPI の事前準備」。**この文書の手順は、HQ の承認の後に行う。** 承認前の今は、準備(コード・テスト・CI・接続の確認)だけ。

## 1. 準備の状態(2026-11-12 時点)

| 項目 | 状態 |
|---|---|
| 取り込みのコード(公表予定・値の取得・出典の表示) | `claude/fx-indicator-coverage` に実装済み。settings には 11/11 に一度入ったが、HQ の指示で外した(11241362)。このブランチ `claude/fx-jpcpi-prep` は、その取り消しの取り消し(`git revert 11241362`)＋ワークフローの手動 target の追加 |
| e-Stat の統計表 | 2025年基準 0004052037。表章項目 3 = 前年同月比、品目 0001 = 総合、地域 00000 = 全国。本物の API で、2026年9月分 = 2.1% を確認(統計局の公表と一致) |
| `ESTAT_APP_ID` | 大野さんが GitHub の Secret に登録済み(登録されていることの確認は、接続の確認のワークフローで行う。値は出さない) |
| DEV の指標 | `JP_CPI` は DEV にある(ペア2、イベント0。2026-11-12 の読み取り専用の確認) |
| DEV のイベント | まだ無い(公表予定を入れる target が settings に無い) |
| 接続の確認 | `.github/workflows/fx-event-analyzer-estat-check.yml`(DB・Supabase の Secret を使わない。e-Stat を2回呼ぶだけ) |
| 手動の target(このブランチにだけ) | `jp-cpi-schedule-dry-run`・`jp-cpi-schedule`・`jp-cpi-values-dry-run`・`jp-cpi-values`。定期実行には入れない。公表予定のジョブにも `--dry-run` を足した(11/13) |
| 予行演習 | 接続の確認のワークフローが、本物の e-Stat の API と取り込みのコード(dry-run)を、メモリ上の疑似のイベントで動かす(`npm run rehearse:jp-cpi`)。A: 公表済みの2026年9月分 → PUBLISH 2.1 / B: 10月分(公表前)→ NOT_YET_AVAILABLE。**11/20 以降に B を流して PUBLISH になれば、本番の取り込みを流してよい** |

## 2. 11/20 の公表に向けた時系列

| 日時 | 内容 |
|---|---|
| 〜11/19 | 承認 → settings に統合 → CI → `jp-cpi-schedule`(公表予定 5件を入れる) |
| **11/20 08:30 JST(= 11/19 23:30 UTC)** | 2026年10月分の全国 CPI が公表される(e-Stat の公表予定) |
| 11/20 以降 | e-Stat のデータベースへの反映は、公表から数日遅れることがある(2025年基準の表は、9月分が 10/23 に公表、10/30 に反映)。値が出たら `jp-cpi-values-dry-run` → `jp-cpi-values` |
| 公表から14日以内(〜12/4) | 初回値として保存できる期間。過ぎると、改定後の値を初回値にしないため保存しない(`TOO_LATE_FOR_FIRST_RELEASE`) |

公表予定(コードの表。e-Stat の公表予定のページと照合済み): 10月分 11/20、11月分 12/18、12月分 2027-01-22、2027年1月分 2027-02-19、2月分 2027-03-19(いずれも 08:30 JST)。

## 3. 手順(承認の後)

### 工程 1: settings への統合
- `claude/fx-jpcpi-prep` を settings に統合する(通常の `--no-ff` のマージ。スクリーンショットの差分は 0 件にする)。
- 必要な CI: Backend CI(lint-typecheck-unit・db-and-integration)と Workflow lint が成功すること。
- 影響: API の JP_CPI の項目に、e-Stat の出典(`attribution`)が付く。Render への反映は不要(API の項目の追加ではなく、値の追加だけ)。
- 失敗したとき: 統合のコミットを `git revert -m 1 <統合の SHA>` で取り消す。

### 工程 2: 公表予定を入れる(先に `target = jp-cpi-schedule-dry-run`、次に `target = jp-cpi-schedule`)
- dry-run の期待: 5件の INSERT(08:30 JST = 前日 23:30 UTC。下の表)、更新 0・過去 0。
- DEV の `economic_events` に、provider `estat_cpi_schedule` のイベントが 5件入る(SCHEDULED・PENDING)。
- 確認(読み取り専用の確認の target を使う): JP_CPI のイベントが5件、公表日時が上の表のとおり(08:30 JST = 前日 23:30 UTC)。
- 失敗したとき / 取り消し:
  ```sql
  delete from economic_events
  where provider = 'estat_cpi_schedule' and status = 'SCHEDULED' and data_status = 'PENDING';
  ```
  (値を保存した後は、RELEASE の値は DB のトリガーで消せないので、この SQL は値を入れる前だけ)

### 工程 3: 公表の後の dry-run(`target = jp-cpi-values-dry-run`)
- DB に書かない。出力は、各回の `plan`(PUBLISH / NOT_YET_AVAILABLE / …)と値。
- 期待する結果: 10月分が `PUBLISH`・値は e-Stat の画面の「前年同月比 総合 全国 2026年10月」と同じ。
- 値が出ていなければ `NOT_YET_AVAILABLE`(e-Stat への反映待ち)。**無理に取らない。** 翌日以降にもう一度。

### 工程 4: 本番の取り込み(`target = jp-cpi-values`)
- 条件(コードの決まり): 公表の時刻を過ぎている・公表から14日以内・その月の値がちょうど1件の数値・統計表の更新日が公表日以降。
- 保存されるもの: `event_snapshots`(RELEASE。actual のみ。forecast・previous は入れない。出典 `総務省統計局（e-Stat）`、VERIFIED)と、`economic_events` の RELEASED・AVAILABLE。
- 確認: 読み取り専用の確認(指標の章)で、JP_CPI の 10月分が RELEASED・値あり。e-Stat の画面の値と同じ。
- 公表後に値が改定されたら、`event_revisions` に改定として足す(初回値は変えない)。

## 4. 接続の確認(承認なしで、今できる)
- ブランチ `verify/fx-estat-check` に push すると、`fx-event-analyzer-estat-check.yml` が動く。
- 出力(注記): Secret の登録の有無(真偽と長さの区分だけ)・API の状態・統計表の更新日・分類の確認(前年同月比・全国・総合)・2026年9月分の値。**appId は出さない。**

## 5. 守ること
- DEV だけ。PROD は触らない。
- `ESTAT_APP_ID` は Secret から渡し、ログ・注記・コミットに出さない(コードは `redactAppId` と HTTP の URL の伏せ字で守る)。
- e-Stat の利用条件: 商用利用可、出典の表示、API のクレジット(「このサービスは、政府統計総合窓口(e-Stat)のAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません。」)を `attribution` の notice に入れてある。
- 短時間の大量アクセスはしない(1回の実行で、メタ情報と値を各1回)。
- main への統合・定期実行の開始は、別の承認。
