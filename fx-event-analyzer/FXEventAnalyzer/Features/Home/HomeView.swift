import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Phase 3 §4: real `GET /home` data —
/// "今日の注目イベント" (SCHEDULED) / "主要通貨ペアの動向" (major_fx) /
/// "最近のイベント" (RELEASED), each event tappable to SCR-004 Event
/// Detail.
struct HomeView: View {
    @StateObject private var viewModel: HomeViewModel
    @Binding var path: NavigationPath
    private let apiClient: APIClient

    init(apiClient: APIClient, path: Binding<NavigationPath>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: HomeViewModel(apiClient: apiClient))
        _path = path
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
                content
            }
            .navigationTitle("FX Event Analyzer")
            .toolbarBackground(DesignTokens.Colors.backgroundPrimary, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
            }
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
        case .loaded(let events, let majorFx) where events.isEmpty && majorFx.isEmpty:
            EmptyStateView(
                title: "本日のイベントはありません",
                message: "本日発表予定の経済指標はありません。",
                systemImage: "calendar"
            )
        case .loaded:
            loadedList
        case .error(let message):
            ErrorView(
                title: "読み込みに失敗しました",
                message: message,
                onRetry: { viewModel.load() }
            )
        }
    }

    private var loadedList: some View {
        List {
            if !viewModel.upcomingEvents.isEmpty {
                Section("今日の注目イベント") {
                    ForEach(viewModel.upcomingEvents) { event in
                        NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                            HomeEventRow(event: event)
                        }
                        .listRowBackground(DesignTokens.Colors.backgroundSurface)
                    }
                }
            }

            if !viewModel.majorFxList.isEmpty {
                Section("主要通貨ペアの動向") {
                    MajorFxRow(items: viewModel.majorFxList)
                        .listRowBackground(DesignTokens.Colors.backgroundSurface)
                }
            }

            if !viewModel.recentEvents.isEmpty {
                Section("最近のイベント") {
                    ForEach(viewModel.recentEvents) { event in
                        NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                            HomeEventRow(event: event)
                        }
                        .listRowBackground(DesignTokens.Colors.backgroundSurface)
                    }
                }
            }

            if viewModel.upcomingEvents.isEmpty && viewModel.recentEvents.isEmpty {
                Section {
                    Text("本日発表予定・発表済みの経済指標はありません。")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                        .listRowBackground(DesignTokens.Colors.backgroundSurface)
                }
            }
        }
        .scrollContentBackground(.hidden)
    }
}

/// ui-screens.md §5 SCR-001 イベントカード: 国旗/通貨/指標名/発表時刻/重要度/
/// Forecast/Previous/Actual/発表前・発表済み/カウントダウン/関連通貨ペア.
private struct HomeEventRow: View {
    let event: HomeEventSummary

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            HStack {
                Text(CountryFlag.emoji(for: event.countryCode))
                Text(event.currencyCode)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                Text(event.indicatorName)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                Spacer()
                Text(event.importance.starDisplay)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.accentPrimary)
            }

            HStack {
                Text(ValueFormat.time(event.releaseDatetime))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                if let countdown = ValueFormat.countdown(to: event.releaseDatetime), event.status == .scheduled {
                    Text(countdown)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.accentSecondary)
                }
                Spacer()
                statusBadge
            }

            switch event.dataStatus {
            case .dataPending:
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            case .dataUnavailable:
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.statusError)
            default:
                valuesRow
            }

            if !event.relatedFxPairs.isEmpty {
                Text(event.relatedFxPairs.map(\.symbol).joined(separator: " / "))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch event.status {
        case .scheduled:
            Text("発表前")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        case .released:
            Text("発表済み")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.accentPrimary)
        case .cancelled:
            Text("中止")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.statusError)
        }
    }

    private var valuesRow: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            valueLabel("予想", ValueFormat.number(event.forecast))
            valueLabel("前回", ValueFormat.number(event.previous))
            if event.status == .released {
                valueLabel("結果", ValueFormat.number(event.actual))
                if let surprise = event.surprise, let direction = event.surpriseDirection {
                    Text("Surprise \(ValueFormat.number(surprise, signed: true))")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(surpriseColor(direction))
                }
            } else {
                valueLabel("結果", "--")
            }
        }
    }

    private func valueLabel(_ title: String, _ value: String) -> some View {
        HStack(spacing: 2) {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Text(value)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        }
    }

    private func surpriseColor(_ direction: SurpriseDirection) -> Color {
        switch direction {
        case .positive: return DesignTokens.Colors.statusSuccess
        case .negative: return DesignTokens.Colors.statusError
        case .neutral: return DesignTokens.Colors.textSecondary
        }
    }
}

private struct MajorFxRow: View {
    let items: [MajorFxSummary]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DesignTokens.Spacing.md) {
                ForEach(items) { fx in
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                        Text(fx.symbol)
                            .font(DesignTokens.Typography.body)
                            .foregroundStyle(DesignTokens.Colors.textPrimary)
                        Text(ValueFormat.percent(fx.changePercent, signed: true))
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(color(for: fx.changePercent))
                    }
                }
            }
        }
    }

    private func color(for changePercent: Double?) -> Color {
        guard let changePercent else { return DesignTokens.Colors.textSecondary }
        if changePercent > 0 { return DesignTokens.Colors.statusSuccess }
        if changePercent < 0 { return DesignTokens.Colors.statusError }
        return DesignTokens.Colors.textSecondary
    }
}

private extension HomeViewModel {
    var majorFxList: [MajorFxSummary] {
        guard case .loaded(_, let majorFx) = state else { return [] }
        return majorFx
    }
}
