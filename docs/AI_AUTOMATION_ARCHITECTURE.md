# AI自動化アーキテクチャ(改善案)

作成日: 2026-09-15
前提: `AI_USAGE_AUDIT.md`の監査結果に基づく改善設計。**本ドキュメントは設計案であり、人間の承認前にコードへ反映しない。**

---

## 1. 目標アーキテクチャ

```
                    ┌──────────────────┐
                    │  GitHub Actions   │  ← schedule: の信頼性問題は
                    │ (cronの信頼性向上) │    ここで直接解決する
                    └─────────┬─────────┘
                              │
                    定型処理・データ取得・条件分岐
                              │
                              ▼
                    ┌──────────────────┐
                    │  リポジトリ内JSON  │ (Supabase等への移行は将来検討、
                    │ (現状のstate管理)  │  現時点では過剰投資と判断)
                    └─────────┬─────────┘
                              │
                        異常・判断必要?
                        /            \
                      No              Yes
                       │                │
                       ▼                ▼
                     終了          Claude API
                                   (軽量〜中量モデル、
                                    定型プロンプト+JSON入出力)
                                        │
                                        ▼
                                  判断結果をJSON保存
                                        │
                                        ▼
                              GitHub Actionsが後続処理を実行
                              (投稿・返信・通知・ログ保存)

Claude Codeはこの常時稼働経路から外し、以下にのみ関与する:
  - 週次経営レビュー(戦略判断)
  - 障害調査・原因不明のトラブルシューティング
  - コード変更・設計・監査
  - 創作領域(記事執筆等)の一次生成 or 最終校正
  - 新しい自動化の設計・実装
```

---

## 2. Threads自動化の移行案(最優先領域)

### 2-A. 「確実に起動」系6Routineの廃止 → GitHub Actions側で信頼性を確保

**現状の問題**: `schedule:`トリガーが発火しない/大幅遅延することがあるため、CCR Routine(Claude Code)から`workflow_dispatch`で叩く「保険」を追加した。

**改善案(優先度順)**:

1. **複数cron時刻の追加**(`threads-publish.yml`で既に実施済みのパターンを他5workflowにも適用)
   - 例: `threads-token-health-check.yml`に`15 */4 * * *`に加え`45 */4 * * *`を追加するなど、同一ワークフロー内に保険用cronを複数持たせる。GitHub Actions内で完結し、Claude Codeを一切必要としない。
   - 既にpublish.ymlで実証済みの対策であり、実装コストが最も低い。

2. **外部監視サービスからの`workflow_dispatch`起動**(cronがどうしても信頼できない場合)
   - GitHub Actions自体の`schedule:`が全体的に不安定なら、外部の無料cronサービス(例: cron-job.org、GitHub外のスケジューラ)からGitHub REST API(`POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`)を直接叩く。認証はfine-grained PAT(Actions: write権限のみ)で足りる。
   - Claude Codeもリポジトリ内コードも経由しない、最も「常時稼働経路から切り離す」度合いが高い案。

3. **(上記2案がどうしても機能しない場合の最終手段として)軽量な定期実行環境**
   - 例えばVercel Cron / Cloudflare Workers Cron等、無料枠のある外部スケジューラから同様に`workflow_dispatch`を叩く。

→ いずれの案でも、**AIの判断は一切不要**。実装後、対応する6つのCCR Routineは削除してよい(削除は人間承認後)。

### 2-B. 「Threadsトークン 監視」の廃止 → GitHub Actions内で完結

**現状**: `check_token_health.py`が`token-health.json`を書き込んだ後、別のCCR Routineがそれを読んでPushNotificationを送っている。

**改善案**: `threads-token-health-check.yml`のワークフロー自体に、通知送信ステップを追加する。
- GitHub Actionsから送れる通知手段: ntfy.sh(無料・APIキー不要に近い)、Pushover、Slack Webhook、メール(SendGrid等)のいずれか。
- ロジック(`ok:false`かつ`notified`未設定の場合のみ送信、送信後`notified:true`を書き込みcommit)は、Pythonスクリプト内にそのまま移植可能(if/elseのみ、AI不要)。
- これにより「Threadsトークン 監視」Routineは完全に不要になる。

**参考**: 現在の通知メッセージ形式(`「Threadsトークン異常検知: {error}。get_token.pyの再認可とGitHub Secrets更新が必要です」`)はそのまま流用できる、定型テンプレート。

### 2-C. 「Threads返信 自動対応」(判断ステップ)→ Claude API化

**現状**: Claude Codeセッションがガードレール文書を読み、`replies-pending.json`の各コメントについてreply/skipを判断し`reply-decisions.json`に書き出す。

**改善案**:
1. `docs/marketing/2026-09-10-threads-auto-reply-guardrails.md`の基準をシステムプロンプトとして固定化したスクリプト(例: `threads-affiliate/judge_replies.py`)を新設。
2. このスクリプトが `ANTHROPIC_API_KEY` を使いClaude API(判断の複雑さに応じてHaiku級で十分な可能性が高い、要検証)を1コメントずつ or バッチで呼び出し、`{action, reply_text | skip_reason}`のJSONを得る。
3. `threads-fetch-replies.yml`実行後、同一ワークフロー内 or 新規`threads-judge-replies.yml`(GitHub Actions、schedule: 毎時30分)としてこのスクリプトを実行し、そのままcommit。
4. これにより「Threads返信 自動対応」Routineは不要になり、判断のレイテンシも(セッション起床を待たず)短縮される。
5. **安全側の判断基準(迷ったらskip)は、プロンプト内に明記して維持する。** 医療/法律/金融等の個別助言・クレーム・個人情報等の除外ルールも同様にプロンプトへ移植。

### 2-D. 「Threadsアフィリエイト 毎日投稿案生成」→ Claude API化(段階的)

**現状**: Claude Codeセッションが`products.json`から商品を選び、`post-template.md`の方針(フック生成・自己評価・9パターン分類)に従って投稿文を作り、`pending/YYYY-MM-DD.json`に保存・commit。

**改善案**:
1. `post-template.md`の内容(基本思想・9パターン・禁止事項・フック自己評価基準)をそのままシステムプロンプトとして固定化。
2. 新規スクリプト(例: `threads-affiliate/generate_post.py`)がClaude APIを1回呼び出し、商品候補(`products.json`)+直近の`publish-log.jsonl`(30日重複回避・post_type別実績)を入力として渡し、JSON形式の投稿案を得る。
3. GitHub Actions(`threads-generate-post.yml`、schedule: 毎日20:00 JST)として実行し、`pending/`にcommit。
4. **ただし移行は段階的に。** 現状はまだ新戦略(9パターン taxonomy)の効果検証中(ユーザー指示により「30〜50投稿を待たず10投稿単位で分析」という運用ルールが敷かれている)であり、初期は生成ロジックの微調整が頻繁に必要になる可能性が高い。当面はClaude Codeでの生成を継続し、**パターンが安定してからAPI化する**のが現実的(優先順位は2-A〜2-Cより低い)。

### 2-E. 週次のResearch/Insights「確実に起動」

2-Aの対策(GitHub Actions内での信頼性確保)で解消。判断ロジック自体(`research.py`)は既に通常コードのため、追加のAI化は不要。

---

## 3. 他事業への適用方針

| 事業 | 現状 | 方針 |
|---|---|---|
| note-articles / love-note | CCR Routineが週1〜2回、記事執筆自体をClaude Codeで実施 | 頻度が低く(週1〜2回)コスト影響は小さい。**創作領域のため当面Claude Code維持**。ただし将来的に「構成案の生成はAPI、最終校正・トーン調整のみ人間+Claude Code」という分業は検討余地あり |
| BGM Shorts / 長尺動画 | 毎日/週次でCCR Routineが生成・公開判断 | 本監査では未深掘り。次回監査で「生成パイプライン(`bgm-pipeline/`)のうちどこまでが機械的処理か」を洗い出す必要がある。特にBGM Shortsは**毎日**実行のため、Threads同様に「機械的な部分」と「創作判断部分」の切り分けの余地が大きい可能性 |
| 週次経営レビュー | 週1回、全社KPIを見て戦略判断 | **これは適切なClaude Code利用。変更不要** |
| expense-app / app | 開発中のプロダクト、自動化なし | 対象外 |

---

## 4. 移行の優先順位

| 優先度 | 対象 | 理由 | 削減見込み(セッション起動回数/日) |
|---|---|---|---|
| **P0** | 2-A「確実に起動」6Routine | 実装コスト最小(cron追加 or 外部スケジューラ)、削減量最大 | 約31.3回/日 |
| **P0** | 2-B「Threadsトークン 監視」 | 実装コスト小(通知ステップ追加のみ)、AI不要処理の典型例 | 約6.0回/日 |
| **P1** | 2-C「Threads返信 自動対応」のAPI化 | Claude API実装+プロンプト移植が必要だが、既存ガードレール文書をほぼそのまま使える | 約12.0回/日(ゼロにはならないが、Claude Code→API呼び出しへの質的転換) |
| **P2** | 2-D「毎日投稿案生成」のAPI化 | 戦略検証中のため生成ロジックが流動的。安定後に着手 | 約1.0回/日(質的転換) |
| **P3** | BGM/note等の他事業の見直し | 頻度が低く緊急性が低い。次回監査で深掘り | 未算定 |

**P0の2件だけで、1日約52回中37.3回(約71%)のセッション起動を削減できる。**

---

## 5. 変更後に期待できる効果

1. **Claude Code/Claude Codeセッションの起動回数が1日約52回→約15回程度(P0+P1完了後)に減少**、無駄な上限消費が解消される。
2. GitHub Actionsの信頼性問題は「Claude Codeで叩き続ける」という対症療法ではなく、**cron設定自体の改善または外部スケジューラという根本対策**で解決される。
3. 返信判断・投稿生成がClaude API化されることで、**セッションの起床を待たない分レイテンシが下がり**、かつ処理コストも(フル機能セッションよりAPI1コールの方が)低くなる可能性が高い。
4. Claude Codeは「開発・監査・戦略判断・障害調査・創作」という、本来の強みを発揮すべき領域に専念できるようになる。
5. AI利用量の可視化(`AI_USAGE_POLICY.md`参照)により、今後同種の「気づかないうちに常時稼働」が再発しにくくなる。
