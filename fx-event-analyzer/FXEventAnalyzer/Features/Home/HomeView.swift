import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Phase 3 §4: real `GET /home` data —
/// "今日の注目イベント" (SCHEDULED + RELEASED, one time-ordered list) /
/// "主要通貨ペアの動向" (major_fx), each event tappable to SCR-004 Event
/// Detail.
///
/// Rebuilt under HQ's "Reference画像の完全再現" instruction (2026-09-18):
/// this screen is no longer a design interpretation of ui-screens.md — it
/// is a literal reproduction of `mockups/screens-overview-dark-v1.png`'s
/// SCR-001 panel, pixel-sampled rather than guessed (see
/// `DesignTokens.Colors.Home` for the sampled values and why each one
/// needed its own token). Same `HomeViewModel`/data contract as before;
/// only the View changed.
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
                DesignTokens.Colors.Home.background.ignoresSafeArea()
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

                if !viewModel.todaysEvents.isEmpty {
                    todaysEventsSection
                }

                if !viewModel.majorFxList.isEmpty {
                    majorFxSection
                }

                if viewModel.todaysEvents.isEmpty {
                    Text("本日発表予定・発表済みの経済指標はありません。")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
                }
            }
            .padding(DesignTokens.Spacing.md)
            .padding(.top, DesignTokens.Spacing.sm)
            .adaptiveContentWidth()
        }
    }

    // MARK: - Header

    /// Custom brand header, not `.navigationTitle` — the Reference's bold
    /// two-tone wordmark isn't achievable with the system nav bar's title
    /// styling, and Home is a tab root with nothing to navigate back from.
    /// The bell is deliberately not a button: notifications aren't a Phase
    /// 5 feature, and an inert tap target is worse than none at all.
    private var header: some View {
        HStack {
            (
                Text("FX")
                    .foregroundStyle(DesignTokens.Colors.Home.accent)
                    + Text(" Event Analyzer")
                    .foregroundStyle(DesignTokens.Colors.Home.primaryText)
            )
            .font(DesignTokens.Typography.title)

            Spacer()

            Image(systemName: "bell")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(DesignTokens.Colors.Home.accent)
                .accessibilityHidden(true)
        }
    }

    // MARK: - 今日の注目イベント (hero)

    /// The Reference renders this as one time-ordered list mixing
    /// already-released and still-upcoming events, distinguished only by
    /// each row's status badge — not as two separate sections. A faint
    /// world-map dot-matrix texture sits behind the title/date only, fading
    /// out before the event rows (see `HeroMapTexture`).
    private var todaysEventsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                HeroMapTexture()
                    .frame(height: 92)
                VStack(alignment: .leading, spacing: 2) {
                    Text("今日の注目イベント")
                        .font(DesignTokens.Typography.headline)
                        .foregroundStyle(DesignTokens.Colors.Home.primaryText)
                    Text(Self.todayLabel())
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
                }
                .padding(DesignTokens.Spacing.md)
            }

            VStack(spacing: 0) {
                ForEach(viewModel.todaysEvents) { event in
                    NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                        HomeEventRow(event: event)
                    }
                    .buttonStyle(.plain)
                    if event.id != viewModel.todaysEvents.last?.id {
                        Divider().background(DesignTokens.Colors.Home.divider)
                    }
                }
            }
            .padding(.horizontal, DesignTokens.Spacing.md)
            .padding(.bottom, DesignTokens.Spacing.sm)
        }
        .fxCard(.elevated, padding: 0)
    }

    private static func todayLabel() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "M月d日 (E)"
        formatter.locale = Locale(identifier: "ja_JP")
        return formatter.string(from: Date())
    }

    // MARK: - 主要通貨ペアの動向

    /// The Reference shows this as one card with each major pair as an
    /// equal-width column (symbol / price / change%), not the individually
    /// scrollable chip cards the pre-Reference Home used.
    private var majorFxSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            SectionHeader(title: "主要通貨ペアの動向")
            HStack(spacing: DesignTokens.Spacing.sm) {
                ForEach(viewModel.majorFxList) { fx in
                    FxPairColumn(fx: fx)
                }
            }
            .fxCard(.surface)
        }
    }
}

/// ui-screens.md §5 SCR-001 イベントカード, reproducing the Reference's row
/// exactly: a circular flag badge (no caption underneath), time-or-currency
/// + indicator name + status badge on one line, "重要度" + a 2-slot star
/// rating + a trailing chevron on the next, then 予想/結果 only — no 前回,
/// no inline Surprise, no related-FX-pair list (all still shown on Event
/// Detail, just not here).
private struct HomeEventRow: View {
    let event: HomeEventSummary

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.sm) {
            flagBadge

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.xs) {
                    Text(leadingLabel)
                        .font(DesignTokens.Typography.numericCaption)
                        .foregroundStyle(DesignTokens.Colors.Home.timeText)
                    Text(event.indicatorName)
                        .font(DesignTokens.Typography.bodyEmphasized)
                        .foregroundStyle(DesignTokens.Colors.Home.primaryText)
                        .lineLimit(1)
                    Spacer(minLength: DesignTokens.Spacing.sm)
                    statusBadge
                }

                HStack(spacing: 4) {
                    Text("重要度")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
                    StarRating(importance: event.importance)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
                }

                switch event.dataStatus {
                case .dataPending:
                    Text(event.dataStatus.label)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
                case .dataUnavailable:
                    Text(event.dataStatus.label)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.Home.negative)
                default:
                    valuesRow
                }
            }
        }
        .padding(.vertical, DesignTokens.Spacing.sm)
    }

    /// The Reference shows the exact release time for an EXACT-precision
    /// event (e.g. "21:30") but the currency code in that same slot for one
    /// whose time isn't precise (e.g. "USD") — derived from the real
    /// `releaseDatetimePrecision` field already on `HomeEventSummary`, not
    /// a new one.
    private var leadingLabel: String {
        event.releaseDatetimePrecision == .exact
            ? ValueFormat.time(event.releaseDatetime)
            : event.currencyCode
    }

    private var flagBadge: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.Colors.Home.surface)
                .frame(width: 44, height: 44)
                .shadow(color: DesignTokens.Colors.Home.accent.opacity(0.35), radius: 6)
            Text(CountryFlag.emoji(for: event.countryCode))
                .font(.system(size: 20))
        }
        .frame(width: 44, height: 44)
    }

    /// Exactly one badge per row, per the Reference — a released event
    /// shows only "発表済み" (red), a scheduled one shows only its
    /// countdown text itself (deep blue), never both a status pill and a
    /// separate countdown label.
    private var statusBadge: some View {
        switch event.status {
        case .scheduled:
            return FXBadge(text: ValueFormat.countdown(to: event.releaseDatetime) ?? "発表前", tone: .scheduled)
        case .released:
            return FXBadge(text: "発表済み", tone: .negative)
        case .cancelled:
            return FXBadge(text: "中止", tone: .neutral)
        }
    }

    private var valuesRow: some View {
        HStack(spacing: DesignTokens.Spacing.lg) {
            valueLabel("予想", ValueFormat.number(event.forecast))
            valueLabel("結果", event.status == .released ? ValueFormat.number(event.actual) : "--")
        }
    }

    private func valueLabel(_ title: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
            Text(value)
                .font(DesignTokens.Typography.numericBody)
                .foregroundStyle(DesignTokens.Colors.Home.primaryText)
        }
    }
}

/// One column of the Major FX Pairs card: symbol / price / change%,
/// matching the Reference's column layout exactly (no per-pair chip card).
private struct FxPairColumn: View {
    let fx: MajorFxSummary

    /// JPY-quoted pairs conventionally show 2 decimal places, others 4
    /// (the Reference: USD/JPY "149.32", EUR/USD "1.0824") — a real FX
    /// market convention read off the pair's own symbol, not a hardcoded
    /// number.
    private var fractionDigits: Int {
        fx.symbol.contains("JPY") ? 2 : 4
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(fx.symbol)
                .font(DesignTokens.Typography.captionEmphasized)
                .foregroundStyle(DesignTokens.Colors.Home.secondaryText)
            Text(ValueFormat.number(fx.price, fractionDigits: fractionDigits))
                .font(DesignTokens.Typography.numericMedium)
                .foregroundStyle(DesignTokens.Colors.Home.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(ValueFormat.percent(fx.changePercent, signed: true))
                .font(DesignTokens.Typography.numericCaption)
                .foregroundStyle(changeColor)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var changeColor: Color {
        guard let change = fx.changePercent else { return DesignTokens.Colors.Home.secondaryText }
        return change >= 0 ? DesignTokens.Colors.Home.positive : DesignTokens.Colors.Home.negative
    }
}

private extension HomeViewModel {
    var majorFxList: [MajorFxSummary] {
        guard case .loaded(_, let majorFx) = state else { return [] }
        return majorFx
    }

    /// The Reference's hero card shows upcoming (SCHEDULED) and
    /// already-released (RELEASED) events together in one time-ordered
    /// list, told apart only by their status badge — not as two separate
    /// sections. `upcomingEvents`/`recentEvents` are untouched (still the
    /// ViewModel's own split); this only recombines them for display.
    var todaysEvents: [HomeEventSummary] {
        (upcomingEvents + recentEvents).sorted { $0.releaseDatetime < $1.releaseDatetime }
    }
}
