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
    }

    // 検索バー上端53・高さ28(y=67中心)、フィルターpill(y=100・高さ約20)との
    // 間隔をHQ指示(2026-10-09、6回目)「検索欄とすべてや指標の間にスペースを
    // もう少し広げて」で3pt→9ptに拡大。クリアできる余白を見て118に設定。
    // V5BottomBarの帯高さ(39)と合わせて491-118-39=334をScrollViewの実高さとした。
    private static let contentTopOffset: CGFloat = 118
    private static let contentAreaHeight: CGFloat = V5P.H - contentTopOffset - 39

    /// HQ指示(2026-10-09、6回目)「検索欄の枠の中は色をつけて」: `V5P.panel2`
    /// 単体だと背景グラデーション(`V5P.bg0`/`bg1`)との明度差が小さく、縮小表示
    /// された実機キャプチャでは塗りが入っていないように見えていたため、枠内
    /// だけ明確に明るい色を専用トークンとして定義した。
    private static let searchFieldFill = Color(red: 0.035, green: 0.15, blue: 0.28)

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(V5P.muted)
            TextField("", text: $viewModel.searchText)
                .font(.system(size: 8.5))
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
                    NotoText.text(filter.title, size: 8).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(selectedFilter == filter ? V5P.blue : V5P.panel2, in: Capsule())
                }.buttonStyle(.plain)
            }
        }.position(x: 117, y: 100)
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
            NotoText.text("人気の検索キーワード", size: 10)
                .foregroundStyle(.white)

            let rows = Self.popularKeywords.chunked(into: 4)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 5) {
                    ForEach(row, id: \.self) { keyword in
                        Button {
                            viewModel.searchText = keyword
                        } label: {
                            NotoText.text(keyword, size: 8.5)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 6)
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
        // さらに右から始まる。同じ10ptをここにも足して開始位置を揃える。
        VStack(alignment: .leading, spacing: 8) {
            NotoText.text("最近の検索履歴", size: 10)
                .foregroundStyle(.white)

            ForEach(recentSearches.prefix(4)) { entry in
                Button {
                    viewModel.searchText = entry.term
                } label: {
                    historyRow(entry)
                }.buttonStyle(.plain)
            }
        }
        .padding(.leading, 10)
    }

    private func historyRow(_ entry: RecentSearchEntry) -> some View {
        HStack(spacing: 8) {
            CountryFlagView(countryCode: entry.countryCode, diameter: 22)
            NotoText.text(entry.term, size: 10).foregroundStyle(.white).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(V5P.muted)
        }
        .padding(.horizontal, 8)
        .frame(height: 36)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - 検索結果(実データのみ — 冒頭のドキュメントコメント参照)

    @ViewBuilder private var resultsSection: some View {
        switch viewModel.state {
        case .loading:
            EmptyView()
        case .backendNotConfigured, .error:
            EmptyView()
        case .loaded(let indicators):
            if selectedFilter == .all || selectedFilter == .indicator {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(indicators) { indicator in
                        NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                            resultRow(indicator)
                        }.buttonStyle(.plain)
                            .simultaneousGesture(TapGesture().onEnded {
                                recentSearches = RecentSearchStore.record(term: indicator.name, countryCode: indicator.countryCode)
                            })
                    }
                }
            }
        }
    }

    private func resultRow(_ indicator: IndicatorSummary) -> some View {
        HStack(alignment: .top, spacing: 8) {
            CountryFlagView(countryCode: indicator.countryCode, diameter: 28)
            VStack(alignment: .leading, spacing: 2) {
                // 長い指標名が`.lineLimit(1)`だと末尾切れになるため2行まで
                // 許可する。`NotoText.text`は(`V5JPFont.text`と違い)文字列を
                // 日本語/非日本語ランに分割して`Text`を連結したりしない
                // 単一の`Text`なので、`V5JPFont`で必要だった
                // `wrappingText`回避策は不要 — 普通に`.lineLimit(2)`で
                // 折り返せる。
                NotoText.text(indicator.name, size: 10.5)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                HStack(spacing: 4) {
                    NotoText.text(CountryFlag.japaneseName(forCountry: indicator.countryCode), size: 8.5)
                    NotoText.text("|", size: 8.5)
                    NotoText.text("経済指標", size: 8.5)
                }
                .foregroundStyle(V5P.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(V5P.muted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
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
