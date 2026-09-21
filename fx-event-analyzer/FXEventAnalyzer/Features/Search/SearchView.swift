import SwiftUI

/// SCR-008 Search (ui-screens.md §4) — was a "準備中" placeholder before
/// this integration; no dedicated ViewModel/endpoint exists for search, but
/// `IndicatorsViewModel` already does real server-side `q`-search against
/// `GET /indicators` (used by the Indicators tab). This screen reuses that
/// same, already-existing capability with its own instance — not a new
/// API/ViewModel, just a second consumer of one that already exists.
///
/// HQ Frontend integration (2026-09-21): visual content — search field,
/// empty state — is HQ's `FXEventAnalyzer_HQFrontend/SearchView.swift`,
/// with its own `NavigationStack` added (HQ's file assumed an enclosing
/// one) and real, debounced results in place of HQ's static `FXDemo`
/// client-side filter.
struct SearchView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @State private var path = NavigationPath()
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
            .navigationTitle("Search")
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("SEARCH").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(FXColor.cyan)
                    Text("検索").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    Text("指標・イベント・通貨ペアを探す").foregroundStyle(FXColor.secondaryText)
                }

                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(FXColor.cyan)
                    TextField("指標名、CPI、USD/JPY…", text: $viewModel.searchText).foregroundStyle(.white)
                }.padding(.horizontal, 15).frame(height: 52).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 15))

                resultsSection
            }.padding(20).frame(maxWidth: 900)
        }
    }

    @ViewBuilder
    private var resultsSection: some View {
        if viewModel.searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            FXEmptyState(icon: "sparkle.magnifyingglass", title: "検索を始めよう", message: "指標名・国・通貨ペアを入力してください")
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
                        }.buttonStyle(.plain)
                    }
                }
            case .error(let message):
                ErrorView(title: "検索に失敗しました", message: message, onRetry: { viewModel.load() })
            }
        }
    }
}
