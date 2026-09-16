# FX Event Analyzer

経済指標・要人発言の「市場予想→実際の結果→サプライズ→FX価格反応→過去イベント比較」を分析できるiOS/iPadアプリ(将来Web展開)。

現在のフェーズ: **詳細設計(HQ主導)**。実装(DB作成・API実装・UI実装)はまだ開始していない。

- [requirements.md](./requirements.md) — 要件定義書 v1.3
- [design.md](./design.md) — 概要設計書 v1.3
- [implementation-notes-for-hq.md](./implementation-notes-for-hq.md) — 詳細設計のためのHQ向け情報整理(制約・リスク・API依存部分・未確定事項)
- [ui-screens.md](./ui-screens.md) — 画面設計・UI方針 v1.0(モックアップ・画面一覧・画面遷移)
- [features.md](./features.md) — 機能一覧 v1.2(FEAT-ID、優先度P0/P1/P2/OUT)
- [mockups/](./mockups/) — UIモックアップ画像

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

## 次のアクション

- HQ側で「画面×機能」「画面×機能×API×DB」の対応表を作成し、詳細設計を完成させる(`implementation-notes-for-hq.md`・`ui-screens.md`・`features.md`の内容を参考情報として利用可能)
- 経済指標API(Trading Economics / EODHD等)へ、エンドユーザーへの商用配信権込みで正式見積もりを取る(requirements.md 6.2節)。詳細設計自体はAPI未選定でも進められる(Adapter抽象化のため)
- FEAT-227(決済実装)の着手時期(β版の前か後か)をリリース計画段階でHQが判断する
- 詳細設計書が確定次第、Claude Codeが実装フェーズに入る
