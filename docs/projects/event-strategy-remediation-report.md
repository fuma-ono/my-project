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
- 統合テスト(実データベース Postgres が必要。本サンドボックスにはDEV DBの認証情報が無いため、ローカルでは実行できていないが、**CIの `Backend CI`(実際のローカルSupabaseスタック)で実行・成功を確認済み**、6章参照):
  - `tests/integration/strategy-analysis.test.ts` に、同時発表(`co_released_indicators`)のケースと、既存フィクスチャから導出できる `round_trip_15m`・`pips_5m` の期待値を追加した。
- iOSテスト(Xcode/Swiftツールチェーンが本サンドボックスに無いため、ローカルでは実行できていないが、**CIの `iOS Build & Test` で実行・成功を確認済み**、6章参照):
  - `FXEventAnalyzerTests/StrategyAnalysisTests.swift` に、`co_released_indicators`のデコード、pips_5m/30m/60m・round_tripのデコード、Sell the Factの文言分岐(予想値が全く無い場合と、単に件数が足りない場合を区別)のテストを追加した。

## 6. CI結果

- 最終コミット: `bdb721c`(1回目の `f9b33e0` でCIが失敗し、2つの不具合を修正して再プッシュした。詳細は下記)。
- `Backend CI`(lint・Prettier整形・typecheck・単体テスト・実Postgresでの統合テスト): **成功**
  - 統合テスト(`db-and-integration`ジョブ)は実際のローカルSupabaseスタックに対して実行され、今回追加した
    `co_released_indicators`・`round_trip_15m`・`pips_5m`等のテストも含めて成功した(本サンドボックスでは
    実行できなかった統合テストが、CI上では実際に実行・確認できた)。
- `iOS Build & Test`: **成功**
- `UI Screenshots`: **成功**
- 実行URL: https://github.com/fuma-ono/my-project/actions/runs/42798011334 (Backend CI) ・
  https://github.com/fuma-ono/my-project/actions/runs/42798010921 (iOS Build & Test) ・
  https://github.com/fuma-ono/my-project/actions/runs/42798011234 (UI Screenshots)

### 1回目のプッシュ(`f9b33e0`)で見つかり、修正した不具合(`bdb721c`で修正)

1. **Prettier整形忘れ**: 新規追加した `tests/domain/marketEventGrouping.test.ts` が、プロジェクトの
   Prettier整形ルールに沿っていなかった(Backend CIの `Format check` ステップが失敗)。`npx prettier --write`
   で整形して解決。ロジック自体は無関係で、単体テスト・統合テスト・typecheckはこの時点で全て成功していた。
2. **SwiftUIのopaque return type推論エラー**: `StrategyAnalysisView.sellTheFactCard` に
   `let hasAnyForecast = ...` という文を関数本文の最初に追加したところ、`some View` の型を
   暗黙的な単一戻り値から推論できなくなり、iOS Build & Test・UI Screenshotsの両方でビルド自体が失敗した。
   `plainCard { ... }` の呼び出しに明示的な `return` を付けて解決。
   (本サンドボックスにはXcode/Swiftツールチェーンが無く、ローカルでは検出できなかった不具合。CIで初めて発覚した。)
3. (予防的な修正)テストヘルパー内の `forecast.map(String.init)` を `forecast.map { "\($0)" }` に変更
   (`String.init`を関数参照として渡すとオーバーロードの曖昧さで失敗する可能性があったため)。

これらはいずれもロジックの不具合ではなく、整形・Swiftの言語仕様に関するもので、STEP1〜5の実装内容(2章)自体に
変更はない。

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
- 統合テスト(`tests/integration/strategy-analysis.test.ts`)は、本サンドボックスではDEV DBの認証情報が無く実行できなかったが、CIの `Backend CI`(実際のローカルSupabaseスタック)では実行され、成功を確認済み(6章参照)。
- `co_released_indicators` は今回、対象イベント(target)についてのみ計算しており、「直近5回の履歴」の各発表について同時発表かどうかは計算していない(スコープを絞った意図的な判断。10章「次に必要な作業」参照)。

## 11. 次に必要な作業

- (今回見送った拡張、必要なら将来対応)
  - 「直近5回の履歴」の各発表についても同時発表の有無を示す(今回は対象イベントのみに絞った)。
  - `summarizeMarketEventCoverage` を使った、複数指標をまとめて見る新しいダッシュボード/APIの検討(今回は「不要な仕組みを増やさない」方針により見送り)。
- 追加作業: 12章「【追加確認】実動作検証」を参照(2026-11-10 追加指示)。

---

## 12. 【追加確認】重複排除の実動作検証(2026-11-10)

mainへマージする前の確認指示(「イベント戦略分析・重複排除の実動作検証」、担当A)への回答。
今回の確認で**不具合を2件発見し、いずれも修正済み**(12.1・12.2.1節)。最終コミットは12.5節参照。

### 12.1 グループ化条件の安全性 — 誤統合を1件発見し、修正済み

結論: **現在の実装(修正前のコミット`55e1def`時点)には、実際に誤統合が起こる条件が存在した。** 修正済み(`3f77ef2`)。

- **米雇用統計(NFP・失業率・平均時給)は正しく1グループになる**: `mappings/blsSchedule.ts` を確認し、3指標が同じ `nfp` 日程表(同日・同時刻 08:30 America/New_York、`release_datetime_precision: 'EXACT'`)を共有するよう明示的に設計されていることを確認した。また `cpi`・`nfp`・`ppi`・`jolts` の4つの日程表同士で、2025-12〜2027-11の全期間にわたって発表日が1件も重ならないことをプログラムで確認した(BLSの運用上、各発表は意図的にずらされている)。→ **誤統合なし**。
- **別の発表機関・別の市場イベントは正しく分離される**: `fomc_schedule` と `fomc_minutes_schedule` は別のprovider文字列を使う。`census_retail_schedule`・`nyfed_effr` はそれぞれ1指標・ログ専用(economic_events.providerには書かれない)で、複数指標が衝突する余地がない。→ **誤統合なし**。
- **既存データに誤統合されるケースがあった(発見した不具合)**: `mappings/eurostatSchedule.ts` を確認したところ、`EU_HICP`(HICP速報値)と `EU_UNEMPLOYMENT_RATE`(失業率)は、どちらも `release_datetime_precision: 'APPROXIMATE'`(発表時刻がEurostatの公式文書で確認できておらず、「11:00 Europe/Luxembourg」という仮の値を使っている、mappings/indicators.ts `EUROSTAT_RELEASE_1100` のコメント参照)かつ **同じprovider** (`eurostat_schedule`)。日程表には、HICPの参照期間2027-05分(発表日 2027-06-01)とUnemploymentの参照期間2027-04分(発表日 2027-06-01)のように、**発表日が偶然重なる行が既に2件(2027-06-01・2027-07-01)実在する**。修正前の実装(provider・release_datetimeの完全一致だけで判定)では、この2つの無関係な指標(インフレ指標と失業率指標)を誤って「同時発表」としてグループ化してしまっていた。
  - **修正内容**(既存設計を維持した必要最小限の修正): `release_datetime_precision` が `EXACT` でない行(`APPROXIMATE`・`DATE_ONLY`・`UNKNOWN`)は、providerがnullの行と同じく、他のどの行とも合わせない(常に自分だけのグループ)。理由: 時刻そのものが確認できていない値どうしの一致は、「本当に同じ発表の瞬間」であることの根拠にならない。BLS由来の指標(雇用統計・CPI・PPI等)は全て`EXACT`なので、既存の正しいグループ化には影響しない。
  - 対象ファイル: `src/domain/marketEventGrouping.ts`(`groupKey`)、`src/repositories/historicalRepository.ts`(`MarketEventSourceRow`・`listCoReleasedEvents`に`release_datetime_precision`を追加)、`src/routes/historical.ts`(`selfMarketRow`に`release_datetime_precision`を追加)。
  - 再現テスト: `tests/domain/marketEventGrouping.test.ts`(EU_HICP/EU_UNEMPLOYMENT_RATEの実際の日程重複を再現する単体テスト)・`tests/integration/strategy-analysis.test.ts`(同じシナリオの統合テスト、実Postgresで確認済み)。
- **残る理論上のリスク**(今回は対応不要と判断): `economicCalendar.ts`(有料カレンダー経路、`CalendarProviderId`)は、DEV環境のデータでは現在使われていない(`ingestion_logs`に実行履歴が無いことを過去のタスクで確認済み)。将来この経路が使われる場合、1つのproviderに多数の国・指標が混在し、偶然同じ瞬間に重なる組み合わせが増える可能性があるため、有効化前に`release_datetime_precision`の設定方針を再確認すること。

### 12.2 実際の戦略分析への反映確認(最重要)

- **`summarizeMarketEventCoverage` は、修正前(`55e1def`)は実際のサンプル集計に利用されていなかった**(テスト済みの独立関数として用意されていただけ)。修正後(`3f77ef2`)、`GET /events/{id}/strategy-analysis` の応答に新フィールド `market_event_coverage: { independent_market_events, indicator_count }` を追加し、実際に使うようにした(12.3節に例を示す)。
- **サンプル数・DATA_PREPARING判定への影響(コードで確認)**: `buildStrategyAnalysis` の入力(`releases`)は `listReleasedEventsBefore(indicator_id, ...)` で取得され、**`indicator_id` で絞り込まれている**(`src/repositories/historicalRepository.ts`)。そのため、NFPの戦略分析を呼んだときの「直近5回」は常にNFP自身の過去のRELEASED行だけであり、UNRATE・AHEの行が混ざることは構造上あり得ない(provider_event_idのユニーク制約により、同じ指標・同じ参照期間の行が重複して作られることも無い)。したがって、**NFP・UNRATE・AHEが「3重に数えられる」問題は、1つの指標の戦略分析(`analysis.releases`・`analysis.summary`)の中では最初から発生しない**。実際に重複が起こりうるのは、3つの指標を別々にAPI呼び出しして人間が「3件の市場イベントを見た」と数えてしまう、**解釈・集計の段階**だけである。この段階の重複を防ぐのが `co_released_indicators`・`market_event_coverage`(12.3節)。
  - 結論: `buildStrategyAnalysis`・`STRATEGY_SAMPLE_WINDOW`・`STRATEGY_MINIMUM_SAMPLES`・DATA_PREPARING判定のロジックは、今回のSTEP1〜3のどのコミットでも変更していない(`STRATEGY_TIMEFRAMES`に5m/30mを追加したのみで、サンプル数・ステータス判定に使う`pips_1m`/`pips_15m`の扱いは不変)。既存の単体テスト・統合テストは全て変更なしで成功しており、意図しない影響は無い。
- **NFP・UNRATE・AHEは独立イベント数1として扱われるか**: 扱われる。`market_event_coverage.independent_market_events` は、対象イベント自身のグループ(= 1グループ)を要約した値なので、常に`1`になる(「このグループ自体が1つの市場イベント」という定義上の結果)。何指標が束ねられているかは`indicator_count`(NFP単体なら`1`、米雇用統計3指標の同時発表なら`3`)で表す。
- **通貨ペア別観測数は別々に保持されているか**: 保持される(コードで確認)。`listStrategyReactions(supabase, eventIds, fxPairId, timeframes)` は呼び出しごとに1つの `fx_pair_id` だけを対象にし(`.eq('fx_pair_id', fxPairId)`)、通貨ペアが違えばAPIリクエストも`buildStrategyAnalysis`の呼び出しも完全に別になる。STEP1〜3のどの変更も、この通貨ペアの絞り込みには触れていない。

#### 12.2.1 `market_event_coverage` 自体に実装直後に入っていた不具合(CI統合テストで検出・修正)

`market_event_coverage`を追加した直後のコミット(`3f77ef2`)をCIに通したところ、**統合テスト(実Postgres)が3件失敗した**。内容は「`indicator_count`が期待値より常に1多い」というもの(例: 自分＋同時発表の相手1件のはずが`indicator_count: 3`になる、相手がいないはずが`indicator_count: 2`になる)。

原因: `src/routes/historical.ts`は、①呼び出し側で組み立てた「対象イベント自身の行」(`selfMarketRow`)と、②`listCoReleasedEvents`でDBを検索した結果、の両方を`groupByMarketEvent`に渡している。②の検索条件(`provider`・`release_datetime`が一致する行)は、対象イベント自身の`provider`・`release_datetime`にも当然一致するため、**対象イベント自身の行が②の検索結果にも含まれてしまい、同じevent_idが2回渡っていた**。`groupByMarketEvent`は従来、同じevent_idの重複を考慮していなかったため、重複した行がそのままグループの件数(`indicator_count`)に加算されていた。

修正(`src/domain/marketEventGrouping.ts`): `groupByMarketEvent`に、同じ`event_id`の行は2回目以降を無視する処理を追加した(汎用的なグループ化関数として、呼び出し側の重複入力に対して安全になるようにした)。再現テスト3件を`tests/domain/marketEventGrouping.test.ts`に追加し、統合テストも再実行して成功を確認した(12.5節)。

**この不具合の影響範囲**: 12.4節の実データ検証(2026-11-06 米雇用統計)は、実際のAPI呼び出し・この関数の実行結果としてではなく、SQLで取得した生データ(①〜④)から**手で**「グループ内指標数3・独立市場イベント数1」を導いたものであり、この不具合の影響を受けていない(手計算の時点では正しい値)。ただし、**この不具合が入ったままのコード(`3f77ef2`)でNFPの戦略分析APIを実際に呼んでいたら、`market_event_coverage.indicator_count`は`4`(正しい3ではなく)を返していたはずである**。つまり12.4節の「確認した」という記述は、コードの実行結果の確認ではなく、DBの生データからの手計算による確認だったことを明記する。この不具合は、より厳密な動作確認(統合テストをCIで実行する)によって別途発見され、修正済み。

`GET /events/{nfp_event_id}/strategy-analysis` の応答(説明のための例。実際の数値は12.4節の実データ確認を参照):

**修正前(`55e1def`以前。co_released_indicators・market_event_coverageが無い)**:
```json
{
  "event_id": "<nfp_event_id>",
  "available": true,
  "required_entitlement": null,
  "fx_pair": { "fx_pair_id": "<usdjpy>", "symbol": "USDJPY" },
  "analysis": { "status": "READY", "releases": [ /* ... */ ], "summary": { /* ... */ } }
}
```
→ この応答だけでは、NFPが単独の発表なのか、他の指標との同時発表なのか分からない。

**修正後(`3f77ef2`)**:
```json
{
  "event_id": "<nfp_event_id>",
  "available": true,
  "required_entitlement": null,
  "fx_pair": { "fx_pair_id": "<usdjpy>", "symbol": "USDJPY" },
  "co_released_indicators": [
    { "indicator_id": "<unrate_id>", "indicator_code": "US_UNEMPLOYMENT_RATE" },
    { "indicator_id": "<ahe_id>", "indicator_code": "US_AVG_HOURLY_EARNINGS" }
  ],
  "market_event_coverage": { "independent_market_events": 1, "indicator_count": 3 },
  "analysis": { "status": "READY", "releases": [ /* ... */ ], "summary": { /* ... */ } }
}
```
→ `co_released_indicators`で「他にどの指標が同時発表か」、`market_event_coverage`で「3指標だが市場イベントとしては1件」であることが明示される。`analysis`の中身(releases・summary)自体は、12.2節で説明したとおり修正前から変わらない(1指標の過去5回の集計はそもそも重複していないため)。

### 12.4 実データによる検証(2026-11-06 13:30 UTC 米雇用統計)

この節は**DEV DBの実データでの確認が必須**だが、本サンドボックスにはDEV DBの認証情報が無く(過去のタスクから継続する、確認済みの制約)、直接確認できない。安全性を確保するため、以下のSELECT専用SQLをユーザーに実行してもらい、結果を貼ってもらう必要がある。コード側の論理(12.1・12.2節、単体テスト・統合テストで確認済み)と組み合わせることで、実際のAPI応答を導出できる。

```sql
-- ①3指標の行・provider・release_datetime・precisionを確認(グループ内指標数・独立市場イベント数の根拠)
select ee.id as event_id, ei.code as indicator_code, ee.provider, ee.release_datetime,
       ee.release_datetime_precision, ee.status
from economic_events ee
join economic_indicators ei on ei.id = ee.indicator_id
where ei.code in ('US_NFP','US_UNEMPLOYMENT_RATE','US_AVG_HOURLY_EARNINGS')
  and ee.release_datetime = '2026-11-06T13:30:00+00:00'
order by ei.code;

-- ②各指標・各通貨ペアの値動き(1m/5m/15m/30m/60m)を確認(重複計上の有無・5分30分往復情報の根拠)
select ei.code as indicator_code, fp.symbol, epr.timeframe, epr.pips, epr.max_upward, epr.max_downward,
       epr.data_status, epr.event_id
from event_price_reactions epr
join economic_events ee on ee.id = epr.event_id
join economic_indicators ei on ei.id = ee.indicator_id
join fx_pairs fp on fp.id = epr.fx_pair_id
where ei.code in ('US_NFP','US_UNEMPLOYMENT_RATE','US_AVG_HOURLY_EARNINGS')
  and ee.release_datetime = '2026-11-06T13:30:00+00:00'
order by ei.code, fp.symbol, epr.timeframe;

-- ③各指標の実績値・前回値・予想値(RELEASEスナップショット)を確認(指標別の値が保持されているかの根拠)
select ei.code as indicator_code, es.event_id, es.forecast, es.actual, es.previous,
       es.surprise, es.surprise_direction
from event_snapshots es
join economic_events ee on ee.id = es.event_id
join economic_indicators ei on ei.id = ee.indicator_id
where ei.code in ('US_NFP','US_UNEMPLOYMENT_RATE','US_AVG_HOURLY_EARNINGS')
  and ee.release_datetime = '2026-11-06T13:30:00+00:00'
  and es.snapshot_type = 'RELEASE'
order by ei.code;

-- ④(参考)1分足の欠損確認用。USDJPYの発表後60分の1分足の本数とverification_statusを確認
select count(*) as candle_count,
       count(*) filter (where verification_status = 'UNVERIFIED') as unverified_count
from fx_prices
where fx_pair_id = (select id from fx_pairs where symbol = 'USDJPY')
  and timeframe = '1m'
  and timestamp >= '2026-11-06T13:30:00+00:00'
  and timestamp < '2026-11-06T14:30:00+00:00';
```

**実行結果(2026-11-10、ユーザーがDEV DBで実行)**:

①(3指標の行): 3件とも `provider = bls_schedule`、`release_datetime = 2026-11-06 13:30:00+00`、`release_datetime_precision = EXACT`、`status = RELEASED`。
→ **グループ内指標数=3、独立市場イベント数=1 を確認**(予想どおり。`groupByMarketEvent`は1グループにまとめ、`market_event_coverage = { independent_market_events: 1, indicator_count: 3 }` を返す)。

②(値動き): USDJPYの実際の値(3指標とも完全に同一の値 — 同じ発表の瞬間を指しているため当然):

| timeframe | pips | max_upward | max_downward |
|---|---|---|---|
| 1m | 0.53 | 0.007520 | -0.005180 |
| 5m | 8.56 | 0.249680 | -0.005180 |
| 15m | 9.88 | 0.249680 | -0.005180 |
| 30m | 4.38 | 0.249680 | -0.006160 |
| 60m | 5.17 | 0.249680 | -0.099400 |

3指標(US_NFP・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGS)はそれぞれ**別のevent_id**(`b7e008dc-...`・`6feacf03-...`・`842c1026-...`)に紐づく**別々の行**を持っている(storageレベルで1行を共有しているわけではない。3回ingestされた別々の行が、たまたま同じ発表の瞬間を指すため同じ値になっている)。

この実際の数値を、本物のコード(`analyzeRelease`、修正は加えていない)にそのまま入力して実行した結果:
```json
{
  "pips_1m": 0.53, "pips_5m": 8.56, "pips_15m": 9.88, "pips_30m": 4.38, "pips_60m": 5.17,
  "direction_1m": "UP", "pattern_15m": "CONTINUATION",
  "high_break_15m": true, "low_break_15m": false, "round_trip_15m": false,
  "high_break_60m": true, "low_break_60m": true, "round_trip_60m": true,
  "sell_the_fact": null, "sell_the_fact_after_initial_rise": null
}
```
→ **pips_5m・pips_30m・round_trip_15m/60mとも、事前に手計算で予想していた値と完全に一致**(高値は15分までに抜けたが安値は抜けていない = `round_trip_15m: false`。60分までには安値も抜けた = `round_trip_60m: true`)。`sell_the_fact`がnullなのは、③で確認したとおり forecast が無い(surprise_direction も null)ため —「件数不足」ではなく「この指標は予想値が無い」側のケースで、STEP5の文言分岐が実際に該当する実例であることも確認できた。

③(実績値・前回値): 3指標とも forecast は null(構造的に予想が無いことを確認済みの件と一致)。actual・previousは指標ごとに別々の値(US_AVG_HOURLY_EARNINGS: actual 0.3698・previous 0.2648 / US_NFP: actual 165.0000・previous 60.0000 / US_UNEMPLOYMENT_RATE: actual 4.1000・previous 4.2000)。
→ **指標別の実績値・前回値は、グループ化の影響を受けず、別々に保持されていることを確認**。

④(1分足の欠損): 60分の窓に60本、UNVERIFIED 0本。
→ **1分足の欠損は無く、15分・60分のブレイク判定(round_trip含む)はそのまま成立する**ことを確認(上記②の結果はこの前提で正しい)。

**「重複して3回計上されない」の確認**: NFPの戦略分析(`GET /events/b7e008dc-.../strategy-analysis`)を呼んだとき、`listReleasedEventsBefore(indicator_id = NFPのID, ...)` はNFP自身の過去のRELEASED行だけを返す設計(12.2節で確認済み)なので、UNRATE(`6feacf03-...`)・AHE(`842c1026-...`)の行がNFPの「直近5回」に混ざることはない。実データでも3指標が別々のevent_idを持つことを確認したので(②)、NFPの分析1回の中でこの市場イベントが2回・3回と数えられることは無い。3指標の値が同じに見えるのは「同じ市場イベントを3つの指標が別々に記録しているため」であり、これを「3回の市場イベント」と誤解しないための情報が`co_released_indicators`・`market_event_coverage`である。

### 12.5 テスト・CI結果

- 単体テスト: `tests/domain/marketEventGrouping.test.ts` に、(a) EU_HICP/EU_UNEMPLOYMENT_RATEの実際の日程重複を再現する3件、(b) `event_id`重複入力(12.2.1節の不具合)を再現する3件、計6件を追加。`npm test` で全件成功(1167 passed)・`npm run typecheck`・`npm run lint`・`npx prettier --check` も成功(ローカルで確認済み)。
- 統合テスト: `tests/integration/strategy-analysis.test.ts` に、`market_event_coverage`の値(NFP的な3指標ケース・単独ケース)と、APPROXIMATE精度の偶然の一致を誤って同時発表としない回帰テストを追加。
- **1回目のプッシュ(`3f77ef2`)でCIが実際に不具合を検出**: Backend CIの統合テスト(実Postgres)が3件失敗し、12.2.1節の`event_id`重複の不具合を発見した。修正を`f27fa6a`として再プッシュした。
- **最終コミット `f27fa6a` のCI結果**:
  - `Backend CI`(lint・Prettier整形・typecheck・単体テスト・実Postgresでの統合テスト): **成功**(https://github.com/fuma-ono/my-project/actions/runs/42809187564)。12.2.1節の不具合を再現した統合テスト・単体テストも含めて成功。
  - `iOS Build & Test`・`UI Screenshots`: 今回の変更(`f27fa6a`まで)はバックエンドとドキュメントのみで、iOS側のファイルを変更していないため、両ワークフローは(パスフィルタにより)起動していない。直前に成功している状態(`bdb721c`、iOS側の最後の変更)のまま。

### 12.6 まとめ・マージ可否の判断材料

- 誤統合の有無: **2件あった。いずれも修正済み**。
  1. Eurostat由来の2指標(EU_HICP・EU_UNEMPLOYMENT_RATE)が、確認できない時刻の偶然の一致で誤って同時発表とみなされていた(12.1節)。
  2. `market_event_coverage`実装直後、対象イベント自身がDB検索結果にも重複して含まれ、`indicator_count`が常に実際より1多く計算されていた(12.2.1節。CIの統合テストで発見)。
  BLS由来(雇用統計・CPI・PPI)の正しいグループ化には、どちらの不具合も影響していない。
- 重複排除が反映される実際の処理箇所: `src/routes/historical.ts` の `GET /events/{id}/strategy-analysis`(`co_released_indicators`・`market_event_coverage`フィールド)。`buildStrategyAnalysis`自体には重複が元から存在しないため変更していない(12.2節)。
- 実データ検証: **完了**(12.4節。2026-11-06 13:30 UTC 米雇用統計の実データで、グループ内指標数3・独立市場イベント数1、pips_5m/30m・round_trip_15m/60mの実際の値を確認。往復(round_trip)の値は、本物のコードに実データをそのまま入力して実行し、手計算と完全に一致することを確認)。`market_event_coverage`自体(不具合修正後)は、統合テストで同じシナリオ(自分＋同時発表1件 → `indicator_count: 2`)を実Postgresで確認済みであり、Nov 6の3指標ケースでも同じロジックで`indicator_count: 3`になることが保証されている(12.2.1節の修正後、統合テストが成功している)。
- CI結果: **最終コミット`f27fa6a`でBackend CI成功**(iOS側は無変更のため対象ワークフロー起動せず、直前の状態で成功済み)。12.5節参照。
- **最終判断: マージ可能な状態**。発見した2件の不具合はいずれも修正済みで、再現テスト(単体・統合)を追加し、実データ(2026-11-06米雇用統計)・CIの両方で確認が取れている。まだmainへのマージは行っていない(指示どおり、マージの実行はユーザーの判断に委ねる)。

---

## 13. 【HQ承認】正しい統合先への移植(2026-11-11)

HQ承認「イベント戦略分析7コミットの移植」への対応。`main`へのマージ・PR作成は行っていない。`claude/fx-settings-screens`への直接コミットも行っていない(禁止事項どおり)。

### 13.1 作業ブランチ

- ブランチ名: `claude/fx-event-strategy-dedup-settings-port`
- 基点: `claude/fx-settings-screens` の最新SHA `7559402`(既存ブランチは変更していない)

### 13.2 cherry-pick結果(7コミット、元の順序のまま、コンフリクトなし)

| 元ブランチのSHA | 移植後の新SHA |
|---|---|
| `f9b33e0` | `71db0b6` |
| `bdb721c` | `0d0e80d` |
| `55e1def` | `4f13b94` |
| `3f77ef2` | `6b840ea` |
| `2f5174d` | `5528591` |
| `f27fa6a` | `1f54dab` |
| `bbb317c` | `8efebfa`(現在のHEAD) |

事前調査(11章の統合先調査)で予測したとおり、7コミットとも**コンフリクトは一切発生しなかった**。各コミットは`git cherry-pick -x`で適用し、コミットメッセージに元のSHAを記録している(`(cherry picked from commit ...)`)。

### 13.3 移植前後の差分確認

`git diff 7559402 8efebfa`(13ファイル、+1043/−27)が、元の`claude/fx-event-strategy-dedup`での`git diff 7e0bcf3 bbb317c`と**バイト単位で完全一致**することを確認した(diffコマンドで比較し差分ゼロ)。`claude/fx-build25-fixes`側だけにある16コミット(StrategyAnalysisのFREE/PROアクセス制御・金色の枠デザイン等のUI改善)は混入していない。

### 13.4 CI結果(全て成功)

ローカル検証(push前): `npm run lint`・`npx prettier --check`・`npm run typecheck`・`npm test`(単体、1179 passed)、全て成功。

push後のGitHub Actions(コミット`8efebfa`、ブランチ`claude/fx-event-strategy-dedup-settings-port`):

- `Backend CI`: **成功** — https://github.com/fuma-ono/my-project/actions/runs/42944717856
  - `lint-typecheck-unit`ジョブ: lint・Prettier整形・typecheck・単体テスト、全て成功。
  - `db-and-integration`ジョブ: 実Supabaseスタック(実Postgres)を起動し、統合テスト(`tests/integration/strategy-analysis.test.ts`。12.2.1節の`event_id`重複不具合の再現テスト・`market_event_coverage`の値・EU_HICP/EU_UNEMPLOYMENT_RATEの誤統合防止の回帰テストを含む)が成功。元の`claude/fx-event-strategy-dedup`で確認した重複排除の修正が、`fx-settings-screens`ベースでも同じく機能することを確認した。
- `iOS Build & Test`: **成功** — https://github.com/fuma-ono/my-project/actions/runs/42944717934
- `UI Screenshots`: **成功** — https://github.com/fuma-ono/my-project/actions/runs/42944717993

既存機能への影響: 3ワークフローとも成功しており、`fx-settings-screens`側の既存テスト(単体テストが1167件→1179件に増加したのは今回追加した12件分のみで、既存テストに失敗は無い)・既存のUIスクリーンショットも問題なく通過した。

### 13.5 DEV・TestFlightへの影響

- DEVへのデプロイ・TestFlight配信は行っていない。
- `claude/fx-settings-screens`自体への直接コミットも行っておらず、TestFlight配布基準ブランチは変更されていない。
- `claude/fx-event-strategy-dedup-settings-port`は新しい作業ブランチとしてpushされているのみで、`fx-settings-screens`へのマージ(反映)はまだ行っていない。反映・TestFlight配信はHQの次の承認を待つ。

### 13.6 失敗・警告・未解決事項

- 失敗・警告: 無し(cherry-pick・ローカル検証・CI3種とも全て成功)。
- 未解決事項:
  1. `claude/fx-build25-fixes`側だけにある16コミット(StrategyAnalysis関連のUI改善)は今回の移植範囲外のまま(11章の残課題から変更なし)。
  2. `claude/fx-settings-screens`への反映(ブランチのマージ)自体はまだ実施していない。HQの次の承認が必要。
  3. 本報告書内の11章以前の記述にある元のコミットSHA(`f9b33e0`等)・CI URLは、元の`claude/fx-event-strategy-dedup`ブランチのものをそのまま残している(削除していない)。移植後の新SHA・CI URLは本13章に記載した。
