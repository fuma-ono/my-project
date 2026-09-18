import SwiftUI

/// SCR-004 Event Detail (ui-screens.md §5, H-1) — "予想と結果、その結果に
/// よる相場の反応を一画面で理解する". Display order is fixed by H-1:
/// 指標名/国地域/通貨/重要度/発表日時 → Forecast/Actual/Previous → Surprise
/// → 乖離理由 → 市場への影響 → 関連FXペア/Reaction.
///
/// Rebuilt under HQ's "UI全面再構築" instruction (2026-09-18, Phase UI-3) —
/// same `EventDetailViewModel`/data contract and the same H-1 information
/// order, restyled: Forecast/Actual/Previous as a single tabular-digit
/// comparison row, Surprise promoted to its own elevated card (the
/// "予想→実績→Surprise→FX反応" chain HQ wants understood at a glance means
/// Surprise can't look like just another line of text), and one pink CTA
/// ("値動きの詳細を見る") for the primary FX pair in addition to — not
/// instead of — each pair's own row staying individually tappable (no
/// navigation capability removed).
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
                adaptiveBody(response)
                    .padding(DesignTokens.Spacing.md)
                    .adaptiveContentWidth()
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    /// iPad: 指標情報を左、市場への影響を右に置き、iPhoneでは縦積み
    /// (HQ「iPadをiPhoneの引き伸ばし版にしない」§20)。予想/結果/Surpriseは
    /// どちらの幅でも常に最上部・単一カラムで表示する — この画面の主役。
    @ViewBuilder
    private func adaptiveBody(_ response: EventDetailResponse) -> some View {
        ViewThatFits(in: .horizontal) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                header(response.event)
                forecastActualPreviousSection(response)
                if response.event.status == .released, response.event.dataStatus == .ready {
                    surpriseSection(response)
                }
                HStack(alignment: .top, spacing: DesignTokens.Spacing.lg) {
                    if let explanation = response.explanation {
                        explanationSection(explanation)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    relatedFxPairsSection(response.relatedFxPairs, event: response.event)
                        .frame(width: 360, alignment: .leading)
                }
            }
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
        }
    }

    // MARK: - 指標名 / 国・地域 / 通貨 / 重要度 / 発表日時

    private func header(_ event: EventDetailEvent) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            HStack(alignment: .top) {
                Text(CountryFlag.emoji(for: event.countryCode))
                    .font(.system(size: 34))
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.indicatorName)
                        .font(DesignTokens.Typography.headline)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                    Text(event.currencyCode)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
                Spacer()
                Text(event.importance.starDisplay)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.accentPrimary)
            }
            HStack(spacing: DesignTokens.Spacing.xs) {
                Text(ValueFormat.dateTime(event.releaseDatetime))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                statusBadge(event.status)
                if event.revisionStatus == .revised {
                    FXBadge(text: "改定あり", tone: .info)
                }
            }
        }
    }

    private func statusBadge(_ status: EventStatus) -> some View {
        switch status {
        case .scheduled:
            return FXBadge(text: "発表前", tone: .neutral)
        case .released:
            return FXBadge(text: "発表済み", tone: .negative)
        case .cancelled:
            return FXBadge(text: "中止", tone: .neutral)
        }
    }

    // MARK: - Forecast / Actual / Previous

    @ViewBuilder
    private func forecastActualPreviousSection(_ response: EventDetailResponse) -> some View {
        let event = response.event
        Group {
            switch event.dataStatus {
            case .dataPending:
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .fxCard(.surface)
            case .dataUnavailable:
                Text(event.dataStatus.label)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.statusError)
                    .fxCard(.surface)
            default:
                HStack(spacing: DesignTokens.Spacing.lg) {
                    MetricTile(title: "予想 (Forecast)", value: ValueFormat.number(response.snapshot?.forecast))
                    MetricTile(
                        title: "結果 (Actual)",
                        value: event.status == .released ? ValueFormat.number(response.snapshot?.actual) : "--",
                        emphasized: true
                    )
                    MetricTile(title: "前回 (Previous)", value: ValueFormat.number(response.snapshot?.previous))
                }
                .fxCard(.surface)
            }
        }
    }

    // MARK: - Surprise

    private func surpriseSection(_ response: EventDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text("SURPRISE")
                .font(DesignTokens.Typography.captionEmphasized)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            if let surprise = response.analysis.surprise, let direction = response.analysis.surpriseDirection {
                if let comparisonLabel = ValueFormat.surpriseComparisonLabel(surprise) {
                    Text(comparisonLabel)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                }
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.sm) {
                    Image(systemName: direction == .negative ? "arrow.down.right" : direction == .positive ? "arrow.up.right" : "arrow.right")
                        .font(.system(size: 20, weight: .bold))
                    Text(ValueFormat.number(surprise, signed: true))
                        .font(DesignTokens.Typography.numericLarge)
                    Text(direction.label)
                        .font(DesignTokens.Typography.caption)
                        .padding(.top, 6)
                }
                .foregroundStyle(DesignTokens.Colors.directional(direction))
            } else {
                Text("Forecastが存在しないため、Surprise分析対象外です。")
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fxCard(.elevated)
    }

    // MARK: - 乖離理由 (事実要約・出典URL)

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
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
                        .foregroundStyle(DesignTokens.Colors.accentCyan)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fxCard(.surface)
    }

    // MARK: - 市場への影響 / 関連FXペア・Reaction

    private func relatedFxPairsSection(_ pairs: [EventRelatedFxPair], event: EventDetailEvent) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            SectionHeader(title: "市場への影響", subtitle: "関連通貨ペア")
            if pairs.isEmpty {
                Text("関連する通貨ペアはありません。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            } else {
                VStack(spacing: DesignTokens.Spacing.sm) {
                    ForEach(pairs) { pair in
                        NavigationLink(value: AppRoute.movementDetail(
                            eventId: event.id,
                            indicatorId: event.indicatorId,
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

                // Phase 4.5 UX audit: "結果は分かった → どれくらい動いたか"
                // needed a clear, single next step, not just per-row taps —
                // HQ's UI rebuild §11 asks for this as an explicit CTA.
                if let primaryPair = pairs.first {
                    NavigationLink(value: AppRoute.movementDetail(
                        eventId: event.id,
                        indicatorId: event.indicatorId,
                        fxPairId: primaryPair.fxPairId,
                        symbol: primaryPair.symbol,
                        indicatorName: event.indicatorName,
                        releaseDatetime: event.releaseDatetime
                    )) {
                        FXPrimaryCTAButton(title: "値動きの詳細を見る")
                    }

                    // Phase 4.5 UX audit: "結果は分かった → 過去と比べてどうか"
                    // needed a direct jump, not a detour through re-searching
                    // the indicator (HQ Phase 5 §5). Reuses the highest-priority
                    // related pair, same as Indicator Detail's own link.
                    NavigationLink(value: AppRoute.historicalComparison(
                        indicatorId: event.indicatorId,
                        indicatorName: event.indicatorName,
                        fxPairId: primaryPair.fxPairId,
                        fxPairSymbol: primaryPair.symbol
                    )) {
                        FXActionRow(title: "過去の発表と比較する", systemImage: "clock.arrow.circlepath")
                    }
                }
            }
        }
    }

    private func reactionRow(_ pair: EventRelatedFxPair) -> some View {
        HStack {
            Text(pair.symbol)
                .font(DesignTokens.Typography.bodyEmphasized)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Spacer()
            switch pair.reaction.analysisStatus {
            case .ready:
                VStack(alignment: .trailing, spacing: 2) {
                    Text(ValueFormat.pips(pair.reaction.pips))
                        .font(DesignTokens.Typography.numericCaption)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                    Text(ValueFormat.percent(pair.reaction.changePercent, signed: true))
                        .font(DesignTokens.Typography.numericCaption)
                        .foregroundStyle(DesignTokens.Colors.directional(pair.reaction.changePercent))
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
        .fxCard(.surface)
    }
}
