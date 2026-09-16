# FX Event Analyzer: 詳細設計のためのHQ向け情報整理

**作成方針(2026-09時点)**: 詳細設計の仕様・設計判断はHQ(楓真＋ChatGPT)側で行う。本書はClaude Code側で確定した設計ではなく、HQが詳細設計を作成する際の**インプット情報**として、要件定義書v1.4・概要設計書v1.5・設計レビューで判明した内容を整理したもの。ここに書かれた内容はいずれも**未確定**であり、Claude Codeが独自に決定・実装したものではない。DB詳細設計(`db-design.md`)がHQにより確定した現在は、本書の役割はDB確定前のインプット情報の記録として維持している。

対象読者: HQ。Claude Codeはこの後、HQが確定した詳細設計書を受け取り次第、実装フェーズに入る。

---

## 1. 実装上の制約

- **DB**: Supabase + PostgreSQL(DB詳細設計でHQ確定、2026-09)。`EventSnapshot`(`EconomicEvent`とは別Entity、`db-design.md`参照)は**不変**として扱う必要があり、アプリケーション層で`forecast`/`actual`/`previous`列へのUPDATEを禁止する運用ルール(またはDB側のトリガー/権限制御)が必要になる。改定はすべて`EventRevision`への追記で表現する。
- **クライアント**: React Native + Expo(iOS/iPad)。外部APIキーはクライアントに一切持たせない(概要設計原則5)。
- **アーキテクチャ**: マイクロサービス化はしない。Read API(ユーザー向け)とIngestion Worker(外部データ取得)の2プロセス構成が前提(概要設計2章・4章)。
- **Provider抽象化**: HQ指示通り、`EconomicDataProvider` / `FXPriceDataProvider`のAdapter/Interfaceで外部APIを抽象化する。これは概要設計書の原則5(外部APIを直接Frontendから呼ばない)・原則10(データソースの条件を本番採用前に確認する)とも整合しており、Claude Code側から見ても妥当な方向性と考える。
- **課金**: サブスクリプション実装はApple In-App Purchase(StoreKit)経由が前提になる(App Store配信のため)。RevenueCat等のラッパーを使うかは未確定。

## 2. 技術的リスク

- **改定(Revision)の検知手段はProvider依存**: 経済指標が後日改定されたことを、Providerが自らプッシュ通知/Webhookで知らせてくれるのか、それとも過去イベントを定期的に再取得して差分を検知する必要があるのかは、選定するProviderの仕様次第で大きく変わる。後者の場合、「どの期間までの過去イベントを、どの頻度で再チェックするか」という追加のバッチ設計が必要になる。
- **T+1分データの取得タイミング**: 発表直後の1分足を、実際に1分以内(できればより短く)にDBへ反映できるかは、FX Price Providerがストリーミング(WebSocket等)に対応しているか、REST APIの低レイテンシポーリングで十分間に合うかに依存する。この見極めができるまで、Ingestion Workerの正確な取得方式(ポーリング間隔 or ストリーミング)は確定できない。
- **Rate Limitとイベント集中**: 重要指標が複数同時刻に発表されるケース(例: 米国指標が同日に複数発表)で、対象通貨ペア×イベント数分のリクエストがRate Limitに抵触しないか、Provider選定時に確認が必要。
- **データソースの不整合**: Economic Data ProviderとFX Price Providerが別会社になる可能性が高く、両者のタイムスタンプの精度・timezone表現が異なることが想定される(概要設計8章で正規化方針は定義済みだが、実際の変換ロジックはProviderのレスポンス仕様が分かってから確定できる)。
- **AI Hallucination(将来フェーズ)**: 出典URL必須という方針(要件定義書12章)は確定しているが、出典として採用する情報源の信頼性判定基準(公式発表とニュースサイトをどう区別するか等)は未設計。

## 3. API依存部分(Provider選定によって仕様が変わる箇所)

| 項目 | Providerによって変わりうる内容 |
|---|---|
| Economic Event取得 | forecast/actual/previous/revisionのうち、Providerがネイティブに提供する項目と、こちらで算出が必要な項目 |
| Revision検知 | Webhook/プッシュ型 or 再ポーリングによる差分検知型 |
| FX価格取得 | REST(ポーリング) or WebSocket(ストリーミング)。対応の有無でIngestion Workerの実装方式が変わる |
| Rate Limit | Scheduler側の取得頻度の上限 |
| 履歴データ範囲 | 「過去N件比較」に必要な年数を満たすか(指標の発表頻度ごとに要確認、要件定義書4.2節) |
| タイムスタンプ精度 | release_datetimeが秒単位か分単位か。8章の同期ルールへの正規化ロジックに影響 |

## 4. 設計上の未確定事項(概要設計書31章の再掲・補足)

- Economic Data Provider / FX Price Providerの最終選定(商用配信権込みの見積もり待ち。要件定義書6.2節)
- Backend framework(言語・フレームワーク)
- Scheduler/Queueの技術選定(例: cronベースの単純な定期ジョブか、専用のQueueミドルウェアを使うか)
- Cloud infrastructure(ホスティング先。DB/Authは以下の通りSupabaseに確定)
- Subscription provider(StoreKit直接 or RevenueCat等のラッパー)
- Notification infrastructure
- Web framework(将来のWeb版)
- Free/Proの最終機能境界・価格

## 5. 将来変更される可能性が高い箇所

- AI「乖離理由分析」がMVPの「出典付き事実要約」から、将来「AIによる自由生成解説」へ拡張される際の、AI Provider選定・プロンプト設計・出典抽出ロジック
- Surprise Magnitude Bucket・Standardized Surpriseの閾値定義(指標ごとに異なる可能性が高く、実データが集まってから調整が必要になりやすい)
- 通知インフラ(将来機能のため、現時点でインフラを固定する必要はない)
- Web版のフロントエンド技術選定

## 6. 実装前に決めるべき事項(HQへの確認依頼)

以下は、Claude Codeが実装に着手する前に、HQ側の詳細設計で確定しておいてほしい項目。

1. Economic Data Provider・FX Price Providerの正式選定(商用配信権を含む契約条件の確認後)
2. `EconomicDataProvider` / `FXPriceDataProvider`インターフェースの具体的なメソッドシグネチャ・戻り値の型定義
3. Scheduler/Queueの技術構成(具体的なミドルウェア・間隔)
4. Snapshot不変性をDBレベルでどう強制するか(アプリケーション層のみで担保するか、DB制約・トリガーを使うか)
5. Revision検知の実装方式(Provider次第だが、方針の確定)
6. 認証方式(HQの他プロジェクトと共通化するか、FX Event Analyzer独自にするか)
7. DBスキーマの正式なテーブル定義・型・Index・制約

---

## 7. Claude Code側からの所感(判断ではなく報告)

- 要件定義書v1.4・概要設計書v1.5の内容(Snapshot/Revision分離・API配信権の必須化・時刻同期ルール・統計除外ルール・AI縮小・Scheduler/Queue/Worker構成・Subscription基盤の段階的実装方針)は、いずれも今回のHQ方針(4章のAdapter抽象化含む)と矛盾しておらず、そのまま詳細設計のベースにできると考えている。
- 唯一、**Snapshot不変性をDB制約で強制するか、アプリケーション層の規律のみに頼るか**は、詳細設計で明示的に決めておくことを推奨する(規律のみに頼ると、将来別の開発者・別のコードパスから誤ってUPDATEしてしまうリスクが残るため)。
- 上記はあくまで報告であり、最終判断はHQに委ねる。
