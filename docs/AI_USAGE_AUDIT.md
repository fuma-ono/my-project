# AI利用監査(Claude Code上限消費調査)

作成日: 2026-09-15
調査範囲: リポジトリ全体(`app/` `bgm-pipeline/` `expense-app/` `love-note/` `note-articles/` `threads-affiliate/` `.github/workflows/` `docs/`)+ Claude Code Remote(CCR)Routine一覧(コード外の設定、`list_triggers`で取得)

本ドキュメントはコード変更を一切行わず、現状把握のみを目的とする。

---

## 1. 結論(先に要点)

**Claude Codeの上限消費の直接原因は、コード内のAI呼び出しではなく、CCR Routineが1日あたり約50回、このClaude Codeセッション自体を起動していること。しかもそのうち約7割は、判断や文章生成を一切伴わない「GitHub Actionsの起動」「JSONファイルを読んでの通知要否判定」だけの、AIが不要な定型処理である。**

- リポジトリ内のPython/TypeScriptコードには、Anthropic API(`anthropic`パッケージ、`api.anthropic.com`、`ANTHROPIC_API_KEY`等)への参照が**一箇所も存在しない**。
- つまり「投稿文を書く」「返信するか判断する」「記事を書く」といったAI処理はすべて、CCR Routineの通知を受けた**このClaude Codeセッションが手作業(Read/Write/Bash/git)で実行している**。スクリプト化・API化されている部分はゼロ。
- 一方で「GitHub Actionsを起動する」「JSONを読んでtrue/falseを判定する」という、本来AIが不要な作業まですべて同じ経路(Claude Codeセッションの起動)を通っている。

---

## 2. Claude Code / Claude API 呼び出し箇所の一覧

### 2-A. コード内(スクリプト・ワークフロー)

| 箇所 | 種別 | 呼び出しの有無 |
|---|---|---|
| `.github/workflows/*.yml`(6件) | GitHub Actions | **無し**(すべて素のPythonスクリプトを`python3`で実行するのみ。Claude CLI/API呼び出し記述なし) |
| `threads-affiliate/*.py`(publish.py / fetch_replies.py / send_replies.py / research.py / decision_log.py / analyze.py / check_token_health.py 等) | Pythonスクリプト | **無し**(`import anthropic`等のSDK importなし、`api.anthropic.com`宛のHTTPリクエストなし) |
| `bgm-pipeline/`, `love-note/`, `note-articles/`, `expense-app/`, `app/` | 各事業のコード | **無し**(`requirements.txt`/`package.json`にAnthropic/OpenAI等のAI SDKが一切含まれない) |
| `app/.claude/settings.json` | Expoアプリ内の開発補助設定 | Claude Code**開発時**のプラグイン設定のみ(プロダクト実行時には関係ない) |

→ **プロダクトの自動化コードは、現時点でClaude Code/Claude APIに一切依存していない。** 依存しているのは「コードの外側」、すなわちCCR Routineが直接このセッションを起こして人手(AI)作業をさせている部分。

### 2-B. コード外(CCR Routine)

すべてのAI関連処理は、CCR Routine(`list_triggers`で取得、計16件)がこのClaude Codeセッションを定期的に起動し、通知本文の指示に従って**セッションが自らRead/Write/Edit/Bash/git/GitHub MCPツールを使って作業する**形で実行されている。詳細は3節・4節。

---

## 3. GitHub Actions 一覧(全6件、すべてthreads-affiliate関連)

| Workflow名 | 頻度 | Trigger | Claude Code使用 | Claude API使用 | 実行目的 | AIが本当に必要か | 通常コードで代替可能か |
|---|---|---|---|---|---|---|---|
| threads-fetch-replies.yml | 2時間おき(毎時10分) | schedule + workflow_dispatch | No | No | コメント新着取得→`replies-pending.json`保存 | 不要(単純API取得) | ✅既に通常コード |
| threads-send-replies.yml | 2時間おき(毎時50分) | schedule + workflow_dispatch | No | No | 判断済み返信を投稿 | 不要(単純API POST) | ✅既に通常コード |
| threads-publish.yml | 毎日21:05/21:35/22:05 JST(3回の保険cron) | schedule + workflow_dispatch | No | No | 下書きを実際に投稿 | 不要(単純API POST) | ✅既に通常コード |
| threads-token-health-check.yml | 4時間おき(毎時15分) | schedule + workflow_dispatch | No | No | トークン生存確認(読み取り専用API) | 不要 | ✅既に通常コード |
| threads-research.yml | 週次(月曜21:05 UTC=火曜06:05 JST) | schedule + workflow_dispatch | No | No | 商品候補の自動更新 | 一部(商品選定基準の適用ロジック次第。現状は`research.py`内で判定、要確認だが少なくとも生成AI呼び出しは無い) | ほぼ既に通常コード |
| threads-insights.yml | 週次(金曜21:00 UTC=土曜06:00 JST) | schedule + workflow_dispatch | No | No | インサイト集計取得 | 不要(単純API取得+集計) | ✅既に通常コード |

**GitHub Actions自体はすでに理想形(AI不使用の通常コード)になっている。** 問題は、これらのワークフローの`schedule:`トリガーが不安定(過去に複数回、発火しない/大幅遅延する事象を確認済み)なため、その「保険」として**Claude Codeセッション(CCR Routine)から`workflow_dispatch`で直接叩く**というバックアップ経路を後付けしたこと。この保険の運用コストが、後述のとおり主要な消費源になっている。

---

## 4. CCR Routine 一覧(全16件)

`list_triggers`で取得した実際のcron設定に基づく(2026-09-15時点)。

| Routine名 | cron | 頻度/日(概算) | 実行内容 | AI判断の有無 | 分類 |
|---|---|---|---|---|---|
| Threadsトークン確認 確実に起動 | `17 */4 * * *` | 6.0 | GH Actions起動+ポーリングのみ | **無し** | LEVEL 0 |
| Threadsトークン 監視 | `30 */4 * * *` | 6.0 | JSON読取→if/elseで通知要否判定→通知送信 | **無し** | LEVEL 0 |
| Threads返信送信 確実に起動 | `52 */2 * * *` | 12.0 | GH Actions起動+ポーリングのみ | **無し** | LEVEL 0 |
| Threads返信取得 確実に起動 | `12 */2 * * *` | 12.0 | GH Actions起動+ポーリングのみ | **無し** | LEVEL 0 |
| Threadsアフィリエイト 投稿を確実に起動 | `5 12 * * *` | 1.0 | GH Actions起動+ポーリングのみ | **無し** | LEVEL 0 |
| Threads Insights取得 確実に起動 | `10 21 * * 5` | 0.14 | GH Actions起動+ポーリングのみ | **無し** | LEVEL 0 |
| Threads商品リサーチ 確実に起動 | `10 21 * * 1` | 0.14 | GH Actions起動+ポーリングのみ | **無し** | LEVEL 0 |
| Threadsトークン延長リマインド | `0 0 1 * *`(月1) | 0.03 | 期限確認+リマインド | ほぼ無し | LEVEL 0 |
| Threads返信 自動対応(判断) | `30 */2 * * *` | 12.0 | 新着コメントに対しreply/skip判断・返信文生成 | **有り**(内容判断・文章生成) | LEVEL 1〜2相当だが実装はフル権限セッション |
| Threadsアフィリエイト 毎日投稿案生成 | `0 11 * * *` | 1.0 | 商品選定・投稿文(フック)生成 | **有り**(創作・戦略的選定) | LEVEL 1〜2相当だが実装はフル権限セッション |
| 恋愛ジャンルnote 週次記事生成 | `0 3 * * 2` | 0.14 | 記事執筆 | 有り(創作) | LEVEL 2 |
| モヤスカ 台本自動生成 | `0 0 * * 3` | 0.14 | 動画台本執筆 | 有り(創作) | LEVEL 2 |
| note記事 週2回自動下書き | `0 0 * * 1,4` | 0.29 | 記事執筆 | 有り(創作) | LEVEL 2 |
| BGM Shorts 毎日自動公開 | `0 12 * * *` | 1.0 | Shorts生成・公開判断 | 一部有り | 要個別確認(本監査では未深掘り) |
| BGM長尺動画 週次自動公開 | `0 0 * * 2` | 0.14 | 長尺動画の公開判断 | 一部有り | 要個別確認 |
| 週次経営レビュー | `0 0 * * 1` | 0.14 | 全社KPIレビュー・戦略判断 | **有り**(まさにClaude Codeが担うべき仕事) | LEVEL 2(適切) |

**合計: 約52.2回/日**(Threads関連だけで約50.3回/日、他事業合計で約1.9回/日)

### 4-1. 「確実に起動」系5Routine(合計 約31.3回/日)

いずれも中身は同一パターン:
```
CCR Routine発火 → Claude Codeセッション起床
→ mcp__github__actions_run_trigger(workflow_dispatch)
→ mcp__github__actions_list でポーリング(数回、Bashのsleepを挟む)
→ 成功なら黙って終了、失敗時のみ報告
```
**AI的な判断は一切発生しない。** 単に「GitHub Actionsのcronが信用できないので、代わりに定期的に叩く」という目的だけで、フル機能のClaude Codeセッションを1日30回以上起こしている。

### 4-2. 「Threadsトークン 監視」(4.6回/日 ※実質)

```
CCR Routine発火 → Claude Codeセッション起床
→ token-health.json を読む
→ ok==true か、ok==false && notified==true か、ok==false && notified無しか の3分岐
→ 該当すればPushNotification送信 or フィールド削除 → git commit/push
→ 該当しなければ何もせず終了
```
これも**完全にif/elseで書ける処理**。実際、今回の監査対応の一部として`check_token_health.py`側で`notified`フラグの保持ロジックを直接コード修正した(本監査の直前作業)。この経験自体が「AIでなくてもよい部分にAIを使っていた」証拠。

### 4-3. 「Threads返信 自動対応」(判断ステップ、12.0回/日)

新着コメントの内容を読み、ガードレール文書(`docs/marketing/2026-09-10-threads-auto-reply-guardrails.md`)に基づいてreply/skipを判断し、返信文を生成する。**これ自体はAIが必要な処理**(自然文の意図理解・トーン生成)。ただし:
- 現状はフル機能のClaude Codeセッション(bash、git、任意ファイル読み書き可能)が担当している。
- 実際にやっていることは「決まったJSON構造の入力→決まったJSON構造の出力」で、**Claude API(軽量〜中量モデル)+定型プロンプトで代替可能**な範囲に収まる。
- 新着コメントが無い回(観測範囲では大半)も、判定ロジック自体は「ファイルを読んで空配列かどうか見るだけ」なのに、フルセッションが毎回起動している。

### 4-4. 「Threadsアフィリエイト 毎日投稿案生成」(1.0回/日)

商品選定・フック生成・自己評価という創作要素があり、AI活用の価値は高い。ただし現状の実装(Claude Codeセッションが対話的に考えて`Write`する)は、Claude API 1回呼び出し+スクリプトでのファイル保存・コミットに置き換え可能な設計になっている(出力フォーマットは`post-template.md`で厳格にJSON化済み)。

---

## 5. 危険な自動化パターン(無限ループ・過剰実行リスク)

| リスク | 現状 | 評価 |
|---|---|---|
| エラー時の無限リトライ | `automation_guard.py`で3回連続失敗時に自動停止する仕組みが実装済み(`MAX_CONSECUTIVE_FAILURES = 3`) | ✅ 対策済み(ただし2026-09-14まで「状態ファイルがGit Actions実行のたびに消える」バグで**実質機能していなかった**ことが判明・修正済み) |
| 同一エラーでの重複通知 | `check_token_health.py`が実行毎に`notified`フラグを消してしまい、4時間おきに同じ障害を再通知し続けるバグがあった | ✅ 本監査直前に修正済み(継続障害はフラグを引き継ぐ) |
| ワークフロー同時実行による重複投稿 | 各workflowに`concurrency`設定済み(直列化) | ✅ 対策済み |
| CCR Routine自体の無限増殖・暴走 | 現状16件で固定、新規作成は人間指示のみ | 問題なし |
| **CCR Routineの通知がセッション側で処理されず放置される** | 2026-09-13に実際発生: 通知キューが67件まで積み上がり、その間に本来実行されるべき「毎日投稿案生成」が一度スキップされた | ⚠️ **構造的リスク**。定期実行をAI(対話セッション)に依存する設計そのものが、セッションのアイドル/多忙/通知処理漏れに弱い。GitHub Actions(非対話・確実に走る)に移すべき理由の一つ |

---

## 6. コンテキスト過剰利用箇所

- 「確実に起動」系Routineは、本文自体は短いが、**発火のたびにこのセッションの直近コンテキスト(会話履歴)全体を伴って起動**している。1日30回以上、システムプロンプト・ツール定義一式を含むフルセッションが「GitHub Actionsを1回叩くだけ」のために起きている。
- `list_triggers`のように出力が大きいツール呼び出し(今回7万文字超でファイル退避が発生)を、単純な確認作業のたびに使う設計は、それ自体がコンテキスト消費源になり得る。
- 現状、日々の定型通知処理では大きなdiffやログ全文を読み込む場面は少ない(すでにある程度最小限化されている)が、これは「たまたま個々のタスクが小さい」だけで、**セッション起動回数そのものが多い**ことが本質的な問題。

---

## 7. LEVEL分類まとめ

### LEVEL 0(AI不要 → 通常コードへ)
- Threadsトークン確認/返信送信/返信取得/投稿/Insights/商品リサーチの「確実に起動」6Routine(合計約31.3回/日)
- Threadsトークン 監視(通知要否判定、約6回/日)
- 各GitHub Actions内の処理(取得・投稿API呼び出し・集計・JSON変換)— **これは既に通常コード。現状維持でよい**

### LEVEL 1(軽量AI・Claude API向き)
- Threads返信 自動対応(reply/skip判断+短文生成、約12回/日)
- Threadsアフィリエイト 毎日投稿案生成(投稿文生成、約1回/日)
- BGM Shorts/長尺の公開可否判断(要個別確認)

### LEVEL 2(Claude Codeに残すべき)
- 週次経営レビュー(全社KPIを見て戦略判断)
- note/love-note/モヤスカの記事・台本の創作的執筆(定型化しにくい創作領域。ただし将来的に「構成案はAPI、最終校正・戦略判断はClaude Code」という分業も検討余地あり)
- 障害の原因調査(今回のOAuthException 190調査、automation_guardバグ調査など、まさに今回行った類の作業)
- コード変更・設計・監査(本ドキュメント自体)

---

## 8. 上限消費の直接原因(まとめ)

1. **GitHub Actionsの`schedule:`トリガーが信頼できない**という真の問題に対し、「Claude Codeセッションを定期的に起こして直接叩く」という、最もコストの高い解決策を採用してしまった。
2. その結果、1日約52回のセッション起動のうち、**約36回(7割弱)がAI判断を一切伴わない機械的な処理**(GitHub Actions起動代行、JSON条件分岐)である。
3. 残る約13〜16回はAI判断を伴うが、**フル機能のClaude Codeセッション**(bash・git・任意ファイルアクセス可能)を使っており、Claude APIへの単純な1回呼び出しで足りる範囲まで、開発環境フルセットを毎回起動している。
4. AI利用量を計測・可視化する仕組みが存在しないため、「どの自動化がどれだけ消費しているか」を定量的に把握できていなかった(本監査が初めての定量化)。
