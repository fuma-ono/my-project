import SwiftUI

/// SCR-008 Search (ui-screens.md §4) — no dedicated ViewModel/endpoint
/// exists for search, but `IndicatorsViewModel` already does real
/// server-side `q`-search against `GET /indicators` (used by the
/// Indicators tab). This screen reuses that same, already-existing
/// capability with its own instance — not a new API/ViewModel.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Search` (fixed 234×491 canvas, search field,
/// filter pills, "最近の検索"/"人気の検索" row lists), reproduced as given.
/// HQ's fixed canvas provisions exactly two labeled row lists and nothing
/// else — no separate region for live search results. Rather than invent
/// new UI for them, the real functionality is fitted into the existing
/// "最近の検索" row list (same 4 fixed slots, same row style, same
/// heading text — never renamed):
/// - Empty query: the 4 rows are real on-device recent-search history
///   (unchanged from the prior integration), tapping fills the field.
/// - Active query, すべて/指標 filter: the 4 rows are the real top
///   indicator matches, tapping pushes to SCR-003.
/// - Active query, イベント/通貨ペア filter: no real search exists for
///   those types, so the rows are simply empty (never fabricated) rather
///   than showing an invented empty-state message this canvas has no room
///   for.
/// "人気の検索" has no backing analytics/popularity endpoint — inventing
/// static "popular" entries would be fabricated data, so both its heading
/// and rows are omitted entirely, the same call made in both prior
/// integration rounds.
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
            V5Viewport {
                V5TopStatus()
                V5Header(title: "検索", back: false, star: false)
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(V5P.muted)
                    TextField("指標名・イベント・通貨ペアなどで検索", text: $viewModel.searchText)
                        .font(.system(size: 7))
                        .foregroundStyle(.white)
                    Spacer()
                }
                .foregroundStyle(.white).padding(7).frame(width: 204, height: 28).background(V5P.panel2, in: Capsule()).position(x: 117, y: 67)

                HStack(spacing: 5) {
                    ForEach(SearchFilter.allCases) { filter in
                        Button { selectedFilter = filter } label: {
                            Text(filter.title).font(.system(size: 7, weight: .semibold)).foregroundStyle(.white)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(selectedFilter == filter ? V5P.blue : V5P.panel2, in: Capsule())
                        }.buttonStyle(.plain)
                    }
                }.position(x: 117, y: 94)

                Text("最近の検索").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 42, y: 123)
                ForEach(Array(rowItems.enumerated()), id: \.offset) { i, item in
                    row(item, y: 142 + CGFloat(i) * 30)
                }

                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
            }
        }
    }

    private enum RowItem {
        case recent(String)
        case indicator(IndicatorSummary)
    }

    private var rowItems: [RowItem] {
        let trimmed = viewModel.searchText.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            return recentSearches.prefix(4).map(RowItem.recent)
        }
        guard selectedFilter == .all || selectedFilter == .indicator else { return [] }
        guard case .loaded(let indicators) = viewModel.state else { return [] }
        return indicators.prefix(4).map(RowItem.indicator)
    }

    @ViewBuilder private func row(_ item: RowItem, y: CGFloat) -> some View {
        switch item {
        case .recent(let term):
            Button {
                viewModel.searchText = term
            } label: {
                HStack { Circle().fill(V5P.red).frame(width: 5); Text(term).font(.system(size: 8)).foregroundStyle(.white); Spacer() }
                    .padding(.horizontal, 8).frame(width: 204, height: 25).background(V5P.panel, in: RoundedRectangle(cornerRadius: 5))
            }.buttonStyle(.plain).position(x: 117, y: y)
        case .indicator(let indicator):
            NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                HStack { Circle().fill(V5P.red).frame(width: 5); Text(indicator.name).font(.system(size: 8)).foregroundStyle(.white).lineLimit(1); Spacer() }
                    .padding(.horizontal, 8).frame(width: 204, height: 25).background(V5P.panel, in: RoundedRectangle(cornerRadius: 5))
            }.buttonStyle(.plain).position(x: 117, y: y)
                .simultaneousGesture(TapGesture().onEnded {
                    recentSearches = RecentSearchStore.record(indicator.name)
                })
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
/// endpoint exists, so this is genuinely local, per-device state: it
/// records indicators the user has actually tapped from real search
/// results.
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
