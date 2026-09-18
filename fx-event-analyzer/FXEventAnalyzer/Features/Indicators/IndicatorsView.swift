import SwiftUI

/// SCR-002 Indicators (ui-screens.md §5): browse indicators, tap through to
/// SCR-003 Indicator Detail.
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
                DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
                content
            }
            .navigationTitle("Indicators")
            .toolbarBackground(DesignTokens.Colors.backgroundPrimary, for: .navigationBar)
            .searchable(text: $viewModel.searchText, prompt: "指標名・コードで検索")
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
            }
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            importanceFilterRow
            switch viewModel.state {
            case .loading:
                LoadingView(caption: "読み込み中...")
            case .backendNotConfigured:
                EmptyStateView(
                    title: "Backendは準備中です",
                    message: "経済指標データはまだ利用できません。",
                    systemImage: "server.rack"
                )
            case .loaded(let indicators) where indicators.isEmpty:
                EmptyStateView(
                    title: "指標が見つかりません",
                    message: "条件に一致する経済指標がありません。",
                    systemImage: "magnifyingglass"
                )
            case .loaded(let indicators):
                List(indicators) { indicator in
                    NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                        IndicatorRow(indicator: indicator)
                    }
                    .listRowBackground(DesignTokens.Colors.backgroundSurface)
                }
                .scrollContentBackground(.hidden)
            case .error(let message):
                ErrorView(
                    title: "読み込みに失敗しました",
                    message: message,
                    onRetry: { viewModel.load() }
                )
            }
        }
    }

    private var importanceFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DesignTokens.Spacing.sm) {
                filterChip(title: "すべて", isSelected: viewModel.importanceFilter == nil) {
                    viewModel.importanceFilter = nil
                }
                filterChip(title: "重要度: 高", isSelected: viewModel.importanceFilter == .high) {
                    viewModel.importanceFilter = .high
                }
                filterChip(title: "重要度: 中", isSelected: viewModel.importanceFilter == .medium) {
                    viewModel.importanceFilter = .medium
                }
                filterChip(title: "重要度: 低", isSelected: viewModel.importanceFilter == .low) {
                    viewModel.importanceFilter = .low
                }
            }
            .padding(.horizontal, DesignTokens.Spacing.md)
            .padding(.vertical, DesignTokens.Spacing.sm)
        }
    }

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .padding(.horizontal, DesignTokens.Spacing.sm)
                .padding(.vertical, DesignTokens.Spacing.xs)
                .background(isSelected ? DesignTokens.Colors.accentPrimary : DesignTokens.Colors.backgroundSurface)
                .foregroundStyle(isSelected ? Color.black : DesignTokens.Colors.textPrimary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct IndicatorRow: View {
    let indicator: IndicatorSummary

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            HStack {
                Text(CountryFlag.emoji(for: indicator.countryCode))
                Text(indicator.currencyCode)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                Text(indicator.name)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                Spacer()
                Text(indicator.importance.starDisplay)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.accentPrimary)
            }
            if let description = indicator.description, !description.isEmpty {
                Text(description)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }
}
