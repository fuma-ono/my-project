# YouTube視聴数を伸ばすための調査と実装(2026-08-03)

オーナーから「動画をただ載せているだけで、これでは視聴数が伸びない」という指摘を受けて実施。1本目の動画はタイトル・概要欄が最小限(概要欄1行のみ、ハッシュタグなし、カスタムサムネイルなし)で、公開しただけの状態だった。

## 調査結果の要点

- **サムネイルが最重要**。鮮明で見やすいサムネイルは同条件比で+27%クリック率という調査がある。ハッシュタグ最適化よりサムネイルのA/Bテストの方が10〜50倍インパクトが大きいという指摘も。ただし誇張・釣り(false emotion)サムネイルは初速のCTRを上げても、視聴者の失望による離脱でアルゴリズム評価が悪化し、数週間でおすすめ露出が80%以上落ちるという報告があり避ける
- **概要欄は最初の100〜150文字が肝**。「もっと見る」で折りたたまれる前の部分に主要キーワードと価値提案を入れる。動画ごとに同じ文面を使い回さない(反復コンテンツとして評価が下がる)
- **ハッシュタグは3〜5個が適正**。概要欄に書くと先頭3個が動画タイトル上に自動表示される。多すぎる・無関係なハッシュタグはスパム扱いされるリスク
- **アルゴリズムは視聴維持率・総視聴時間を最優先**。長尺のアンビエント/睡眠用BGMは「流しっぱなしにされる」性質上、視聴時間で有利になりやすい(クリックさえ取れれば)

Sources:
- [Best YouTube Thumbnail Guide 2026](https://ampifire.com/blog/best-youtube-thumbnail-guide-examples-best-practices-2026-for-high-ctr/)
- [YouTube Description Best Practices 2026](https://touhfa.art/blog/seo/youtube-description-guide/)
- [YouTube Hashtags Best Practices 2026](https://touhfa.art/blog/seo/youtube-hashtags-guide/)
- [10 Tips to Organically Grow a LoFi YouTube Channel](https://www.onemaker.io/post/10-tips-to-organically-grow-a-lofi-youtube-channel)

## 実装した変更(`bgm_pipeline/`)

- **`thumbnail.py`(新規)**: プリセットごとのブランドカラー(`video.py`の`THEME_COLORS`と共通)でグラデーション背景 + タイトルの大きな白文字 + 「1 HOUR」等の長さバッジを生成。チャンネルアート(`branding.py`)と同じ三日月・星のモチーフで統一感を持たせた。`publish.py`がアップロード後に`thumbnails.set`で自動セットする
- **`presets.py`の`PRESET_METADATA`を大幅拡充**: 各プリセットに`hook`(最初の100〜150文字用)・`about`(詳細説明)・`use_cases`(用途リスト)・`hashtags`(3〜5個)・拡充した`tags`(10〜14個、プリセットごとに具体的なロングテールキーワード)を追加。`build_description()`で概要欄を組み立てる
- 概要欄には用途リスト・AI生成/著作権フリーの明記・購読CTA・ハッシュタグブロックを含む。動画の長さに応じて文面が変わるので、同じ文面の使い回しにはならない
- タグは「sleep music」等の汎用語を全プリセットに機械的に付けるのをやめ、プリセットごとの関連語に絞った(無関係なタグはスパム扱いのリスクがあるため)

## 今後の運用

- 1本目の動画(`cCFbFsWHX80`)は今回の改善前のメタデータのまま。次回公開分から新しい仕組みが適用される。1本目も後から`videos.update`で概要欄・タグを更新することは可能(希望があれば実施)
- サムネイルのA/Bテストや、実際の視聴数データに基づくタイトル改善は、YouTube Analyticsのスコープ取得(別タスク化済み)が済み次第、データ分析部と連携して回す
