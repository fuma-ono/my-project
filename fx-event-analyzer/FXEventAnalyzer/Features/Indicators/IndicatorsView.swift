import SwiftUI

/// SCR-002 Indicators (ui-screens.md §5): browse indicators, tap through to
/// SCR-003 Indicator Detail.
///
/// HQ Frontend integration (2026-09-21): visual content — page header, row
/// styling — is HQ's `FXEventAnalyzer_HQFrontend/IndicatorsView.swift`.
/// Two adaptations, both wiring not redesign: HQ's `.searchable` bound to a
/// local `@State` that only filtered its own `FXDemo` array is rewired to
/// the real `IndicatorsViewModel.searchText` (server-side, debounced search
/// — the existing data-fetch behavior); and the existing importance-filter
/// chips (すべて/高/中/低, driving `viewModel.importanceFilter`) are kept —
/// HQ's mockup had no filter row at all, but dropping a working filter
/// wasn't asked for, so it's re-added in HQ's own chip/typography style.
struct IndicatorsView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @Binding var path: NavigationPath
    private let apiClient: APIClient

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
            .navigationTitle("Indicators")
            .searchable(text: $viewModel.searchText, prompt: "指標名・コードで検索")
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
                pageHeader
                importanceFilterRow
                switch viewModel.state {
                case .loading:
                    LoadingView(caption: "読み込み中...")
                case .backendNotConfigured:
                    FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。")
                case .loaded(let indicators) where indicators.isEmpty:
                    FXEmptyState(icon: "magnifyingglass", title: "指標が見つかりません", message: "条件に一致する経済指標がありません。")
                case .loaded(let indicators):
                    LazyVStack(spacing: 10) {
                        ForEach(indicators) { indicator in
                            NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                                IndicatorRow(indicator: FXIndicatorUI(indicator: indicator))
                            }.buttonStyle(.plain)
                        }
                    }
                case .error(let message):
                    ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 24).frame(maxWidth: 900)
        }
    }

    private var pageHeader: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("ECONOMIC CALENDAR").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(FXColor.cyan)
            Text("経済指標").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text("指標を選ぶと、過去イベントとFX反応を確認できます").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
        }
    }

    private var importanceFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                filterChip(title: "すべて", isSelected: viewModel.importanceFilter == nil) { viewModel.importanceFilter = nil }
                filterChip(title: "重要度: 高", isSelected: viewModel.importanceFilter == .high) { viewModel.importanceFilter = .high }
                filterChip(title: "重要度: 中", isSelected: viewModel.importanceFilter == .medium) { viewModel.importanceFilter = .medium }
                filterChip(title: "重要度: 低", isSelected: viewModel.importanceFilter == .low) { viewModel.importanceFilter = .low }
            }
        }
    }

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(isSelected ? FXColor.cyan.opacity(0.16) : FXColor.card)
                .foregroundStyle(isSelected ? FXColor.cyan : FXColor.secondaryText)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(isSelected ? FXColor.cyan.opacity(0.4) : FXColor.border, lineWidth: 1))
        }.buttonStyle(.plain)
    }
}

/// Not `private` — reused by `SearchView`, exactly as HQ's own
/// `SearchView.swift` reuses `IndicatorsView.swift`'s `IndicatorRow`.
struct IndicatorRow: View {
    let indicator: FXIndicatorUI
    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(indicator.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    FXBadge(text: indicator.code, tint: FXColor.secondaryText)
                }
                Text("\(indicator.country) · \(indicator.currency)").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Spacer()
            FXBadge(text: indicator.importance, tint: indicator.importance == "HIGH" ? FXColor.pink : FXColor.cyan)
            Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(FXColor.tertiaryText)
        }.padding(16).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(FXColor.border))
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
