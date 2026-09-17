import SwiftUI

/// SCR-006 Historical Comparison (ui-screens.md §5). Reached from SCR-003
/// Indicator Detail's related FX pair list. Advanced Statistics uses the
/// existing partial-gating contract — a FREE user still sees the whole
/// screen, never a 403.
struct HistoricalComparisonView: View {
    @StateObject private var viewModel: HistoricalComparisonViewModel

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String) {
        _viewModel = StateObject(wrappedValue: HistoricalComparisonViewModel(
            apiClient: apiClient,
            indicatorId: indicatorId,
            indicatorName: indicatorName,
            fxPairId: fxPairId,
            fxPairSymbol: fxPairSymbol
        ))
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content
        }
        .navigationTitle("過去の比較")
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
            EmptyStateView(title: "Backendは準備中です", message: "過去の比較データはまだ利用できません。", systemImage: "server.rack")
        case .notFound:
            EmptyStateView(title: "データが見つかりません", message: "指定された指標・通貨ペアの組み合わせが存在しません。", systemImage: "questionmark.circle")
        case .notEntitled:
            EmptyStateView(
                title: "この情報はご利用いただけません",
                message: "現在のプランでは過去の比較データを閲覧できません。",
                systemImage: "lock.fill"
            )
        case .loaded(let response):
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                    header
                    timeframePicker
                    statsSection(response)
                    advancedStatisticsSection(response.advancedStatistics)
                    eventsSection(response.events)
                }
                .padding(DesignTokens.Spacing.md)
                .adaptiveContentWidth()
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(viewModel.indicatorName)
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text(viewModel.fxPairSymbol)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.accentPrimary)
        }
    }

    private var timeframePicker: some View {
        Picker("時間軸", selection: $viewModel.selectedTimeframe) {
            ForEach(ReactionTimeframe.all, id: \.self) { timeframe in
                Text(timeframe).tag(timeframe)
            }
        }
        .pickerStyle(.segmented)
    }

    private func statsSection(_ response: ComparisonResponse) -> some View {
        card {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
                Text("分析可能 \(response.analyzableEvents) / 全 \(response.totalEvents) 件")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                metadataRow(title: "平均変動幅", value: ValueFormat.number(response.stats.averageMovement, fractionDigits: 3, signed: true))
                metadataRow(title: "平均 Pips", value: ValueFormat.pips(response.stats.averagePips))
                metadataRow(title: "最大変動", value: ValueFormat.number(response.stats.maxMovement, fractionDigits: 3, signed: true))
                metadataRow(title: "最小変動", value: ValueFormat.number(response.stats.minMovement, fractionDigits: 3, signed: true))
                Divider().background(DesignTokens.Colors.borderSubtle)
                HStack(spacing: DesignTokens.Spacing.lg) {
                    countColumn(title: "上昇", value: response.stats.upwardCount, color: DesignTokens.Colors.statusSuccess)
                    countColumn(title: "下落", value: response.stats.downwardCount, color: DesignTokens.Colors.statusError)
                    countColumn(title: "変化なし", value: response.stats.noChangeCount, color: DesignTokens.Colors.textSecondary)
                }
            }
        }
    }

    @ViewBuilder
    private func advancedStatisticsSection(_ advanced: AdvancedStatistics) -> some View {
        card {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
                Text("詳細統計 (Advanced Statistics)")
                    .font(DesignTokens.Typography.headline)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                if advanced.available, let data = advanced.data {
                    metadataRow(title: "平均絶対変動幅", value: ValueFormat.number(data.averageAbsoluteMovement, fractionDigits: 3))
                    metadataRow(title: "平均絶対 Pips", value: ValueFormat.pips(data.averageAbsolutePips, signed: false))
                } else {
                    Text("この統計はPro会員限定です。")
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            }
        }
    }

    private func eventsSection(_ events: [ComparisonEventSummary]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("過去のイベント")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            if events.isEmpty {
                Text("比較対象のイベントはまだありません。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else {
                ForEach(events) { event in
                    eventRow(event)
                }
            }
        }
    }

    private func eventRow(_ event: ComparisonEventSummary) -> some View {
        HStack {
            Text(ValueFormat.dateTime(event.releaseDatetime))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Spacer()
            if let surprise = event.surprise {
                Text("Surprise \(ValueFormat.number(surprise, signed: true))")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
            } else {
                Text("--")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .padding(.vertical, DesignTokens.Spacing.sm)
        .padding(.horizontal, DesignTokens.Spacing.md)
        .background(DesignTokens.Colors.backgroundSurface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
    }

    private func metadataRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Spacer()
            Text(value)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        }
    }

    private func countColumn(title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Text("\(value)")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(color)
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.md)
            .background(DesignTokens.Colors.backgroundSurface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.card))
    }
}
