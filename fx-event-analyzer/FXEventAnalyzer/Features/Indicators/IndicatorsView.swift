import SwiftUI

/// SCR-002 Indicators (ui-screens.md §5): browse indicators, tap through to
/// SCR-003 Indicator Detail.
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-002.png` — title "指標一覧" (no subtitle), search
/// bar, and four filter chips (すべて / 重要度 / 国・地域 / 通貨ペア).
/// "重要度" wires to the existing `viewModel.importanceFilter` (unchanged
/// server-side filter). "国・地域"/"通貨ペア" have no server-side filter
/// endpoint — implemented as a client-side filter over the already-fetched
/// `indicators` list (real countryCode/currencyCode fields already on
/// `IndicatorSummary`), not a new API. The reference's per-row release time
/// ("21:30") has no equivalent in `IndicatorSummary` (Indicators is
/// indicator metadata, not scheduled events) — omitted rather than
/// fabricated.
struct IndicatorsView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @Binding var path: NavigationPath
    private let apiClient: APIClient

    @State private var countryFilter: String?
    @State private var currencyFilter: String?

    init(apiClient: APIClient, path: Binding<NavigationPath>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorsViewModel(apiClient: apiClient))
        _path = path
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                FXAppBackground()
                content
            }
            .navigationTitle("指標一覧")
            .searchable(text: $viewModel.searchText, prompt: "指標名・国名で検索")
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
            }
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
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
                        LazyVStack(spacing: 10) {
                            ForEach(filtered) { indicator in
                                NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                                    IndicatorRow(indicator: FXIndicatorUI(indicator: indicator))
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                case .error(let message):
                    ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 24).frame(maxWidth: 900)
        }
    }

    private var filterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                filterChip(title: "すべて", isSelected: viewModel.importanceFilter == nil && countryFilter == nil && currencyFilter == nil) {
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
                    filterChipLabel(title: "重要度", isSelected: viewModel.importanceFilter != nil)
                }
                Menu {
                    Button("すべて") { countryFilter = nil }
                    ForEach(availableCountries, id: \.self) { code in
                        Button("\(CountryFlag.emoji(for: code)) \(code)") { countryFilter = code }
                    }
                } label: {
                    filterChipLabel(title: "国・地域", isSelected: countryFilter != nil)
                }
                Menu {
                    Button("すべて") { currencyFilter = nil }
                    ForEach(availableCurrencies, id: \.self) { code in
                        Button(code) { currencyFilter = code }
                    }
                } label: {
                    filterChipLabel(title: "通貨ペア", isSelected: currencyFilter != nil)
                }
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

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { filterChipLabel(title: title, isSelected: isSelected) }.buttonStyle(.plain)
    }

    private func filterChipLabel(title: String, isSelected: Bool) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(isSelected ? FXColor.cyan.opacity(0.16) : FXColor.card)
            .foregroundStyle(isSelected ? FXColor.cyan : FXColor.secondaryText)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(isSelected ? FXColor.cyan.opacity(0.4) : FXColor.border, lineWidth: 1))
    }
}

/// Not `private` — reused by `SearchView`, exactly as HQ's own
/// `SearchView.swift` reuses `IndicatorsView.swift`'s `IndicatorRow`.
struct IndicatorRow: View {
    let indicator: FXIndicatorUI
    var body: some View {
        HStack(spacing: 14) {
            Text(CountryFlag.emoji(for: indicator.country)).font(.system(size: 28))
            VStack(alignment: .leading, spacing: 6) {
                Text("\(CountryFlag.kanjiAbbreviation(for: indicator.country))) \(indicator.name) (\(indicator.code))")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(indicator.currency).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Spacer()
            FXBadge(text: indicator.importance.capitalized, tint: importanceTint)
        }.padding(16).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(FXColor.border))
    }

    private var importanceTint: Color {
        switch indicator.importance {
        case "HIGH": return FXColor.red
        case "MEDIUM": return FXColor.green
        default: return FXColor.blue
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
