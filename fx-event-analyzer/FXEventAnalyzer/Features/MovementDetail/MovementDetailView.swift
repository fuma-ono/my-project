import Charts
import SwiftUI

/// SCR-005 Movement Detail (ui-screens.md §5, HQ Phase 4 instruction) —
/// "発表前後にFX相場が実際にどれくらい動いたのか確認する". Timeframe
/// Segmented Control (iOS標準UI) drives both the Reaction figures (already
/// fetched for every timeframe) and the Chart (re-fetched per timeframe).
///
/// Rebuilt under HQ's "UI全面再構築" instruction (2026-09-18, Phase UI-4) —
/// same `MovementDetailViewModel`/data contract; the chart is now visually
/// the anchor of the screen (elevated card, brand-tinted segmented
/// control), and every signed figure (movement/pips/変化率/最大上昇/
/// 最大下落) is colored by direction instead of uniform white text — HQ:
/// "色によって情報の重要度を表現する", not decoration for its own sake.
struct MovementDetailView: View {
    @StateObject private var viewModel: MovementDetailViewModel

    init(apiClient: APIClient, eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date) {
        _viewModel = StateObject(wrappedValue: MovementDetailViewModel(
            apiClient: apiClient,
            eventId: eventId,
            indicatorId: indicatorId,
            fxPairId: fxPairId,
            symbol: symbol,
            indicatorName: indicatorName,
            releaseDatetime: releaseDatetime
        ))
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content
        }
        .navigationTitle(viewModel.symbol)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(DesignTokens.Colors.backgroundPrimary, for: .navigationBar)
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            EmptyStateView(title: "Backendは準備中です", message: "値動き情報はまだ利用できません。", systemImage: "server.rack")
        case .notFound:
            EmptyStateView(title: "データが見つかりません", message: "指定されたイベント・通貨ペアの組み合わせが存在しません。", systemImage: "questionmark.circle")
        case .notEntitled:
            EmptyStateView(
                title: "この情報はご利用いただけません",
                message: "現在のプランでは値動き情報を閲覧できません。",
                systemImage: "lock.fill"
            )
        case .loaded(let preReleasePrice, let reactions):
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                    header
                    timeframePicker
                    adaptiveBody(preReleasePrice: preReleasePrice, reactions: reactions)
                    historicalComparisonLink
                }
                .padding(DesignTokens.Spacing.md)
                .adaptiveContentWidth()
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    /// iPad: chart and reaction figures side-by-side so the chart doesn't
    /// stretch edge-to-edge; iPhone: stacked (HQ Phase 4 §16).
    @ViewBuilder
    private func adaptiveBody(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry]) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: DesignTokens.Spacing.lg) {
                chartSection
                    .frame(width: 420)
                reactionSection(preReleasePrice: preReleasePrice, reactions: reactions)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                chartSection
                reactionSection(preReleasePrice: preReleasePrice, reactions: reactions)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(viewModel.indicatorName)
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            HStack {
                Text(viewModel.symbol)
                    .font(DesignTokens.Typography.bodyEmphasized)
                    .foregroundStyle(DesignTokens.Colors.accentPrimary)
                Text(ValueFormat.dateTime(viewModel.releaseDatetime))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
    }

    private var timeframePicker: some View {
        Picker("時間軸", selection: $viewModel.selectedTimeframe) {
            ForEach(ReactionTimeframe.all, id: \.self) { timeframe in
                Text(timeframe).tag(timeframe)
            }
        }
        .pickerStyle(.segmented)
        .tint(DesignTokens.Colors.accentPrimary)
    }

    /// Phase 4.5 UX audit: "このイベントでこれだけ動いた → 過去はどうだった？"
    /// was previously a dead end from this screen — HQ Phase 5 §3 closes it,
    /// reusing this event's indicator/FX pair so the user never re-searches.
    private var historicalComparisonLink: some View {
        NavigationLink(value: AppRoute.historicalComparison(
            indicatorId: viewModel.indicatorId,
            indicatorName: viewModel.indicatorName,
            fxPairId: viewModel.fxPairId,
            fxPairSymbol: viewModel.symbol
        )) {
            FXActionRow(title: "過去の値動きと比較する", systemImage: "chart.bar.xaxis")
        }
    }

    // MARK: - Chart

    @ViewBuilder
    private var chartSection: some View {
        switch viewModel.chartState {
        case .loading:
            LoadingView(caption: "チャートを読み込み中...")
                .frame(height: 220)
        case .empty:
            EmptyStateView(title: "チャートデータがありません", message: "この時間軸のチャートデータはまだ取得されていません。", systemImage: "chart.xyaxis.line")
                .frame(height: 220)
        case .error(let message):
            ErrorView(title: "チャート取得に失敗しました", message: message, onRetry: { viewModel.retryChart() })
                .frame(height: 220)
        case .loaded(let chart):
            MovementChartView(chart: chart)
        }
    }

    // MARK: - Reaction figures

    private func reactionSection(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            MetricRow(title: "発表前価格", value: ValueFormat.number(preReleasePrice, fractionDigits: 3))
                .fxCard(.surface)
            if let selected = reactions.first(where: { $0.timeframe == viewModel.selectedTimeframe }) {
                reactionCard(selected)
            }
        }
    }

    @ViewBuilder
    private func reactionCard(_ reaction: ReactionTimeframeEntry) -> some View {
        switch reaction.analysisStatus {
        case .ready:
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
                MetricRow(title: "発表後価格", value: ValueFormat.number(reaction.postReleasePrice, fractionDigits: 3))
                MetricRow(
                    title: "変動幅 (Movement)",
                    value: ValueFormat.number(reaction.movement, fractionDigits: 3, signed: true),
                    valueColor: DesignTokens.Colors.directional(reaction.movement)
                )
                MetricRow(
                    title: "Pips",
                    value: ValueFormat.pips(reaction.pips),
                    valueColor: DesignTokens.Colors.directional(reaction.pips)
                )
                MetricRow(
                    title: "変化率 (%)",
                    value: ValueFormat.percent(reaction.changePercent, signed: true),
                    valueColor: DesignTokens.Colors.directional(reaction.changePercent)
                )
                Divider().background(DesignTokens.Colors.borderSubtle)
                MetricRow(
                    title: "最大上昇",
                    value: ValueFormat.number(reaction.maxUpward, fractionDigits: 3, signed: true),
                    valueColor: DesignTokens.Colors.statusSuccess
                )
                MetricRow(title: "最大上昇 Pips", value: ValueFormat.pips(reaction.maxUpwardPips), valueColor: DesignTokens.Colors.statusSuccess)
                MetricRow(
                    title: "最大下落",
                    value: ValueFormat.number(reaction.maxDownward, fractionDigits: 3, signed: true),
                    valueColor: DesignTokens.Colors.statusError
                )
                MetricRow(title: "最大下落 Pips", value: ValueFormat.pips(reaction.maxDownwardPips), valueColor: DesignTokens.Colors.statusError)
            }
            .fxCard(.surface)
        case .dataPending, .dataUnavailable, .notAnalyzable:
            Text(reaction.analysisStatus.label)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .fxCard(.surface)
        }
    }
}

/// Price line + Release marker + pre/post shading (HQ Phase 4 §6). No
/// candlestick rendering — a close-price line is enough to answer "how did
/// it move before/after" without adding decoration HQ asked us to avoid.
private struct MovementChartView: View {
    let chart: ChartResponse

    /// Explicit y-bounds (rather than an omitted-y overload whose fill
    /// behavior isn't worth guessing at) — a hair outside the plotted
    /// price range so the shading reaches the chart's true edges.
    private var priceBounds: (low: Double, high: Double) {
        let values = chart.prices.map(\.close)
        guard let low = values.min(), let high = values.max() else { return (0, 1) }
        guard low < high else { return (low - 0.001, high + 0.001) }
        let padding = (high - low) * 0.05
        return (low - padding, high + padding)
    }

    var body: some View {
        Chart {
            if let first = chart.prices.first?.timestamp {
                RectangleMark(
                    xStart: .value("Start", first),
                    xEnd: .value("Release", chart.releaseDatetime),
                    yStart: .value("Low", priceBounds.low),
                    yEnd: .value("High", priceBounds.high)
                )
                .foregroundStyle(DesignTokens.Colors.backgroundPrimary.opacity(0.5))
            }
            if let last = chart.prices.last?.timestamp {
                RectangleMark(
                    xStart: .value("Release", chart.releaseDatetime),
                    xEnd: .value("End", last),
                    yStart: .value("Low", priceBounds.low),
                    yEnd: .value("High", priceBounds.high)
                )
                .foregroundStyle(DesignTokens.Colors.accentPrimary.opacity(0.10))
            }

            ForEach(chart.prices) { point in
                LineMark(
                    x: .value("Time", point.timestamp),
                    y: .value("Price", point.close)
                )
                .foregroundStyle(DesignTokens.Colors.accentPrimary)
                .interpolationMethod(.monotone)
            }

            RuleMark(x: .value("Release", chart.releaseDatetime))
                .foregroundStyle(DesignTokens.Colors.accentSecondary)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                .annotation(position: .top, alignment: .center) {
                    Text("発表時刻")
                        .font(DesignTokens.Typography.footnote)
                        .foregroundStyle(.white)
                        .padding(.horizontal, DesignTokens.Spacing.sm)
                        .padding(.vertical, 3)
                        .background(DesignTokens.Colors.accentSecondary, in: Capsule())
                }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine().foregroundStyle(DesignTokens.Colors.borderSubtle)
                AxisValueLabel(format: .dateTime.hour().minute())
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine().foregroundStyle(DesignTokens.Colors.borderSubtle)
                AxisValueLabel()
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .frame(height: 240)
        .fxCard(.elevated)
    }
}
