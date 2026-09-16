# FX Event Analyzer: 機能一覧 v1.0

**出典**: HQより2026-09-16共有。実装は未着手。

**位置づけ**: 要件定義書v1.2・概要設計書v1.1・画面設計(ui-screens.md v1.0)の内容を、機能ID(FEAT-xxx)単位に分解したもの。今後の設計・実装で本書のIDを参照する。次フェーズでHQが「画面×機能」「画面×機能×API×DB」の対応表を作成する際の基礎資料となる。

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
| FEAT-045 | Revised Previous表示 | P0 | Event Detail |
| FEAT-046 | 発表時点Snapshot取得 | P0 | Event Detail |
| FEAT-047 | 発表前/発表後状態判定 | P0 | Event Detail |
| FEAT-048 | データ取得状態表示 | P0 | Event Detail |
| FEAT-049 | データ欠損状態表示 | P0 | Event Detail |

**Snapshotの重要ルール**(要件定義書v1.2 5.1節・概要設計書v1.1 5.3/5.4節と同じ原則): 経済指標の現在値を単純に上書きして、過去の分析結果を書き換えてはいけない。`EconomicEvent`(Snapshot)・`EventRevision`の概念を維持し、相場反応分析は原則としてRelease-time Snapshotを参照する。

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

対象時間軸: 1m/5m/15m/30m/60m。発表時刻とFX価格の時刻同期仕様は別途詳細設計で厳密に定義する(概要設計書v1.1 8章が基本方針)。

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
| FEAT-224 | Subscription | P2 |
| FEAT-225 | Community | P2 |
| FEAT-226 | Web版 | P2 |

## 13. 作らない機能(OUT)

自動売買 / Broker注文 / FX価格予測 / 売買シグナル / 投資判断の自動指示 / 一般的なSNS / 汎用掲示板 / MVPでの高度AI分析 / MVPでの要人発言分析

---

## 14. MVPのコアループ

```
経済指標を見つける → Forecastを見る → Actualを見る → Surpriseを見る
  → 発表前後のFX価格を見る → pips/%を見る
  → 過去の同じイベントを見る → 今回と過去を比較する
```

---

## 15. 既存設計との整合性確認

### 15.1 矛盾・懸念

#### 懸念-1
- **該当ID**: FEAT-045(Revised Previous表示、P0、Event Detail)
- **現在の設計**: 要件定義書v1.2 5.2節・概要設計書v1.1 5.3節では、設計レビューの反映により`EconomicEvent`(Snapshot)から`revised_previous`列を撤去済み。改定情報は別テーブル`EventRevision`に分離し、「参考情報」として扱う設計になっている(不変のSnapshot値による分析結果を、改定によって書き換えない、という原則のため)。
- **今回の機能一覧**: 「Revised Previous表示」がEvent Detail画面のP0(MVP必須)機能として記載されている。
- **問題点**: 「Revised Previous表示」が①`EventRevision`の内容(=後日の改定履歴)を参考情報として表示する機能なのか、②旧v1.0設計にあった`EconomicEvent.revised_previous`という単一の可変フィールドを指しているのか、名称からは区別できない。後者の意味であれば、レビューで修正した「Snapshot不変性」の原則と矛盾する。
- **推奨案**: 「Revised Previous表示」を「Previous改定履歴の参考表示(EventRevisionベース)」という機能として定義し直すことを推奨。表示自体はP0のままで問題ないが、データソースは`EventRevision`であることを明記する。
- **HQ判断が必要か**: Yes(機能の定義自体は小さな確認で済むと考えられるが、Snapshot不変性という中核原則に関わるため、念のため確認をお願いしたい)。

#### 懸念-2
- **該当ID**: FEAT-224(Subscription、P2=将来)
- **現在の設計**: 要件定義書v1.1 45〜49章・概要設計書v1.1 25章は、Free/Proの機能区分(過去データ完全検索・統計・複数ペア比較等をPro限定とする)をプロダクト戦略の中核として詳細に記述している。
- **今回の機能一覧**: Subscription機能自体がP2(将来追加)に分類されている。
- **問題点**: Free/Pro機能区分の「設計」はMVPの前提として要件定義書に組み込まれているが、実際の「課金機構(Subscription)」の実装がP2(MVP後)だとすると、**MVPの初回リリース時点ではFree/Proの区分けを実施せず、全機能を無料公開する**ことになる。これは矛盾ではなく整理不足の可能性が高いが、影響が大きいため確認が必要。
- **推奨案**: 「MVPでは課金導線(実際の決済)は実装しないが、Free/Proの機能区分(表示上のゲーティング)自体はMVPに含める」のか、「MVPでは区分自体を設けず全機能無料で提供する」のか、どちらの方針かをHQに確認する。
- **HQ判断が必要か**: Yes(プロダクト戦略・収益化タイミングに関わる判断のため)。

#### 懸念-3(不足、矛盾ではない)
- **該当ID**: FEAT-028(関連通貨ペア表示、P0、Indicator Detail)
- **現在の設計**: 概要設計書v1.1 5.2節の`Indicator`エンティティ定義には、関連するFXペアとの関係(Indicator↔FXPairの紐付け)が明示されていない。
- **今回の機能一覧**: 「関連通貨ペア表示」がP0機能として明記されている。
- **問題点**: この機能を実現するには、IndicatorとFXPairの間に何らかの関連付け(多対多の可能性が高い)をデータモデルに追加する必要があるが、現状のER設計にその関連が存在しない。
- **推奨案**: 詳細設計で`Indicator`↔`FXPair`のマッピング(例: 中間テーブル)を追加することを推奨する。
- **HQ判断が必要か**: No(詳細設計の通常の作業範囲と考えられるが、見落とし防止のため一応報告)。

### 15.2 整合性が確認できた箇所(参考)

- Surprise分析(FEAT-050〜054)は要件定義書v1.2 11章・概要設計書v1.1 9章の「Forecast欠損時はnull、0禁止」の方針と完全に一致
- AI分析(FEAT-200〜204)が全てP2であることは、要件定義書v1.2 12章・概要設計書v1.1 11章の「MVPでは出典付き事実要約のみ、自由生成AI解説は将来拡張」という縮小方針と一致
- 統計除外(FEAT-091)・分析可能件数表示(FEAT-090)は概要設計書v1.1 10.2/10.3節の母数表示ルールと完全に一致
- Snapshot/Revision管理(FEAT-046・143・144)は概要設計書v1.1 5.3/5.4節の設計と一致
- FEAT-074(通貨ペア切り替え、Movement Detail、P0)により、ui-screens.md 8.3節で報告していた「Movement Detailの複数ペア比較の要否」という技術的懸念の一部が解消された(少なくとも「切り替え」は確定した。同時比較表示の要否は引き続き未確認)

---

## 16. 現在の設計ドキュメント構成

```
docs/projects/fx-event-analyzer/
├── README.md                        … プロジェクト概要・開発体制・経緯
├── requirements.md                  … 要件定義書 v1.2
├── design.md                        … 概要設計書 v1.1
├── implementation-notes-for-hq.md   … 詳細設計インプット情報
├── ui-screens.md                    … 画面設計・UI方針 v1.0
├── features.md                      … 本書。機能一覧 v1.0(FEAT-ID)
└── mockups/
    └── screens-overview-dark-v1.png
```

## 17. 次のフェーズ

HQ側で「画面×機能」の対応表を作成し、その後「画面×機能×API×DB」まで紐付けて詳細設計を完成させる。Claude Codeは実装未着手のまま待機する。
