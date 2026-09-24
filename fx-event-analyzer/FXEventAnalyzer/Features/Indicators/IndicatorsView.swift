import SwiftUI

/// SCR-002 Indicators (ui-screens.md §5): browse indicators, tap through to
/// SCR-003 Indicator Detail.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Indicators` (fixed 234×491 canvas, search
/// bar, filter pills, 6 absolute-positioned `V5Card` rows), reproduced as
/// given. Adaptations, all wiring, not redesign:
/// - HQ's search bar is a static `Text` placeholder — made a real
///   `TextField` bound to `viewModel.searchText`, same visual shape.
/// - HQ's filter pills (すべて/重要度/国・地域/通貨ペア) have no tap action —
///   wrapped in `Menu`/`Button` wired to the existing real filters
///   (`viewModel.importanceFilter` server-side; 国・地域/通貨ペア
///   client-side over the already-fetched list), same visual shape.
/// - HQ's 6 hardcoded rows → a real `ForEach` over the filtered indicator
///   list, `.prefix(6)`-ed to the 6 fixed slots HQ's coordinates provision
///   (y = 106 + i×52) — there is no `ScrollView` in this screen's design
///   at all, so a 7th+ real match simply isn't shown here (it's still
///   reachable via search), never inventing extra rows to break the fixed
///   coordinate system.
/// - HQ's per-row release time ("21:30") has no equivalent field on
///   `IndicatorSummary` (Indicators is metadata, not a scheduled event) —
///   hidden rather than fabricated, per instruction.
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
            content
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: AppRoute.self) { route in
                    AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
                }
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。") }
        case .loaded(let indicators):
            V5Viewport {
                V5TopStatus()
                V5Header(title: "指標一覧", back: false, star: false)
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(V5P.muted)
                    TextField("指標名・国名で検索", text: $viewModel.searchText)
                        .font(.system(size: 8))
                        .foregroundStyle(.white)
                }
                .padding(7).frame(width: 204, height: 27, alignment: .leading)
                .background(V5P.panel2, in: Capsule()).position(x: 117, y: 66)

                HStack(spacing: 5) {
                    filterPill(text: "すべて", active: viewModel.importanceFilter == nil && countryFilter == nil && currencyFilter == nil) {
                        viewModel.importanceFilter = nil
                        countryFilter = nil
                        currencyFilter = nil
                    }
                    Menu {
                        Button("すべて") { viewModel.importanceFilter = nil }
                        Button("重要度: 高") { viewModel.importanceFilter = .high }
                        Button("重要度: 中") { viewModel.importanceFilter = .medium }
                        Button("重要度: 低") { viewModel.importanceFilter = .low }
                    } label: {
                        pillLabel(text: "重要度", active: viewModel.importanceFilter != nil)
                    }
                    Menu {
                        Button("すべて") { countryFilter = nil }
                        ForEach(availableCountries(indicators), id: \.self) { code in
                            Button("\(CountryFlag.emoji(for: code)) \(code)") { countryFilter = code }
                        }
                    } label: {
                        pillLabel(text: "国・地域", active: countryFilter != nil)
                    }
                    Menu {
                        Button("すべて") { currencyFilter = nil }
                        ForEach(availableCurrencies(indicators), id: \.self) { code in
                            Button(code) { currencyFilter = code }
                        }
                    } label: {
                        pillLabel(text: "通貨ペア", active: currencyFilter != nil)
                    }
                }.position(x: 117, y: 91)

                let filtered = applyLocalFilters(indicators)
                if filtered.isEmpty {
                    FXEmptyState(icon: "magnifyingglass", title: "指標が見つかりません", message: "条件に一致する経済指標がありません。")
                        .frame(width: 204).position(x: 117, y: 260)
                } else {
                    ForEach(Array(filtered.prefix(6).enumerated()), id: \.element.id) { i, indicator in
                        NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                            V5Card(CGRect(x: 10, y: 106 + CGFloat(i) * 52, width: 214, height: 46)) {
                                row(indicator)
                            }
                        }.buttonStyle(.plain)
                    }
                }
                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            LinearGradient(colors: [V5P.bg0, V5P.bg1, V5P.bg0], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            content()
        }
    }

    @ViewBuilder private func filterPill(text: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { pillLabel(text: text, active: active) }.buttonStyle(.plain)
    }

    private func pillLabel(text: String, active: Bool) -> some View {
        Text(text).font(.system(size: 7, weight: .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(active ? V5P.blue : V5P.panel2, in: Capsule())
    }

    private func availableCountries(_ indicators: [IndicatorSummary]) -> [String] {
        Array(Set(indicators.map(\.countryCode))).sorted()
    }

    private func availableCurrencies(_ indicators: [IndicatorSummary]) -> [String] {
        Array(Set(indicators.map(\.currencyCode))).sorted()
    }

    private func applyLocalFilters(_ indicators: [IndicatorSummary]) -> [IndicatorSummary] {
        indicators.filter { indicator in
            (countryFilter == nil || indicator.countryCode == countryFilter)
                && (currencyFilter == nil || indicator.currencyCode == currencyFilter)
        }
    }

    @ViewBuilder private func row(_ indicator: IndicatorSummary) -> some View {
        HStack(spacing: 5) {
            Text(CountryFlag.emoji(for: indicator.countryCode)).font(.system(size: 14))
            VStack(alignment: .leading, spacing: 2) {
                Text("\(CountryFlag.kanjiAbbreviation(for: indicator.countryCode))) \(indicator.name)")
                    .font(.system(size: 8, weight: .semibold)).lineLimit(1)
                Text(indicator.currencyCode).font(.system(size: 7)).foregroundStyle(V5P.muted)
            }
            Spacer()
            V5Badge(text: indicator.importance.rawValue.capitalized, color: indicator.importance.v5Color)
        }
        .foregroundStyle(.white)
    }
}
