# FX Event Analyzer

経済指標・要人発言の「市場予想→実際の結果→サプライズ→FX価格反応→過去イベント比較」を分析できるiOS/iPadアプリ(将来Web展開)。

現在のフェーズ: **詳細設計(HQ主導)**。実装(DB作成・API実装・UI実装)はまだ開始していない。

- [requirements.md](./requirements.md) — 要件定義書 v1.2
- [design.md](./design.md) — 概要設計書 v1.1
- [implementation-notes-for-hq.md](./implementation-notes-for-hq.md) — 詳細設計のためのHQ向け情報整理(制約・リスク・API依存部分・未確定事項)

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

## 次のアクション

- HQ側で詳細設計書を作成(`implementation-notes-for-hq.md`の内容を参考情報として利用可能)
- 経済指標API(Trading Economics / EODHD等)へ、エンドユーザーへの商用配信権込みで正式見積もりを取る(requirements.md 6.2節)。詳細設計自体はAPI未選定でも進められる(Adapter抽象化のため)
- 詳細設計書が確定次第、Claude Codeが実装フェーズに入る
