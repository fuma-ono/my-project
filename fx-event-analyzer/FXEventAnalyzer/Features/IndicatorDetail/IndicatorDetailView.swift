import SwiftUI

/// SCR-003 Indicator Detail (ui-screens.md §5) — "指標そのものを理解する"。
/// Distinct from SCR-004 Event Detail: no single event's Surprise is the
/// headline here, only the indicator's own metadata and a "最近の発表結果"
/// list that taps through to SCR-007.
struct IndicatorDetailView: View {
    @StateObject private var viewModel: IndicatorDetailViewModel

    init(apiClient: APIClient, indicatorId: String) {
        _viewModel = StateObject(wrappedValue: IndicatorDetailViewModel(apiClient: apiClient, indicatorId: indicatorId))
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content
        }
        .navigationTitle("指標詳細")
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
            EmptyStateView(title: "Backendは準備中です", message: "指標情報はまだ利用できません。", systemImage: "server.rack")
        case .loaded(let indicator, let relatedFxPairs, let recentEvents):
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                    header(indicator)
                    metadataSection(indicator)
                    if !relatedFxPairs.isEmpty {
                        relatedFxPairsSection(relatedFxPairs)
                    }
                    recentEventsSection(recentEvents)
                }
                .padding(DesignTokens.Spacing.md)
                .adaptiveContentWidth()
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func header(_ indicator: IndicatorSummary) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            HStack {
                Text(CountryFlag.emoji(for: indicator.countryCode))
                    .font(DesignTokens.Typography.title)
                VStack(alignment: .leading) {
                    Text(indicator.name)
                        .font(DesignTokens.Typography.headline)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                    Text("\(indicator.code) ・ \(indicator.currencyCode)")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
                Spacer()
            }
            Text(indicator.importance.starDisplay)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.accentPrimary)
        }
    }

    private func metadataSection(_ indicator: IndicatorSummary) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            if let description = indicator.description, !description.isEmpty {
                Text(description)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
            }
            metadataRow(title: "発表頻度", value: indicator.frequency)
            if let unit = indicator.unit {
                metadataRow(title: "単位", value: unit)
            }
            if let source = indicator.source {
                metadataRow(title: "出典", value: source)
            }
        }
        .padding(DesignTokens.Spacing.md)
        .background(DesignTokens.Colors.backgroundSurface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.card))
    }

    private func metadataRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Spacer()
            Text(value)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        }
    }

    private func relatedFxPairsSection(_ pairs: [RelatedFxPairSummary]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("関連通貨ペア")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            HStack {
                ForEach(pairs) { pair in
                    Text(pair.symbol)
                        .font(DesignTokens.Typography.caption)
                        .padding(.horizontal, DesignTokens.Spacing.sm)
                        .padding(.vertical, DesignTokens.Spacing.xs)
                        .background(DesignTokens.Colors.backgroundSurface)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                        .clipShape(Capsule())
                }
            }
        }
    }

    private func recentEventsSection(_ events: [IndicatorEventSummary]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("最近の発表結果")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            if events.isEmpty {
                Text("発表済みのデータはまだありません。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else {
                ForEach(events) { event in
                    NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                        RecentEventRow(event: event)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct RecentEventRow: View {
    let event: IndicatorEventSummary

    var body: some View {
        HStack {
            Text(ValueFormat.dateTime(event.releaseDatetime))
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Spacer()
            if event.dataStatus != .ready {
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else if let surprise = event.surprise {
                Text("Surprise \(ValueFormat.number(surprise, signed: true))")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
            } else {
                Text("Surprise分析対象外")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        }
        .padding(.vertical, DesignTokens.Spacing.sm)
        .padding(.horizontal, DesignTokens.Spacing.md)
        .background(DesignTokens.Colors.backgroundSurface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
    }
}
