import SwiftUI

/// SCR-001 Home (ui-screens.md 5章) — Phase 1 shell only. Layout/list rows
/// for Forecast/Actual/Previous/countdown etc. (features.md FEAT-001〜011)
/// arrive in Phase 2/3 once a Backend exists to source them from.
struct HomeView: View {
    @StateObject private var viewModel: HomeViewModel

    init(viewModel: @autoclosure @escaping () -> HomeViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
                content
            }
            .navigationTitle("FX Event Analyzer")
            .toolbarBackground(DesignTokens.Colors.backgroundPrimary, for: .navigationBar)
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            EmptyStateView(
                title: "Backendは準備中です",
                message: "経済指標データはまだ利用できません。実装が完了次第、ここに表示されます。",
                systemImage: "server.rack"
            )
        case .loaded(let events) where events.isEmpty:
            EmptyStateView(
                title: "本日のイベントはありません",
                message: "本日発表予定の経済指標はありません。",
                systemImage: "calendar"
            )
        case .loaded(let events):
            List(events) { event in
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                    Text(event.indicatorName)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                    Text(event.status)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
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
