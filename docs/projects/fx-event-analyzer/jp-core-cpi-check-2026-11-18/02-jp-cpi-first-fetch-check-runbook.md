# JP CPI 初回取得確認の手順書(11/20 公表後、読み取り専用)

担当 D。**実行は 2026-11-20 の公表後**(日本時間 08:30 = 2026-11-19 23:30 UTC)。作成日 2026-11-18(現在 09:30 UTC。公表の約 38 時間前)なので、**今は実行できない**。本書は、準備と手順の確定。結果は、実行後に本書の §6 に追記する。

## 1. 目的・範囲
HQ 指示(「JP CPI 初回取得確認」):
- e-Stat の**メタ情報の更新時刻**
- **統計データの更新時刻**
- 取得できる**値と対象期間**
- **公式発表値との一致**
- **初回取得に必要な時間**
dry-run の結果を提出する。**DB への保存・定時実行は行わない**。

## 2. 使うもの(既存の確認ワークフロー。変更しない)
- `.github/workflows/fx-event-analyzer-estat-check.yml`(`verify/fx-estat-check` の先頭 `6272eec3`)。
  - 起動: `verify/fx-estat-check` への **push**(または手動実行。この環境からは手動実行できない)。
  - DB に接続しない。Supabase の Secret を使わない。`ESTAT_APP_ID` は出力しない。
  - 出力: Actions の注記(`::notice`)。**公開の Actions API の注記から読める**(認証不要。2026-11-13 の実行で、読み取りを確認済み)。
- 内容(既存): ①Secret の有無 ②`getMetaInfo`(`table_updated`、分類の確認)③`getStatsData`(全国・総合・前年同月比の **2026-09 と 2026-10**)④取り込みの本物のコードの dry-run(`rehearse:jp-cpi`、メモリ上の疑似イベント、DB なし)。
- **ワークフロー・スクリプトは変更しない**。トリガーは**空コミットの push**だけ。

## 3. 読み方の注意(誤読の防止)
1. **`rehearsal B release morning verdict` の `ok` は、公表後は `false` になる**。スクリプトの期待値は「公表前の朝 = `NOT_YET_AVAILABLE`」に固定されている(`expected: {"action":"NOT_YET_AVAILABLE"}`)。**公表後に `PUBLISH` と値が出れば、本番の取り込みを流してよい印**(スクリプトの冒頭コメント)。`ok:false` は失敗ではない。判定は、`plan` の `action` と `value` で読む。
2. **`table_updated` は日付だけ**(例 `2026-10-30`)。時刻は無い。**「統計データ更新時刻」は、日付までしか分からない**(時刻は未確認のまま、確認できない)。
3. e-Stat の反映は、**公表より数日遅れることがある**(2026-09 分は 10/23 公表 → `table_updated` 10/30)。取り込みは、`table_updated ≥ 公表日` のときだけ初回値を受け付ける(既存の設計)。
4. 初回値として受け付ける期限は、公表から **14 日**(`JP_CPI_MAX_DAYS_AFTER_RELEASE`)。

## 4. 実行の手順(2026-11-20 以降)
**準備(公表前に済ませる)**: `verify/fx-estat-check` を取得する専用の作業ツリーを用意する(新しいパスを使い、作成の成功を確認)。以後、そのブランチへの**空コミット**だけを push する。ファイルは変更しない。
```
git worktree add ../fx-estatcheck origin/verify/fx-estat-check   # 作成の成功を確認してから
git commit --allow-empty -m "JP CPI 初回取得確認(<日時>)" && git push origin HEAD:verify/fx-estat-check
```
**実行の予定**(日本時間。1 回の実行は約 40 秒):
| 回 | 時刻 | 目的 |
|---|---|---|
| 1 | 11/20 08:35 | 公表の直後。値が出ているか |
| 2 | 11/20 09:30 | 同上 |
| 3 | 11/20 12:00 | 午前の確認 |
| 4 | 11/20 18:00 | 当日の確認 |
| 5〜 | 11/21 から毎朝 09:00・夕 18:00 | 初回の値が出るまで(最大 14 日) |
- 値が出て、`table_updated ≥ 2026-11-20` になった回で、**終了**(それ以降は実行しない)。
- 各回の結果は、`gh` なしで、公開の Actions API から読む:
  `GET /repos/fuma-ono/my-project/actions/runs?branch=verify/fx-estat-check` → `jobs` → `check-runs/<job_id>/annotations`。

## 5. 記録する項目(各回)
| 項目 | 取り方 |
|---|---|
| 実行の開始・終了時刻、所要時間 | run の `created_at`・job の `started_at`・`completed_at` |
| メタ情報の更新(`table_updated`) | 注記 `estat 2 meta` |
| 2026-10 の値(全国・総合・前年同月比) | 注記 `estat 3 values` の `2026001010`(**公表前は値なし**) |
| 取り込みの dry-run の判定 | 注記 `jpcpi rehearsal B release morning`(`action`・`value`・`table_updated`) |
| 公式発表値 | 統計局の公表ページ(https://www.stat.go.jp/data/cpi/sokuhou/tsuki/index-z.html)の「総合 前年同月比」(Shift_JIS。2026-11-18 に取得方法を確認済み) |
| 一致 | e-Stat の値(小数 1 桁)= 統計局の公表値 |
| 初回取得に必要な時間 | **(a) 公表(08:30 JST)から、e-Stat の API に値が出るまでの経過**(上の回の最初の「値あり」の時刻 − 08:30。**回の間隔が精度の限界**)、**(b) 1 回の取得の所要時間**(約 40 秒。2026-11-13 の実行: 02:02:57 → 02:03:34 = 37 秒) |

## 6. 結果(実行後に追記)
(未実行)

## 7. 制約・未確認
- 実行は 2026-11-20 08:30 JST 以降。**今回は実行していない**。
- `table_updated` の**時刻**(日付より細かい更新時刻)は、既存の出力に無く、確認できない。
- 初回取得に必要な時間は、**実行の間隔の精度**でしか測れない(1 回の実行が約 40 秒でも、公開から値が出るまでの遅れは、回の間隔で丸められる)。
- 実行には、`verify/fx-estat-check` への空コミットの push が要る(この環境から可能。`gh` なし)。**ワークフロー・スクリプトは変更しない**。
- 禁止事項(遵守): DB への保存、定時実行、migration、DEV・TEST・PROD の変更、秘密情報の取得・表示、ワークフローの変更。
