# AI Affiliate OS: マルチSNS展開に向けた現状監査・アーキテクチャ設計

オーナー指示「AI Affiliate OS：マルチSNS展開に向けた現状監査・アーキテクチャ設計」への回答。**今回はコード変更を一切行っていない(報告のみ)。**

## 1. 現在のアーキテクチャ

`threads-affiliate/`配下、13ファイル・約2,100行。責務ごとの実態:

| ファイル | 役割 | Threads依存度 |
|---|---|---|
| `research.py` | 楽天API商品調査・スコアリング(`score_item()`: レビュー数/評価/価格からのみ算出) | **無し**(楽天APIへの依存はあるが、SNSには一切依存しない) |
| `amazon-links.md` | Amazon手動リンク管理 | 無し |
| `post-template.md` | 投稿文生成の指示書(**コードではなくMarkdown**。実際の文章生成はCCR Routine=Claude自身が読んで書く) | 一部(PR表記ルール・文字数制限500字はThreads固有、それ以外の「悩み→気づき→商品→CTA」構成は汎用) |
| `publish.py` | 投稿実行・ログ記録。`validate_pr_disclosure()`/`infer_affiliate_platform()`/`PR_MARKERS`は論理的には汎用だが、Threads専用ファイルに埋め込まれている | 中(API呼び出し部分は固有、PR表記検証ロジックは汎用) |
| `threads_client.py` | Threads Graph APIへの薄いHTTPラッパー | 高(base URL、認証方式がThreads固有) |
| `fetch_replies.py`/`send_replies.py` | 返信取得・送信、二重返信防止、レート制限 | 中(API呼び出しは固有、レート制限/重複防止ロジックは汎用) |
| `get_token.py`/`refresh_token.py`/`check_token_health.py` | OAuth・トークン管理 | 高(Meta OAuth固有。ただしInstagramも同じMeta OAuth基盤なので流用度は高い) |
| `analyze.py` | 実績集計 | **低**(publish-log.jsonlのスキーマに依存するだけで、Threadsそのものへの依存は無い) |
| `automation_guard.py` | サーキットブレーカー | **無し**(ファイルパスとカウント閾値のみ、SNS非依存) |
| `decision_log.py` | AI意思決定ログ | **無し**(完全汎用) |
| `docs/marketing/2026-09-09-affiliate-conversion-tracking-design.md` | 成果手動突合設計 | 低(日付+商品名という方式自体はSNS非依存) |

GitHub Actions(6本)は「Threads APIへの接続が必要な処理」を担うためだけに存在し、判断(内容生成・返信の可否判断)はすべてClaude Code Remoteの定期Routineが担う、という**2層構造**が既に確立している。この構造自体はマルチSNS化しても変わらない(Adapterごとに同種のGitHub Actionsが増えるだけ)。

## 2. 共通化可能な処理

| 処理 | 現状 | 共通化の容易さ |
|---|---|---|
| 商品リサーチ・スコアリング(`research.py`) | 既に100%SNS非依存 | ★★★ そのまま流用可 |
| 商品カテゴリ・11項目選定基準 | `post-template.md`内(Markdown) | ★★★ そのまま流用可 |
| PR表記検証(`validate_pr_disclosure`) | `publish.py`に埋め込み | ★★★ 関数を切り出すだけ |
| affiliate_platform判定(`infer_affiliate_platform`) | `publish.py`に埋め込み | ★★★ 関数を切り出すだけ |
| 投稿ログスキーマ(post_id/affiliate_url/product_name/price/category/post_type) | `publish.py`内で直書き | ★★☆ platformフィールドを追加すれば共通ログにできる |
| 実績分析(`analyze.py`) | publish-log.jsonlのキー名に依存するのみ | ★★☆ platform列を見て横断集計する拡張は容易 |
| コンバージョン手動突合設計 | 日付+商品名方式 | ★★★ SNS非依存、そのまま使える |
| AI意思決定ログ(`decision_log.py`) | 完全汎用 | ★★★ そのまま流用可 |
| 異常検知・サーキットブレーカー(`automation_guard.py`) | ファイルパス以外SNS非依存 | ★★☆ 「どのplatformで何回失敗したか」を区別する拡張が必要 |
| 重複投稿・重複返信防止の考え方(ID重複チェック) | ロジックは汎用、対象IDがThreads固有 | ★★★ 考え方はそのまま、対象データ構造を汎用化するだけ |
| コンテンツ生成の「型」(悩み→気づき→商品→利用シーン→CTA) | `post-template.md`(Markdown、Claude自身が実行) | ★★☆ 型は汎用だが、SNSごとに文字数・トーン・フォーマット(テキストのみ/動画台本/画像+短文)が全く異なるため、SNSごとのテンプレートは必要 |

## 3. Threads固有処理

| 処理 | 内容 |
|---|---|
| `threads_client.py`のAPI呼び出し(base URL、`media_type: TEXT`、`reply_to_id`等のパラメータ形式) | Threads Graph API固有 |
| OAuthスコープ(`threads_basic`, `threads_content_publish`, `threads_manage_insights`, `threads_read_replies`, `threads_manage_replies`, `threads_manage_mentions`) | Threads固有(ただしMeta OAuthの型自体はInstagramと共通) |
| topic_tag機能・フォールバック処理 | Threads固有機能 |
| PR表記の「先頭10文字以内」というオフセット制約 | Threadsの表示仕様に基づく実装判断(他SNSでは同じ制約が成立するとは限らない) |
| 500文字制限 | Threads固有(他SNSは文字数制限が異なる、または動画中心で文字数の概念が薄い) |
| Insights取得の7metric(`views/likes/replies/reposts/quotes/shares/clicks`) | Threads Insights API固有の名称・仕様 |

## 4. SNS API比較(公式開発者ドキュメントベース)

| 項目 | Threads(現状) | Instagram | Pinterest | YouTube (Shorts) | TikTok |
|---|---|---|---|---|---|
| 投稿API | ✅ 実装済み・稼働中 | ✅ Graph API(Threadsと同じcontainer→publish方式) | ✅ API v5(Pin作成) | ✅ Data API v3(既存bgm-pipelineで稼働実績あり) | ⚠️ Content Posting API(Direct Post)はあるが… |
| 動画投稿 | 非対応(テキストのみ運用) | ✅ Reels対応 | ✅ 動画Pin(登録→アップロード→作成の3段階) | ✅ 既存コード(bgm_pipeline)で実装済み | ✅ あり |
| 画像投稿 | 未使用 | ✅ | ✅(Pin本体が画像中心) | 非対象 | ✅(Photo Post API) |
| **本文/キャプションのリンクがタップ可能か** | ✅ **確認済み**(実機でOGPカード表示・タップ可) | ❌ **通常アカウントは不可**(2026年3月からMeta Verified限定の試験運用のみ、Reelsは一切不可) | ✅ **Pin自体が常にクリック可能なリンクを持つ**(outbound click数が公式メトリクスとして存在) | ✅ 概要欄のリンクは昔からタップ可能 | ❌ **キャプション内リンクは常に不可**(bio内リンク1本のみ、フォロワー数条件あり) |
| コメント取得 | ✅ 実装済み | ✅ 対応(list/get replies) | 情報不足(Pinterestは「保存」文化中心でコメント機能自体の重要度が低い) | ✅ `commentThreads.list` | ❌ 標準開発者APIには無し(TikTok for Business=広告用製品にのみ限定的に存在) |
| コメント返信 | ✅ 実装済み・稼働中 | ✅ 対応 | 情報不足 | ✅ `comments.insert`(quota 50/回、10,000/日中で運用に十分) | ❌ 標準APIには無し |
| インサイト取得 | ✅ 実装済み(7metric確認済み) | ✅ reach/impressions/profile views/engagement | ✅ Pin/Board単位の詳細アナリティクス(outbound click含む) | ✅ 動画単位の視聴回数・エンゲージメント取得可 | ⚠️ Display APIで一部あり(詳細情報不足) |
| OAuth | ✅ 稼働中(Meta) | Meta(Threadsと共通基盤、要App Review) | Pinterest独自OAuth 2.0 | Google OAuth(**既存bgm-pipelineで実装済み**) | TikTok独自OAuth |
| アカウント条件 | プロフェッショナル(達成済み) | ビジネス/クリエイターアカウント+連携Facebookページ | 通常アカウントで申請可 | 通常のGoogleアカウントで可 | 通常アカウントで可 |
| API申請/審査 | 完了済み | 必要(Meta App Review、既存アプリの拡張で対応可能な見込み) | 必要(Standard到達にはOAuthフロー動画提出を含む審査。ソロ開発者でも例外なし) | 不要(既存プロジェクトのGoogle Cloud設定を流用可) | **必要かつ重い**: 監査未完了は投稿が非公開(SELF_ONLY)扱いになる |
| 自動化可能範囲 | フル自動(稼働中) | 投稿・返信ともにフル自動化技術的には可能 | Pin作成はフル自動化可能。ただし**開発者ガイドラインに「個別の検討を伴わない自動アクションを禁止」する趣旨の条項があり、完全無人化はポリシー上グレー** | フル自動化可能(既存インフラの延長) | 審査完了までは事実上フル自動化不可(非公開投稿になるため) |
| レート制限 | 実運用上問題なし | 未調査(通常のGraph API制限に準拠と想定) | Trial/Standardでティアごとに制限あり | 動画アップロード: 100件/日、コメント: 実質200件/日相当 | Content Posting: 6リクエスト/分/ユーザートークン(投稿頻度としては十分) |

## 5. 事業価値ランキング(利益ファネル基準)

判断基準は指示通り「フォロワー数→表示数→クリック→成約→報酬→利益」のファネル。**特に「クリック」段階(本文/キャプションのリンクがタップ可能か)が今回の調査で最大の差別化要因と判明した。**

### A: Pinterest
- **Pinを作成した瞬間から常にクリック可能なリンクが付き、outbound clickという専用指標まで公式に存在する** — 今回調べた4候補の中で唯一Threadsと同格以上に「クリックされる設計」が保証されている
- ユーザーの利用文脈が「後で買うものを探す/保存する」という**購買意図に近い行動**であり、商品紹介コンテンツとの親和性がThreadsより高い可能性すらある
- 減点要因: Standardアクセス到達に審査(OAuthフローの動画提出、ソロ開発者でも省略不可)が必要、開発者ガイドラインに「個別の検討を伴わない完全自動アクションの制限」を示唆する条項があり、**完全無人投稿の適法性をポリシー上詰め切れていない**(要確認事項として残る)
- コメント返信の可否は情報不足(Pinterestの文化上、返信自動化の優先度はThreadsほど高くないと考えられる)

### A: YouTube Shorts
- 概要欄のリンクは昔から確実にタップ可能
- コメント取得・返信ともに公式APIで十分な自動化余地(quota的にも問題なし)
- **既存の`bgm-pipeline`にOAuth・動画アップロード基盤が実装済み**という、今回調べた中で唯一の「大幅な流用資産」がある
- 減点要因: コンテンツ制作コストが構造的に高い(テキスト生成で済むThreads/Pinterestと異なり、実際の動画=台本+映像+音声が必要。この一手間がボトルネックになりやすい)

### B: Instagram
- 技術的にはThreadsと兄弟API(同じMetaのcontainer→publish方式)で、実装コストは4候補中最も低いと見込まれる。コメント取得・返信・インサイトもフル対応
- **しかし致命的な弱点**: 通常アカウントのキャプションリンクはタップ不可(2026年3月時点でMeta Verified限定の試験運用のみ)、Reelsに至ってはリンク手段が一切存在しない。実質「プロフィール欄リンク1本」頼みとなり、**投稿単位でのアフィリエイト成果の帰属がほぼ不可能**(今のThreadsで既に課題になっている「日付+商品名」突合が、Instagramではさらに機能しにくい)
- 実装は安いが、狙う「利益」に直結する導線が弱い、というのが今回の調査で最も重要な発見

### C: TikTok
- リーチ・バズポテンシャルは高いと言われるが、**キャプションリンクは常にタップ不可**(bio1本のみ、フォロワー条件あり)、**標準開発者APIにはコメント取得・返信の手段が無い**(広告向けの別製品にのみ限定的に存在)、そして最大の問題は**API監査が完了するまで投稿がSELF_ONLY(本人にしか見えない非公開)扱いになる**こと
- 「バズるSNSではなく自動化でき利益につながるSNSを優先する」という判断基準に最も反する候補。今回調べた4つの中で、技術的自動化のしやすさ・クリック導線・返信自動化のいずれにおいても最下位

## 6. 推奨アーキテクチャ(既存コードを壊さない前提)

大規模な`affiliate-core/`+`platforms/`へのディレクトリ再編は**今回は行わない**(既存動作への影響が大きすぎる)。将来実施する場合も、まずは以下の順で「切り出し candidate」を明確にしておく:

```
threads-affiliate/               ← 現状維持(Threads固有、稼働中のまま触らない)
  research.py                    ← 将来: affiliate_core/product_research.py へ移動候補
                                     (SNSに依存する記述が元々無いため、移動リスクが最も低い)
  analyze.py                     ← 将来: affiliate_core/analytics.py へ移動候補
                                     (platform列を見て横断集計するよう拡張すればそのまま使える)
  automation_guard.py            ← 将来: affiliate_core/automation_guard.py へ移動候補
  decision_log.py                ← 将来: affiliate_core/decision_log.py へ移動候補
  publish.py内のvalidate_pr_disclosure/infer_affiliate_platform
                                  ← 将来: affiliate_core/compliance.py へ切り出し候補
                                     (Threadsの文字数・オフセット定数だけ引数化する)
```

「Adapter」の共通インターフェースは、指示にある案の通り無理に全SNS共通にしない。今回の調査結果を踏まえると、実際に共通化して意味があるのは:

- `publish(text, link, ...) -> post_id`(全SNSに存在)
- `fetch_metrics(post_id) -> dict`(全SNSに存在するが、返ってくるmetric名が全く異なるため「正規化」が必要)

一方、**無理に共通化すべきでない**もの:
- `fetch_replies()`/`send_reply()`(TikTokには実質存在しない。Pinterestも不明確。Instagram/YouTubeにはある。**「返信機能」はオプショナルなAdapter capabilityとして扱うべきで、全Adapterに強制する共通interfaceには含めない**)
- リンクの扱い(Threads/Pinterest/YouTubeは「投稿に直接埋め込み」、TikTok/Instagramは「bio 1本」という根本的に異なる設計のため、Adapter側で「この投稿の成果は個別に追跡できるか」を返すフラグ程度は共通interfaceに持たせる価値がある)

## 7. 実装ロードマップ(Phase 1以降は今回実装しない)

- **Phase 0(現在)**: Threads運用継続、30〜50投稿のデータ収集
- **Phase 1**: `research.py`/`analyze.py`/`automation_guard.py`/`decision_log.py`の4つ(SNS非依存度が最も高い)を`threads-affiliate/`から独立したディレクトリへ切り出す。Threads側はimport元を変えるだけで動作は変えない
- **Phase 2**: 最優先SNSを1つ追加。**候補はPinterestまたはYouTube Shorts**(下記8参照)
- **Phase 3**: SNS横断分析(analyze.pyにplatform軸を追加)
- **Phase 4**: AIによるSNS別投稿配分最適化(Threadsで既に保留中のPhase 2戦略変更ループの、SNS版)
- **Phase 5**: AI CEOによる自律戦略変更(SNS横断)

## 8. 現時点で実装すべきか

### 結論: 「今はThreadsのデータ収集を優先すべき」

Threadsは検証期間に入ったばかり(投稿数5件)。マルチSNS化はThreadsの検証データが出揃ってから着手するのが妥当。今回の調査結果自体は、その判断を覆すほどの「今すぐやるべき明確な理由」を示していない(Pinterest/YouTubeが有望というのは分かったが、緊急性は無い)。

### ただし「今すぐ実装してもリスクが低く、将来のために価値が高いもの」

1. **`publish.py`内の`validate_pr_disclosure`/`infer_affiliate_platform`を独立ファイルに切り出す**(ロジック変更なし、importパスを変えるだけ)。将来のマルチSNS化で確実に再利用するとわかっている部分を、今のうちに整理しておくのは低リスク。ただし今回は「報告のみ」の指示のため実施していない
2. **Pinterest APIの「完全自動アクション禁止」条項の詳細確認**(オーナー自身がPinterest Developerドキュメントの利用規約原文を確認する。ここは第三者記事ではなく一次情報での確認が必須な部分で、判断を誤ると規約違反リスクに直結する)
3. YouTube Shortsを将来追加する場合、`bgm-pipeline/youtube_auth.py`の**スコープに`youtube.force-ssl`(コメント投稿に必要)が含まれるか**を今のうちに確認しておく価値はある(現在のスコープは`youtube.upload`/`yt-analytics.readonly`のみで、コメント返信には追加スコープが必要と見込まれる)

いずれも「今すぐ着手すべき」というほどの緊急性は無く、**Phase 2着手を判断するタイミングで初めて必要になる調査・準備**という位置づけが妥当。

## 6(補足). 既存Threads運用への影響確認

今回の作業でThreads関連コード・GitHub Actions・CCR Routineへの変更は一切行っていない。監査は読み取りのみ、報告書の新規作成のみ。
