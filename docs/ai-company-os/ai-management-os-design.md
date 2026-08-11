# AI経営判断OS — MVP設計

**作成日**: 2026-08-11 | **ステータス**: 設計のみ、未実装(オーナー指示により大規模実装は開始していない)

`2026-08-11-amendments.md`で確定した方針(0→1売上検証フェーズ、Experimentエンティティの追加、実顧客支払いの記録)を実現するためのデータ構造・ワークフロー・実装順序を提案する。

## 設計方針

1. **大規模なDB/バックエンドは作らない。** 既存の運用(gitがすべての正、markdown/JSONで管理、Routineがコミット・プッシュ)をそのまま踏襲する。「構造化データ」とは「専用DBサーバー」ではなく「決まったスキーマのJSONファイル群をgitで管理する」ことを意味する。
2. **既存の仕組みを置き換えない、接ぎ木する。** 5つのRoutine・ダッシュボード・週次レポートは維持し、それぞれが「書き込む先」を今のプレーンな文章(HTML直接編集)から構造化データに変える。
3. **「タスクをこなした記録」ではなく「仮説検証の記録」を主役にする。** Experimentエンティティが中心。すべての事業活動は最終的に何らかのExperimentに紐づく。
4. **売上ゼロの現段階では過剰な自動化をしない。** 最初はほぼ手動(Routineがファイルを書く程度)で運用し、実際にデータが溜まって「見る価値」が証明されてから可視化・自動集計を強化する。

## データ構造

`docs/company-os/`配下に、エンティティごとのディレクトリを作る。1レコード=1JSONファイル(git履歴そのものが変更履歴になる)。

```
docs/company-os/
  company.json                 # シングルトン: 会社全体の識別情報・北極星KPI
  businesses/
    bgm.json
    note.json
    app.json
    moyasuka.json
  experiments/
    <business>-<slug>.json      # 例: moyasuka-tts-comparison.json
  kpi/
    <business>-<YYYY-Www>.json  # 週次スナップショット
  revenue/
    <YYYY-MM-DD>-<seq>.json     # 実際に入金があった時だけ作る
  expense/
    <YYYY-MM-DD>-<seq>.json
  decisions/
    <YYYY-MM-DD>-<slug>.json    # 必須協議事項に該当する意思決定
  risks/
    <slug>.json
```

### Company(シングルトン)

```json
{
  "mission": "AIによって経営・実行コストを極限まで下げながら、利益と企業価値を最大化する",
  "phase": "0-to-1-revenue-validation",
  "phase_started": "2026-08-11",
  "north_star_kpi": "real_customer_payment",
  "secondary_kpi": "operating_profit",
  "cash_balance_jpy": 0,
  "last_updated": "2026-08-11"
}
```

### Business

```json
{
  "id": "moyasuka",
  "name": "モヤスカ",
  "tier": 1,
  "status": "active",
  "thesis": "LINE風スカッと系Shortsで日次投稿→広告収益",
  "success_metrics": ["再生数", "視聴時間", "登録者", "CTR", "継続視聴", "収益化条件への進捗", "収益額"],
  "not_success_metrics": ["自動化率そのもの"],
  "revenue_jpy_total": 0,
  "last_updated": "2026-08-11"
}
```
(`app`は`status: "market-validation-pending"`とし、"凍結"扱いにしない)

### Experiment(新規、中心エンティティ)

```json
{
  "id": "moyasuka-tts-comparison",
  "business_id": "moyasuka",
  "hypothesis": "代替TTSに切り替えれば、100本連続自動生成できる信頼性が得られる",
  "target": "ナレーション音声合成の成功率",
  "action": "現行方式(iPad Shortcuts経由tts.quest API)と代替候補(Google Cloud TTS等)を同一台本で比較",
  "period": {"start": "2026-08-11", "end": "2026-08-18"},
  "cost_jpy": 0,
  "kpi_target": {"success_rate": ">=95%", "sample_size": 100},
  "result": null,
  "learning": null,
  "next_action": null,
  "verdict": "pending",
  "status": "planned"
}
```

`verdict`は`continue | improve | pivot | kill`のいずれかで終了時に確定させる。

### Revenue(実際の支払いが発生した時だけ作る)

```json
{
  "id": "2026-08-20-0001",
  "business_id": "note",
  "date": "2026-08-20",
  "who": "note読者(匿名、属性のみ記録可)",
  "what": "有料マガジン購読",
  "why": "BGM選びの記事から流入、継続読者化",
  "amount_jpy": 500,
  "channel": "note.com",
  "source": "note"
}
```

北極星KPI(実顧客支払いの発生)は、このディレクトリにファイルが1つでも増えた瞬間に「発生」とみなせる — ダッシュボードで「Revenueファイル数 > 0」を最重要指標として最上部に出す。

### Decision(必須協議事項のみ、AI経営パートナー憲章と対応)

```json
{
  "id": "2026-08-11-new-business-exploration",
  "date": "2026-08-11",
  "category": "new-business",
  "ceo_opinion": "...",
  "partner_opinion": "...",
  "specialist_opinions": {"cfo": "...", "cmo": "..."},
  "agreements": ["..."],
  "disagreements": ["..."],
  "recommended": "...",
  "not_recommended": "...",
  "owner_decision_needed": "...",
  "owner_decision": null,
  "outcome_review_date": "2026-11-09"
}
```

`owner_decision`はオーナーが判断した後に埋める。`outcome_review_date`はAI経営パートナーの評価(成果ベース)のために、後で振り返る日付を最初から記録しておく。

### KPI・Expense・Risk

KPIは事業ごとの週次スナップショット(再生数・視聴時間・登録者等、事業のsuccess_metricsに対応)。ExpenseとRiskは既存の`docs/finance/ledger.md`・ダッシュボードの「保留」表記を構造化するだけで、様式は概ねシンプル(業務・金額・頻度・状態 / 説明・重大度・対応要否)。

## ワークフロー

1. **既存の5 Routineが、コミットの一部として該当するJSONも更新する。** 新しいシステムを追加するのではなく、今すでに「dashboardのHTMLに手で1行追記している」作業を、構造化ファイルへの追記に変えるだけ。
   - 例: モヤスカ台本生成Routine → 新台本作成時、対応する`experiments/`があれば`next_action`を更新
   - 例: 週次経営レビューRoutine → 各`businesses/*.json`の`last_updated`とKPIスナップショットを更新
2. **必須協議事項(新規事業・大規模投資・撤退等)が発生したら、`decisions/`に新規ファイルを作り、AI経営パートナーをサブエージェントとして起動して`partner_opinion`を埋める。** 今回の新規事業探索・モヤスカ継続判断の独立分析は、この運用の実例そのものになる。
3. **日次ブリーフ**: `company-os/`全体を読んで、現金残高・事業別ステータス(Tier順)・直近のExperiment結果・Revenue発生有無・未解決Risk・オーナー承認待ちのDecisionを1ページにまとめる生成スクリプト(既存`docs/dashboard/build.py`と同じ構造)。最初は日次Routineは新設せず、週次経営レビューの一部として生成し、需要が見えたら日次化する。
4. **週次レポート(.pptx)は維持。** ソースを手作業の箇条書きから、`company-os/`の集計に置き換えていく(段階的、Phase 3以降)。

## 実装順序(フェーズ、いずれも小さく)

- **Phase 1(設計確定後すぐ、数十分規模)**: `docs/company-os/`のディレクトリと4事業分の`businesses/*.json`を、現状データ(このレポートに書いた実績)でバックフィル初期化する。読み取り専用のスナップショットから始める。
- **Phase 2**: モヤスカのTTS比較Experimentを実際に開始(`amendments.md`5番)。これが最初の実データになる。
- **Phase 3**: 既存5 Routineのプロンプトに「対応するJSONを更新するステップ」を1行ずつ追加(大改修ではなく既存プロンプトへの追記)。
- **Phase 4**: 日次/週次レビューに`company-os/`からの自動集計ステップを追加、ダッシュボードの最上部に「Revenue発生有無」を最重要指標として表示するよう改修。
- **Phase 5**: 必須協議事項発生時にAI経営パートナーのサブエージェント起動を定型化(プロンプトテンプレート化)。

Phase 1・2は今すぐ着手可能(オーナー承認があれば)。Phase 3以降は実データが数件溜まってから、本当に必要な自動化だけ足す(「作る利益 vs 売る利益」の原則をこの設計自体にも適用する)。
