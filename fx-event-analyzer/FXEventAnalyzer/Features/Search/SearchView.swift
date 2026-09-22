import SwiftUI

/// SCR-008 Search (ui-screens.md §4) — was a "準備中" placeholder before
/// this integration; no dedicated ViewModel/endpoint exists for search, but
/// `IndicatorsViewModel` already does real server-side `q`-search against
/// `GET /indicators` (used by the Indicators tab). This screen reuses that
/// same, already-existing capability with its own instance — not a new
/// API/ViewModel, just a second consumer of one that already exists.
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-008.png` — "検索" title, search field, filter
/// chips (すべて/指標/イベント/通貨ペア), "最近の検索", "人気の検索". Two
/// deliberate deviations from the reference, not redesigns: (1) only
/// indicator search is a real, existing capability (`GET /indicators?q=`);
/// there is no event- or currency-pair-search endpoint, so the イベント/
/// 通貨ペア chips are kept (matching the reference) but surface an honest
/// "この検索対象はまだ利用できません" state rather than silently falling
/// back to indicator results or inventing an endpoint. (2) "人気の検索" has
/// no backing analytics/popularity endpoint — inventing static "popular"
/// entries would be fabricated data, so it is omitted, the same "necessary
/// deviation due to missing real data" call already made elsewhere this
/// round (e.g. Movement Detail's dropped 平均変動幅 column). "最近の検索" is
/// real, on-device history of indicators the user has actually opened from
/// this screen, persisted locally.
struct SearchView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @State private var path = NavigationPath()
    @State private var selectedFilter: SearchFilter = .all
    @State private var recentSearches: [String] = RecentSearchStore.load()
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorsViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                FXAppBackground()
                content
            }
            .navigationTitle("検索")
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("検索").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)

                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(FXColor.cyan)
                    TextField("指標名・イベント・通貨ペアなどで検索", text: $viewModel.searchText).foregroundStyle(.white)
                }.padding(.horizontal, 15).frame(height: 52).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 15))

                filterChips

                resultsSection
            }.padding(20).frame(maxWidth: 900)
        }
    }

    private var filterChips: some View {
        HStack(spacing: 10) {
            ForEach(SearchFilter.allCases) { filter in
                Button {
                    selectedFilter = filter
                } label: {
                    Text(filter.title)
                        .font(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .background(selectedFilter == filter ? FXColor.cyan : FXColor.card)
                        .foregroundStyle(selectedFilter == filter ? .white : FXColor.secondaryText)
                        .clipShape(Capsule())
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
                LazyVStack(spacing: 10) {
                    ForEach(indicators) { indicator in
                        NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                            IndicatorRow(indicator: FXIndicatorUI(indicator: indicator))
                        }.buttonStyle(.plain).simultaneousGesture(TapGesture().onEnded {
                            recentSearches = RecentSearchStore.record(indicator.name)
                        })
                    }
                }
            case .error(let message):
                ErrorView(title: "検索に失敗しました", message: message, onRetry: { viewModel.load() })
            }
        }
    }

    private var recentSearchesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("最近の検索").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            VStack(spacing: 0) {
                ForEach(Array(recentSearches.enumerated()), id: \.element) { index, term in
                    Button {
                        viewModel.searchText = term
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "clock.arrow.circlepath").foregroundStyle(FXColor.red)
                            Text(term).font(.system(size: 14)).foregroundStyle(.white)
                            Spacer()
                        }.padding(14).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    if index != recentSearches.count - 1 {
                        Divider().background(FXColor.border)
                    }
                }
            }.fxCard(padding: 4)
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
