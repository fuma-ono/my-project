# イベント戦略分析：重複排除・集計改善・AI分析基盤の整備(実装報告)

## 1. 担当・ブランチ・変更ファイル

- 担当: A(iOS・バックエンド実装、今回のみバックエンドにも変更あり。Bへの依頼はしていない)
- ブランチ: `claude/fx-event-strategy-dedup`(`claude/fx-build25-fixes` から分岐、`7e0bcf3` を起点)
- 対象: `fuma-ono/my-project` モノレポ。本番DB・本番API・mainブランチへの直接マージは行っていない。
- 変更ファイル:
  - バックエンド(`fx-event-analyzer-backend/`)
    - 新規 `src/domain/marketEventGrouping.ts`(同時発表イベントのグループ化。純粋関数)
    - 新規 `tests/domain/marketEventGrouping.test.ts`
    - 変更 `src/domain/eventStrategyAnalysis.ts`(リスク特性の追加: pips_5m/30m/60m、round_trip_15m/60m)
    - 変更 `tests/domain/eventStrategyAnalysis.test.ts`(上記の単体テスト追加)
    - 変更 `src/repositories/eventsRepository.ts`(`EventRow.provider` を追加。既存フィールドの削除・変更なし)
    - 変更 `src/repositories/historicalRepository.ts`(`listReleasedEventsBefore` に `provider` を追加、新規 `listCoReleasedEvents`)
    - 変更 `src/routes/historical.ts`(`GET /events/{id}/strategy-analysis` に `co_released_indicators` を追加)
    - 変更 `tests/integration/strategy-analysis.test.ts`(同時発表・round_trip・pips_5mの統合テスト追加。DEV DBが無いため今回は実行できず、未実行であることをCI結果の章に明記)
  - iOS(`fx-event-analyzer/`)
    - 変更 `FXEventAnalyzer/Features/StrategyAnalysis/StrategyAnalysisModels.swift`(新フィールドのdecode追加、Sell the Factの文言分岐)
    - 変更 `FXEventAnalyzer/Features/StrategyAnalysis/StrategyAnalysisViewModel.swift`(`co_released_indicators` を状態に追加)
    - 変更 `FXEventAnalyzer/Features/StrategyAnalysis/StrategyAnalysisView.swift`(同時発表バッジの追加、Sell the Fact文言の分岐)
    - 変更 `FXEventAnalyzerTests/StrategyAnalysisTests.swift`(上記の単体テスト追加)

## 2. 実装内容(STEP1〜5)

### STEP1: 同時発表イベントのグループ化(最重要)

- 問題: 米雇用統計の `US_NFP`・`US_UNEMPLOYMENT_RATE`・`US_AVG_HOURLY_EARNINGS` は、実データ確認(`docs/projects/event-strategy-trading-utility-report.md`、未コミットの調査用ワークツリーに作成済み)で、2026-11-06 13:30 UTC の**同じ1回の発表**であることが判明している(全ペア・全時間足で `pips`・`max_upward`・`max_downward` が完全一致)。しかし現状、指標ごとに別の `economic_events` 行・別の戦略分析として扱われ、3つの指標ページを個別に見ると「3回の市場イベントを分析した」と誤解できる。
- 対応: 既存の `economic_events.provider`(取り込みジョブ、例 `bls_schedule`)と `release_datetime` が完全一致する行を同じ市場イベントとみなす、新しい純粋関数 `groupByMarketEvent`(`src/domain/marketEventGrouping.ts`)を追加した。`provider` が無い行(発表元が不明)は、誤って同一視しないよう、常に自分だけのグループになる。
- DB変更なし: 新しいテーブル・列は増やしていない。既存の `economic_events.provider`・`release_datetime` だけで、リクエストごとにその場で計算する。
- API: `GET /events/{id}/strategy-analysis` の応答に `co_released_indicators`(対象イベントと同時発表の他の指標。`indicator_id`・`indicator_code` の配列。無ければ空配列)を追加した。既存のフィールドは変更していない(追加のみ)。
- iOS: 分析画面に、同時発表の指標があるときだけ出る小さいバッジ(「同時発表: US_UNEMPLOYMENT_RATE」等)を追加した。既存のカード構成・配色・デザインは変更していない。

### STEP2: 集計改善(dedup-aware counters)

- `marketEventGrouping.ts` に `summarizeMarketEventCoverage(groups)` を追加し、「指標イベント数(重複排除前)」と「独立市場イベント数(重複排除後)」を区別して数えられるようにした(単体テストで、米雇用統計3指標+JOLTS1件 → 指標イベント数4・独立市場イベント数2、を確認)。
- **今回のスコープで実際に使った範囲**: `GET /events/{id}/strategy-analysis` は元々1つの指標だけを見るAPIで、複数指標をまとめて集計する既存のエンドポイント・画面は無い。そのため今回は、この関数を「対象イベント1件が、何件の他指標と同時発表か」を数える `co_released_indicators`(STEP1)の基礎として使う形にとどめた。
- **今回やらなかったこと**: 複数指標・複数イベントをまとめて集計する新しいダッシュボード/APIは作っていない(「不要なテーブル・API・複雑な仕組みを増やさない」という制約のもと、依頼にない新画面を今回追加することは見送った)。`summarizeMarketEventCoverage` はテスト済みの再利用可能な関数として用意してあるので、将来そうした集計画面が必要になった時にそのまま使える。

### STEP3: リスク特性の追加

- `STRATEGY_TIMEFRAMES` を `['1m','15m','60m']` → `['1m','5m','15m','30m','60m']` に拡張した。5分・30分の値動きは `event_price_reactions` に**既に保存されている**(DEV DB実データ確認済み。`docs/projects/event-strategy-data-readiness-report.md` 参照)ため、新しい Twelve Data 取得は増えない。
- `StrategyReleaseRow` に `pips_5m`・`pips_30m`・`pips_60m`(既存の `high_break_60m` 等はあったが生のpipsは返していなかった)を追加。
- `round_trip_15m`・`round_trip_60m`(1分の高値・安値を、その窓の中で**両方とも**抜けた「往復」)を追加。既存の `high_break_*`・`low_break_*` の判定(1分足の欠損確認を含む)をそのまま利用する派生値で、どちらかが `null` なら `round_trip` も `null`。
- 実データで確認した「USDJPYが15分までに高値だけ抜け、安値は60分までに抜けた(往復)」という型を、単体テスト(`tests/domain/eventStrategyAnalysis.test.ts`)に代表的なフィクスチャとして再現し、`round_trip_15m: false, round_trip_60m: true` を確認した(※実際のDB値そのものは手元に無いため、確認済みの「高値だけ早く抜け、安値は後で抜けた」という型を再現したテストデータであり、実際のpips数値そのものの再掲ではない)。

### STEP4: AI分析基盤の整備(今回はデータ構造のみ。AI呼び出しは追加していない)

- 新しい有料AI APIの導入・AI呼び出しの追加は行っていない(指示の「新規契約・追加課金は禁止」どおり)。
- 「基盤」として今回整備したのは、将来AIが要約・分析する際に使える、**事実だけが入った・出典を区別できる**データである:
  - `co_released_indicators`(この発表が単独の市場イベントか、複数指標の同時発表かを区別できる — AIが「3つの指標が動いた」のように誤って書くのを防ぐ材料になる)
  - `round_trip_15m/60m`・`pips_5m/30m/60m`(断定的な「勝率」ではなく、観測された値動きの経過を時系列で区別できる)
  - `forecast`(既存。予想が無い発表は `null` のまま — AIが「予想を上回った」と作り話をしないための前提情報)
- `requirements.md` §11.3/§12.3 の「AIは価格予測をしない」「出典・事実/推測の区別を明示する」という既存の方針は、今回のAPI追加でも引き続き守っている(新しい `co_released_indicators`・`round_trip_*` も、保存済みの値から機械的に導出した事実であり、傾向の断定・売買の推奨は一切追加していない)。
- **今回実装していないもの**: 実際のAI要約・AI分析の呼び出し自体。これは「基盤整備」の範囲外(今回の指示どおり)。

### STEP5: Sell the Fact の null-forecast ハンドリング

- 問題: `US_CPI`・`US_CORE_CPI` 等、BLS由来の指標は `forecast` が構造的に常に `null`(DEV DB実データ確認済み)。この場合 Sell the Fact は「件数が足りないから分析データ準備中」なのか「この指標はそもそも判定できない」のか、既存の文言(「分析データ準備中（予想と結果がそろった発表が足りません）」)では区別できなかった。
- バックエンド側のデータは変更不要(既存の `forecast` フィールドが既に `null`/値ありを正しく返している)。
- iOS側で、直近の発表(`releases`)のどれにも `forecast` が無い場合は「この指標は予想値が無く、判定できません」という別の文言を出すよう、`StrategyAnalysisText.sellTheFactLine` とカードの文言を分岐させた。件数が増えても解決しない構造的な制約であることが分かるようにした。
- 予想値の取得元調査: 既存の調査(`docs/projects/fx-event-analyzer/data-sources.md`、未コミットの調査用ワークツリーで確認済み)で、無料で使える市場コンセンサス予想の提供元は見つかっていない(Enterprise/有料プラン限定のものが中心)。FRBの「ナウキャスト」系モデルは予想とは性質が異なる(モデルの推定値で、アナリスト予想のコンセンサスではない)ため、今回は代替として採用しない。新しい調査・契約は行っていない(指示の「有料サービスの契約・利用開始は禁止」どおり)。

## 3. 同時発表グループ化の仕様

- グループの鍵: `provider` と `release_datetime` の完全一致。
- `provider` が `null` の行は、他のどの行とも合わせない(常に自分だけのグループ)。発表元が分からない行を誤って同一視するリスクを避けるため。
- 新しいテーブル・マイグレーションは使わない(既存列のみ)。
- 実装: `fx-event-analyzer-backend/src/domain/marketEventGrouping.ts`(`groupByMarketEvent`・`coReleasedRows`・`summarizeMarketEventCoverage`)。

## 4. 修正前後のサンプル数(米雇用統計の例)

| | 修正前 | 修正後 |
|---|---|---|
| 指標ごとのイベント数(2026-11-06の発表) | 3件(US_NFP・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGSを別々に集計) | 3件(指標ごとの戦略分析はそのまま。仕様は変えていない) |
| 実際の市場イベント数 | 区別できない(APIからは分からない) | 1件(`co_released_indicators` で他の2指標が同時発表と分かる) |

※ `GET /events/{id}/strategy-analysis` は1指標ごとのAPIであり、既存の「直近5回の発表」の集計対象(1つの指標の過去のRELEASED)自体は変更していない。変わったのは、「この発表が他の指標との同時発表かどうか」が初めてAPIから分かるようになった点。

## 5. テスト内容・結果

- 単体テスト(DB不要。`npm test`で今回実行・全件確認済み):
  - `tests/domain/marketEventGrouping.test.ts`(新規、9件): グループ化・同時発表の抽出・集計のロジックを確認。
  - `tests/domain/eventStrategyAnalysis.test.ts`(既存+追加3件): pips_5m/30m・往復(round_trip)の判定、1分足欠損時にroundTripもnullになることを確認。
  - バックエンド全体: `npm test` → **1161 passed, 268 skipped(DB接続が必要な統合テストのみskip)**、`npm run typecheck`・`npm run lint` → エラーなし。
- 統合テスト(実データベース Postgres が必要。本サンドボックスにはDEV DBの認証情報が無く、過去のタスクで確認済みのとおり**今回も実行できていない**):
  - `tests/integration/strategy-analysis.test.ts` に、同時発表(`co_released_indicators`)のケースと、既存フィクスチャから導出できる `round_trip_15m`・`pips_5m` の期待値を追加した。コード・アサーションはレビュー可能な状態で用意したが、ローカル・本サンドボックスでは実行できていない。**CIの `Backend CI`(Postgresを使う統合テスト込み)で実行・結果を確認する**(6章参照)。
- iOSテスト(Xcode/Swiftツールチェーンがこのサンドボックスに無いため、ローカルでは実行できず、**CIの `iOS Build & Test` で実行・結果を確認する**):
  - `FXEventAnalyzerTests/StrategyAnalysisTests.swift` に、`co_released_indicators`のデコード、pips_5m/30m/60m・round_tripのデコード、Sell the Factの文言分岐(予想値が全く無い場合と、単に件数が足りない場合を区別)のテストを追加した。

## 6. CI結果

- プッシュ後、GitHub Actionsの `iOS Build & Test` と `Backend CI`(統合テスト込み)の結果をこの節に追記する。
- コミットハッシュ: このセクションの直後に追記する。

## 7. DB変更の有無と内容

- **無し(意図的な設計判断)**。
- 新しいテーブル・カラム・マイグレーションは一切追加していない。同時発表の判定は、既存の `economic_events.provider`・`release_datetime` だけをその場で比較して行う(`marketEventGrouping.ts`)。5分・30分の値動きも、既存の `event_price_reactions` に既に保存されている値を読むだけで、新しい取り込み・書き込みは発生しない。
- そのため、ロールバックは「このブランチの変更を取り消す(コードを戻す)」だけで完了し、DBの復旧作業は不要。

## 8. AI分析の実装範囲と未実装範囲

- 実装した範囲: 「2. 実装内容」STEP4に記載のとおり、将来のAI分析が使える、事実ベース・出典区別可能なデータ構造(`co_released_indicators`・`round_trip_*`・既存の`forecast`のnull保持)のみ。
- 実装していない範囲: 実際のAI/LLM呼び出し、要約生成、価格予測、トレーディングシグナルの生成。新しい有料APIの契約・導入も行っていない。

## 9. 予想値取得元の調査結果と費用・利用条件

- 今回新たな調査は行っていない。既存の調査(`docs/projects/fx-event-analyzer/data-sources.md`、過去のタスクで作成済み・未コミットの調査用ワークツリーに保存)が、無料の市場コンセンサス予想データ源について既に網羅的に調べており、状況は変わっていないと判断した。
- 要点(既存調査の再掲): 無料で使える市場コンセンサス予想の提供元は見つかっておらず、有力な候補はEnterprise/有料プラン限定。FRBの「ナウキャスト」系モデル(例: GDPNow)は代替案として検討対象になるが、アナリストのコンセンサス予想とは性質が異なる(モデル推定値であり、調査対象でもない)ため、今回は採用を見送った。
- 費用・契約: 新しい有料サービスの契約・利用開始はしていない(指示どおり)。

## 10. 残課題・リスク

- `listCoReleasedEvents` は、対象イベントの `provider`・`release_datetime` に完全一致する行を取得するため、同じ `provider` の別の無関係なタイムスタンプとは混同しない設計だが、**同じ瞬間に同じ発表元から全く無関係な2つの指標が偶然公開される**(極めて稀だが理論上あり得る)場合は「同時発表」と誤って判定する可能性がある。現時点でこの誤判定が実際に起きた例は確認していない。
- `round_trip_15m/60m` は既存の `high_break`・`low_break` の単純な論理積であり、どちらが先に起きたか(往復の順序)は依然判定していない(既存の制約を継承。`StrategyAnalysisText.notes` に明記済み)。
- 統合テスト(`tests/integration/strategy-analysis.test.ts`)は、DEV DBの認証情報がこのサンドボックスに無いため**未実行**。CIの `Backend CI` で実行結果を確認する必要がある(6章に結果を追記予定)。もし失敗した場合は、このブランチで追加修正が必要。
- `co_released_indicators` は今回、対象イベント(target)についてのみ計算しており、「直近5回の履歴」の各発表について同時発表かどうかは計算していない(スコープを絞った意図的な判断。10章「次に必要な作業」参照)。

## 11. 次に必要な作業

- CIの実行結果(iOS Build & Test・Backend CI)をこのレポートの6章に追記し、ユーザーへ報告する。
- (今回見送った拡張、必要なら将来対応)
  - 「直近5回の履歴」の各発表についても同時発表の有無を示す(今回は対象イベントのみに絞った)。
  - `summarizeMarketEventCoverage` を使った、複数指標をまとめて見る新しいダッシュボード/APIの検討(今回は「不要な仕組みを増やさない」方針により見送り)。
  - 統合テストのCI実行結果を確認し、必要なら修正。
