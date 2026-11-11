## 14. 【HQ指示】settings系統への統合(2026-11-11)

HQ指示「イベント戦略分析のsettings系統への統合」への対応。13章で移植した`claude/fx-event-strategy-dedup-settings-port`(HEAD `48ac584`)を、PRを作成した上で`claude/fx-settings-screens`へマージした。

### 14.1 PR作成・差分確認

- PR: https://github.com/fuma-ono/my-project/pull/12(`claude/fx-event-strategy-dedup-settings-port` → `claude/fx-settings-screens`)
- 差分: 115ファイル(+1100/−27)、コミット9件 — 13章の7コミット(cherry-pick)+ CIによるiPhoneスクリーンショット自動更新1件 + 13章追記の報告書コミット1件。
  - `ci-screenshots/`配下のPNG102ファイルの差分は、`claude/fx-settings-screens`に今も残っている旧来の「UIテスト成功後にスクリーンショットを自動commitする」仕組み(`commit-screenshots`ジョブ)によるもので、`build25`では既に削除済みの仕組み。想定どおりの差分であり、意図しない変更ではない。
  - **build25側の16コミットの混入なし**: PRのコミット一覧を確認し、7件のcherry-pick以外はCIスクリーンショット更新・報告書追記のみであることを再確認した。
  - **既存機能との競合なし**: 対象ファイル(`eventStrategyAnalysis.ts`等バックエンド6ファイル・iOS6ファイル)は、cherry-pick前の`claude/fx-settings-screens`と分岐元(`7e0bcf3`)とで完全一致(diffゼロ、13.3節で確認済み)。FREE/PROアクセス制御(`EventDetailCards.swift`/`EventDetailView.swift`)・Settings画面は今回のPRで一切変更していない。

### 14.2 PR上のCI結果と再実行

- PRの `db-and-integration`・`lint-typecheck-unit`・`build-and-test`チェックは初回から成功。
- `screenshots`チェックが、PRを「レビュー可能」にした際の2回目の実行(run `42949300948`)で**失敗**した。ログを確認した結果、失敗箇所は`testCaptureAllScreens(): XCTAssertTrue failed - Home tab did not appear after login`で、ログイン直後のタブ表示に関するテストだった。
  - 今回の7コミットはログイン・タブ切り替えのコードを一切変更していない(変更範囲はイベント戦略分析関連のみ、14.1節参照)。
  - 同じコミット(`48ac584`)は、ポートブランチへのpush時の初回実行(run `42944717993`、13.4節)では全く同じテストスイートが成功していた。
  - 以上から、今回の変更による回帰ではなく、一時的な不具合(環境・タイミングに起因するフレーク)と判断し、`rerun_failed_jobs`で該当ジョブのみ再実行した → **再実行で成功**(全5チェック成功、`mergeable_state: clean`を確認)。

### 14.3 マージ

- マージ方法: squash
- マージコミット: `db4b93f`(https://github.com/fuma-ono/my-project/commit/db4b93fa887e68b215bb3f734770b1bb1abb5cde)
- マージ後、CIによるiPhoneスクリーンショット自動更新コミット`aee2e96`(`[skip ci]`)が続けて記録された(14.2節で触れた既存の仕組みによる、想定どおりの追加コミット)。

### 14.4 マージ後の`claude/fx-settings-screens`でのCI結果(HEAD `db4b93f`、全て成功)

- `Backend CI`: **成功** — https://github.com/fuma-ono/my-project/actions/runs/42955727314
- `iOS Build & Test`: **成功** — https://github.com/fuma-ono/my-project/actions/runs/42955727306
- `UI Screenshots`: **成功** — https://github.com/fuma-ono/my-project/actions/runs/42955727329(14.2節のフレークは再現せず)

### 14.5 既存のFREE/PRO制御・DEV・TestFlightへの影響

- FREE/PROアクセス制御・Settings・既存UIデザインへの変更なし(14.1節で差分ゼロを確認済み)。
- mainへのマージは行っていない。DEVデプロイ・TestFlight配信も行っていない(禁止事項どおり)。DB変更・追加の価格データ取得・有料サービス導入もなし。

### 14.6 未解決事項・次の実装候補

- 未解決事項:
  1. `claude/fx-build25-fixes`側だけにある16コミット(StrategyAnalysis関連のUI改善・FREE/PRO制御等)は今回も移植範囲外のまま(11章・13.6節から変更なし)。
  2. TestFlightへの実際の配信はまだ行っていない(次のHQ承認が必要)。
- 次の実装候補: build25側の16コミット(UI改善)を、同様の手順でsettings系統へ個別に移植することが考えられる。
