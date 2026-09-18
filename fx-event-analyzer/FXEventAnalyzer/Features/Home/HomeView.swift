import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Phase 3 §4: real `GET /home` data —
/// "今日の注目イベント" (SCHEDULED) / "主要通貨ペアの動向" (major_fx) /
/// "最近のイベント" (RELEASED), each event tappable to SCR-004 Event
/// Detail.
///
/// Rebuilt under HQ's "UI全面再構築" instruction (2026-09-18, Phase UI-2):
/// same `HomeViewModel`/data contract, new visual structure — a custom
/// brand header (not the system nav bar), "今日の注目イベント" promoted to
/// an elevated hero card (the one thing this screen wants you to notice
/// first), and Major FX Pairs shown as real price + change cards instead
/// of a bare percentage. No new network calls; `MajorFxSummary.price` was
/// already being fetched and simply wasn't rendered before.
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
            .toolbar(.hidden, for: .navigationBar)
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
            loadedScroll
        case .error(let message):
            ErrorView(
                title: "読み込みに失敗しました",
                message: message,
                onRetry: { viewModel.load() }
            )
        }
    }

    private var loadedScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                header

                if !viewModel.upcomingEvents.isEmpty {
                    todaysEventsSection
                }

                if !viewModel.majorFxList.isEmpty {
                    majorFxSection
                }

                if !viewModel.recentEvents.isEmpty {
                    recentEventsSection
                }

                if viewModel.upcomingEvents.isEmpty && viewModel.recentEvents.isEmpty {
                    Text("本日発表予定・発表済みの経済指標はありません。")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            }
            .padding(DesignTokens.Spacing.md)
            .padding(.top, DesignTokens.Spacing.sm)
            .adaptiveContentWidth()
        }
    }

    // MARK: - Header

    /// Custom brand header, not `.navigationTitle` — the reference's bold
    /// two-tone wordmark isn't achievable with the system nav bar's title
    /// styling, and Home is a tab root with nothing to navigate back from.
    /// The bell is deliberately not a button: notifications aren't a Phase
    /// 5 feature, and an inert tap target is worse than none at all.
    private var header: some View {
        HStack {
            (
                Text("FX")
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
                    + Text(" Event Analyzer")
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
            )
            .font(DesignTokens.Typography.title)

            Spacer()

            Image(systemName: "bell")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .accessibilityHidden(true)
        }
    }

    // MARK: - 今日の注目イベント (hero)

    private var todaysEventsSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            SectionHeader(title: "今日の注目イベント", subtitle: Self.todayLabel())
            VStack(spacing: DesignTokens.Spacing.sm) {
                ForEach(viewModel.upcomingEvents) { event in
                    NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                        HomeEventRow(event: event)
                    }
                    .buttonStyle(.plain)
                    if event.id != viewModel.upcomingEvents.last?.id {
                        Divider().background(DesignTokens.Colors.borderSubtle)
                    }
                }
            }
        }
        .fxCard(.elevated)
    }

    private static func todayLabel() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "M月d日 (E)"
        formatter.locale = Locale(identifier: "ja_JP")
        return formatter.string(from: Date())
    }

    // MARK: - 主要通貨ペアの動向

    private var majorFxSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            SectionHeader(title: "主要通貨ペアの動向")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DesignTokens.Spacing.sm) {
                    ForEach(viewModel.majorFxList) { fx in
                        FxPairChip(fx: fx)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: - 最近のイベント

    private var recentEventsSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            SectionHeader(title: "最近のイベント")
            VStack(spacing: DesignTokens.Spacing.sm) {
                ForEach(viewModel.recentEvents) { event in
                    NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                        HomeEventRow(event: event)
                            .fxCard(.surface)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// ui-screens.md §5 SCR-001 イベントカード: 国旗/通貨/指標名/発表時刻/重要度/
/// Forecast/Previous/Actual/発表前・発表済み/カウントダウン/関連通貨ペア.
private struct HomeEventRow: View {
    let event: HomeEventSummary

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.sm) {
            VStack(spacing: 2) {
                Text(CountryFlag.emoji(for: event.countryCode))
                    .font(.system(size: 22))
                Text(event.currencyCode)
                    .font(DesignTokens.Typography.footnote)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
            .frame(width: 40)

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(ValueFormat.time(event.releaseDatetime))
                        .font(DesignTokens.Typography.numericCaption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                    Text(event.indicatorName)
                        .font(DesignTokens.Typography.bodyEmphasized)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    Text(event.importance.starDisplay)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.accentPrimary)
                }

                HStack(spacing: DesignTokens.Spacing.xs) {
                    statusBadge
                    if let countdown = ValueFormat.countdown(to: event.releaseDatetime), event.status == .scheduled {
                        Text(countdown)
                            .font(DesignTokens.Typography.footnote)
                            .foregroundStyle(DesignTokens.Colors.accentCyan)
                    }
                    Spacer()
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
                        .font(DesignTokens.Typography.footnote)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            }
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }

    private var statusBadge: some View {
        switch event.status {
        case .scheduled:
            return FXBadge(text: "発表前", tone: .neutral)
        case .released:
            return FXBadge(text: "発表済み", tone: .negative)
        case .cancelled:
            return FXBadge(text: "中止", tone: .neutral)
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
                        .font(DesignTokens.Typography.numericCaption)
                        .foregroundStyle(DesignTokens.Colors.directional(direction))
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
                .font(DesignTokens.Typography.numericCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        }
    }
}

/// A single Major FX Pair card: symbol, last price, and change% — the
/// price itself is new in this rebuild (the data was already fetched via
/// `MajorFxSummary.price`, just never shown).
private struct FxPairChip: View {
    let fx: MajorFxSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(fx.symbol)
                .font(DesignTokens.Typography.captionEmphasized)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Text(ValueFormat.number(fx.price, fractionDigits: 3))
                .font(DesignTokens.Typography.numericBody)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text(ValueFormat.percent(fx.changePercent, signed: true))
                .font(DesignTokens.Typography.numericCaption)
                .foregroundStyle(DesignTokens.Colors.directional(fx.changePercent))
        }
        .frame(minWidth: 104, alignment: .leading)
        .fxCard(.surface, padding: DesignTokens.Spacing.sm)
    }
}
