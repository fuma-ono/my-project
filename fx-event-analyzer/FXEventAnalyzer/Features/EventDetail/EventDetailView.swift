import SwiftUI

/// SCR-004 Event Detail (ui-screens.md §5, H-1) — "予想と結果、その結果に
/// よる相場の反応を一画面で理解する". Display order is fixed by H-1:
/// 指標名/国地域/通貨/重要度/発表日時 → Forecast/Actual/Previous → Surprise
/// → 乖離理由 → 市場への影響 → 関連FXペア/Reaction.
struct EventDetailView: View {
    @StateObject private var viewModel: EventDetailViewModel

    init(apiClient: APIClient, eventId: String) {
        _viewModel = StateObject(wrappedValue: EventDetailViewModel(apiClient: apiClient, eventId: eventId))
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content
        }
        .navigationTitle("イベント詳細")
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
            EmptyStateView(title: "Backendは準備中です", message: "イベント情報はまだ利用できません。", systemImage: "server.rack")
        case .notFound:
            EmptyStateView(title: "イベントが見つかりません", message: "指定されたイベントは存在しません。", systemImage: "questionmark.circle")
        case .notEntitled:
            EmptyStateView(
                title: "この情報はご利用いただけません",
                message: "現在のプランではこのイベント情報を閲覧できません。",
                systemImage: "lock.fill"
            )
        case .loaded(let response):
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                    header(response.event)
                    forecastActualPreviousSection(response)
                    if response.event.status == .released, response.event.dataStatus == .ready {
                        surpriseSection(response)
                    }
                    if let explanation = response.explanation {
                        explanationSection(explanation)
                    }
                    relatedFxPairsSection(response.relatedFxPairs, event: response.event)
                }
                .padding(DesignTokens.Spacing.md)
                .adaptiveContentWidth()
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    // MARK: - 指標名 / 国・地域 / 通貨 / 重要度 / 発表日時

    private func header(_ event: EventDetailEvent) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            HStack {
                Text(CountryFlag.emoji(for: event.countryCode))
                    .font(DesignTokens.Typography.title)
                VStack(alignment: .leading) {
                    Text(event.indicatorName)
                        .font(DesignTokens.Typography.headline)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                    Text(event.currencyCode)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
                Spacer()
                Text(event.importance.starDisplay)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.accentPrimary)
            }
            HStack {
                Text(ValueFormat.dateTime(event.releaseDatetime))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                statusBadge(event.status)
                if event.revisionStatus == .revised {
                    Text("改定あり")
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.accentSecondary)
                }
            }
        }
    }

    private func statusBadge(_ status: EventStatus) -> some View {
        Group {
            switch status {
            case .scheduled:
                Text("発表前").foregroundStyle(DesignTokens.Colors.textSecondary)
            case .released:
                Text("発表済み").foregroundStyle(DesignTokens.Colors.accentPrimary)
            case .cancelled:
                Text("中止").foregroundStyle(DesignTokens.Colors.statusError)
            }
        }
        .font(DesignTokens.Typography.caption)
    }

    // MARK: - Forecast / Actual / Previous

    @ViewBuilder
    private func forecastActualPreviousSection(_ response: EventDetailResponse) -> some View {
        let event = response.event
        card {
            switch event.dataStatus {
            case .dataPending:
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            case .dataUnavailable:
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.statusError)
            default:
                HStack(spacing: DesignTokens.Spacing.lg) {
                    valueColumn(title: "予想 (Forecast)", value: ValueFormat.number(response.snapshot?.forecast))
                    valueColumn(
                        title: "結果 (Actual)",
                        value: event.status == .released ? ValueFormat.number(response.snapshot?.actual) : "--"
                    )
                    valueColumn(title: "前回 (Previous)", value: ValueFormat.number(response.snapshot?.previous))
                }
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

    // MARK: - Surprise

    private func surpriseSection(_ response: EventDetailResponse) -> some View {
        card {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text("Surprise")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                if let surprise = response.analysis.surprise, let direction = response.analysis.surpriseDirection {
                    HStack {
                        Text(ValueFormat.number(surprise, signed: true))
                            .font(DesignTokens.Typography.headline)
                            .foregroundStyle(surpriseColor(direction))
                        Text(direction.label)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(surpriseColor(direction))
                    }
                } else {
                    Text("Forecastが存在しないため、Surprise分析対象外です。")
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            }
        }
    }

    private func surpriseColor(_ direction: SurpriseDirection) -> Color {
        switch direction {
        case .positive: return DesignTokens.Colors.statusSuccess
        case .negative: return DesignTokens.Colors.statusError
        case .neutral: return DesignTokens.Colors.textSecondary
        }
    }

    // MARK: - 乖離理由 (事実要約・出典URL)

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

    // MARK: - 市場への影響 / 関連FXペア・Reaction

    private func relatedFxPairsSection(_ pairs: [EventRelatedFxPair], event: EventDetailEvent) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("市場への影響 (関連通貨ペア)")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            if pairs.isEmpty {
                Text("関連する通貨ペアはありません。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else {
                ForEach(pairs) { pair in
                    NavigationLink(value: AppRoute.movementDetail(
                        eventId: event.id,
                        fxPairId: pair.fxPairId,
                        symbol: pair.symbol,
                        indicatorName: event.indicatorName,
                        releaseDatetime: event.releaseDatetime
                    )) {
                        reactionRow(pair)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func reactionRow(_ pair: EventRelatedFxPair) -> some View {
        HStack {
            Text(pair.symbol)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Spacer()
            switch pair.reaction.analysisStatus {
            case .ready:
                VStack(alignment: .trailing) {
                    Text(ValueFormat.pips(pair.reaction.pips))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                    Text(ValueFormat.percent(pair.reaction.changePercent, signed: true))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            default:
                Text(pair.reaction.analysisStatus.label)
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

    // MARK: - Shared card container

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.md)
            .background(DesignTokens.Colors.backgroundSurface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.card))
    }
}
