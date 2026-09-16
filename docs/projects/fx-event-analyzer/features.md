# FX Event Analyzer: 機能一覧 v1.3

**出典**: HQより2026-09-16共有。v1.2は、HQが再発行した「正式版 機能一覧」テキストを本書に統合したもの。v1.3で、v1.2の内容がHQにより正式な基準仕様として確定し、あわせて用語統一(MarketReaction→EventPriceReaction)を反映した。実装は未着手。

**位置づけ**: 要件定義書v1.3・概要設計書v1.3・画面設計(ui-screens.md v1.0)の内容を、機能ID(FEAT-xxx)単位に分解したもの。今後の設計・実装で本書のIDを参照する。次フェーズでHQが「画面×機能」「画面×機能×API×DB」の対応表を作成する際の基礎資料となる。

## 変更履歴

- **v1.0**: 初版
- **v1.1**: 整合性確認3点へのHQ回答を反映
  - FEAT-045: 「EventRevisionベースの改定履歴表示」であることを明確化(定義自体は変更なし)
  - FEAT-224: 優先度をP2→**P1**に変更。ただしMVP対象はEntitlement設計・プラン概念までで、決済実装は別ID(FEAT-227、新設)に分離し、実装タイミングは未定のまま
  - FEAT-028: 対応方針確定(`IndicatorFxPair`多対多関連、詳細設計で確定)
- **v1.2**(今回): HQが再発行した「機能一覧 v1.0」(v1.1で確定済みの内容を含む完全版)を突き合わせ、差分のみ追加反映
  - FEAT-225(Community)の説明を具体化: 「一般的な掲示板ではなく、特定の経済イベントを中心とした共有機能として検討する」(13.将来機能)
  - OUT OF SCOPEに「MVPでの高度通知機能」を追加(13.作らない機能)
  - データ品質に関する絶対ルール(8項目)を独立セクションとして明文化(13.1節、新設)
  - それ以外の項目(Priority定義・FEAT-001〜226の内容)は既存のv1.1と完全に一致していることを確認済み(15.4節に確認結果を記載)
- **v1.3**(今回): HQ回答(2026-09-16「HQ確認」)を反映
  - 本書v1.2の内容を、HQが正式な基準仕様として確定
  - 用語「MarketReaction」を`EventPriceReaction`に統一することを確定(15.4節の用語表を更新)。今後、設計書・DB設計・API設計・FEAT関連資料・コード上のEntity/Model/DTO/Repository等はすべて`EventPriceReaction`を使用する。既存コードは存在しないため、コード側の変更対象は無し
  - Search API(FEAT-110〜115)の最終仕様は今回確定せず、DB詳細設計・API詳細設計へ持ち越すことを確認(申し送り事項として維持)
  - 次工程を「DB詳細設計」とすることを確認(`db-design.md`を新設)

## 優先度定義

- **P0**: MVP必須。これがないとコア価値が成立しない
- **P1**: MVPに含める。製品として必要
- **P2**: 将来追加
- **OUT**: 現時点では作らない

---

## 1. Home機能

| ID | 機能 | 優先度 | 対応画面 |
|---|---|---|---|
| FEAT-001 | 今日の経済イベント一覧取得 | P0 | Home |
| FEAT-002 | 重要イベント表示 | P0 | Home |
| FEAT-003 | イベント発表時刻表示 | P0 | Home |
| FEAT-004 | Countdown表示 | P1 | Home |
| FEAT-005 | Forecast表示 | P0 | Home |
| FEAT-006 | Previous表示 | P0 | Home |
| FEAT-007 | Actual表示 | P0 | Home |
| FEAT-008 | イベント発表前/発表済み状態表示 | P0 | Home |
| FEAT-009 | 主要FXペアの現在値表示 | P1 | Home |
| FEAT-010 | FXペアの変動率表示 | P1 | Home |
| FEAT-011 | イベント詳細への遷移 | P0 | Home |

## 2. 経済指標機能

| ID | 機能 | 優先度 | 対応画面 |
|---|---|---|---|
| FEAT-020 | 経済指標一覧取得 | P0 | Indicators |
| FEAT-021 | 国・地域による絞り込み | P1 | Indicators |
| FEAT-022 | 通貨による絞り込み | P1 | Indicators |
| FEAT-023 | 重要度による絞り込み | P1 | Indicators |
| FEAT-024 | 指標検索 | P0 | Indicators / Search |
| FEAT-025 | 指標詳細表示 | P0 | Indicator Detail |
| FEAT-026 | 指標説明表示 | P1 | Indicator Detail |
| FEAT-027 | 発表頻度表示 | P1 | Indicator Detail |
| FEAT-028 | 関連通貨ペア表示 | P0 | Indicator Detail |
| FEAT-029 | 過去の発表への遷移 | P0 | Indicator Detail |

## 3. イベント機能(コア)

| ID | 機能 | 優先度 | 対応画面 |
|---|---|---|---|
| FEAT-040 | 特定イベント取得 | P0 | Event Detail |
| FEAT-041 | 発表日時表示 | P0 | Event Detail |
| FEAT-042 | Forecast表示 | P0 | Event Detail |
| FEAT-043 | Actual表示 | P0 | Event Detail |
| FEAT-044 | Previous表示 | P0 | Event Detail |
| FEAT-045 | Revised Previous表示(= EventRevisionベースの改定履歴表示。「改定後」ラベルで区別。定義確定、v1.1) | P0 | Event Detail |
| FEAT-046 | 発表時点Snapshot取得 | P0 | Event Detail |
| FEAT-047 | 発表前/発表後状態判定 | P0 | Event Detail |
| FEAT-048 | データ取得状態表示 | P0 | Event Detail |
| FEAT-049 | データ欠損状態表示 | P0 | Event Detail |

**Snapshotの重要ルール**(要件定義書v1.3 5.1節・概要設計書v1.3 5.3/5.4節と同じ原則): 経済指標の現在値を単純に上書きして、過去の分析結果を書き換えてはいけない。`EconomicEvent`(Snapshot)・`EventRevision`の概念を維持し、相場反応分析は原則としてRelease-time Snapshotを参照する。

## 4. Surprise分析

| ID | 機能 | 優先度 | 対応画面 |
|---|---|---|---|
| FEAT-050 | Surprise計算 | P0 | Event Detail |
| FEAT-051 | Surprise符号表示 | P0 | Event Detail |
| FEAT-052 | Surprise値表示 | P0 | Event Detail |
| FEAT-053 | Forecast欠損時の処理 | P0 | Event Detail |
| FEAT-054 | Surprise分析対象外表示 | P0 | Event Detail |

MVP: `Surprise = Actual - Forecast`。Forecastが存在しない場合は`Surprise = null`(0扱い禁止)。将来: 指標ごとの標準化・Surprise magnitude・bucket・高度な乖離分析。

## 5. FX価格・相場反応機能

| ID | 機能 | 優先度 | 対応画面 |
|---|---|---|---|
| FEAT-060 | FXペア一覧管理 | P0 | 全体 |
| FEAT-061 | FX価格取得 | P0 | Backend |
| FEAT-062 | 1分足取得 | P0 | Movement Detail |
| FEAT-063 | 5分足取得 | P0 | Movement Detail |
| FEAT-064 | 15分足取得 | P0 | Movement Detail |
| FEAT-065 | 30分足取得 | P0 | Movement Detail |
| FEAT-066 | 60分足取得 | P0 | Movement Detail |
| FEAT-067 | 発表前価格取得 | P0 | Movement Detail |
| FEAT-068 | 発表後価格取得 | P0 | Movement Detail |
| FEAT-069 | 変動幅計算 | P0 | Movement Detail |
| FEAT-070 | pips計算 | P0 | Movement Detail |
| FEAT-071 | 変動率計算 | P0 | Movement Detail |
| FEAT-072 | 最大上昇/下落計算 | P1 | Movement Detail |
| FEAT-073 | 発表時刻チャート表示 | P0 | Movement Detail |
| FEAT-074 | 通貨ペア切り替え | P0 | Movement Detail |

対象時間軸: 1m/5m/15m/30m/60m。発表時刻とFX価格の時刻同期仕様は別途詳細設計で厳密に定義する(概要設計書v1.3 8章が基本方針)。

## 6. Historical Comparison

| ID | 機能 | 優先度 | 対応画面 |
|---|---|---|---|
| FEAT-080 | 過去イベント一覧取得 | P0 | Historical Comparison |
| FEAT-081 | 過去N回取得 | P0 | Historical Comparison |
| FEAT-082 | 過去イベントのForecast表示 | P0 | Historical Comparison |
| FEAT-083 | 過去イベントのActual表示 | P0 | Historical Comparison |
| FEAT-084 | 過去イベントのPrevious表示 | P0 | Historical Comparison |
| FEAT-085 | 過去イベントのSurprise表示 | P0 | Historical Comparison |
| FEAT-086 | 過去イベントの値動き表示 | P0 | Historical Comparison |
| FEAT-087 | 平均変動計算 | P0 | Historical Comparison |
| FEAT-088 | 最大変動計算 | P1 | Historical Comparison |
| FEAT-089 | 最小変動計算 | P1 | Historical Comparison |
| FEAT-090 | 分析可能件数表示 | P0 | Historical Comparison |
| FEAT-091 | 統計対象外データ除外 | P0 | Backend |
| FEAT-092 | 過去イベント比較チャート | P1 | Historical Comparison |

「過去20件」だけでなく「分析可能18/20」のように母数を表示。不完全なイベントを統計へ無条件に含めない。

## 7. Historical Event Detail

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-100 | 過去イベント詳細取得 | P0 |
| FEAT-101 | 発表時Snapshot表示 | P0 |
| FEAT-102 | Forecast / Actual / Previous表示 | P0 |
| FEAT-103 | Surprise表示 | P0 |
| FEAT-104 | 過去の相場反応表示 | P0 |
| FEAT-105 | 発表前後チャート表示 | P0 |
| FEAT-106 | Indicator Detailへの遷移 | P0 |

Historical Event Detail(過去の特定回のイベント)とIndicator Detail(指標そのもの)を混同しない。

## 8. Search

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-110 | キーワード検索 | P0 |
| FEAT-111 | 指標検索 | P0 |
| FEAT-112 | イベント検索 | P0 |
| FEAT-113 | FXペア検索 | P0 |
| FEAT-114 | 通貨検索 | P1 |
| FEAT-115 | 検索結果フィルタ | P1 |

## 9. 認証・アカウント

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-120 | 新規登録 | P0 |
| FEAT-121 | ログイン | P0 |
| FEAT-122 | ログアウト | P0 |
| FEAT-123 | パスワードリセット | P1 |
| FEAT-124 | アカウント情報表示 | P1 |
| FEAT-125 | アカウント情報変更 | P1 |

認証方式は別途詳細設計で確定する。

### 9.1 Subscription基盤(v1.1で新設。旧FEAT-224をP2→P1に変更・分割)

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-224 | Free/Proプラン概念・ユーザーの現在プラン管理・機能アクセス判定(Entitlement)・Backend側Entitlementデータ構造・UI上のプラン表示 | **P1**(MVP対象。決済実装は含まない) |
| FEAT-227(新設) | App Store決済(StoreKit)実装・購入処理・更新・解約・レシート/トランザクション検証 | 実装タイミング未定(β版前後で別途判断) |

「課金を後から追加する設計」ではなく、「最初からFree/Proへ拡張可能な設計にしておき、決済機構の実装タイミングだけ後で判断する」という方針(HQ回答、2026-09)。詳細は要件定義書v1.3 38〜55章・概要設計書v1.3 25章参照。

## 10. データ取得・管理(非表示、システム内部機能)

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-140 | 経済指標API取得 | P0 |
| FEAT-141 | FX価格API取得 | P0 |
| FEAT-142 | データ正規化 | P0 |
| FEAT-143 | Event Revision管理 | P0 |
| FEAT-144 | Release Snapshot生成 | P0 |
| FEAT-145 | 重複データ排除 | P0 |
| FEAT-146 | データ整合性検証 | P0 |
| FEAT-147 | 欠損データ検出 | P0 |
| FEAT-148 | APIエラーリトライ | P0 |
| FEAT-149 | Rate Limit制御 | P0 |
| FEAT-150 | Ingestionログ | P1 |
| FEAT-151 | データ品質ステータス管理 | P0 |

## 11. AI分析(MVPでは実装しない)

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-200 | 予想乖離理由AI分析 | P2 |
| FEAT-201 | 市場反応AI分析 | P2 |
| FEAT-202 | 過去イベントAI比較 | P2 |
| FEAT-203 | 要約生成 | P2 |
| FEAT-204 | AI分析根拠ソース表示 | P2 |

MVPでは自由生成AIによる「なぜ乖離したか」の説明は行わない。必要な場合は公式ソース等に基づく事実情報を表示する。

## 12. 将来機能

| ID | 機能 | 優先度 |
|---|---|---|
| FEAT-220 | 要人発言分析 | P2 |
| FEAT-221 | イベント通知 | P2 |
| FEAT-222 | Watchlist | P2 |
| FEAT-223 | パーソナライズ | P2 |
| FEAT-225 | Community(**v1.2で具体化**: 一般的な掲示板ではなく、特定の経済イベントを中心とした共有機能として検討する) | P2 |
| FEAT-226 | Web版 | P2 |

> FEAT-224(Subscription)はv1.1で9.1節「Subscription基盤」に移動・P1へ変更(決済実装のみFEAT-227として実装タイミング未定のまま残す)。

## 13. 作らない機能(OUT)

自動売買 / Broker注文(Brokerへの注文送信) / FX価格予測 / 売買シグナル / 自動投資判断・投資助言 / 一般的なSNS / 一般的な掲示板 / MVPでの高度AI分析 / MVPでの要人発言分析 / **MVPでの高度通知機能**(v1.2で追加)

### 13.1 データ品質に関する絶対ルール(v1.2で新設)

金融データを扱うため、以下をプロダクト全体の絶対ルールとして明文化する(いずれも既存の要件定義書v1.3・概要設計書v1.3に個別に記載済みの原則を、チェックリストとして一箇所に集約したもの)。

1. 取得できていないデータを0として扱わない
2. Forecastがない場合、Surpriseを0にしない(`Surprise = null`)
3. Release時点の情報と、後から改定された情報を区別する(Snapshot/Revision分離)
4. Release Snapshotはimmutableとする
5. 統計対象外イベントを分析件数に無条件で含めない(母数を明示する)
6. Pipsの最終値はBackendをSource of Truthとする
7. 外部APIのデータをそのままUIへ流さず、Backendで正規化してから利用する
8. データ取得失敗・欠損・遅延を状態(data_status)として管理する

---

## 14. MVPのコアループ

```
経済指標を見つける → Forecastを見る → Actualを見る → Surpriseを見る
  → 発表前後のFX価格を見る → pips/%を見る
  → 過去の同じイベントを見る → 今回と過去を比較する
```

---

## 15. 既存設計との整合性確認

### 15.1 解決済みの矛盾・懸念(v1.1、HQ回答反映)

#### 懸念-1(解決)
- **該当ID**: FEAT-045(Revised Previous表示、P0、Event Detail)
- **HQ回答**: FEAT-045は`EventRevision`ベースの改定履歴・改定値を扱う機能。`EconomicEvent.revised_previous`のような可変フィールドは復活させない。UI上で改定値を表示する場合は「改定後」等のラベルで発表時点の値と明確に区別する。
- **反映先**: 要件定義書v1.3 5.1節・概要設計書v1.3 5.4節、本書FEAT-045の記述を更新。

#### 懸念-2(解決)
- **該当ID**: FEAT-224(Subscription)
- **HQ回答**: 優先度をP2→P1へ変更。ただしMVP対象はFree/Proのプラン概念・Entitlement設計・UI表示までで、「決済まで完成させる」という意味ではない。App Store決済(StoreKit)実装・購入/更新/解約・レシート検証はβ版前後で実装タイミングを別途判断する。
- **反映先**: 要件定義書v1.3 38〜55章・概要設計書v1.3 25章、本書9.1節(新設)・FEAT-227(新設)。

#### 懸念-3(解決)
- **該当ID**: FEAT-028(関連通貨ペア表示、P0、Indicator Detail)
- **HQ回答**: 報告通り、Indicator↔FXPairの多対多関係を基本とし、`IndicatorFxPair`という関連モデルを検討する。具体的なテーブル名・カラム・制約はDB詳細設計で確定する。
- **反映先**: 要件定義書v1.3 27章・概要設計書v1.3 5.1/5.2節。

### 15.2 整合性が確認できた箇所(参考)

- Surprise分析(FEAT-050〜054)は要件定義書v1.3 11章・概要設計書v1.3 9章の「Forecast欠損時はnull、0禁止」の方針と完全に一致
- AI分析(FEAT-200〜204)が全てP2であることは、要件定義書v1.3 12章・概要設計書v1.3 11章の「MVPでは出典付き事実要約のみ、自由生成AI解説は将来拡張」という縮小方針と一致
- 統計除外(FEAT-091)・分析可能件数表示(FEAT-090)は概要設計書v1.3 10.2/10.3節の母数表示ルールと完全に一致
- Snapshot/Revision管理(FEAT-046・143・144)は概要設計書v1.3 5.3/5.4節の設計と一致
- FEAT-074(通貨ペア切り替え、Movement Detail、P0)により、ui-screens.md 8.3節で報告していた「Movement Detailの複数ペア比較の要否」という技術的懸念の一部が解消された(少なくとも「切り替え」は確定した。同時比較表示の要否は引き続き未確認)

### 15.3 新たに発生した懸念

現時点で新たな矛盾・懸念は確認していない。強いて挙げるなら、FEAT-227(決済実装)の具体的な着手時期(β版の「前」か「後」か)が未定のままであることは、リリース計画を立てる段階で改めてHQの判断が必要になる。

### 15.4 v1.2再確認レポート(HQが再発行した機能一覧との突き合わせ)

HQ指示の7項目に沿って報告する。**コードは一切存在しないため(実装未着手)、「コードとの不整合」は該当なし。**

1. **現在のコード・設計との不整合**: コードは存在しない。設計ドキュメント(要件定義書v1.3・概要設計書v1.3・ui-screens.md v1.0)との不整合は無し。差分は13章・13.1節に反映した2点のみ(Community説明の具体化、OUT項目の追加)。
2. **機能一覧に不足している依存関係**: 新たな不足は見つからなかった。既知の依存(Home→Event Detail遷移がFEAT-040に依存、等)は画面遷移(ui-screens.md 6章)と一致している。
3. **DB設計に影響する機能**: EventSnapshot(FEAT-046)・EventRevision(FEAT-045/143)・IndicatorFxPair(FEAT-028)・EventPriceReaction(FEAT-069〜074、旧称MarketReaction)・DataQualityStatus(FEAT-151)。いずれも概要設計書v1.3 5章・db-design.md v1.0に反映済み。
4. **API設計に影響する機能**: 検索(FEAT-110〜115)が指標・イベント・FXペア・通貨を横断するため、複数エンティティを跨ぐ検索APIの設計が必要になる点は、現時点ではAPI詳細設計に未反映(詳細設計での確認事項として記録)。
5. **P0/P1/P2の矛盾**: 確認した範囲で矛盾なし。全FEAT-IDの優先度は本書(v1.1で確定済みの内容)と完全に一致していた。
6. **既存仕様との矛盾**: 無し。
7. **実装前に決める必要がある事項**: `implementation-notes-for-hq.md`の既存リスト(Provider最終選定・Scheduler/Queue技術・Auth service等)に変更なし。加えて上記4のAPI設計事項を追加。

**HQ確認事項として指定された用語の状況**:

| 用語 | 現在のドキュメント上の状態 |
|---|---|
| EventSnapshot | 概要設計書v1.3 5.3節で`EconomicEvent`として定義済み(immutable) |
| EventRevision | 概要設計書v1.3 5.4節で定義済み(「改定後」ラベル表示ルールも明記済み) |
| IndicatorFxPair | 概要設計書v1.3 5.1/5.2節で定義済み(多対多、具体的カラムはDB詳細設計待ち) |
| MarketReaction / EventPriceReaction | **解決(HQ確認、2026-09-16)**: `EventPriceReaction`に正式統一。設計書・DB設計・API設計・FEAT関連資料・コード上のEntity/Model/DTO/Repository等すべてで今後この名称を使用する |
| FX Pips calculation | 概要設計書v1.3 5.5節・要件定義書v1.3 10章で「Backendを正とする」ことが明記済み |
| Data Quality | 概要設計書v1.3 13章(データ品質管理・運営機能)・13.1節(絶対ルール)で明記済み |
| Subscription / Entitlement | 概要設計書v1.3 25章・本書9.1節で「Entitlement設計はMVP、決済実装はFEAT-227として分離・タイミング未定」の方針が明記済み |
| Forecast missing handling | 要件定義書v1.3 11.2節・概要設計書v1.3 9.3節で`Surprise = null`(0禁止)と明記済み |
| Historical statistics denominator | 概要設計書v1.3 10.2/10.3節で「分析可能件数/全件数を提示する」ルールが明記済み |

**ディレクトリ構成の提案について**: HQから`docs/requirements/`・`docs/design/{screen,feature,database,api}/`のような階層構成の提案があったが、HQ自身の指示にある「既存構成を勝手に大幅変更しない」という原則に従い、**今回は変更していない**。現在の`docs/projects/fx-event-analyzer/`配下のフラット構成(requirements.md / design.md / features.md / ui-screens.md / implementation-notes-for-hq.md)は、他プロジェクト(moyasuka・bgm-pipeline)と同じ`docs/projects/<name>/`規約に沿っており、相互参照リンクも既に機能している。ディレクトリ階層化が必要かどうかは、DB詳細設計・API詳細設計のドキュメントが増えた際に改めてHQの判断を仰ぎたい。

---

## 16. 現在の設計ドキュメント構成

```
docs/projects/fx-event-analyzer/
├── README.md                        … プロジェクト概要・開発体制・経緯
├── requirements.md                  … 要件定義書 v1.3
├── design.md                        … 概要設計書 v1.3
├── implementation-notes-for-hq.md   … 詳細設計インプット情報
├── ui-screens.md                    … 画面設計・UI方針 v1.0
├── features.md                      … 本書。機能一覧 v1.3(FEAT-ID)
├── db-design.md                     … DB詳細設計 v1.0(新設)
└── mockups/
    └── screens-overview-dark-v1.png
```

## 17. 次のフェーズ

機能一覧v1.2はHQにより正式な基準仕様として確定した(v1.3、2026-09-16)。次工程は「DB詳細設計」(`db-design.md`)。HQレビューの後、API詳細設計へ進む。Claude Codeは実装未着手のまま待機する。
