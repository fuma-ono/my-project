import SwiftUI

/// SCR-008 Search (ui-screens.md §4) — was a "準備中" placeholder before
/// the prior integration; no dedicated ViewModel/endpoint exists for search,
/// but `IndicatorsViewModel` already does real server-side `q`-search
/// against `GET /indicators` (used by the Indicators tab). This screen
/// reuses that same, already-existing capability with its own instance —
/// not a new API/ViewModel, just a second consumer of one that already
/// exists.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5SearchView` (search field, filter
/// `HQV5Pill`s すべて/指標/イベント/通貨ペア, "最近の検索"
/// `HQV5NeonCard` rows), reproduced as given. Two deliberate deviations,
/// carried over unchanged from the prior integration (real-data
/// constraints, not redesigns): (1) only indicator search is a real,
/// existing capability; イベント/通貨ペア chips surface an honest "この
/// 検索対象はまだ利用できません" state rather than a fabricated result.
/// (2) HQ's "人気の検索" has no backing analytics/popularity endpoint —
/// inventing static "popular" entries would be fabricated data, so it is
/// omitted, same as Movement Detail's dropped 平均変動幅. "最近の検索" is
/// real, on-device history of indicators the user has actually opened from
/// this screen. Search results (when a query is active) use the same
/// `HQV5NeonCard` indicator row as the Indicators tab, since HQ's file has
/// no dedicated results-row visual of its own to reproduce.
struct SearchView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @State private var path = NavigationPath()
    @State private var selectedFilter: SearchFilter = .all
    @State private var recentSearches: [String] = RecentSearchStore.load()
    @Binding var tabSelection: Int
    private let apiClient: APIClient

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorsViewModel(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack(alignment: .bottom) {
                HQV5Background()
                content
                    .safeAreaInset(edge: .bottom) {
                        HQV5BottomBar(selected: $tabSelection).padding(.horizontal, 10).padding(.bottom, 5)
                    }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        HQV5Screen(title: "検索") {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(HQV5.muted)
                TextField("指標名・イベント・通貨ペアなどで検索", text: $viewModel.searchText)
                    .font(.system(size: 10))
                    .foregroundStyle(.white)
                Spacer()
            }.padding(11).background(HQV5.panel2, in: Capsule())

            filterChips

            resultsSection
        }
    }

    private var filterChips: some View {
        HStack {
            ForEach(SearchFilter.allCases) { filter in
                Button { selectedFilter = filter } label: {
                    HQV5Pill(text: filter.title, active: selectedFilter == filter)
                }.buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var resultsSection: some View {
        if viewModel.searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            if !recentSearches.isEmpty {
                recentSearchesSection
            } else {
                FXEmptyState(icon: "sparkle.magnifyingglass", title: "検索を始めよう", message: "指標名・国・通貨ペアを入力してください")
            }
        } else if selectedFilter == .event || selectedFilter == .fxPair {
            FXEmptyState(icon: "hourglass", title: "準備中です", message: "\(selectedFilter.title)の検索はまだ利用できません。")
        } else {
            switch viewModel.state {
            case .loading:
                LoadingView(caption: "検索中...")
            case .backendNotConfigured:
                FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "検索はまだ利用できません。")
            case .loaded(let indicators) where indicators.isEmpty:
                FXEmptyState(icon: "magnifyingglass", title: "見つかりませんでした", message: "別のキーワードでお試しください。")
            case .loaded(let indicators):
                ForEach(indicators) { indicator in
                    NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                        row(FXIndicatorUI(indicator: indicator))
                    }.buttonStyle(.plain).simultaneousGesture(TapGesture().onEnded {
                        recentSearches = RecentSearchStore.record(indicator.name)
                    })
                }
            case .error(let message):
                ErrorView(title: "検索に失敗しました", message: message, onRetry: { viewModel.load() })
            }
        }
    }

    private var recentSearchesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("最近の検索").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
            ForEach(Array(recentSearches.enumerated()), id: \.element) { index, term in
                Button { viewModel.searchText = term } label: {
                    HQV5NeonCard {
                        HStack {
                            Circle().fill(HQV5.red).frame(width: 6)
                            Text(term).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                            Spacer()
                        }
                    }
                }.buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private func row(_ indicator: FXIndicatorUI) -> some View {
        HQV5NeonCard {
            HStack {
                Text(CountryFlag.emoji(for: indicator.country)).font(.title3)
                VStack(alignment: .leading) {
                    Text("\(CountryFlag.kanjiAbbreviation(for: indicator.country))) \(indicator.name)").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                    Text(indicator.code).font(.system(size: 8)).foregroundStyle(HQV5.muted)
                }
                Spacer()
                HQV5Badge(text: indicator.importance.capitalized, kind: indicator.hqv5Kind)
            }
        }
    }
}

private enum SearchFilter: String, CaseIterable, Identifiable {
    case all, indicator, event, fxPair
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "すべて"
        case .indicator: return "指標"
        case .event: return "イベント"
        case .fxPair: return "通貨ペア"
        }
    }
}

/// On-device "最近の検索" history (SCR-008) — no server-side search-history
/// endpoint exists, so this is genuinely local, per-device state, not
/// something omitted or fabricated: it records indicators the user has
/// actually tapped from real search results.
private enum RecentSearchStore {
    private static let key = "fx.search.recentTerms"
    private static let limit = 5

    static func load() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    @discardableResult
    static func record(_ term: String) -> [String] {
        var terms = load()
        terms.removeAll { $0 == term }
        terms.insert(term, at: 0)
        if terms.count > limit { terms = Array(terms.prefix(limit)) }
        UserDefaults.standard.set(terms, forKey: key)
        return terms
    }
}
