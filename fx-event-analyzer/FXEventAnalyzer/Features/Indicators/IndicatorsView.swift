import SwiftUI

/// SCR-002 Indicators (ui-screens.md §5): browse indicators, tap through to
/// SCR-003 Indicator Detail.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5IndicatorsView` (search bar, filter
/// `HQV5Pill`s, `HQV5NeonCard` rows, `HQV5BottomBar`), reproduced as
/// given. Adaptations, all wiring, not redesign:
/// - HQ's search bar is a static `Text` placeholder (no `TextField`) — made
///   a real `TextField` bound to `viewModel.searchText`, same visual shape.
/// - HQ's filter pills (すべて/重要度/国・地域/通貨ペア) have no tap action —
///   wrapped in `Menu`/`Button` wired to the existing real filters
///   (`viewModel.importanceFilter` server-side; 国・地域/通貨ペア client-side
///   over the already-fetched list, same as the previous integration), same
///   visual shape.
/// - HQ's 6 hardcoded demo rows → a real `ForEach` over the filtered
///   `IndicatorSummary` list, `NavigationLink`ed to `AppRoute.indicatorDetail`.
///   The demo row's per-item release time ("21:30") has no equivalent field
///   on `IndicatorSummary` (Indicators is metadata, not a scheduled event) —
///   omitted rather than fabricated, same call as the previous integration.
struct IndicatorsView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @Binding var path: NavigationPath
    @Binding var tabSelection: Int
    private let apiClient: APIClient

    @State private var countryFilter: String?
    @State private var currencyFilter: String?

    init(apiClient: APIClient, path: Binding<NavigationPath>, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorsViewModel(apiClient: apiClient))
        _path = path
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
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        HQV5Screen(title: "指標一覧") {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(HQV5.muted)
                TextField("指標名・国名で検索", text: $viewModel.searchText)
                    .font(.system(size: 11))
                    .foregroundStyle(.white)
                Spacer()
            }.padding(11).background(HQV5.panel2, in: Capsule())

            filterRow

            switch viewModel.state {
            case .loading:
                LoadingView(caption: "読み込み中...")
            case .backendNotConfigured:
                FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。")
            case .loaded(let indicators) where indicators.isEmpty:
                FXEmptyState(icon: "magnifyingglass", title: "指標が見つかりません", message: "条件に一致する経済指標がありません。")
            case .loaded(let indicators):
                let filtered = applyLocalFilters(indicators)
                if filtered.isEmpty {
                    FXEmptyState(icon: "magnifyingglass", title: "指標が見つかりません", message: "条件に一致する経済指標がありません。")
                } else {
                    ForEach(filtered) { indicator in
                        NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                            row(FXIndicatorUI(indicator: indicator))
                        }.buttonStyle(.plain)
                    }
                }
            case .error(let message):
                ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
            }
        }
    }

    private var filterRow: some View {
        HStack {
            Button {
                viewModel.importanceFilter = nil
                countryFilter = nil
                currencyFilter = nil
            } label: {
                HQV5Pill(text: "すべて", active: viewModel.importanceFilter == nil && countryFilter == nil && currencyFilter == nil)
            }.buttonStyle(.plain)

            Menu {
                Button("すべて") { viewModel.importanceFilter = nil }
                Button("重要度: 高") { viewModel.importanceFilter = .high }
                Button("重要度: 中") { viewModel.importanceFilter = .medium }
                Button("重要度: 低") { viewModel.importanceFilter = .low }
            } label: {
                HQV5Pill(text: "重要度", active: viewModel.importanceFilter != nil)
            }

            Menu {
                Button("すべて") { countryFilter = nil }
                ForEach(availableCountries, id: \.self) { code in
                    Button("\(CountryFlag.emoji(for: code)) \(code)") { countryFilter = code }
                }
            } label: {
                HQV5Pill(text: "国・地域", active: countryFilter != nil)
            }

            Menu {
                Button("すべて") { currencyFilter = nil }
                ForEach(availableCurrencies, id: \.self) { code in
                    Button(code) { currencyFilter = code }
                }
            } label: {
                HQV5Pill(text: "通貨ペア", active: currencyFilter != nil)
            }
        }
    }

    private var availableCountries: [String] {
        guard case .loaded(let indicators) = viewModel.state else { return [] }
        return Array(Set(indicators.map(\.countryCode))).sorted()
    }

    private var availableCurrencies: [String] {
        guard case .loaded(let indicators) = viewModel.state else { return [] }
        return Array(Set(indicators.map(\.currencyCode))).sorted()
    }

    private func applyLocalFilters(_ indicators: [IndicatorSummary]) -> [IndicatorSummary] {
        indicators.filter { indicator in
            (countryFilter == nil || indicator.countryCode == countryFilter)
                && (currencyFilter == nil || indicator.currencyCode == currencyFilter)
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

/// Not `private` — reused by `SearchView`.
extension FXIndicatorUI {
    var hqv5Kind: HQV5Badge.Kind {
        switch importance {
        case "HIGH": return .high
        case "MEDIUM": return .medium
        default: return .low
        }
    }
}

extension FXIndicatorUI {
    init(indicator: IndicatorSummary) {
        self.init(
            id: indicator.id,
            name: indicator.name,
            code: indicator.code,
            country: indicator.countryCode,
            currency: indicator.currencyCode,
            importance: indicator.importance.rawValue,
            description: indicator.description ?? "",
            source: indicator.source ?? ""
        )
    }
}
