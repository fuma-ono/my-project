import SwiftUI

/// SCR-007 Historical Event Detail (ui-screens.md §5): 指標/発表日時/
/// Forecast/Actual/Previous/Surprise/発表前後価格/pips/%、+必須の
/// 「指標詳細を見る」→ SCR-003 遷移.
struct HistoricalEventDetailView: View {
    @StateObject private var viewModel: HistoricalEventDetailViewModel

    init(apiClient: APIClient, eventId: String) {
        _viewModel = StateObject(wrappedValue: HistoricalEventDetailViewModel(apiClient: apiClient, eventId: eventId))
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content
        }
        .navigationTitle("過去のイベント")
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
            EmptyStateView(title: "Backendは準備中です", message: "過去のイベント情報はまだ利用できません。", systemImage: "server.rack")
        case .notFound:
            EmptyStateView(title: "イベントが見つかりません", message: "指定されたイベントは存在しません。", systemImage: "questionmark.circle")
        case .notEntitled:
            EmptyStateView(
                title: "この情報はご利用いただけません",
                message: "現在のプランでは過去のイベント情報を閲覧できません。",
                systemImage: "lock.fill"
            )
        case .loaded(let response):
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                    header(response.event)
                    snapshotSection(response.snapshot)
                    if let explanation = response.explanation {
                        explanationSection(explanation)
                    }
                    reactionsSection(response.relatedFxPairs, event: response.event, indicatorId: response.indicatorId)
                    NavigationLink(value: AppRoute.indicatorDetail(id: response.indicatorId)) {
                        Text("指標詳細を見る")
                            .font(DesignTokens.Typography.body)
                            .frame(maxWidth: .infinity)
                            .padding(DesignTokens.Spacing.md)
                            .background(DesignTokens.Colors.accentGradient)
                            .foregroundStyle(Color.black)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
                    }
                }
                .padding(DesignTokens.Spacing.md)
                .adaptiveContentWidth()
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func header(_ event: HistoricalEventSummary) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(event.indicatorName)
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            HStack {
                Text(ValueFormat.dateTime(event.releaseDatetime))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                Text(event.importance.starDisplay)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.accentPrimary)
            }
        }
    }

    @ViewBuilder
    private func snapshotSection(_ snapshot: HistoricalSnapshot?) -> some View {
        card {
            if let snapshot {
                HStack(spacing: DesignTokens.Spacing.lg) {
                    valueColumn(title: "予想", value: ValueFormat.number(snapshot.forecast))
                    valueColumn(title: "結果", value: ValueFormat.number(snapshot.actual))
                    valueColumn(title: "前回", value: ValueFormat.number(snapshot.previous))
                }
                if let surprise = snapshot.surprise, let direction = snapshot.surpriseDirection {
                    VStack(alignment: .leading, spacing: 2) {
                        if let comparisonLabel = ValueFormat.surpriseComparisonLabel(surprise) {
                            Text(comparisonLabel)
                                .font(DesignTokens.Typography.body)
                                .foregroundStyle(DesignTokens.Colors.textPrimary)
                        }
                        Text("Surprise \(ValueFormat.number(surprise, signed: true)) (\(direction.label))")
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(DesignTokens.Colors.textSecondary)
                    }
                } else {
                    Text("Forecastが存在しないため、Surprise分析対象外です。")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            } else {
                Text("データ未取得")
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
    }

    private func valueColumn(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Text(value)
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
        card {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
                Text("乖離理由")
                    .font(DesignTokens.Typography.headline)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                if let summary = explanation.summary {
                    Text(summary)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                }
                if let source = explanation.source, let urlString = explanation.sourceUrl, let url = URL(string: urlString) {
                    Link(destination: url) {
                        Text("出典: \(source)")
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(DesignTokens.Colors.accentSecondary)
                    }
                }
            }
        }
    }

    private func reactionsSection(_ pairs: [HistoricalRelatedFxPair], event: HistoricalEventSummary, indicatorId: String) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("値動き")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            if pairs.isEmpty {
                Text("値動きデータはまだありません。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else {
                ForEach(pairs) { pair in
                    // Phase 4.5 UX audit: past events had no way to reach
                    // the chart — HQ Phase 5 §6 makes this apply to
                    // historical events too, not only the live/current flow.
                    NavigationLink(value: AppRoute.movementDetail(
                        eventId: event.id,
                        indicatorId: indicatorId,
                        fxPairId: pair.fxPairId,
                        symbol: pair.symbol,
                        indicatorName: event.indicatorName,
                        releaseDatetime: event.releaseDatetime
                    )) {
                        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                            HStack {
                                Text(pair.symbol)
                                    .font(DesignTokens.Typography.body)
                                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                            }
                            ForEach(pair.reactions) { reaction in
                                reactionRow(reaction)
                            }
                        }
                        .padding(DesignTokens.Spacing.md)
                        .background(DesignTokens.Colors.backgroundSurface)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func reactionRow(_ reaction: HistoricalReaction) -> some View {
        HStack {
            Text(reaction.timeframe)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .frame(width: 40, alignment: .leading)
            Spacer()
            if reaction.analysisStatus == .ready {
                Text(ValueFormat.pips(reaction.pips))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                Text(ValueFormat.percent(reaction.changePercent, signed: true))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else {
                Text(reaction.analysisStatus.label)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
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
