# AI_AUTOMATION_ARCHITECTURE.md — 改善後のAI自動化アーキテクチャ(提案, 2026-09-15)

`AI_USAGE_AUDIT.md`の監査結果に基づく改善案。**本ドキュメントは提案のみであり、実装(Routineの変更・削除、ワークフロー追加)はオーナー確認後に別途行う。**

## 1. 目標アーキテクチャ(全体像)

```
                    ┌──────────────┐
                    │ GitHub Actions│  ← 定型処理・データ取得・確実性チェックはここに集約
                    └──────┬───────┘
                           │
                    定型処理・データ取得
                           │
                           ▼
                    ┌──────────────┐
                    │ リポジトリ内JSON │  ← 既存方針(専用DBを作らない)を維持
                    └──────┬───────┘
                           │
                     異常・判断必要？
                       /       \
                     No         Yes
                     │           │
                     ▼           ▼
                  終了      Claude Code Remote Routine
                               │
                               ▼
                         AI判断・分析・創作
                               │
                               ▼
                         アクション実行(コミット・push)
                               │
                               ▼
                            ログ保存
```

Claude Code Remoteは「判断・創作・戦略」だけに使い、「確認・起動・条件分岐」は通常コード(GitHub Actions)に寄せる。

## 2. 現状構造との比較

**現状(問題)**:

```
GitHub Actions(schedule, 不安定)
    ↓ 信頼できないので
Claude Code Remote Routine(「確実に起動」系、6件)
    ↓ workflow_dispatchで再起動 + ポーリング
GitHub Actions(実処理)
```

→ GitHub Actionsの信頼性問題を、コストの高いClaude Code Remoteセッションで「保険」を掛けることで解決している。本末転倒な構造。

**改善後**:

```
GitHub Actions(schedule, 複数の緩和策を併用)
    ↓
GitHub Actions(実処理)
```

→ Claude Code Remoteを経路から完全に外し、GitHub Actionsの信頼性問題はGitHub Actionsの範囲内(または無料の外部cronサービス)で解決する。

## 3. 「確実に起動」系Routine(6件+トークン監視1件、計37回/日)の代替案

### 案A(推奨): 単一の「ヘルスチェック統合ワークフロー」に集約

現在、個別に「確実に起動」Routineを持っている6つのワークフロー(`threads-token-health-check`, `threads-insights`, `threads-research`, `threads-send-replies`, `threads-fetch-replies`, `threads-publish`)それぞれに専用のClaude Code Remote Routineを作る代わりに、**1本のGitHub Actionsワークフロー(例: `scheduled-health-guard.yml`)を10〜15分おきに実行し、「各対象ワークフローの直近の実行時刻」をGitHub Actions APIで確認して、想定時刻を過ぎても実行されていなければ`workflow_dispatch`で起動する**、という自己修復ロジックに置き換える。

- 実装は素のシェルスクリプト+`gh` CLI(またはREST API)のみ。AIは一切不要
- 10〜15分おきの実行はGitHub Actionsの「毎時00分の混雑」問題を避けられる(このリポジトリの既存ワークフローが実践している「00分を避ける」ノウハウをそのまま踏襲)
- 実行自体は軽量(数秒)なので、頻度を上げてもコスト増は無視できるレベル

### 案B: 外部無料cronサービスからの直接起動

`cron-job.org`等の無料外部cronサービスから、GitHub Actionsの`repository_dispatch`または`workflow_dispatch` REST APIを直接HTTPで叩く。GitHub Actions自体の`schedule:`トリガーの不安定さ(公式に「混雑時は遅延・スキップされ得る」と明記されている既知の制限)を、GitHub Actions内で解決しようとするのではなく、外部から直接呼び出すことで回避する。

- リポジトリ内にコードの追加は不要(外部サービスの設定のみ)
- ただしPAT(personal access token)の外部サービスへの登録が必要になるため、セキュリティ上のトレードオフをオーナーと相談してから採用する

**どちらを採用するにせよ、Claude Code Remoteは経路から完全に外れる。** 37回/日のセッション起動が実質ゼロになる。

### 「Threadsトークン 監視」(4時間おき、token-health.jsonの条件分岐+通知)の代替

これも同様にAIが不要。GitHub Actions側で`token-health.json`の`"ok"`フィールドをチェックし、異常時はGitHub Actionsから直接Slack Webhook/メール/(可能であれば)何らかのプッシュ通知APIを叩く形に変更する。現状`PushNotification`ツール(Claude Code Remote専用機能)を使っているためAIセッション経由になっているが、これは通知手段の制約であり判断の複雑さの問題ではない。**通知経路さえ確保できれば完全にコード化できる。**

## 4. 「Threads返信 自動対応」(2時間おき、LEVEL 2)の見直し

このRoutine自体はAIの判断が必要な領域(内容の可否判断)だが、**2時間おきという頻度は必ずしも必要ない**可能性がある。

- 現状、直前の`threads-fetch-replies.yml`(GitHub Actions)がコメントを`replies-pending.json`に蓄積する設計であるため、**「判断」自体は1日1〜2回のバッチ処理にまとめても実用上の遅延は限定的**(コメント返信が数時間遅れても、ユーザー体験への影響は投稿の即時性ほど大きくない)。
- 案: 2時間おき(12回/日)→ 4時間おきまたは1日2回(朝夕)に減らす。判断対象が0件のサイクルはRoutine自体が「新着コメント無し」で即終了する設計のため、頻度を下げても機会損失は「返信が数時間遅れる」程度に留まる。
- これにより12回/日→2〜6回/日に削減でき、セッションAの起動回数をさらに大きく減らせる。

## 5. BGM Shorts/長尺自動公開の分離

現状、OAuth残日数チェック→公開スクリプト実行→成否判定→通知、という一連の処理がすべて1つのClaude Code Remote Routineに入っている。このうち:

- OAuth残日数の数値比較・公開スクリプトの実行・終了コード確認・定型通知 → **GitHub Actionsに移行可能**(`bgm-pipeline`のPythonスクリプトをそのままGitHub Actions runnerで実行し、失敗時のみ通知を送る設計にできる。既に`note-publish-check.yml`が同種の「Pythonスクリプト実行+条件付き通知」パターンを実践している)
- 「毎日稼働への切替が視聴者離れを起こしていないか、月1回程度チェックする」「実績データに基づくプリセット追加の判断」等の**戦略判断部分だけ**を、週次経営レビューRoutine(既存)に統合する

これにより、BGM Shorts/長尺の日次・週次Routine自体を段階的にGitHub Actions化できる可能性がある(ただし、YouTube Data APIの認証情報をGitHub Secretsに保存する必要があり、セキュリティ・運用面の検討が必要。**この移行は本ドキュメントでは提案に留め、実装しない**)。

## 6. AIを残す領域(変更しない)

以下は現状のままClaude Code Remote Routineとして維持することを推奨する(`AI_USAGE_AUDIT.md`セクション6と同じ):

- Threadsアフィリエイト 毎日投稿案生成(創作)
- note記事生成(週2回)・恋愛ジャンルnote週次記事生成(創作)
- モヤスカ台本自動生成(創作+構文検証)
- 週次経営レビュー(複数事業横断の戦略判断)
- Threads返信の可否判断そのもの(頻度のみ4-の通り見直し)

これらはLEVEL 1〜2に該当し、Claude Code Remoteの価値が実際に発揮される領域である。

## 7. Claude Code Remote内でのコンテキスト管理

`persist_session: true`によって会話が無期限に蓄積し続ける設計自体も見直しの余地がある。

- 案: 定期的(例えば月1回)に永続セッションを「区切り直す」— 直近の重要な状態(未解決タスク・進行中の作業)をファイル(`docs/company-os/`配下)に書き出した上で、新しいセッションIDに`persistent_session_id`を切り替える運用を検討する。ただしこれは**Claude Code Remote側の運用方法の変更であり、リポジトリのコード変更を伴わない**。オーナーの判断が必要。
- 上記3〜5の変更(Routine起動回数を1日53回→十数回程度に削減)を先に実施すれば、cache_read_tokensの増加速度そのものが大幅に下がるため、コンテキスト圧迫の問題も自然に緩和される。

## 8. まとめ: 優先順位

1. **最優先・最も効果が大きい**: 「確実に起動」系6件+トークン監視1件をGitHub Actions側の自己修復ワークフローに置き換える(セクション3)。これだけで1日約37回、セッションAの起動回数の72%を削減できる
2. **次点**: Threads返信自動対応の頻度を2時間おきから4時間おき/1日2回に見直す(セクション4)。さらに数回/日を削減
3. **中期**: BGM Shorts/長尺の機械的部分をGitHub Actions化する(セクション5)。要オーナー確認(YouTube認証情報の扱い)
4. **運用面**: Claude Code Remote永続セッションの定期的な区切り直しを検討する(セクション7)。要オーナー確認

いずれも本ドキュメントは提案であり、実装は別途承認を得てから行う。
