# FX Event Analyzer

経済指標・要人発言の「市場予想→実際の結果→サプライズ→FX価格反応→過去イベント比較」を分析できるiOS/iPadアプリ(将来Web展開)。

現在のフェーズ: **実装フェーズ(Phase 2: Backend/DB基盤)**。設計はHQ主導で確定済み(全設計最終監査PASS WITH CHANGES)。iOSクライアント基盤(Phase 1)完了、DB migration/RLS/Seed(Phase 2a)完了、Backend APIサーバー実装(Node.js/TypeScript/Fastify、Phase 2b)進行中。実装コードは`fx-event-analyzer/`(iOS)・`fx-event-analyzer-backend/`(Backend)を参照。

- [requirements.md](./requirements.md) — 要件定義書 v1.8
- [design.md](./design.md) — 概要設計書 v1.9
- [implementation-notes-for-hq.md](./implementation-notes-for-hq.md) — 詳細設計のためのHQ向け情報整理(制約・リスク・API依存部分・未確定事項)
- [ui-screens.md](./ui-screens.md) — 画面設計・UI方針 v1.2(モックアップ・画面一覧・画面遷移。SCR-000 Splash / App Icon仕様を追加)
- [features.md](./features.md) — 機能一覧 v1.7(FEAT-ID、優先度P0/P1/P2/OUT。HQにより正式な基準仕様として確定済み)
- [db-design.md](./db-design.md) — DB詳細設計 v4.2(HQ確定・完成版。max_upward_pips/max_downward_pipsをDB保存に統一)
- [api-design.md](./api-design.md) — API詳細設計書 v1.3(HQ作成のv1.0をベースに、全設計横断監査の確定事項まで反映)
- [mockups/](./mockups/) — UIモックアップ画像(画面一覧・App Icon参考・Splash参考)

## 開発体制(2026-09〜)

**詳細設計の主導権はHQ(楓真＋ChatGPT)側にあり、Claude Codeは独自に確定しない。**

- HQ: システムアーキテクチャ・コンポーネント責務・DB/API詳細設計・Snapshot/Revision設計・時刻同期・Surprise計算・統計計算・データ品質処理・認証/権限・UI状態設計などの仕様・設計判断を行う
- Claude Code: HQが確定した詳細設計書を読み込み、実装・テスト作成・テスト実行・バグ修正・マイグレーション/CI-CD実装・自己レビューを行う。仕様変更が必要な問題を見つけた場合は、独自判断で変更せずHQへ報告する
- 経済指標API・FX価格APIの最終選定が未確定でも詳細設計は止めない(`EconomicDataProvider` / `FXPriceDataProvider`としてAdapter抽象化する方針)

## これまでの経緯

1. 要件定義書 v1.0 / v1.1(継続利用・サブスクリプション要件)を受領
2. 概要設計書 v1.0 を受領し、実装前レビューを実施(Critical/High 7件を含む指摘)
3. レビュー結果を反映し、要件定義書 v1.2・概要設計書 v1.1 に改訂
4. HQより「詳細設計はHQ主導、Claude Codeは実装担当」という開発体制の方針を受領。詳細設計のインプットとなる情報(制約・リスク・未確定事項)を整理(本ディレクトリの`implementation-notes-for-hq.md`)
5. HQより画面設計・UIモックアップ(ダーク版、11画面)を受領し保存。ナビゲーション構成が5タブ→4タブ(Analysisタブ廃止)に更新されたことを確認(本ディレクトリの`ui-screens.md`)
6. HQより機能一覧v1.0(FEAT-ID)を受領し保存。既存設計との整合性確認を実施し、矛盾・懸念3件(Revised Previousの定義・Subscription実装タイミング・Indicator/FXPairの関連付け不足)を報告(本ディレクトリの`features.md`)
7. HQより上記3件への回答を受領し、要件定義書v1.3・概要設計書v1.2・機能一覧v1.1に反映。Subscriptionの優先度をP1に変更(ただし決済実装はFEAT-227として分離・実装タイミング未定のまま)、Indicator↔FXPairの多対多関連(IndicatorFxPair)を追加、EventRevisionの「改定後」ラベル表示ルールを明記
8. HQより機能一覧v1.0の統合再送版を受領し、機能一覧v1.2・概要設計書v1.3に反映。Community機能(FEAT-225)のスコープ明確化、OUT項目「MVPでの高度通知機能」の追加、「データ品質に関する絶対ルール」8項目の明文化、既存9用語の状態確認レポートを実施(`features.md` 15.4節)。ディレクトリ再構成の提案は現状の構成を維持する形で見送り。「MarketReaction」という用語名と既存の`EventPriceReaction`との関係はHQの決定待ち
9. HQより機能一覧v1.2の確定確認を受領(機能一覧v1.3)。用語を`EventPriceReaction`に正式統一、Search API(FEAT-110〜115)の最終仕様は詳細設計へ持ち越しを確認。次工程を「DB詳細設計」と指示され、`db-design.md`(Entity/Table定義・RLS方針・データ保持方針・HQ確認事項11件)を新規作成(v1.0)
10. HQよりDB詳細設計の正式なEntity定義・Relationship・Column一覧を受領し、`db-design.md`をv2.0へ全面改訂。既存設計との重要な不整合を報告(`EconomicEvent`と`EventSnapshot`が同一エンティティか別テーブルか、`EventExplanation`のEntity一覧からの欠落、`favorable_direction`/`release_datetime_precision`の欠落等)。HQ指定14項目+既存資料との整合性確認から追加で判明した項目をあわせ、計25件をHQ確認事項として整理。DB設計の実装(migration/Table作成等)は未着手のまま
11. HQよりv2.0で報告した不整合・確認事項への正式回答を受領。`EconomicEvent`/`EventSnapshot`を別Entityとして正式採用(`snapshot_type`は将来の複数種類を想定、MVPはRELEASE固定)、`EventExplanation`をMVP必須Entityとして復活、`favorable_direction`/`release_datetime_precision`/`IngestionLog`を追加、Supabase+PostgreSQLを正式採用しRLSを実装前提の設計条件に確定、Surpriseは保存方式(raw+direction)を採用、EventPriceReactionは段階的生成(データ不足時は0を保存せず分析対象外として扱う)を採用。`db-design.md`をv3.0へ全面改訂し、要件定義書v1.4・概要設計書v1.4へ反映(EconomicEvent=EventSnapshotという旧来表現を修正)。残るHQ確認事項17件(主に型・精度・enum境界値等の技術的細部)を整理
12. HQよりv3.0で報告した17件のHQ確認事項すべてに最終判断を受領。EventSnapshotの不変性をDBトリガーで担保、EventExplanationを上書きせず履歴保持(version管理)に変更、Entitlement.feature_codeを機能単位のコード体系に具体化(FREE/PRO名称は埋め込まない)、IngestionLog.data_typeを確定、Surprise=0の場合はNEUTRAL(NULLと明確に区別)、Numeric精度をカラム用途ごとに個別設定、EconomicEventの重複防止をprovider_event_id優先に変更、EventPriceReactionのmax_upward/max_downwardを「pre_release_price基準の期間内最大変動」に確定、RLS/Delete-Cascade/FxPriceデータ保持範囲を最終確定。`db-design.md`をv4.0(完成版)へ改訂し、概要設計書をv1.5へ改訂(EventExplanationの履歴保持化を反映)。DB設計の実装(migration/Table作成等)は今回も未着手のまま
13. HQよりAPI詳細設計書v1.0(HQ作成)を受領し、要件定義書・features.md・design.md・ui-screens.md・db-design.mdとの整合性を第三者レビュー。Aランク(必須修正)8件・Bランク(推奨修正)7件を報告(EventRevision取得APIの欠落・Event Detailの複数FXペア反応サマリー欠如・Data Quality状態名のDB不一致・Profile.timezone未設計・Currencyマスタ不在・event_nameカラム不在・Data Pending/UnavailableのHTTPエラー扱いの是非・Historical Comparisonのtimeframe単一指定、等)
14. HQよりAランク8件・Bランク7件すべてに方針確定を受領。`api-design.md`をv1.1として新規作成し反映(EventRevision API新設、related_fx_pairsへのReaction Summary追加、Data Quality状態のDB↔APIマッピング表明記、Profile.timezoneは追加せずRequestで明示受領する方式に変更、Currencyは静的マッピングで対応、event_nameはIndicator基準検索に変更、DATA_PENDING/UNAVAILABLEはHTTPエラーから除外し200+status field方式に統一、Historical Comparisonにtimeframe=all追加、Entitlement×Endpoint対応表追加等)。要件定義書・概要設計書・DB設計は変更せず、変更候補として報告するに留めた
15. HQよりv1.1の残課題6件(B-1/B-6/B-7/A-1/B-5/A-6/timezone)への最終回答を受領。`api-design.md`をv1.2へ改訂(Advanced Statisticsの段階的制御をavailable/required_entitlement/data形式で確定、available_timeframesの精度別除外ルールを正式確定、Backend↔PostgreSQLはservice_role接続+Backend Authorizationを正式採用し7段階の処理順序を明記、Revision APIはEntitlement制限なしと確定)。pg_trgm+GIN Index方針は`db-design.md`をv4.1へ改訂して直接反映(HQ指示による、Migrationは未実施)。event_name関連は要件定義書側の変更候補として確定(要件定義書自体は変更せず)
16. HQ指示により「実装開始前の全設計最終整合性監査」を実施。要件定義書・概要設計書・features.md・ui-screens.md・db-design.md・api-design.mdを横断監査し、Critical 0件・High 2件(H-1: EventExplanationがSCR-004・features.mdに未反映、H-2: Homeの「最近のイベント」のデータソース未確定)・Medium 5件(favorable_direction/data_statusの旧enum表記、max_upward_pips等の保存方針の非対称性、design.mdのIngestionLog欠落、timezone方針の反映漏れ)・Low 6件(User/Profile・FXPair/FxPairの表記揺れ等)を報告。総合判定「PASS WITH CHANGES」
17. HQよりH-1/H-2/M-1〜M-5/L-1〜L-6/A-6すべてに最終方針を受領し、全設計書へクリーンアップとして反映。SCR-004に乖離理由表示を追加(features.mdにFEAT-055新設)、Homeの「最近のイベント」を「当日中のRELEASEDイベント」と定義、EventPriceReactionのmax_upward_pips/max_downward_pipsをDB保存方式に統一、要件定義書・概要設計書の旧enum表記・旧サンプル値を確定済みDB値に統一、design.mdにIngestionLog追加・timezone方針反映・User→Profile/FXPair→FxPairの表記統一、requirements.md 27章にSubscription/Entitlement追加、requirements.md 5.2節からevent_nameを削除しIndicator基準に整合。実装は今回も一切行っていない
18. HQより「Splash / Launch ScreenとApp Iconの追加」の指示を受領し、参考画像2点(App Icon・Splashモックアップシート)とともに設計へ反映。SCR-000 Splash / Launch Screenを新規MVP画面としてui-screens.mdへ追加(iOSシステムLaunch Screenとの責務分離、起動フロー、Session Expired/API接続エラー処理、レスポンシブ方針)、App Icon / Brand Asset仕様を新設(ブランド方向性・Asset管理方針・「フルロゴ版」「シンボル版」を候補として記録、HQ判断待ち)、design.md/requirements.mdに起動フロー・App Icon方針の必要最小限の記述を追加、features.mdに新規FEAT-126〜129(アプリ起動・Splash)を追加(Splashのブランド表示自体はFEAT化せず理由を明記)。api-design.md/db-design.mdは指示通り変更せず(新規APIもDBスキーマ変更も不要と確認)。実装・コード変更・Asset生成は今回も一切行っていない

## 次のアクション

- HQが今回のクリーンアップ結果および今回のSCR-000/App Icon追加を確認し、「全設計最終監査」を再実施する
- 再監査でPASS判定となれば「設計凍結→実装フェーズ」へ移行する
- App Iconの「フルロゴ版」/「シンボル版」のどちらを採用するか(またはどう使い分けるか)をHQが判断する
- 経済指標API(Trading Economics / EODHD等)へ、エンドユーザーへの商用配信権込みで正式見積もりを取る(requirements.md 6.2節)。詳細設計自体はAPI未選定でも進められる(Adapter抽象化のため)
- FEAT-227(決済実装)の着手時期(β版の前か後か)をリリース計画段階でHQが判断する
- 詳細設計書が確定次第、Claude Codeが実装フェーズに入る
