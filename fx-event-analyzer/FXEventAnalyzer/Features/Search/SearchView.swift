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

    // 検索バー上端53・高さ28(y=67中心)、フィルターpill(y=94・高さ約20)が
    // クリアできる余白を見て112に設定。V5BottomBarの帯高さ(39)と合わせて
    // 491-112-39=340をScrollViewの実高さとした。
    private static let contentTopOffset: CGFloat = 112
    private static let contentAreaHeight: CGFloat = V5P.H - contentTopOffset - 39

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(V5P.muted)
            TextField("", text: $viewModel.searchText)
                .font(.system(size: 7))
                .foregroundStyle(.white)
                .accessibilityLabel("検索")
                .focused($searchFieldFocused)
                .onTapGesture { searchFieldFocused = true }
                .placeholder(when: viewModel.searchText.isEmpty) {
                    Text("指標名・通貨・キーワードで検索")
                        .font(.system(size: 7))
                        .foregroundStyle(V5P.muted)
                        .allowsHitTesting(false)
                }
            Spacer()
        }
        .padding(.horizontal, 10)
        .frame(width: 204, height: 28)
        .background(V5P.panel2, in: Capsule())
        .overlay(Capsule().stroke(V5P.line, lineWidth: 1))
        .position(x: 117, y: 67)
    }

    private var filterPills: some View {
        HStack(spacing: 5) {
            ForEach(SearchFilter.allCases) { filter in
                Button { selectedFilter = filter } label: {
                    Text(filter.title).font(.system(size: 7, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(selectedFilter == filter ? V5P.blue : V5P.panel2, in: Capsule())
                }.buttonStyle(.plain)
            }
        }.position(x: 117, y: 94)
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

    private var popularKeywordsPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("人気の検索キーワード")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white)

            let rows = Self.popularKeywords.chunked(into: 4)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 6) {
                    ForEach(row, id: \.self) { keyword in
                        Button {
                            viewModel.searchText = keyword
                        } label: {
                            Text(keyword)
                                .font(.system(size: 7, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .frame(maxWidth: .infinity)
                                .background(V5P.panel2, in: Capsule())
                                .overlay(Capsule().stroke(V5P.line.opacity(0.5), lineWidth: 1))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(10)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(V5P.line.opacity(0.3), lineWidth: 1))
    }

    // MARK: - 最近の検索履歴

    private var recentSearchSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("最近の検索履歴")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white)

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
            CountryFlagView(countryCode: entry.countryCode, diameter: 20)
            Text(entry.term).font(.system(size: 8)).foregroundStyle(.white).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(V5P.muted)
        }
        .padding(.horizontal, 8)
        .frame(height: 32)
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
        HStack(spacing: 8) {
            CountryFlagView(countryCode: indicator.countryCode, diameter: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(indicator.name).font(.system(size: 8, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                HStack(spacing: 4) {
                    Text(CountryFlag.japaneseName(for: indicator.countryCode))
                    Text("|")
                    Text("経済指標")
                }
                .font(.system(size: 6.5))
                .foregroundStyle(V5P.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(V5P.muted)
        }
        .padding(.horizontal, 8)
        .frame(height: 40)
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
