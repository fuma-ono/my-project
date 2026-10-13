import SwiftUI

/// SCR-011 検索 — no dedicated ViewModel/endpoint exists for search, but
/// `IndicatorsViewModel` already does real server-side `q`-search against
/// `GET /indicators` (used by the Indicators tab). This screen reuses that
/// same, already-existing capability with its own instance — not a new
/// API/ViewModel.
///
/// HQ指示(2026-10-09)でこの画面専用の参考画像(検索タブ初期表示 / 「CPI」
/// 入力後の検索結果)が提供され、「これを完全再現して」と指示された。
/// 他のV5キャンバス画面(指標一覧など)と違い、人気の検索キーワード
/// パネル+最近の検索履歴+検索結果の3段を同じ234×491キャンバス内に
/// 収める必要があり、固定行数では収まらないため、`HomeView`が既に使って
/// いる「ヘッダー直下にScrollViewを敷き、キャンバス残り全域を
/// `contentAreaHeight`として割り当てる」パターンを初めてこの画面にも
/// 適用した(`V5Header`/検索バー/フィルターpillはScrollViewの外、常に
/// 固定表示)。
///
/// 参考画像との差分(捏造しないための意図的な省略 — 既存ドキュメント
/// コメントの踏襲):
/// - 「人気の検索キーワード」のpillはFOMC/CPI/GDPなど一般的なFX用語の
///   固定リストで、タップすると検索欄にその語を入れて実際に検索する —
///   「人気」を裏付ける実際の分析・集計データは存在しないため、あくまで
///   固定の検索ショートカットとして実装し、順位や件数などの数値は一切
///   表示しない(存在しないデータを捏造しない)。
/// - 「CPI」の検索結果で参考画像は同じ指標を「消費者物価指数(CPI)」
///   「CPI(消費者物価指数)」の2行に分けて見せているが、実データ上は
///   同一の指標1件のみのため、重複行は作らず1行にまとめている。
/// - 要人発言(バウエル議長の発言など)・用語解説・ニュースコラムの行は
///   それぞれ実データ・実機能が存在しないため表示しない(「要人発言の
///   検索結果もSCR-013へ遷移させる」はHQ新仕様で求められているが、
///   要人発言検索自体が未実装のため次回に持ち越し — 以前からの方針を
///   継続)。フィルターpill自体は参考画像通り「要人発言」に更新したが、
///   選択時は指標と同じく「対応する実データが無ければ空」という既存の
///   振る舞いのまま。
/// - `V5Viewport`'s `.scaleEffect` is known to make a synthesized tap
///   land without moving keyboard focus onto a `TextField` inside it (a
///   Simulator/XCUITest limitation, not a visual change) — `@FocusState`
///   + an explicit `.onTapGesture` forces the focus assignment, the same
///   fix Login needed.
///
/// HQ指摘(2026-10-09、5回目)「文字サイズのルールとかを別アカウントの
/// クロードコードから引き継いで」「全体的にサイズが小さい」: 初版は
/// 旧`SearchView`(最初の7〜9pt中心)の値をそのまま踏襲していたが、
/// `claude/fx-settings-screens`ブランチが指標詳細(SCR-006)等で確立した
/// 「名前10.5・見出し9.5・本文/サブタイトル8.5・印7前後」という文字サイズ
/// 体系と、数字・英字混在の見た目の揺れを無くす`NotoText.text(_:size:)`
/// (日本語だけNotoにする`V5JPFont`と違い、文字列全体をNoto Sans JPで
/// 統一する — 時刻のような数字と日本語が並ぶ行でサイズがちぐはぐに
/// 見える問題の対策、`NotoText.swift`参照)に合わせて全面的に引き上げた。
/// `CountryFlag.japaneseName(forCountry:)`も同ブランチの関数名・対応表に
/// 揃えた(元は本画面実装時に`japaneseName(for:)`という別名・簡略版の
/// 対応表で独自に追加していた)。
///
/// HQ指摘(2026-10-09、6回目): (1)検索欄とフィルターpill行の間隔を拡大、
/// (2)検索欄の塗り色を明確化、(3)「人気の検索キーワード」見出し・
/// キーワードpillの文字サイズをそれぞれ+0.5、(4)外枠とpillの塗り色を
/// 別トーンにしてpillの方を明るく、(5)「最近の検索履歴」見出し・行の
/// 文字サイズを+0.5、(6)「最近の検索履歴」の開始位置を「人気の検索
/// キーワード」の開始位置(パネル内パディング分)に揃える — 以上を反映。
///
/// HQ指摘(2026-10-09、7回目): (1)フィルターpill(すべて/指標等)の文字
/// サイズをキーワードpill(雇用統計等)と同じ8.5に、(2)検索欄より下の
/// 領域(フィルターpill行・コンテンツ)をさらに下げる、(3)キーワードpillの
/// 縦パディングを6→4に縮小、(4)「最近の検索履歴」の表示状態を確認できる
/// よう`ScreenshotTests`に実データ記録キャプチャを追加(検索結果の行を
/// 実際にタップして`RecentSearchStore`に記録させる — 捏造データではない)。
///
/// HQ指摘(2026-10-11、8回目): (1)「人気の検索キーワード」pillの文字
/// サイズ+1、(2)「最近の検索履歴」見出し・行の文字サイズ+0.5、(3)同履歴行の
/// 国旗を指標一覧(`IndicatorsView`)の経済指標リストと同じ14ptに縮小、
/// (4)同履歴行の「＞」をエントリ文字サイズと揃え、枠線を追加、(5)検索結果
/// (「CPI」検索後)の行も「＞」をタイトル文字サイズに揃え、(6)カテゴリの
/// 「経済指標」をプレーン文字ではなく`HomeView`の経済指標バッジと同じ
/// 見た目(青いカプセル)に、(7)検索結果行の国旗を28→24に縮小、(8)検索結果
/// 一覧を個々の行カードではなく、1枚の外枠カード+行間の区切り線という
/// 構成に変更。
struct SearchView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @State private var path = NavigationPath()
    @State private var selectedFilter: SearchFilter = .all
    @State private var recentSearches: [RecentSearchEntry] = RecentSearchStore.load()
    @FocusState private var searchFieldFocused: Bool
    @Binding var tabSelection: Int
    private let apiClient: APIClient

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorsViewModel(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    private var trimmedQuery: String {
        viewModel.searchText.trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        NavigationStack(path: $path) {
            V5Viewport {
                V5Header(title: "検索", back: false)
                searchBar
                filterPills

                scrollableContent
                    .frame(width: V5P.W, height: Self.contentAreaHeight, alignment: .top)
                    .padding(.top, Self.contentTopOffset)
                    .frame(width: V5P.W, height: V5P.H, alignment: .top)

                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
            }
        }
        // 2026-10-13: IndicatorsViewModelは一覧を1回読み込み、検索語では端末の中で絞り込む
        // 形になった(入力のたびの通信はしない)ので、最初に読み込む。
        .task { viewModel.load() }
    }

    // 検索バー上端53・高さ28(y=67中心)、フィルターpill(y=104・高さ約20)との
    // 間隔をHQ指示(2026-10-09、6回目)「検索欄とすべてや指標の間にスペースを
    // もう少し広げて」で3pt→9ptに拡大した後、7回目「検索枠から下を少し
    // 下げて」でさらに+4pt(計13pt)に拡大。クリアできる余白を見て122に設定。
    // V5BottomBarの帯高さ(39)と合わせて491-122-39=330をScrollViewの実高さとした。
    private static let contentTopOffset: CGFloat = 122
    private static let contentAreaHeight: CGFloat = V5P.H - contentTopOffset - 39

    /// HQ指示(2026-10-09、6回目)「検索欄の枠の中は色をつけて」: `V5P.panel2`
    /// 単体だと背景グラデーション(`V5P.bg0`/`bg1`)との明度差が小さく、縮小表示
    /// された実機キャプチャでは塗りが入っていないように見えていたため、枠内
    /// だけ明確に明るい色を専用トークンとして定義した。
    private static let searchFieldFill = Color(red: 0.035, green: 0.15, blue: 0.28)

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(V5P.muted)
            // HQ指示(2026-10-11、18回目)「検索欄に入るCPIの文字サイズを
            // 大きくして」: 入力文字のみ8.5→11(プレースホルダーは据え置き)。
            TextField("", text: $viewModel.searchText)
                .font(.system(size: 11))
                .foregroundStyle(.white)
                .accessibilityLabel("検索")
                .focused($searchFieldFocused)
                .onTapGesture { searchFieldFocused = true }
                .placeholder(when: viewModel.searchText.isEmpty) {
                    NotoText.text("指標名・通貨・キーワードで検索", size: 8.5)
                        .foregroundStyle(V5P.muted)
                        .allowsHitTesting(false)
                }
            Spacer()
        }
        .padding(.horizontal, 10)
        .frame(width: 204, height: 28)
        .background(Self.searchFieldFill, in: Capsule())
        .overlay(Capsule().stroke(V5P.line, lineWidth: 1))
        .position(x: 117, y: 67)
    }

    private var filterPills: some View {
        HStack(spacing: 5) {
            ForEach(SearchFilter.allCases) { filter in
                Button { selectedFilter = filter } label: {
                    // HQ指示(2026-10-09、7回目)「フィルターの文字サイズを
                    // 雇用統計と同じサイズにして」: キーワードpill(8.5)と揃えた。
                    NotoText.text(filter.title, size: 8.5).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(selectedFilter == filter ? V5P.blue : V5P.panel2, in: Capsule())
                }.buttonStyle(.plain)
            }
        }.position(x: 117, y: 104)
    }

    @ViewBuilder private var scrollableContent: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                if trimmedQuery.isEmpty {
                    popularKeywordsPanel
                    recentSearchSection
                } else {
                    resultsSection
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 16)
        }
    }

    // MARK: - 人気の検索キーワード

    /// 分析・集計に基づく実際の「人気」データは存在しないため、一般的な
    /// FX用語の固定リストをタップ可能な検索ショートカットとして提供する
    /// (冒頭のドキュメントコメント参照)。
    private static let popularKeywords = ["FOMC", "雇用統計", "CPI", "ECB", "日銀", "GDP", "インフレ", "金利"]

    /// HQ指示(2026-10-09、6回目)「人気の検索枠とFOMC枠に色をつけて、同じ色
    /// ではなくFOMCの方が明るく」: 従来は`V5P.panel`(外枠)/`V5P.panel2`
    /// (キーワードpill)という隣接トークンを使っていたが、実機キャプチャ上では
    /// 明度差が小さく塗りがほぼ同じ色に見えていたため、差が明確な専用トークン
    /// を定義した(外枠 < pillの明るさ)。
    private static let popularPanelFill = Color(red: 0.025, green: 0.12, blue: 0.22)
    private static let keywordPillFill = Color(red: 0.07, green: 0.24, blue: 0.42)

    private var popularKeywordsPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            // HQ指示(2026-10-13)「人気の検索キーワードの文字サイズを1
            // 大きくして」: 10→11。
            NotoText.text("人気の検索キーワード", size: 11)
                .foregroundStyle(.white)

            let rows = Self.popularKeywords.chunked(into: 4)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 5) {
                    ForEach(row, id: \.self) { keyword in
                        Button {
                            viewModel.searchText = keyword
                        } label: {
                            // HQ指示(2026-10-09、7回目)「FOMCの枠の縦幅を
                            // 少し短くして」: 上下パディングを6→4に。
                            // HQ指示(2026-10-11、8回目)「人気の検索ワードの
                            // 文字サイズを1大きくして」: 8.5→9.5。
                            NotoText.text(keyword, size: 9.5)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 4)
                                .frame(maxWidth: .infinity)
                                .foregroundStyle(.white)
                                .background(Self.keywordPillFill, in: Capsule())
                                .overlay(Capsule().stroke(V5P.line.opacity(0.5), lineWidth: 1))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(10)
        .background(Self.popularPanelFill, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(V5P.line.opacity(0.3), lineWidth: 1))
    }

    // MARK: - 最近の検索履歴

    private var recentSearchSection: some View {
        // HQ指示(2026-10-09、6回目)「最近の検索の文字開始を人気の検索の開始と
        // 位置を揃えて」: 「人気の検索キーワード」は`popularKeywordsPanel`の
        // 枠線内パディング10pt分、scrollableContentの左パディング10ptより
        // さらに右から始まる。
        // HQ指示(2026-10-11、9回目)「最近の検索履歴の米国CPIの枠を人気の検索
        // キーワードの枠と横の長さを揃えて」: 以前はこの揃え用の10ptを
        // VStack全体(見出し+行)にかけていたため、行のカード自体も10pt
        // 狭くなってしまっていた。見出しテキストにだけ掛けるようにし、
        // 行のカードはpopularKeywordsPanelと同じ全幅のままにした。
        VStack(alignment: .leading, spacing: 8) {
            // HQ指示(2026-10-11、8回目)「最近の検索履歴の文字サイズを0.5
            // 大きくして」: 10→10.5。
            NotoText.text("最近の検索履歴", size: 10.5)
                .foregroundStyle(.white)
                .padding(.leading, 10)

            ForEach(recentSearches.prefix(4)) { entry in
                Button {
                    viewModel.searchText = entry.term
                } label: {
                    historyRow(entry)
                }.buttonStyle(.plain)
            }
        }
    }

    private func historyRow(_ entry: RecentSearchEntry) -> some View {
        HStack(spacing: 8) {
            // HQ指示(2026-10-11、8回目)「国旗マークの大きさを経済指標、
            // カレンダーと同じにして」: `IndicatorsView`の経済指標リスト行と
            // 同じ14ptに縮小(22→14)。HQ指示(2026-10-11、9回目)「国旗マークを
            // 少し大きくして」で14→16に微調整。
            CountryFlagView(countryCode: entry.countryCode, diameter: 16)
            // HQ指示(2026-10-13)「最近の検索履歴の米国CPIの文字サイズを
            // 0.5小さくして」: 10.5→10。
            NotoText.text(entry.term, size: 10).foregroundStyle(.white).lineLimit(1)
            Spacer()
            // HQ指示(2026-10-11、8回目)「＞の文字サイズを米国CPIと同じに」:
            // エントリ文字サイズに揃えた。
            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.muted)
        }
        .padding(.horizontal, 8)
        // HQ指示(2026-10-13)「枠の高さも少し小さくして」: 36→32。
        .frame(height: 32)
        // HQ指示(2026-10-11、10回目)「最近の検索結果の枠の色を人気の検索
        // キーワードと同じにして」: `popularKeywordsPanel`と同じ
        // `popularPanelFill`/枠線不透明度0.3に揃えた。
        .background(Self.popularPanelFill, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.3), lineWidth: 1))
    }

    // MARK: - 検索結果(実データのみ — 冒頭のドキュメントコメント参照)

    /// `HomeView`の「経済指標」バッジ(`economicIndicatorBadgeColor`)と
    /// 同じ色。HQ指示(2026-10-11、8回目)「経済指標や要人発言のマークを
    /// ホーム画面と同じに」で、プレーン文字だったカテゴリ表示をホームと
    /// 同じ見た目のバッジに揃えた。
    private static let economicIndicatorBadgeColor = Color(red: 0.0 / 255, green: 118.0 / 255, blue: 234.0 / 255)

    @ViewBuilder private var resultsSection: some View {
        switch viewModel.state {
        case .loading:
            EmptyView()
        case .backendNotConfigured, .error:
            EmptyView()
        case .loaded:
            // 検索語(指標名・国・通貨ペア)で絞り込んだ結果(SCR-005と同じ規則)。
            let indicators = viewModel.filtered
            if selectedFilter == .all || selectedFilter == .indicator {
                // HQ指示(2026-10-11、8回目)「CPIを検索した後の画面のカード
                // 全体を枠を囲って、線で各行を表して」: 行ごとに別々の
                // カードを並べる構成から、1枚の外枠カード+行間の区切り線
                // という構成に変更した。
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(indicators.enumerated()), id: \.element.id) { index, indicator in
                        NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                            resultRow(indicator)
                        }.buttonStyle(.plain)
                            .simultaneousGesture(TapGesture().onEnded {
                                recentSearches = RecentSearchStore.record(term: indicator.name, countryCode: indicator.countryCode)
                            })
                        if index < indicators.count - 1 {
                            Rectangle().fill(V5P.line.opacity(0.3)).frame(height: 1)
                        }
                    }
                }
                // HQ指示(2026-10-11、10回目)「検索結果の米国CPI等の枠の色も
                // 同じにして」: `popularKeywordsPanel`と同じ`popularPanelFill`
                // に揃えた(枠線の不透明度0.3は元々同じ)。
                .background(Self.popularPanelFill, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(V5P.line.opacity(0.3), lineWidth: 1))
            }
        }
    }

    private func resultRow(_ indicator: IndicatorSummary) -> some View {
        // HQ指示(2026-10-11、11回目)「検索画面は米国CPIのままになっている
        // ので修正して」: Homeの「今日の重要イベント」と同じ
        // `CountryFlag.indicatorDisplayName`を使い、国名接頭辞を除いた
        // 正式名+略称(「消費者物価指数(CPI)」等)を表示する。
        let display = CountryFlag.indicatorDisplayName(indicator.name, countryCode: indicator.countryCode)
        // HQ指示(2026-10-11、12回目)「消費者物価指数(CPI)は改行しないで。
        // 改行する条件は1行で入り切らない場合にして」: 以前は略称の有無で
        // 機械的に2行へ分けていたが、1つの文字列として組み立て、1行で
        // 収まる限りは1行のまま・収まらない場合だけ自然に2行目へ折り返す
        // ようにする。
        let displayName = display.abbreviation.map { "\(display.main)(\($0))" } ?? display.main
        // HQ指示(2026-10-11、16回目)「国旗マークはカードの縦幅の中心に
        // くるように」: 行全体を上揃え(`.top`)にしていたのをやめ、国旗・
        // タイトルブロックの両方を行の中央に揃える。
        return HStack(alignment: .center, spacing: 8) {
            // HQ指示(2026-10-11、8回目)「CPIを検索した後の画面の国旗マーク
            // を少し小さくして」: 28→24。
            CountryFlagView(countryCode: indicator.countryCode, diameter: 24)
            // HQ指示(2026-10-11、16回目)「カード内の行間を短くして」: 2→1。
            VStack(alignment: .leading, spacing: 1) {
                // HQ指示(2026-10-11、9回目)「枠線の高さは全て揃えて」:
                // 1行で収まる名前でも、2行に折り返す名前と同じ高さを確保
                // するため、タイトル部分に2行分の`minHeight`を与えた。
                // `ViewThatFits`で、1行で収まる場合は1行版(縦中央揃え)を
                // 採用し、収まらない場合だけ2行版(上揃え)にフォールバック
                // する — HQ指示(2026-10-11、10回目)「折り返さない場合は
                // 中央にしてください」をデータに依らず実現する。
                // HQ指示(2026-10-11、15回目)「各枠の縦幅をもう少し短くして」:
                // 2行分の予約を27→22に縮め、行全体の余白も合わせて詰めた。
                // HQ指示(2026-10-11、16回目)「非農業部門雇用者数は()が2行目に
                // くるようにして」: `.lineLimit(2)`の自然な折り返しだと幅の
                // 都合で「(雇用」「用統計)」のように括弧の途中で割れることが
                // あったため、名前本体と(略称)を明示的に分けた2行版に戻す
                // (Homeの`eventRow`と同じ考え方)。
                // HQ指示(2026-10-11、17回目)「各カードの縦幅も少し短くして」:
                // 見出しを9.5ptに縮めた分、2行分の予約も22→19に詰めた。
                ViewThatFits(in: .horizontal) {
                    NotoText.text(displayName, size: 9.5)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .frame(minHeight: 19, alignment: .leading)
                    VStack(alignment: .leading, spacing: 0) {
                        NotoText.text(display.main, size: 9.5)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        if let abbreviation = display.abbreviation {
                            NotoText.text("(\(abbreviation))", size: 9.5)
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                    .frame(minHeight: 19, alignment: .topLeading)
                }
                // 括弧を2行目に分けたことで、タイトルのaccessibility labelも
                // 「米国CPI」「(消費者物価指数)」の2要素に分かれてしまい、
                // UIテストの`tap(containing: "米国CPI(消費者物価指数)")`が
                // 検索結果行を見つけられなくなった(CI screenshots job、commit
                // 9dbe5e9で検出)。見た目は2行のまま、検索可能な名前は元の
                // 1つの文字列に明示的に戻す。
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(indicator.name)
                HStack(spacing: 4) {
                    NotoText.text(CountryFlag.japaneseName(forCountry: indicator.countryCode), size: 8.5)
                        .foregroundStyle(V5P.muted)
                    NotoText.text("|", size: 8.5)
                        .foregroundStyle(V5P.muted)
                    // HQ指示(2026-10-11、9回目)「経済指標のマークを大きく
                    // して」: 5.3→6.5、パディングも比例して広げた。
                    NotoText.text("経済指標", size: 6.5)
                        .tracking(-0.4)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4).padding(.vertical, 2)
                        .background(Self.economicIndicatorBadgeColor, in: Capsule())
                }
            }
            Spacer(minLength: 20)
        }
        .padding(.horizontal, 8)
        // HQ指示(2026-10-11、16回目)「検索画面の各カードの縦幅をまだ短く
        // して」: 6→4、52→46。
        // HQ指示(2026-10-11、17回目)「各カードの縦幅も少し短くして」:
        // 4→3、46→42。
        .padding(.vertical, 3)
        .frame(minHeight: 42, alignment: .top)
        // HQ指示(2026-10-11、9回目)「>の位置は枠の右端の中心にして」: 行の
        // 内容(`alignment: .top`)から独立して、行全体の高さの中央・右端に
        // オーバーレイで置く。
        .overlay(alignment: .trailing) {
            Image(systemName: "chevron.right")
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(V5P.muted)
                .padding(.trailing, 8)
        }
    }
}

private enum SearchFilter: String, CaseIterable, Identifiable {
    case all, indicator, speech, fxPair
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "すべて"
        case .indicator: return "指標"
        case .speech: return "要人発言"
        case .fxPair: return "通貨ペア"
        }
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}

private extension View {
    @ViewBuilder
    func placeholder(when shouldShow: Bool, @ViewBuilder placeholder: () -> some View) -> some View {
        ZStack(alignment: .leading) {
            if shouldShow { placeholder() }
            self
        }
    }
}

/// SCR-011検索結果行/最近の検索履歴のレコード。国コードはアイコン表示
/// (`CountryFlagView`)に使う — 指標検索の実結果からのみ記録されるため、
/// 常に実在する指標のcountry_codeである(推測・捏造ではない)。
struct RecentSearchEntry: Codable, Identifiable, Equatable {
    let term: String
    let countryCode: String
    var id: String { term }
}

/// On-device "最近の検索" history (SCR-011) — no server-side search-history
/// endpoint exists, so this is genuinely local, per-device state: it
/// records indicators the user has actually tapped from real search
/// results.
private enum RecentSearchStore {
    private static let key = "fx.search.recentEntries"
    private static let limit = 5

    static func load() -> [RecentSearchEntry] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let entries = try? JSONDecoder().decode([RecentSearchEntry].self, from: data) else {
            return []
        }
        return entries
    }

    @discardableResult
    static func record(term: String, countryCode: String) -> [RecentSearchEntry] {
        var entries = load()
        entries.removeAll { $0.term == term }
        entries.insert(RecentSearchEntry(term: term, countryCode: countryCode), at: 0)
        if entries.count > limit { entries = Array(entries.prefix(limit)) }
        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: key)
        }
        return entries
    }
}
